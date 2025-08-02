// Google Sheets Configuration
let SHEETS_URL = '';
let SHEETS_NAME = '';
let CLIENT_ID = '';
let gapi = null;
let isGapiLoaded = false;
let isGisLoaded = false;
let tokenClient = null;

// Global callback functions for Google API
window.gapiLoadCallback = function() {
    gapi = window.gapi;
    gapi.load('client', async () => {
        await gapi.client.init({
            discoveryDocs: ['https://sheets.googleapis.com/$discovery/rest?version=v4'],
        });
        isGapiLoaded = true;
        maybeEnableButtons();
    });
};

window.gisLoadCallback = function() {
    // CLIENT_ID should be set by now from handleInviteRoute
    const clientId = getCookie('client_id');
    if (!clientId) {
        console.error('Client ID not available');
        return;
    }
    
    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: 'https://www.googleapis.com/auth/spreadsheets',
        callback: (resp) => {
            if (resp.error !== undefined) {
                console.error('OAuth error:', resp);
                showError('Anmeldung fehlgeschlagen: ' + resp.error);
                return;
            }
            // Cache the token with long expiration
            setCookie('oauth_token', resp.access_token, 365); // 1 year
            if (resp.expires_in) {
                const expiresAt = Date.now() + (resp.expires_in * 1000);
                setCookie('oauth_token_expires', expiresAt.toString(), 365);
            }
            onAuthSuccess();
        },
    });
    isGisLoaded = true;
    maybeEnableButtons();
};

// Global state
let currentUser = '';
let books = [];
let currentFilter = 'all';
let editingBook = null; // Track which book is being edited
let isAddingBook = false; // Prevent multiple simultaneous book additions

// Voting state
let userVotes = {}; // Only store current user's votes: { points: bookId, ... }
let isVotingMode = false; // Toggle between normal and voting mode
let votingPhase = false; // Whether voting is currently active
let readyCheckInterval = null; // Interval for checking if all users are ready
let isVoteCompleted = false; // Whether voting has been completed
let votingResults = null; // Store the voting results

// Initialize the app
document.addEventListener('DOMContentLoaded', function() {
    handleInviteRoute();
    initializeApp();
    setupEventListeners();
    updateTitleForScreenSize();
    
    // Update title on window resize
    window.addEventListener('resize', updateTitleForScreenSize);
});

// Handle /invite route with Google Sheets parameters
function handleInviteRoute() {
    const urlParams = new URLSearchParams(window.location.search);
    const sheetsId = urlParams.get('d');  // Only the spreadsheet ID
    const sheetsName = urlParams.get('s');
    const clientId = urlParams.get('c');  // OAuth2 Client ID
    
    if (sheetsId && sheetsName && clientId) {
        // Store Google Sheets configuration in cookies
        setCookie('sheets_id', sheetsId);  // Store just the ID
        setCookie('sheets_name', sheetsName);
        setCookie('client_id', clientId);
        
        // Redirect to main app (remove query parameters)
        window.history.replaceState({}, document.title, window.location.pathname);
    }
    
    // Load Google Sheets configuration from cookies
    const SHEETS_ID = getCookie('sheets_id');
    SHEETS_NAME = getCookie('sheets_name');
    CLIENT_ID = getCookie('client_id');
    
    // Construct full URL from ID
    if (SHEETS_ID) {
        SHEETS_URL = `https://docs.google.com/spreadsheets/d/${SHEETS_ID}/edit`;
    }
    
    // Check if we have all required configuration
    if (!SHEETS_ID || !SHEETS_NAME || !CLIENT_ID) {
        showConfigModal();
        return;
    }
    
    // Initialize Google API
    initializeGoogleAPI();
}

// Initialize the application
function initializeApp() {
    // Check if Google Sheets configuration is available
    const SHEETS_ID = getCookie('sheets_id');
    if (!SHEETS_ID || !SHEETS_NAME || !CLIENT_ID) {
        showError('Fehlerhafte Konfiguration, bitte verwende einen gültigen Einladungslink.');
        return;
    }
    
    // Construct full URL from ID if not already set
    if (!SHEETS_URL && SHEETS_ID) {
        SHEETS_URL = `https://docs.google.com/spreadsheets/d/${SHEETS_ID}/edit`;
    }
    
    // Initialize Google API is handled in handleInviteRoute
    // The rest of the initialization will be called from onAuthSuccess
    
    const savedName = getCookie('bookclub_username');
    if (savedName) {
        currentUser = savedName;
        updateUIForUserMode();
    }
}

// Setup event listeners
function setupEventListeners() {
    // Config modal close button
    document.getElementById('closeConfigBtn').addEventListener('click', hideConfigModal);
    
    // Config modal generate link button
    document.getElementById('generateLinkBtn').addEventListener('click', generateInviteLink);
    
    // Logout button
    document.getElementById('logoutBtn').addEventListener('click', logout);
    
    // Auth modal sign in button
    document.getElementById('signInBtn').addEventListener('click', function() {
        if (isGapiLoaded && isGisLoaded) {
            tokenClient.requestAccessToken({prompt: 'select_account'});
        }
    });
    
    // Add Book Modal functionality
    document.getElementById('addBookModalBtn').addEventListener('click', showAddBookModal);
    
    // Clear form button
    document.getElementById('clearFormBtn').addEventListener('click', clearForm);
    
    // Form submission
    document.getElementById('addBookForm').addEventListener('submit', function(e) {
        e.preventDefault();
        addBook();
    });
    
    // Edit book modal
    document.getElementById('saveEditBtn').addEventListener('click', saveEditedBook);
    document.getElementById('cancelEditBtn').addEventListener('click', hideEditModal);
    document.getElementById('deleteBookBtn').addEventListener('click', deleteBook);
    
    // Filter tabs - event listeners will be attached in updateTabsWithUsers()
    // No longer using filter tabs here as they're dynamically generated
    
    // Remove user filter dropdown functionality
    // Now using tabs instead
    
    // Add refresh button functionality
    const refreshBtn = document.getElementById('refreshBtn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', function() {
            loadBooks();
            showSuccess('Vorschläge werden geladen...');
        });
    }
    
    // Voting mode functionality
    const votingModeBtn = document.getElementById('votingModeBtn');
    if (votingModeBtn) {
        votingModeBtn.addEventListener('click', toggleVotingMode);
    }
    
    // Ready checkbox functionality
    const readyCheckbox = document.getElementById('readyCheckbox');
    if (readyCheckbox) {
        readyCheckbox.addEventListener('change', handleReadyToggle);
    }
}

// Cookie functions
function setCookie(name, value, days = 365) {
    // Set cookie with specified expiration (default 1 year for better caching)
    const expirationDate = new Date();
    expirationDate.setDate(expirationDate.getDate() + days);
    document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expirationDate.toUTCString()}; path=/; SameSite=Lax`;
}

function getCookie(name) {
    const nameEQ = name + "=";
    const ca = document.cookie.split(';');
    for(let i = 0; i < ca.length; i++) {
        let c = ca[i];
        while (c.charAt(0) === ' ') c = c.substring(1, c.length);
        if (c.indexOf(nameEQ) === 0) return decodeURIComponent(c.substring(nameEQ.length, c.length));
    }
    return null;
}

function deleteCookie(name) {
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
}

// Update title based on screen size
function updateTitleForScreenSize() {
    const titleElement = document.querySelector('.md3-top-app-bar-headline');
    if (titleElement) {
        if (window.innerWidth <= 768) {
            titleElement.textContent = 'BuVoWerk';
        } else {
            titleElement.textContent = 'Buchvorschlag Werkzeug';
        }
    }
}

// Modal functions
function showAuthModal() {
    const modal = document.getElementById('authModal');
    modal.classList.add('show');
    
    // Hide other modals
    hideNameModal();
}

function hideAuthModal() {
    const modal = document.getElementById('authModal');
    modal.classList.remove('show');
}

function showNameModal() {
    const modal = document.getElementById('nameModal');
    modal.classList.add('show');
    
    // Show loading state and load available names only if authenticated
    document.getElementById('loadingNames').style.display = 'block';
    document.getElementById('nameSelectionContainer').style.display = 'none';
    document.getElementById('nameError').style.display = 'none';
    
    // Only load names if we have a valid token
    if (gapi && gapi.client.getToken()) {
        loadAvailableNames();
    } else {
        // Hide name modal and show auth modal instead
        hideNameModal();
        showAuthModal();
    }
}

async function loadAvailableNames() {
    try {
        const SHEETS_ID = getCookie('sheets_id');
        if (!SHEETS_ID || !SHEETS_NAME) {
            throw new Error('Google Sheets Konfiguration fehlt');
        }
        
        // Check if we have a valid token
        if (!gapi || !gapi.client.getToken()) {
            throw new Error('Nicht authentifiziert');
        }
        
        // Fetch data from Google Sheets to get available names using OAuth2
        const range = `${SHEETS_NAME}!I4:Z4`; // Names are stored in row 4, starting from column I

        const response = await gapi.client.sheets.spreadsheets.values.get({
            spreadsheetId: SHEETS_ID,
            range: range,
        });
        
        const nameRow = response.result.values?.[0] || [];
        
        // Process names until we find a duplicate or empty cell
        const uniqueNames = [];
        const seenNames = new Set();
        
        for (const name of nameRow) {
            if (!name || !name.trim() || seenNames.has(name.trim()) || name.trim() === "Ergebnis") {
                break; // Stop at first empty cell or duplicate
            }
            seenNames.add(name.trim());
            uniqueNames.push(name.trim());
        }
        
        // Sort alphabetically
        uniqueNames.sort();
        
        // Create the button grid
        const nameButtonGrid = document.getElementById('nameButtonGrid');
        nameButtonGrid.innerHTML = '';
        
        uniqueNames.forEach(name => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'name-button';
            button.textContent = name;
            button.dataset.name = name;
            
            // Pre-select current user if changing name
            if (currentUser && currentUser === name) {
                button.classList.add('selected');
            }
            
            // Add click handler
            button.addEventListener('click', function() {
                // Remove selected class from all buttons
                document.querySelectorAll('.name-button').forEach(btn => {
                    btn.classList.remove('selected');
                });
                
                // Add selected class to clicked button
                this.classList.add('selected');
                
                // Directly save the selected name
                currentUser = name;
                setCookie('bookclub_username', name);
                updateUIForUserMode();
                hideNameModal();
                
                // Load books if this is initial setup
                if (books.length === 0) {
                    loadBooks();
                } else {
                    renderBooks(); // Re-render to update filters
                }
            });
            
            nameButtonGrid.appendChild(button);
        });
        
        // Show the selection container
        document.getElementById('loadingNames').style.display = 'none';
        document.getElementById('nameSelectionContainer').style.display = 'block';
        
    } catch (error) {
        console.error('Error loading available names:', error);
        
        // If authentication error, clear cached tokens and try to re-authenticate
        if (error.status === 401 || error.message.includes('authentication')) {
            deleteCookie('oauth_token');
            deleteCookie('oauth_token_expires');
            gapi.client.setToken('');
            
            // Show error and trigger re-authentication
            document.getElementById('loadingNames').style.display = 'none';
            document.getElementById('nameError').style.display = 'block';
            
            // Auto-trigger re-authentication after a short delay
            setTimeout(() => {
                hideNameModal();
                showAuthModal();
            }, 2000);
            return;
        }
        
        // Show error state
        document.getElementById('loadingNames').style.display = 'none';
        document.getElementById('nameError').style.display = 'block';
    }
}

function hideNameModal() {
    const modal = document.getElementById('nameModal');
    modal.classList.remove('show');
}

function showConfigModal() {
    const modal = document.getElementById('configModal');
    modal.classList.add('show');
    
    // Hide other modals
    hideAuthModal();
    hideNameModal();
}

function hideConfigModal() {
    const modal = document.getElementById('configModal');
    modal.classList.remove('show');
}

function generateInviteLink() {
    const sheetUrl = document.getElementById('configSheetUrl').value.trim();
    const sheetName = document.getElementById('configSheetName').value.trim();
    const clientId = document.getElementById('configClientId').value.trim();
    
    if (!sheetUrl || !sheetName || !clientId) {
        showError('Bitte fülle alle Felder aus.');
        return;
    }
    
    // Extract sheet ID from URL
    const sheetId = extractSpreadsheetId(sheetUrl);
    if (!sheetId) {
        showError('Ungültige Google Sheet URL.');
        return;
    }
    
    // Generate the invite link
    const baseUrl = window.location.origin + window.location.pathname;
    const inviteLink = `${baseUrl}?d=${encodeURIComponent(sheetId)}&s=${encodeURIComponent(sheetName)}&c=${encodeURIComponent(clientId)}`;
    
    // Show the generated link
    document.getElementById('inviteLink').style.display = 'block';
    document.getElementById('generatedLink').value = inviteLink;
}

function copyInviteLink() {
    const linkInput = document.getElementById('generatedLink');
    linkInput.select();
    document.execCommand('copy');
    
    showSuccess('Link wurde in die Zwischenablage kopiert!');
}

// UI Mode functions
function updateUIForUserMode() {
    const userInfo = document.getElementById('userInfo');
    
    // Show normal user UI
    userInfo.style.display = 'flex';
    
    document.getElementById('currentUser').textContent = currentUser;
    
    // Reset voting state for new user
    userVotes = {};
    isVotingMode = false;
    updateVotingModeUI();
}

function logout() {
    // Revoke Google OAuth token
    if (gapi && gapi.client.getToken()) {
        const token = gapi.client.getToken();
        if (token !== null) {
            google.accounts.oauth2.revoke(token.access_token);
            gapi.client.setToken('');
        }
    }
    
    // Clear all cached data
    deleteCookie('bookclub_username');
    deleteCookie('oauth_token');
    deleteCookie('oauth_token_expires');
    
    currentUser = '';
    books = [];
    currentFilter = 'all';
    
    // Hide user info and show config modal if no configuration is present
    document.getElementById('userInfo').style.display = 'none';
    
    const SHEETS_ID = getCookie('sheets_id');
    if (!SHEETS_ID || !SHEETS_NAME || !CLIENT_ID) {
        showConfigModal();
    } else {
        showAuthModal();
    }
}

function clearForm() {
    // Clear all form fields
    document.getElementById('bookTitle').value = '';
    document.getElementById('bookAuthor').value = '';
    document.getElementById('bookGenre').value = '';
    document.getElementById('bookDescription').value = '';
    document.getElementById('bookPages').value = '';
    document.getElementById('bookYear').value = '';
    
    // Focus on title field
    document.getElementById('bookTitle').focus();
}

// Loading functions
function showLoading() {
    document.getElementById('loadingIndicator').classList.add('show');
}

function hideLoading() {
    document.getElementById('loadingIndicator').classList.remove('show');
}

// Google API initialization
function initializeGoogleAPI() {
    // The callbacks are now defined globally at the top of the file
    // Just check if APIs are already loaded
    if (window.gapi) {
        gapiLoadCallback();
    }
    if (window.google && window.google.accounts) {
        gisLoadCallback();
    }
}

function maybeEnableButtons() {
    if (isGapiLoaded && isGisLoaded) {
        // Check if we have a cached valid token
        const cachedToken = getCookie('oauth_token');
        const tokenExpires = getCookie('oauth_token_expires');
        
        if (cachedToken && tokenExpires && Date.now() < (parseInt(tokenExpires) - 60000)) { // 1 minute buffer
            // Use cached token
            gapi.client.setToken({
                access_token: cachedToken
            });
            onAuthSuccess();
        } else {
            // Clear expired/invalid tokens
            deleteCookie('oauth_token');
            deleteCookie('oauth_token_expires');
            // Show auth modal instead of auto-triggering
            showAuthModal();
        }
    }
}

function onAuthSuccess() {
    console.log('Google OAuth authentication successful');
    
    // Hide auth modal
    hideAuthModal();
    
    // If name modal is open, load available names
    const nameModal = document.getElementById('nameModal');
    if (nameModal && nameModal.classList.contains('show')) {
        loadAvailableNames();
        return;
    }
    
    // Continue with app initialization
    if (!currentUser) {
        showNameModal();
    } else {
        loadBooks();
    }
}

// Google Sheets API functions
async function loadBooks() {
    showLoading();
    
    try {
        const SHEETS_ID = getCookie('sheets_id');
        if (!SHEETS_ID || !SHEETS_NAME || !CLIENT_ID) {
            throw new Error('Google Sheets Konfiguration fehlt');
        }
        
        // Check if we have a valid token
        if (!gapi.client.getToken()) {
            throw new Error('Nicht authentifiziert');
        }
        
        // Use Google Sheets API v4 with OAuth2
        const spreadsheetId = SHEETS_ID;
        const range = `${SHEETS_NAME}!A5:H1000`; // Only need columns A-H for book data
        
        const response = await gapi.client.sheets.spreadsheets.values.get({
            spreadsheetId: spreadsheetId,
            range: range,
        });
        
        books = await parseGoogleSheetsData(response.result.values || []);
        
        // Check if voting is completed
        await checkVotingCompletedState();
        
        renderBooks();
        
    } catch (error) {
        console.error('Error loading books:', error);
        
        // Handle authentication errors
        if (error.status === 401 || error.message.includes('authentication') || error.message === 'Nicht authentifiziert') {
            // Clear cached tokens
            deleteCookie('oauth_token');
            deleteCookie('oauth_token_expires');
            gapi.client.setToken('');
            
            showAuthModal();
        } else {
            showError('Bücher konnten nicht geladen werden: ' + error.message);
            books = [];
            renderBooks();
        }
    } finally {
        hideLoading();
    }
}

async function checkVotingCompletedState() {
    try {
        const SHEETS_ID = getCookie('sheets_id');
        
        // Get users and their ready status
        const usersRange = `${SHEETS_NAME}!I3:Z4`; // Row 3 for ready status, row 4 for names
        const response = await gapi.client.sheets.spreadsheets.values.get({
            spreadsheetId: SHEETS_ID,
            range: usersRange,
        });
        
        const data = response.result.values || [];
        const readyRow = data[0] || [];
        const nameRow = data[1] || [];
        
        // Check if all users are finished (vote completed state)
        let allFinished = true;
        let hasUsers = false;
        
        for (let i = 0; i < nameRow.length; i++) {
            if (nameRow[i] && nameRow[i].trim() && nameRow[i].trim() !== "Ergebnis") {
                hasUsers = true;
                const status = readyRow[i] ? readyRow[i].trim() : '';
                if (status !== 'fertig') {
                    allFinished = false;
                    break;
                }
            } else if (nameRow[i] && nameRow[i].trim() === "Ergebnis") {
                break; // Stop at Ergebnis column
            }
        }
        
        // If all users are finished, we're in completed state
        if (allFinished && hasUsers) {
            isVoteCompleted = true;
            isVotingMode = false;
            
            // Load results if not already loaded
            if (!votingResults) {
                const results = await calculateFinalResults();
                votingResults = results;
            }
        } else {
            isVoteCompleted = false;
            votingResults = null;
        }
        
        // Update UI to reflect current state
        updateVotingModeUI();
        
    } catch (error) {
        console.error('Error checking voting completed state:', error);
        // Don't throw error, just continue with normal loading
    }
}

function extractSpreadsheetId(url) {
    const regex = /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/;
    const match = url.match(regex);
    return match ? match[1] : null;
}

async function parseGoogleSheetsData(rows) {
    const books = [];
    
    for (const row of rows) {
        // Skip empty rows
        if (!row || row.length === 0 || !row[2] || !row[3]) continue;
        
        // Columns: SuggestedBy, Funfacts, Buchtitel, Autor, Jahr, Seitenzahl, Genres, Kurzbeschreibung
        const book = {
            title: row[2] || '',           // Buchtitel
            author: row[3] || '',          // Autor
            year: row[4] || '',            // Jahr - keep as string
            pages: row[5] || '',           // Seitenzahl - keep as string
            description: row[7] || '',      // Kurzbeschreibung
            genres: row[6] || '',          // Genres
            suggestedBy: row[0] || 'Unbekannt' // SuggestedBy
        };
        
        books.push(book);
    }
    
    return books;
}

async function saveBooks() {
    // For Google Sheets, we'll handle saving differently
    // This function is now mainly used as a placeholder for compatibility
    // Individual book operations will handle the Google Sheets updates
    return true;
}

// Add book to Google Sheets using OAuth2 - insert at correct position within user group
async function appendBookToSheet(book) {
    try {
        const SHEETS_ID = getCookie('sheets_id');
        if (!SHEETS_ID || !SHEETS_NAME || !CLIENT_ID) {
            throw new Error('Google Sheets Konfiguration fehlt');
        }
        
        // Check if we have a valid token
        if (!gapi.client.getToken()) {
            throw new Error('Nicht authentifiziert');
        }
        
        const spreadsheetId = SHEETS_ID;
        
        // First, read the entire sheet to find the correct insertion point
        const readRange = `${SHEETS_NAME}!A5:H1000`;
        const readResponse = await gapi.client.sheets.spreadsheets.values.get({
            spreadsheetId: spreadsheetId,
            range: readRange,
        });
        
        const existingRows = readResponse.result.values || [];
        
        // Also read the user names row to determine the result column
        const usersRange = `${SHEETS_NAME}!I4:Z4`; // Names are in row 4, starting from column I
        const usersResponse = await gapi.client.sheets.spreadsheets.values.get({
            spreadsheetId: spreadsheetId,
            range: usersRange,
        });
        
        const userNames = usersResponse.result.values?.[0] || [];
        
        // Find the last user column and determine result column
        let lastUserColumnIndex = -1;
        for (let i = 0; i < userNames.length; i++) {
            if (userNames[i] && userNames[i].trim() && userNames[i].trim() !== "Ergebnis") {
                lastUserColumnIndex = i;
            } else {
                break; // Stop at first empty or "Ergebnis" column
            }
        }
        
        // Find the last row for this user or determine where to insert
        let insertRowIndex = findInsertionRowForUser(existingRows, book.suggestedBy);
        
        // Prepare the values in the correct order based on the sheet structure
        // Columns: SuggestedBy, Funfacts, Buchtitel, Autor, Jahr, Seitenzahl, Genres, Kurzbeschreibung
        const values = [[
            book.suggestedBy,    // SuggestedBy (Column A)
            '',                  // Funfacts (Column B) - leave empty for now
            book.title,          // Buchtitel (Column C)
            book.author,         // Autor (Column D)
            book.year || '',     // Jahr (Column E) - keep as string
            book.pages || '',    // Seitenzahl (Column F) - keep as string
            book.genre || '',    // Genres (Column G)
            book.description || '' // Kurzbeschreibung (Column H)
        ]];
        
        // Insert at the specific row position
        const insertRange = `${SHEETS_NAME}!A${insertRowIndex + 5}:H${insertRowIndex + 5}`;
        
        // Get sheet metadata to find the correct sheet ID
        const sheetMetadata = await gapi.client.sheets.spreadsheets.get({
            spreadsheetId: spreadsheetId
        });
        
        const targetSheet = sheetMetadata.result.sheets.find(sheet => 
            sheet.properties.title === SHEETS_NAME
        );
        
        if (!targetSheet) {
            throw new Error(`Sheet "${SHEETS_NAME}" nicht gefunden`);
        }
        
        const sheetId = targetSheet.properties.sheetId;
        
        // Use batchUpdate to insert rows at specific position
        const batchUpdateResponse = await gapi.client.sheets.spreadsheets.batchUpdate({
            spreadsheetId: spreadsheetId,
            resource: {
                requests: [
                    {
                        insertRange: {
                            range: {
                                sheetId: sheetId,
                                startRowIndex: insertRowIndex + 4, // +4 because header starts at row 5 (0-indexed)
                                endRowIndex: insertRowIndex + 5
                                // No startColumnIndex/endColumnIndex = entire row
                            },
                            shiftDimension: 'ROWS'
                        }
                    }
                ]
            }
        });
        
        // Now insert the data
        const updateResponse = await gapi.client.sheets.spreadsheets.values.update({
            spreadsheetId: spreadsheetId,
            range: insertRange,
            valueInputOption: 'USER_ENTERED',
            resource: {
                values: values
            }
        });
        
        // Add SUM formula to result column if users exist
        if (lastUserColumnIndex >= 0) {
            const resultColumnIndex = lastUserColumnIndex + 1; // Next column after last user
            const resultColumnLetter = String.fromCharCode(73 + resultColumnIndex); // 73 = 'I'
            const firstUserColumnLetter = 'I'; // First user column is always I
            const lastUserColumnLetter = String.fromCharCode(73 + lastUserColumnIndex); // Last user column
            const resultRowNumber = insertRowIndex + 5; // Adjust for header rows
            
            const sumFormula = `=SUM(${firstUserColumnLetter}${resultRowNumber}:${lastUserColumnLetter}${resultRowNumber})`;
            const resultRange = `${SHEETS_NAME}!${resultColumnLetter}${resultRowNumber}`;
            
            await gapi.client.sheets.spreadsheets.values.update({
                spreadsheetId: spreadsheetId,
                range: resultRange,
                valueInputOption: 'USER_ENTERED',
                resource: {
                    values: [[sumFormula]]
                }
            });
            
            // console.log('Added SUM formula:', sumFormula, 'to', resultRange);
        }
        
        console.log('Successfully inserted book at row', insertRowIndex + 5, ':', updateResponse.result);
        return true;
        
    } catch (error) {
        console.error('Error saving book to sheets:', error);
        throw error;
    }
}

// Helper function to find the correct insertion row for a user's book
function findInsertionRowForUser(existingRows, userName) {
    let userGroupStart = -1;
    let userGroupEnd = -1;
    let currentGroup = null;
    
    // Go through all rows to find user groups
    for (let i = 0; i < existingRows.length; i++) {
        const row = existingRows[i];
        if (!row || row.length === 0) continue;
        
        const rowUser = row[0] ? row[0].trim() : '';
        
        // If this row has a user name (not empty)
        if (rowUser) {
            // If we're starting a new group
            if (currentGroup !== rowUser) {
                // If we were tracking our target user, mark the end of their group
                if (currentGroup === userName && userGroupStart >= 0) {
                    userGroupEnd = i - 1;
                    break;
                }
                
                currentGroup = rowUser;
                
                // If this is our target user, remember the start of their group
                if (rowUser === userName) {
                    userGroupStart = i;
                }
            }
        } else if (currentGroup === userName) {
            // Empty user cell but we're in the target user's group
            userGroupEnd = i;
        }
    }
    
    // If we reached the end and were still in the target user's group
    if (currentGroup === userName && userGroupStart >= 0 && userGroupEnd === -1) {
        userGroupEnd = existingRows.length - 1;
    }
    
    // If user has existing entries, insert at second-to-last position (-2)
    if (userGroupStart >= 0 && userGroupEnd >= 0) {
        // Always insert at the end of the group for consistency
        return userGroupEnd;
    }
    
    // If user doesn't exist yet, find where to insert alphabetically
    const users = [];
    currentGroup = null;
    
    for (let i = 0; i < existingRows.length; i++) {
        const row = existingRows[i];
        if (!row || row.length === 0) continue;
        
        const rowUser = row[0] ? row[0].trim() : '';
        if (rowUser && rowUser !== currentGroup) {
            users.push({ name: rowUser, row: i });
            currentGroup = rowUser;
        }
    }
    
    // Find alphabetical position
    users.sort((a, b) => a.name.localeCompare(b.name));
    
    for (let i = 0; i < users.length; i++) {
        if (userName.localeCompare(users[i].name) < 0) {
            return users[i].row;
        }
    }
    
    // Insert at the end if user comes last alphabetically
    return existingRows.length;
}

// Book management
async function addBook() {
    // Prevent multiple simultaneous executions
    if (isAddingBook) {
        return;
    }
    isAddingBook = true;
    
    const title = document.getElementById('bookTitle').value.trim();
    const author = document.getElementById('bookAuthor').value.trim();
    const genre = document.getElementById('bookGenre').value.trim();
    const description = document.getElementById('bookDescription').value.trim();
    const pages = document.getElementById('bookPages').value.trim();
    const year = document.getElementById('bookYear').value.trim();
    
    if (!title || !author) {
        alert('Bitte gib sowohl Titel als auch Autor an.');
        isAddingBook = false;
        return;
    }
    
    // Check for duplicates
    const duplicate = books.find(book => 
        book.title.toLowerCase() === title.toLowerCase() && 
        book.author.toLowerCase() === author.toLowerCase()
    );
    
    if (duplicate) {
        alert('Dieses Buch wurde bereits vorgeschlagen.');
        isAddingBook = false;
        return;
    }
    
    showLoading();
    
    try {
        // Add book to Google Sheets using OAuth2
        const success = await appendBookToSheet({
            title,
            author,
            genre,
            year,
            pages,
            description,
            suggestedBy: currentUser
        });
        
        if (success) {
           // Clear form and hide modal
            clearForm();
            hideAddBookModal();
            
            // Reload books to show the new entry
            setTimeout(() => loadBooks(), 1000);
        }
    } catch (error) {
        console.error('Error adding book:', error);
        
        // Handle authentication errors
        if (error.status === 401 || error.message.includes('authentication') || error.message === 'Nicht authentifiziert') {
            // Clear cached tokens
            deleteCookie('oauth_token');
            deleteCookie('oauth_token_expires');
            gapi.client.setToken('');
            
            showAuthModal();
        } else {
            showError('Fehler beim Hinzufügen des Buchvorschlags: ' + error.message);
        }
    } finally {
        hideLoading();
        isAddingBook = false;
    }
}

// Add Book Modal functions
function showAddBookModal() {
    // Prevent opening in voting mode
    if (isVotingMode && !isVoteCompleted) {
        return;
    }
    
    const modal = document.getElementById('addBookModal');
    modal.classList.add('show');
    
    // Clear form when opening
    clearForm();
    
    // Focus on first field
    setTimeout(() => {
        document.getElementById('bookTitle').focus();
    }, 100);
    
    // Add event listener for clicking outside modal
    const handleOutsideClick = (e) => {
        if (e.target === modal) {
            hideAddBookModal();
        }
    };
    modal.addEventListener('click', handleOutsideClick);
    
    // Remove event listener when modal is closed
    modal.addEventListener('hide', () => {
        modal.removeEventListener('click', handleOutsideClick);
    }, { once: true });
}

function hideAddBookModal() {
    const modal = document.getElementById('addBookModal');
    // Trigger hide event to remove event listeners
    modal.dispatchEvent(new Event('hide'));
    modal.classList.remove('show');
}

// Modal functions
let currentModalBook = null;

function showBookModal(title, author) {
    currentModalBook = books.find(b => b.title === title && b.author === author);
    if (!currentModalBook) return;

    const modal = document.getElementById('bookDetailModal');
    
    // Event-Handler für Klicks außerhalb des Modals
    const handleOutsideClick = (e) => {
        if (e.target === modal) {
            hideBookModal();
        }
    };
    modal.addEventListener('click', handleOutsideClick);
    
    // Event-Handler entfernen wenn Modal geschlossen wird
    modal.addEventListener('hide', () => {
        modal.removeEventListener('click', handleOutsideClick);
        currentModalBook = null;
    }, { once: true });
    
    updateModalContent();
    modal.classList.add('show');
}

function updateModalContent() {
    if (!currentModalBook) return;
    
    const modal = document.getElementById('bookDetailModal');
    const book = currentModalBook;
    const bookId = `${book.title}|${book.author}`;
    const hasVoted = userVotes[bookId];
    const votedPoints = hasVoted ? userVotes[bookId] : null;
    
    // Build voting buttons for modal - only show if voting is active and not completed
    let votingHTML = '';
    if (isVotingMode && !isVoteCompleted) {
        const usedPoints = Object.values(userVotes);
        const allPoints = [3, 2, 1];
        
        const buttonHTML = allPoints.map(points => {
            const isVotedForThisBook = hasVoted && votedPoints === points;
            
            if (isVotedForThisBook) {
                // This book has this vote - clicking will remove it
                return `<button class="md3-vote-number md3-vote-number-selected md3-vote-${points}" onclick="castVote('${escapeJsString(book.title)}', '${escapeJsString(book.author)}', ${points})">${points}</button>`;
            } else {
                // Available to vote - clicking will either add vote or replace existing vote
                return `<button class="md3-vote-number md3-vote-number-available md3-vote-${points}" onclick="castVote('${escapeJsString(book.title)}', '${escapeJsString(book.author)}', ${points})">${points}</button>`;
            }
        }).join('');
        
        votingHTML = `
            <div class="md3-voting-buttons">
                ${buttonHTML}
            </div>
        `;
    }
    
    modal.innerHTML = `
        <div class="md3-modal-content" style="max-width: 800px; padding: 32px; background: var(--md-sys-color-surface); border-radius: 28px; margin: 24px; box-shadow: 0 0 0 1px var(--md-sys-color-primary) inset, 0 0 20px 4px rgba(208, 188, 255, 0.15);">
            <div class="md3-book-detail">
                <div class="md3-book-detail-header">
                    <h2 class="md3-book-detail-title" style="font-size: 2em; margin-bottom: 8px;">${escapeHtml(book.title)}</h2>
                </div>
                <div class="md3-book-detail-author" style="font-size: 1.2em; margin-bottom: 24px; font-weight: 500; color: var(--md-sys-color-on-surface-variant);">${escapeHtml(book.author)}</div>
                
                ${book.description ? `<div class="md3-book-detail-description" style="margin: 12px 0; font-size: 1.1em; text-align: justify; line-height: 1.5; white-space: pre-line;">${escapeHtml(book.description.trim())}</div>` : ''}
                
                <div class="md3-book-detail-tags" style="margin: 24px 0; display: flex; flex-wrap: wrap; gap: 8px;">
                    ${book.year ? `
                        <div class="md3-book-detail-chip" style="white-space: nowrap;">
                            <span class="material-icons-round" style="font-size: 16px;">calendar_today</span>
                            ${book.year}
                        </div>
                    ` : ''}
                    
                    ${book.pages ? `
                        <div class="md3-book-detail-chip" style="white-space: nowrap;">
                            <span class="material-icons-round" style="font-size: 16px;">menu_book</span>
                            ${book.pages} Seiten
                        </div>
                    ` : ''}
                    
                    ${book.genres ? book.genres.split(/[,;]/).map(genre => genre.trim()).filter(genre => genre).map(genre => `
                        <div class="md3-book-detail-chip" style="white-space: nowrap;">
                            <span class="material-icons-round" style="font-size: 16px;">category</span>
                            ${escapeHtml(genre)}
                        </div>
                    `).join('') : ''}
                </div>
                
                <div class="md3-book-detail-footer">
                    <div class="md3-book-detail-suggested-by">
                        ${escapeHtml(book.suggestedBy)}
                    </div>
                    ${votingHTML}
                </div>
            </div>
        </div>
    `;
}



function hideBookModal() {
    const modal = document.getElementById('bookDetailModal');
    // Event auslösen, damit Event-Listener entfernt werden
    modal.dispatchEvent(new Event('hide'));
    modal.classList.remove('show');
}

// Edit functionality - disabled for Google Sheets
function editBook(title, author) {
    alert('Bearbeitung ist nicht verfügbar, da die Daten aus Google Sheets stammen. Bitte bearbeite das Buch direkt im Google Sheet.');
}

function showEditModal() {
    // Disabled for Google Sheets integration
}

function hideEditModal() {
    // Disabled for Google Sheets integration
}

async function saveEditedBook() {
    // Disabled for Google Sheets integration
    return false;
}

async function deleteBook() {
    // Disabled for Google Sheets integration
    alert('Löschen ist nicht verfügbar, da die Daten aus Google Sheets stammen. Bitte lösche das Buch direkt im Google Sheet.');
    return false;
}

// Voting functionality
function toggleVotingMode() {
    // Check if voting is completed first
    if (isVoteCompleted) {
        showVotingResults();
        return;
    }
    
    // If switching to voting mode, clear "bereit" status if it exists
    if (!isVotingMode) {
        clearReadyStatusIfNeeded();
    }
    
    isVotingMode = !isVotingMode;
    updateVotingModeUI();
    renderBooks(); // Re-render books to show/hide voting buttons
}

function updateVotingModeUI() {
    const votingModeBtn = document.getElementById('votingModeBtn');
    const votingInfo = document.getElementById('votingInfo');
    const addBookBtn = document.getElementById('addBookModalBtn');
    
    // Check if voting is completed
    if (isVoteCompleted) {
        votingModeBtn.classList.remove('md3-button-filled');
        votingModeBtn.classList.add('md3-button-outlined');
        votingModeBtn.innerHTML = '<span class="material-icons-round">poll</span><span>Ergebnisse anzeigen</span>';
        votingInfo.style.display = 'none';
        
        // Re-enable add book button when voting is completed
        if (addBookBtn) {
            addBookBtn.disabled = false;
            addBookBtn.style.opacity = '1';
            addBookBtn.style.cursor = 'pointer';
        }
        return;
    }
    
    if (isVotingMode) {
        votingModeBtn.classList.add('md3-button-filled');
        votingModeBtn.classList.remove('md3-button-outlined');
        votingModeBtn.innerHTML = '<span class="material-icons-round">close</span><span>Abstimmungsmodus</span>';
        votingInfo.style.display = 'flex';
        updateVotingCounter();
        
        // Disable add book button in voting mode
        if (addBookBtn) {
            addBookBtn.disabled = true;
            addBookBtn.style.opacity = '0.5';
            addBookBtn.style.cursor = 'not-allowed';
        }
    } else {
        votingModeBtn.classList.remove('md3-button-filled');
        votingModeBtn.classList.add('md3-button-outlined');
        votingModeBtn.innerHTML = '<span class="material-icons-round">how_to_vote</span><span>Abstimmungsmodus</span>';
        votingInfo.style.display = 'none';
        
        // Re-enable add book button when exiting voting mode
        if (addBookBtn) {
            addBookBtn.disabled = false;
            addBookBtn.style.opacity = '1';
            addBookBtn.style.cursor = 'pointer';
        }
        
        // Reset ready toggle when exiting voting mode
        const readyToggle = document.getElementById('readyToggle');
        const readyCheckbox = document.getElementById('readyCheckbox');
        readyToggle.style.display = 'none';
        readyCheckbox.checked = false;
        
        // Stop ready state monitoring when exiting voting mode
        stopReadyStateMonitoring();
    }
    
    // Re-render books to update voting buttons visibility
    renderBooks();
}

function updateVotingCounter() {
    const votesUsed = Object.keys(userVotes).length;
    const votesRemaining = 3 - votesUsed;
    const votingText = document.getElementById('votingText');
    const readyToggle = document.getElementById('readyToggle');
    const readyCheckbox = document.getElementById('readyCheckbox');
    
    // Update voting counter to show the three numbers with filled states
    const usedPoints = Object.values(userVotes);
    const counterHTML = [3, 2, 1].map(points => {
        const isUsed = usedPoints.includes(points);
        return `<div class="md3-vote-counter-number ${isUsed ? 'md3-vote-counter-filled' : ''} md3-vote-counter-${points}">${points}</div>`;
    }).join('');
    
    if (votingText) {
        votingText.innerHTML = `Stimmen: ${counterHTML}`;
    }
    
    // Always show ready toggle when in voting mode, but enable only when all votes are cast
    if (isVotingMode) {
        readyToggle.style.display = 'flex';
        if (votesRemaining === 0) {
            readyCheckbox.disabled = false;
        } else {
            readyCheckbox.disabled = true;
            readyCheckbox.checked = false;
        }
    } else {
        readyToggle.style.display = 'none';
    }
}

async function clearReadyStatusIfNeeded() {
    try {
        const SHEETS_ID = getCookie('sheets_id');
        if (!SHEETS_ID || !SHEETS_NAME || !CLIENT_ID) {
            return; // Skip if not configured
        }
        
        if (!gapi.client.getToken()) {
            return; // Skip if not authenticated
        }
        
        // Get current user's status
        const usersRange = `${SHEETS_NAME}!I3:Z4`; // Row 3 for ready status, row 4 for names
        const response = await gapi.client.sheets.spreadsheets.values.get({
            spreadsheetId: SHEETS_ID,
            range: usersRange,
        });
        
        const data = response.result.values || [];
        const readyRow = data[0] || [];
        const nameRow = data[1] || [];
        
        // Find current user's column
        let userColumnIndex = -1;
        for (let i = 0; i < nameRow.length; i++) {
            if (nameRow[i] && nameRow[i].trim() === currentUser) {
                userColumnIndex = i;
                break;
            }
        }
        
        // If user found and status is "bereit", clear it
        if (userColumnIndex >= 0) {
            const currentStatus = readyRow[userColumnIndex] ? readyRow[userColumnIndex].trim() : '';
            if (currentStatus === 'bereit') {
                const columnLetter = String.fromCharCode(73 + userColumnIndex); // 73 = 'I'
                const readyCell = `${SHEETS_NAME}!${columnLetter}3`;
                
                await gapi.client.sheets.spreadsheets.values.update({
                    spreadsheetId: SHEETS_ID,
                    range: readyCell,
                    valueInputOption: 'USER_ENTERED',
                    resource: {
                        values: [['']] // Clear the cell
                    }
                });
                
                console.log('Cleared "bereit" status when starting voting');
            }
        }
    } catch (error) {
        console.error('Error clearing ready status:', error);
        // Don't throw error to prevent disrupting voting start
    }
}

function castVote(bookTitle, bookAuthor, points) {
    const bookId = `${bookTitle}|${bookAuthor}`;
    
    // If user already voted this exact vote for this book, remove it
    if (userVotes[bookId] === points) {
        delete userVotes[bookId];
        updateVotingCounter();
        renderBooks();
        
        // Update modal if it's open for this book
        if (currentModalBook && currentModalBook.title === bookTitle && currentModalBook.author === bookAuthor) {
            updateModalContent();
        }
        
        // No popup message when removing votes
        return;
    }
    
    // Check if this point value is used for another book and remove it
    const bookWithThisPoints = Object.keys(userVotes).find(id => userVotes[id] === points);
    if (bookWithThisPoints) {
        delete userVotes[bookWithThisPoints];
    }
    
    // If user already voted for this book with different points, remove the old vote
    if (userVotes[bookId]) {
        delete userVotes[bookId];
    }
    
    // Cast the new vote
    userVotes[bookId] = points;
    updateVotingCounter();
    renderBooks(); // Re-render to update button states
    
    // Update modal if it's open for this book
    if (currentModalBook && currentModalBook.title === bookTitle && currentModalBook.author === bookAuthor) {
        updateModalContent();
    }
}

async function handleReadyToggle() {
    const readyCheckbox = document.getElementById('readyCheckbox');
    const isReady = readyCheckbox.checked;
    
    try {
        await updateReadyStatus(isReady);
        
        // Start/stop periodic checking based on ready state
        if (isReady) {
            startReadyStateMonitoring();
        } else {
            stopReadyStateMonitoring();
        }
    } catch (error) {
        console.error('Error updating ready status:', error);
        showError('Fehler beim Aktualisieren der Bereitschaft: ' + error.message);
        // Revert checkbox state
        readyCheckbox.checked = !isReady;
    }
}

async function updateReadyStatus(isReady) {
    const SHEETS_ID = getCookie('sheets_id');
    if (!SHEETS_ID || !SHEETS_NAME || !CLIENT_ID) {
        throw new Error('Google Sheets Konfiguration fehlt');
    }
    
    if (!gapi.client.getToken()) {
        throw new Error('Nicht authentifiziert');
    }
    
    // First, get the list of all users to find the correct column
    const usersRange = `${SHEETS_NAME}!I4:Z4`; // Names are in row 4
    const usersResponse = await gapi.client.sheets.spreadsheets.values.get({
        spreadsheetId: SHEETS_ID,
        range: usersRange,
    });
    
    const userRow = usersResponse.result.values?.[0] || [];
    let userColumnIndex = -1;
    
    // Find current user's column (starting from column I = index 0)
    for (let i = 0; i < userRow.length; i++) {
        if (userRow[i] && userRow[i].trim() === currentUser) {
            userColumnIndex = i;
            break;
        }
    }
    
    if (userColumnIndex === -1) {
        throw new Error('User nicht in der Tabelle gefunden');
    }
    
    // Convert index to column letter (I=0, J=1, K=2, etc.)
    const columnLetter = String.fromCharCode(73 + userColumnIndex); // 73 = 'I'
    const readyCell = `${SHEETS_NAME}!${columnLetter}3`;
    
    // Update the ready status (only "bereit" or empty, not "fertig" yet)
    await gapi.client.sheets.spreadsheets.values.update({
        spreadsheetId: SHEETS_ID,
        range: readyCell,
        valueInputOption: 'USER_ENTERED',
        resource: {
            values: [[isReady ? 'bereit' : '']]
        }
    });
    
    // Check if all users are ready and process votes
    await checkAllUsersReady();
}

function startReadyStateMonitoring() {
    // Clear any existing interval
    stopReadyStateMonitoring();
    
    // Start checking every 1 second
    readyCheckInterval = setInterval(async () => {
        try {
            await checkAllUsersReady();
        } catch (error) {
            console.error('Error during periodic ready check:', error);
        }
    }, 1000);
}

function stopReadyStateMonitoring() {
    if (readyCheckInterval) {
        clearInterval(readyCheckInterval);
        readyCheckInterval = null;
    }
}

async function writeUserVotes(userColumnIndex) {
    const SHEETS_ID = getCookie('sheets_id');
    const columnLetter = String.fromCharCode(73 + userColumnIndex); // 73 = 'I'
    
    // Get all books from the sheet to match with votes
    const booksRange = `${SHEETS_NAME}!A5:H1000`;
    const booksResponse = await gapi.client.sheets.spreadsheets.values.get({
        spreadsheetId: SHEETS_ID,
        range: booksRange,
    });
    
    const rows = booksResponse.result.values || [];
    const updates = [];
    
    // Find each voted book and prepare the update
    for (const [bookId, points] of Object.entries(userVotes)) {
        const [title, author] = bookId.split('|');
        
        // Find the row for this book
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            if (row && row[2] === title && row[3] === author) {
                const rowNumber = i + 5; // Adjust for header rows
                const voteCell = `${SHEETS_NAME}!${columnLetter}${rowNumber}`;
                updates.push({
                    range: voteCell,
                    values: [[points]]
                });
                break;
            }
        }
    }
    
    // Batch update all votes
    if (updates.length > 0) {
        await gapi.client.sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: SHEETS_ID,
            resource: {
                valueInputOption: 'USER_ENTERED',
                data: updates
            }
        });
    }
}

async function checkAllUsersReady() {
    const SHEETS_ID = getCookie('sheets_id');
    
    // Get users and their ready status
    const usersRange = `${SHEETS_NAME}!I3:Z4`; // Row 3 for ready status, row 4 for names
    const response = await gapi.client.sheets.spreadsheets.values.get({
        spreadsheetId: SHEETS_ID,
        range: usersRange,
    });
    
    const data = response.result.values || [];
    const readyRow = data[0] || [];
    const nameRow = data[1] || [];
    
    // Check different states: all ready ("bereit"), all finished ("fertig")
    let allReady = true;
    let allFinished = true;
    const activeUsers = [];
    let myColumnIndex = -1;
    
    for (let i = 0; i < nameRow.length; i++) {
        if (nameRow[i] && nameRow[i].trim() && nameRow[i].trim() !== "Ergebnis") {
            activeUsers.push(nameRow[i].trim());
            
            // Track current user's column
            if (nameRow[i].trim() === currentUser) {
                myColumnIndex = i;
            }
            
            const status = readyRow[i] ? readyRow[i].trim() : '';
            
            if (status !== 'bereit' && status !== 'fertig') {
                allReady = false;
                allFinished = false;
            } else if (status === 'bereit') {
                allFinished = false;
            }
        } else {
            break; // Stop at first empty name
        }
    }
    
    if (allFinished && activeUsers.length > 0) {
        // All users are finished - show results
        isVoteCompleted = true;
        isVotingMode = false;
        stopReadyStateMonitoring();
        
        // Update UI to reflect completed state and hide voting buttons immediately
        updateVotingModeUI();
        renderBooks(); // Re-render books to hide voting buttons before showing modal
        
        // Calculate and show results
        await calculateAndShowResults();
        
    } else if (allReady && activeUsers.length > 0 && myColumnIndex >= 0) {
        // All users are ready - now write votes and change to "fertig"
        const myStatus = readyRow[myColumnIndex] ? readyRow[myColumnIndex].trim() : '';
        
        if (myStatus === 'bereit') {
            // Change own status to "fertig" and write votes
            await markAsFinishedAndWriteVotes(myColumnIndex);
        }
    }
}

async function markAsFinishedAndWriteVotes(userColumnIndex) {
    const SHEETS_ID = getCookie('sheets_id');
    const columnLetter = String.fromCharCode(73 + userColumnIndex); // 73 = 'I'
    const readyCell = `${SHEETS_NAME}!${columnLetter}3`;
    
    try {
        // First, write the votes if user has all 3 votes
        if (Object.keys(userVotes).length === 3) {
            await writeUserVotes(userColumnIndex);
        }
        
        // Then change status to "fertig"
        await gapi.client.sheets.spreadsheets.values.update({
            spreadsheetId: SHEETS_ID,
            range: readyCell,
            valueInputOption: 'USER_ENTERED',
            resource: {
                values: [['fertig']]
            }
        });
        
        console.log('Marked as finished and wrote votes');
        
    } catch (error) {
        console.error('Error marking as finished:', error);
        throw error;
    }
}

async function finalizeVoting() {
    // This function is called when all users are ready
    // Calculate final results and write them to the sheet
    await calculateFinalResults();
    console.log('Voting finalized - all users ready');
}

async function calculateFinalResults() {
    const SHEETS_ID = getCookie('sheets_id');
    
    // Get all voting data including user names
    const votingRange = `${SHEETS_NAME}!A5:Z1000`; // Get all data including votes
    const usersRange = `${SHEETS_NAME}!I4:Z4`; // Get user names
    
    const [votingResponse, usersResponse] = await Promise.all([
        gapi.client.sheets.spreadsheets.values.get({
            spreadsheetId: SHEETS_ID,
            range: votingRange,
        }),
        gapi.client.sheets.spreadsheets.values.get({
            spreadsheetId: SHEETS_ID,
            range: usersRange,
        })
    ]);
    
    const rows = votingResponse.result.values || [];
    const userNames = usersResponse.result.values?.[0] || [];
    const results = {};
    const userVoteValidation = {}; // Track votes per user for validation
    
    // Initialize vote validation tracking
    userNames.forEach((userName, index) => {
        if (userName && userName.trim() && userName.trim() !== "Ergebnis") {
            userVoteValidation[userName.trim()] = [];
        }
    });
    
    // Calculate total points for each book and track votes
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!row || !row[2] || !row[3]) continue; // Skip if no title or author
        
        const bookId = `${row[2]}|${row[3]}`; // title|author
        if (!results[bookId]) {
            results[bookId] = {
                title: row[2],
                author: row[3],
                suggestedBy: row[0] || 'Unbekannt',
                totalPoints: 0,
                votes: [],
                voterDetails: []
            };
        }
        
        // Check columns I onwards for votes, but only for actual user columns
        for (let j = 8; j < row.length; j++) {
            const userIndex = j - 8; // Convert back to user index
            const userName = userNames[userIndex];
            
            // Only process if this column has a valid user name (not empty or "Ergebnis")
            if (!userName || !userName.trim() || userName.trim() === "Ergebnis") {
                continue; // Skip this column as it's not a user column
            }
            
            const points = parseInt(row[j]);
            if (!isNaN(points) && points > 0) {
                results[bookId].totalPoints += points;
                results[bookId].votes.push(points);
                
                // Add voter details with initial and points
                const initial = userName.trim().charAt(0).toUpperCase();
                results[bookId].voterDetails.push({ initial, points });
                
                // Track user's votes for validation
                if (userVoteValidation[userName.trim()]) {
                    userVoteValidation[userName.trim()].push(points);
                }
            }
        }
    }
    
    // Validate votes: each user should have exactly one vote of 1, 2, and 3
    const invalidVotes = [];
    Object.keys(userVoteValidation).forEach(userName => {
        const votes = userVoteValidation[userName];
        const sortedVotes = votes.slice().sort((a, b) => a - b);
        
        if (votes.length === 0) {
            // User didn't vote at all - this is allowed
            return;
        }
        
        if (votes.length !== 3 || sortedVotes.join(',') !== '1,2,3') {
            invalidVotes.push({
                user: userName,
                votes: votes,
                issue: votes.length !== 3 ? 
                    `${votes.length} Stimmen abgegeben (erwartet: 3)` : 
                    `Ungültige Punkteverteilung: ${votes.join(', ')} (erwartet: 1, 2, 3)`
            });
        }
    });
    
    // Store validation results
    results._validation = {
        isValid: invalidVotes.length === 0,
        invalidVotes: invalidVotes
    };
    
    return results;
}

async function calculateAndShowResults() {
    try {
        const results = await calculateFinalResults();
        votingResults = results;
        showVotingResults();
    } catch (error) {
        console.error('Error calculating results:', error);
        showError('Fehler beim Berechnen der Ergebnisse: ' + error.message);
    }
}

function showVotingResults() {
    if (!votingResults) return;
    
    // Check for validation issues
    const validation = votingResults._validation;
    let validationWarningHTML = '';
    
    if (validation && !validation.isValid) {
        const warningDetails = validation.invalidVotes.map(invalid => 
            `<li><strong>${escapeHtml(invalid.user)}:</strong> ${escapeHtml(invalid.issue)}</li>`
        ).join('');
        
        validationWarningHTML = `
            <div style="
                background: var(--md-sys-color-error-container);
                color: var(--md-sys-color-on-error-container);
                padding: 16px;
                border-radius: 12px;
                margin-bottom: 24px;
                border: 1px solid var(--md-sys-color-error);
            ">
                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                    <span class="material-icons-round" style="color: var(--md-sys-color-error);">warning</span>
                    <strong>Ungültige Abstimmungen erkannt!</strong>
                </div>
                <div style="font-size: 0.9em; line-height: 1.4;">
                    Die folgenden Abstimmungen entsprechen nicht den Regeln (jeder Abstimmer sollte genau einmal 1, 2 und 3 Punkte vergeben):
                </div>
                <ul style="margin: 8px 0 0 20px; font-size: 0.9em;">
                    ${warningDetails}
                </ul>
            </div>
        `;
    }
    
    // Convert results to array and sort by total points
    const sortedResults = Object.values(votingResults)
        .filter(result => result.totalPoints > 0)
        .sort((a, b) => b.totalPoints - a.totalPoints);
    
    if (sortedResults.length === 0) {
        showError('Keine Abstimmungsergebnisse gefunden.');
        return;
    }
    
    // Find the winner(s) and their suggestedBy
    const highestPoints = sortedResults[0].totalPoints;
    const winners = sortedResults.filter(result => result.totalPoints === highestPoints);
    const winnerSuggestedBy = winners[0].suggestedBy;
    
    // Get all books from the same person who suggested the winning book(s)
    const allBooksFromWinner = Object.values(votingResults)
        .filter(result => result.suggestedBy === winnerSuggestedBy)
        .sort((a, b) => b.totalPoints - a.totalPoints);
    
    const modal = document.getElementById('bookDetailModal');
    
    // Event-Handler für Klicks außerhalb des Modals
    const handleOutsideClick = (e) => {
        if (e.target === modal) {
            hideBookModal();
        }
    };
    modal.addEventListener('click', handleOutsideClick);
    
    // Event-Handler entfernen wenn Modal geschlossen wird
    modal.addEventListener('hide', () => {
        modal.removeEventListener('click', handleOutsideClick);
    }, { once: true });
    
    let resultsHTML = '';
    let currentRank = 1;
    let previousPoints = -1;
    
    allBooksFromWinner.forEach((result, index) => {
        // Determine if this is a winner (tied for first place)
        const isWinner = result.totalPoints === highestPoints;
        
        // Update rank only if points are different from previous
        if (result.totalPoints !== previousPoints) {
            currentRank = index + 1;
        }
        previousPoints = result.totalPoints;
        
        const rankClass = isWinner ? 'winner' : '';
        const rankIcon = isWinner ? '👑' : `${currentRank}.`;
        
        resultsHTML += `
            <div class="result-item ${rankClass}" style="
                display: flex; 
                justify-content: space-between; 
                align-items: center; 
                padding: 16px; 
                margin: 8px 0; 
                border-radius: 12px;
                background: ${isWinner ? 'var(--md-sys-color-primary-container)' : 'var(--md-sys-color-surface-variant)'};
                border: ${isWinner ? '2px solid var(--md-sys-color-primary)' : '1px solid var(--md-sys-color-outline-variant)'};
                gap: 24px;
            ">
                <div style="display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0;">
                    <span style="font-size: 1.5em; min-width: 40px;">${rankIcon}</span>
                    <div style="flex: 1; min-width: 0;">
                        <div style="font-weight: ${isWinner ? '700' : '500'}; font-size: ${isWinner ? '1.2em' : '1em'}; line-height: 1.2;">
                            ${escapeHtml(result.title)}
                        </div>
                        <div style="color: var(--md-sys-color-on-surface-variant); font-size: 0.9em;">
                            von ${escapeHtml(result.author)}
                        </div>
                    </div>
                </div>
                <div style="text-align: right; flex-shrink: 0;">
                    <div style="font-weight: 700; font-size: 1.3em; color: var(--md-sys-color-primary);">
                        ${result.totalPoints} Punkte
                    </div>
                    <div style="font-size: 0.8em; color: var(--md-sys-color-on-surface-variant);">
                        ${result.voterDetails.map(voter => `${voter.initial}${voter.points}`).join(', ')}
                    </div>
                </div>
            </div>
        `;
    });
    
    modal.innerHTML = `
        <div class="md3-modal-content" style="max-width: 1000px; padding: 32px; background: var(--md-sys-color-surface); border-radius: 28px; margin: 24px; box-shadow: 0 0 0 1px var(--md-sys-color-primary) inset, 0 0 20px 4px rgba(208, 188, 255, 0.15);">
            <div style="text-align: center; margin-bottom: 32px;">
                <h2 style="font-size: 2em; margin-bottom: 8px; color: var(--md-sys-color-primary);">
                    🎉 Ergebnis 🎉
                </h2>
            </div>
            
            ${validationWarningHTML}
            
            <div style="max-height: 400px; overflow-y: auto;">
                ${resultsHTML}
            </div>
        </div>
    `;
    
    modal.classList.add('show');
}

async function resetVoting() {
    try {
        const SHEETS_ID = getCookie('sheets_id');
        
        // Clear all ready states and votes
        const clearRange = `${SHEETS_NAME}!I3:Z1000`;
        await gapi.client.sheets.spreadsheets.values.clear({
            spreadsheetId: SHEETS_ID,
            range: clearRange
        });
        
        // Reset local state
        isVoteCompleted = false;
        isVotingMode = false;
        userVotes = {};
        votingResults = null;
        
        // Update UI
        updateVotingModeUI();
        hideBookModal();
        
        showSuccess('Abstimmung zurückgesetzt. Eine neue Abstimmung kann gestartet werden.');
        
    } catch (error) {
        console.error('Error resetting voting:', error);
        showError('Fehler beim Zurücksetzen der Abstimmung: ' + error.message);
    }
}

// Rendering functions
function renderBooks() {
    const booksList = document.getElementById('booksList');
    const filteredBooks = getFilteredBooks();
    
    // Update tabs to show user-specific tabs
    updateTabsWithUsers();
    
    if (filteredBooks.length === 0) {
        booksList.style.display = 'flex';
        booksList.style.justifyContent = 'center';
        booksList.innerHTML = getEmptyStateHTML();
        return;
    }
    booksList.style.display = 'grid'; // Reset to grid for normal book display
    
    // No sorting needed - display books in the order they appear in the sheet
    const sortedBooks = filteredBooks;
    
    booksList.innerHTML = sortedBooks.map(book => renderBookCard(book)).join('');
}

function renderBookCard(book) {
    const isMyBook = book.suggestedBy === currentUser;
    const bookId = `${book.title}|${book.author}`; // Simple book ID
    const hasVoted = userVotes[bookId];
    const votedPoints = hasVoted ? userVotes[bookId] : null;
    
    // Build bottom tags HTML (Jahr, Seitenzahl, Genres)
    let tagsHTML = '';
    const tags = [];
    
    // Jahr zuerst
    if (book.year) {
        tags.push(`<div class="md3-book-detail-chip"><span class="material-icons-round" style="font-size: 16px;">calendar_today</span>${book.year}</div>`);
    }
    
    // Dann Seitenzahl
    if (book.pages) {
        tags.push(`<div class="md3-book-detail-chip"><span class="material-icons-round" style="font-size: 16px;">menu_book</span>${book.pages} Seiten</div>`);
    }
    
    // Dann die Genres
    if (book.genres) {
        // Split by comma or semicolon and trim each genre
        const genreList = book.genres.split(/[,;]/).map(g => g.trim()).filter(g => g);
        for (const genre of genreList) {
            tags.push(`<div class="md3-book-detail-chip"><span class="material-icons-round" style="font-size: 16px;">category</span>${escapeHtml(genre)}</div>`);
        }
    }
    
    if (tags.length > 0) {
        tagsHTML = `<div class="md3-book-card-tags">${tags.join('')}</div>`;
    }

    const charLimit = 200;
    
    // Build voting buttons HTML - only show if voting is active and not completed
    let votingHTML = '';
    if (isVotingMode && !isVoteCompleted) {
        const usedPoints = Object.values(userVotes);
        const allPoints = [3, 2, 1];
        
        const buttonHTML = allPoints.map(points => {
            const isVotedForThisBook = hasVoted && votedPoints === points;
            
            if (isVotedForThisBook) {
                // This book has this vote - clicking will remove it
                return `<button class="md3-vote-number md3-vote-number-selected md3-vote-${points}" onclick="castVote('${escapeJsString(book.title)}', '${escapeJsString(book.author)}', ${points})">${points}</button>`;
            } else {
                // Available to vote - clicking will either add vote or replace existing vote
                return `<button class="md3-vote-number md3-vote-number-available md3-vote-${points}" onclick="castVote('${escapeJsString(book.title)}', '${escapeJsString(book.author)}', ${points})">${points}</button>`;
            }
        }).join('');
        
        votingHTML = `
            <div class="md3-voting-buttons">
                ${buttonHTML}
            </div>
        `;
    }
    
    return `
        <div class="md3-book-card ${isVotingMode ? 'md3-book-card-voting' : ''}">
            <div class="md3-book-card-content" ${!isVotingMode ? `onclick="showBookModal('${escapeJsString(book.title)}', '${escapeJsString(book.author)}')"`  : ''}>
                <div class="md3-book-card-main" ${isVotingMode ? `onclick="showBookModal('${escapeJsString(book.title)}', '${escapeJsString(book.author)}')"`  : ''}>
                    <h3 class="md3-book-card-title">${escapeHtml(book.title)}</h3>
                    <div class="md3-book-card-author">${escapeHtml(book.author)}</div>
                    
                    ${book.description ? `<div class="md3-book-card-description">${escapeHtml(book.description.length > charLimit ? book.description.substring(0, charLimit-3) + '...' : book.description)}</div>` : ''}
                    
                    ${tagsHTML}
                </div>
            </div>
            
            <div class="md3-book-card-footer">
                <div class="md3-book-card-suggested-by">
                    ${escapeHtml(book.suggestedBy)}
                </div>
                ${votingHTML}
            </div>
        </div>
    `;
}

function getFilteredBooks() {
    let filteredBooks = books;
    
    // Apply category filter
    switch (currentFilter) {
        case 'all':
            return filteredBooks;
        default:
            // If it's a user name, filter by that user
            return filteredBooks.filter(book => book.suggestedBy === currentFilter);
    }
}

function getEmptyStateHTML() {
    switch (currentFilter) {
        case 'all':
            return `
                <div class="md3-empty-state" style="text-align: center; max-width: 600px; padding: 48px 16px;">
                    <h3>Noch keine Bücher</h3>
                    <p>Sei der erste, der ein Buch für den Buchclub vorschlägt!</p>
                </div>
            `;
        default:
            // User-specific filter
            return `
                <div class="md3-empty-state" style="text-align: center; max-width: 600px; padding: 48px 16px;">
                    <h3>Keine Vorschläge von ${escapeHtml(currentFilter)}</h3>
                    <p>${escapeHtml(currentFilter)} hat noch keine Bücher vorgeschlagen.</p>
                </div>
            `;
    }
}

// Filter functions
function setActiveFilter(filter) {
    // If someone tries to set 'liked' filter, default to 'all'
    if (filter === 'liked') {
        filter = 'all';
    }
    currentFilter = filter;
    renderBooks(); // This will update the tabs and show the active state
}

// Update tabs to show users on the right side
function updateTabsWithUsers() {
    const tabsContainer = document.getElementById('filterTabs');
    const uniqueUsers = [...new Set(books.map(book => book.suggestedBy))].sort();
    
    // Create new tabs HTML
    let tabsHTML = `
        <div class="md3-tabs-left">
            <button class="md3-tab ${currentFilter === 'all' ? 'md3-tab-active' : ''}" data-filter="all">
                <span class="material-icons-round">library_books</span>
                <span>Alle Bücher</span>
            </button>
        </div>
        <div class="md3-tabs-right">
    `;
    
    // Add user tabs on the right
    uniqueUsers.forEach(user => {
        const isActive = currentFilter === user;
        tabsHTML += `
            <button class="md3-tab md3-tab-user ${isActive ? 'md3-tab-active' : ''}" data-filter="${escapeHtml(user)}">
                <span class="material-icons-round">person</span>
                <span>${escapeHtml(user)}</span>
            </button>
        `;
    });
    
    tabsHTML += '</div>';
    
    tabsContainer.innerHTML = tabsHTML;
    
    // Re-attach event listeners
    tabsContainer.querySelectorAll('.md3-tab').forEach(btn => {
        btn.addEventListener('click', function() {
            const filter = this.dataset.filter;
            setActiveFilter(filter);
        });
    });
}

// Utility functions
function escapeJsString(text) {
    if (!text) return '';
    return text.replace(/[\\'"]/g, '\\$&');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatDate(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diffTime = Math.abs(now - date);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays === 1) return 'Heute';
    if (diffDays === 2) return 'Gestern';
    if (diffDays <= 7) return `vor ${diffDays - 1} Tagen`;
    
    return date.toLocaleDateString();
}

function showError(message) {
    // Remove existing error messages
    const existingError = document.querySelector('.error-message');
    if (existingError) {
        existingError.remove();
    }
    
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message';
    errorDiv.style.background = 'var(--md-sys-color-error-container)';
    errorDiv.style.color = 'var(--md-sys-color-on-error-container)';
    errorDiv.style.border = '1px solid var(--md-sys-color-error)';
    errorDiv.style.borderRadius = '8px';
    errorDiv.style.padding = '12px 16px';
    errorDiv.style.margin = '16px 0';
    errorDiv.textContent = message;
    
    const container = document.querySelector('.md3-main-content');
    container.insertBefore(errorDiv, container.firstChild);
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
        if (errorDiv.parentNode) {
            errorDiv.remove();
        }
    }, 5000);
}

function showSuccess(message) {
    // Create success message 
    const successDiv = document.createElement('div');
    successDiv.className = 'success-message';
    successDiv.style.background = 'var(--md-sys-color-primary-container)';
    successDiv.style.color = 'var(--md-sys-color-on-primary-container)';
    successDiv.style.border = '1px solid var(--md-sys-color-primary)';
    successDiv.style.borderRadius = '8px';
    successDiv.style.padding = '12px 16px';
    successDiv.style.margin = '16px 0';
    successDiv.textContent = message;
    
    const container = document.querySelector('.md3-main-content');
    container.insertBefore(successDiv, container.firstChild);
    
    // Auto-remove after 3 seconds
    setTimeout(() => {
        if (successDiv.parentNode) {
            successDiv.remove();
        }
    }, 3000);
}
