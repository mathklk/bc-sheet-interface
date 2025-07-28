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

// Initialize the app
document.addEventListener('DOMContentLoaded', function() {
    handleInviteRoute();
    initializeApp();
    setupEventListeners();
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
        showError('Google Sheets Konfiguration fehlt. Bitte verwende den Einladungslink.');
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
    // Logout button
    document.getElementById('logoutBtn').addEventListener('click', logout);
    
    // Auth modal sign in button
    document.getElementById('signInBtn').addEventListener('click', function() {
        if (isGapiLoaded && isGisLoaded) {
            tokenClient.requestAccessToken({prompt: 'select_account'});
        }
    });
    
    // Add book
    document.getElementById('addBookBtn').addEventListener('click', addBook);
    
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
    
    // Form submission on Enter (except textarea)
    document.getElementById('bookTitle').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') addBook();
    });
    document.getElementById('bookAuthor').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') addBook();
    });
    document.getElementById('bookGenre').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') addBook();
    });
    document.getElementById('bookPages').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') addBook();
    });
    document.getElementById('bookYear').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') addBook();
    });
    
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
        const range = `${SHEETS_NAME}!A5:A1000`; // Only get SuggestedBy column
        
        const response = await gapi.client.sheets.spreadsheets.values.get({
            spreadsheetId: SHEETS_ID,
            range: range,
        });
        
        const rows = response.result.values || [];
        
        // Extract unique names from the SuggestedBy column
        const uniqueNames = [...new Set(
            rows
                .map(row => row[0]) // Get first column (SuggestedBy)
                .filter(name => name && name.trim()) // Filter out empty values
                .map(name => name.trim()) // Trim whitespace
        )].sort(); // Sort alphabetically
        
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
                    renderBooks(); // Re-render to update "my suggestions" filter and show vote buttons
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

// UI Mode functions
function updateUIForUserMode() {
    const userInfo = document.getElementById('userInfo');
    const addBookSection = document.getElementById('addBookSection');
    
    // Show normal user UI
    userInfo.style.display = 'flex';
    addBookSection.style.display = 'block';
    
    document.getElementById('currentUser').textContent = currentUser;
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
    
    // Hide user info and show auth modal
    document.getElementById('userInfo').style.display = 'none';
    document.getElementById('addBookSection').style.display = 'none';
    
    showAuthModal();
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
        const range = `${SHEETS_NAME}!A5:H1000`; // Adjust range as needed
        
        const response = await gapi.client.sheets.spreadsheets.values.get({
            spreadsheetId: spreadsheetId,
            range: range,
        });
        
        books = parseGoogleSheetsData(response.result.values || []);
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

function extractSpreadsheetId(url) {
    const regex = /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/;
    const match = url.match(regex);
    return match ? match[1] : null;
}

function parseGoogleSheetsData(rows) {
    const books = [];
    
    // Load local likes data
    const likesKey = 'bookclub_likes';
    const likes = JSON.parse(getCookie(likesKey) || '{}');
    
    for (const row of rows) {
        // Skip empty rows
        if (!row || row.length === 0 || !row[2] || !row[3]) continue;
        
        // Columns: SuggestedBy, Funfacts, Buchtitel, Autor, Jahr, Seitenzahl, Genres, Kurzbeschreibung
        const book = {
            title: row[2] || '',           // Buchtitel
            author: row[3] || '',          // Autor
            year: row[4] ? parseInt(row[4]) : null,  // Jahr
            pages: row[5] ? parseInt(row[5]) : null, // Seitenzahl
            description: row[7] || '',      // Kurzbeschreibung
            genres: row[6] || '',          // Genres
            suggestedBy: row[0] || 'Unbekannt', // SuggestedBy
            suggestedAt: new Date().toISOString(), // We don't have this data from sheets
            likes: []  // Will be populated from local storage
        };
        
        // Load likes from local storage
        const bookKey = `${book.title}_${book.author}`;
        book.likes = likes[bookKey] || [];
        book.likeCount = book.likes.length;
        
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
        
        // Find the last row for this user or determine where to insert
        let insertRowIndex = findInsertionRowForUser(existingRows, book.suggestedBy);
        
        // Prepare the values in the correct order based on the sheet structure
        // Columns: SuggestedBy, Funfacts, Buchtitel, Autor, Jahr, Seitenzahl, Genres, Kurzbeschreibung
        const values = [[
            book.suggestedBy,    // SuggestedBy (Column A)
            '',                  // Funfacts (Column B) - leave empty for now
            book.title,          // Buchtitel (Column C)
            book.author,         // Autor (Column D)
            book.year || '',     // Jahr (Column E)
            book.pages || '',    // Seitenzahl (Column F)
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
            valueInputOption: 'RAW',
            resource: {
                values: values
            }
        });
        
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
        const groupSize = userGroupEnd - userGroupStart + 1;
        if (groupSize >= 2) {
            // Insert at second-to-last position (between existing entries)
            return userGroupEnd - 1;
        } else {
            // Only one entry, insert at the end of the group
            return userGroupEnd + 1;
        }
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
    const title = document.getElementById('bookTitle').value.trim();
    const author = document.getElementById('bookAuthor').value.trim();
    const genre = document.getElementById('bookGenre').value.trim();
    const description = document.getElementById('bookDescription').value.trim();
    const pages = document.getElementById('bookPages').value.trim();
    const year = document.getElementById('bookYear').value.trim();
    
    if (!title || !author) {
        alert('Bitte gib sowohl Titel als auch Autor an.');
        return;
    }
    
    // Check for duplicates
    const duplicate = books.find(book => 
        book.title.toLowerCase() === title.toLowerCase() && 
        book.author.toLowerCase() === author.toLowerCase()
    );
    
    if (duplicate) {
        alert('Dieses Buch wurde bereits vorgeschlagen.');
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
            showSuccess('Buchvorschlag erfolgreich hinzugefügt!');
            
            // Clear form
            document.getElementById('bookTitle').value = '';
            document.getElementById('bookAuthor').value = '';
            document.getElementById('bookGenre').value = '';
            document.getElementById('bookDescription').value = '';
            document.getElementById('bookPages').value = '';
            document.getElementById('bookYear').value = '';
            
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
    }
}
async function toggleLike(title, author) {
    const book = books.find(b => b.title === title && b.author === author);
    if (!book) return;
    
    // Store likes locally since we can't write to Google Sheets easily
    const likesKey = 'bookclub_likes';
    const likes = JSON.parse(getCookie(likesKey) || '{}');
    const bookKey = `${title}_${author}`;
    
    if (!likes[bookKey]) {
        likes[bookKey] = [];
    }
    
    const userLikeIndex = likes[bookKey].findIndex(like => like.user === currentUser);
    
    if (userLikeIndex > -1) {
        // Remove like
        likes[bookKey].splice(userLikeIndex, 1);
    } else {
        // Add like
        likes[bookKey].push({
            user: currentUser,
            likedAt: new Date().toISOString()
        });
    }
    
    // Update local storage
    setCookie(likesKey, JSON.stringify(likes));
    
    // Update book's likes array for rendering
    book.likes = likes[bookKey] || [];
    book.likeCount = book.likes.length;
    
    renderBooks();
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

// Rendering functions
function renderBooks() {
    const booksList = document.getElementById('booksList');
    const filteredBooks = getFilteredBooks();
    
    // Update tabs to show user-specific tabs
    updateTabsWithUsers();
    
    if (filteredBooks.length === 0) {
        booksList.innerHTML = getEmptyStateHTML();
        return;
    }
    
    // Sort books by like count (descending) and then by date (newest first)
    const sortedBooks = filteredBooks.sort((a, b) => {
        if (b.likes.length !== a.likes.length) {
            return b.likes.length - a.likes.length;
        }
        return new Date(b.suggestedAt) - new Date(a.suggestedAt);
    });
    
    booksList.innerHTML = sortedBooks.map(book => renderBookCard(book)).join('');
}

function renderBookCard(book) {
    const userHasLiked = book.likes.some(like => like.user === currentUser);
    const isMyBook = book.suggestedBy === currentUser;
    
    // Build bottom tags HTML (Jahr, Genre, Seitenzahl)
    let tagsHTML = '';
    const tags = [];
    
    if (book.year) {
        tags.push(`<div class="md3-book-detail-chip"><span class="material-icons-round" style="font-size: 16px;">calendar_today</span>${book.year}</div>`);
    }
    
    if (book.genres) {
        tags.push(`<div class="md3-book-detail-chip"><span class="material-icons-round" style="font-size: 16px;">category</span>${escapeHtml(book.genres)}</div>`);
    }
    
    if (book.pages) {
        tags.push(`<div class="md3-book-detail-chip"><span class="material-icons-round" style="font-size: 16px;">menu_book</span>${book.pages} Seiten</div>`);
    }
    
    if (tags.length > 0) {
        tagsHTML = `<div class="md3-book-card-tags">${tags.join('')}</div>`;
    }
    
    return `
        <div class="md3-book-card">
            <div class="md3-book-card-content">
                <h3 class="md3-book-card-title">${escapeHtml(book.title)}</h3>
                <div class="md3-book-card-author">${escapeHtml(book.author)}</div>
                
                ${book.description ? `<div class="md3-book-card-description">${escapeHtml(book.description)}</div>` : ''}
                
                ${tagsHTML}
            </div>
            
            <div class="md3-book-card-footer">
                <div class="md3-book-card-suggested-by">
                    ${escapeHtml(book.suggestedBy)}
                </div>
                
                <div class="md3-book-card-heart-section">
                    <button 
                        class="md3-heart-button-combined ${userHasLiked ? 'md3-heart-button-liked' : ''}"
                        onclick="toggleLike('${escapeHtml(book.title)}', '${escapeHtml(book.author)}')"
                        ${isMyBook ? 'disabled title="Ja, schon klar, dass du deinen eigenen Vorschlag gut findest"' : ''}
                    >
                        <span class="md3-heart-icon">${userHasLiked ? '❤️' : '🤍'}</span>
                        <span class="md3-heart-count">${book.likes.length}</span>
                    </button>
                </div>
            </div>
        </div>
    `;
}

function getFilteredBooks() {
    let filteredBooks = books;
    
    // Apply category filter
    switch (currentFilter) {
        case 'liked':
            return filteredBooks.filter(book => book.likes.some(like => like.user === currentUser));
        case 'all':
            return filteredBooks;
        default:
            // If it's a user name, filter by that user
            return filteredBooks.filter(book => book.suggestedBy === currentFilter);
    }
}

function getEmptyStateHTML() {
    switch (currentFilter) {
        case 'liked':
            return `
                <div class="md3-empty-state">
                    <h3>Noch keine Favoriten</h3>
                    <p>Du hast noch keine Bücher geliket. Durchstöbere alle Bücher und like deine Favoriten!</p>
                </div>
            `;
        case 'all':
            return `
                <div class="md3-empty-state">
                    <h3>Noch keine Bücher</h3>
                    <p>Sei der erste, der ein Buch für den Buchclub vorschlägt!</p>
                </div>
            `;
        default:
            // User-specific filter
            return `
                <div class="md3-empty-state">
                    <h3>Keine Vorschläge von ${escapeHtml(currentFilter)}</h3>
                    <p>${escapeHtml(currentFilter)} hat noch keine Bücher vorgeschlagen.</p>
                </div>
            `;
    }
}

// Filter functions
function setActiveFilter(filter) {
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
            <button class="md3-tab ${currentFilter === 'liked' ? 'md3-tab-active' : ''}" data-filter="liked">
                <span class="material-icons-round">favorite</span>
                <span>Favoriten</span>
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
