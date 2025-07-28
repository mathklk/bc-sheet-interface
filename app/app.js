// Configuration - Replace this URL with your actual jsonblob.com URL
const JSONBLOB_URL = 'https://jsonblob.com/api/jsonBlob/1399123128373927936';

// Global state
let currentUser = '';
let isViewerMode = false;
let books = [];
let currentFilter = 'all';
let currentUserFilter = 'all'; // New filter for user selection
let editingBook = null; // Track which book is being edited

// Initialize the app
document.addEventListener('DOMContentLoaded', function() {
    initializeApp();
    setupEventListeners();
});

// Initialize the application
function initializeApp() {
    const savedName = getCookie('bookclub_username');
    
    if (!savedName) {
        showNameModal();
    } else {
        currentUser = savedName;
        isViewerMode = false;
        updateUIForUserMode();
        loadBooks();
    }
}

// Setup event listeners
function setupEventListeners() {
    // Name modal
    document.getElementById('saveNameBtn').addEventListener('click', saveName);
    document.getElementById('viewerModeBtn').addEventListener('click', enterViewerMode);
    document.getElementById('nameInput').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') saveName();
    });
    
    // Logout button
    document.getElementById('logoutBtn').addEventListener('click', logout);
    
    // Join with name button (from viewer mode)
    document.getElementById('joinWithNameBtn').addEventListener('click', function() {
        showNameModal();
    });
    
    // Add book
    document.getElementById('addBookBtn').addEventListener('click', addBook);
    
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
    document.getElementById('bookPages').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') addBook();
    });
    document.getElementById('bookYear').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') addBook();
    });
    
    // Filter tabs
    document.querySelectorAll('.md3-tab').forEach(btn => {
        btn.addEventListener('click', function() {
            const filter = this.dataset.filter;
            setActiveFilter(filter);
        });
    });
    
    // User filter dropdown
    document.getElementById('userFilter').addEventListener('change', function() {
        currentUserFilter = this.value;
        renderBooks();
    });
}

// Cookie functions
function setCookie(name, value) {
    // Set cookie without expiration (session cookie that persists)
    document.cookie = `${name}=${encodeURIComponent(value)}; path=/; SameSite=Lax`;
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
function showNameModal() {
    const modal = document.getElementById('nameModal');
    modal.classList.add('show');
    const nameInput = document.getElementById('nameInput');
    nameInput.focus();
    
    // Pre-fill with current name if changing
    if (currentUser) {
        nameInput.value = currentUser;
    }
}

function hideNameModal() {
    const modal = document.getElementById('nameModal');
    modal.classList.remove('show');
}

// UI Mode functions
function updateUIForUserMode() {
    const userInfo = document.getElementById('userInfo');
    const viewerInfo = document.getElementById('viewerInfo');
    const addBookSection = document.getElementById('addBookSection');
    const myBooksTab = document.getElementById('myBooksTab');
    const likedBooksTab = document.getElementById('likedBooksTab');
    
    if (isViewerMode) {
        // Show viewer UI
        userInfo.style.display = 'none';
        viewerInfo.style.display = 'flex';
        addBookSection.style.display = 'none';
        myBooksTab.style.display = 'none';
        likedBooksTab.style.display = 'none';
        
        // Reset to "all" filter if currently on filtered view
        if (currentFilter !== 'all') {
            setActiveFilter('all');
        }
    } else {
        // Show normal user UI
        userInfo.style.display = 'flex';
        viewerInfo.style.display = 'none';
        addBookSection.style.display = 'block';
        myBooksTab.style.display = 'inline-block';
        likedBooksTab.style.display = 'inline-block';
        
        document.getElementById('currentUser').textContent = currentUser;
    }
}

function enterViewerMode() {
    isViewerMode = true;
    currentUser = '';
    hideNameModal();
    updateUIForUserMode();
    
    // Load books if not already loaded
    if (books.length === 0) {
        loadBooks();
    } else {
        renderBooks(); // Re-render to hide vote buttons
    }
}

function logout() {
    deleteCookie('bookclub_username');
    currentUser = '';
    isViewerMode = false;
    books = [];
    showNameModal();
}

// Save user name
function saveName() {
    const nameInput = document.getElementById('nameInput');
    const name = nameInput.value.trim();
    
    if (!name) {
        alert('Bitte gib einen gültigen Namen ein.');
        return;
    }
    
    currentUser = name;
    isViewerMode = false;
    setCookie('bookclub_username', name);
    updateUIForUserMode();
    hideNameModal();
    nameInput.value = '';
    
    // Load books if this is initial setup
    if (books.length === 0) {
        loadBooks();
    } else {
        renderBooks(); // Re-render to update "my suggestions" filter and show vote buttons
    }
}

// Loading functions
function showLoading() {
    document.getElementById('loadingIndicator').classList.add('show');
}

function hideLoading() {
    document.getElementById('loadingIndicator').classList.remove('show');
}

// API functions
async function loadBooks() {
    showLoading();
    
    try {
        const response = await fetch(JSONBLOB_URL);
        
        if (response.ok) {
            const data = await response.json();
            books = data.books || [];
        } else if (response.status === 404) {
            // First time setup - initialize with empty data
            books = [];
            await saveBooks();
        } else {
            throw new Error(`HTTP ${response.status}`);
        }
        
        renderBooks();
    } catch (error) {
        console.error('Error loading books:', error);
        showError('Bücher konnten nicht geladen werden. Bitte versuche es erneut.');
        books = [];
        renderBooks();
    } finally {
        hideLoading();
    }
}

async function saveBooks() {
    const data = {
        books: books,
        lastUpdated: new Date().toISOString()
    };
    
    try {
        const response = await fetch(JSONBLOB_URL, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(data)
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        return true;
    } catch (error) {
        console.error('Error saving books:', error);
        showError('Änderungen konnten nicht gespeichert werden. Bitte versuche es erneut.');
        return false;
    }
}

// Book management
async function addBook() {
    // Prevent adding books in viewer mode
    if (isViewerMode) {
        alert('Im Zuschauer-Modus können keine Bücher hinzugefügt werden.');
        return;
    }
    
    const title = document.getElementById('bookTitle').value.trim();
    const author = document.getElementById('bookAuthor').value.trim();
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
    
    const newBook = {
        title: title,
        author: author,
        description: description,
        pages: pages ? parseInt(pages) : null,
        year: year ? parseInt(year) : null,
        suggestedBy: currentUser,
        suggestedAt: new Date().toISOString(),
        likes: []
    };
    
    books.unshift(newBook); // Add to beginning of array
    
    showLoading();
    const success = await saveBooks();
    hideLoading();
    
    if (success) {
        // Clear form
        document.getElementById('bookTitle').value = '';
        document.getElementById('bookAuthor').value = '';
        document.getElementById('bookDescription').value = '';
        document.getElementById('bookPages').value = '';
        document.getElementById('bookYear').value = '';
        
        renderBooks();
        showSuccess('Buchvorschlag erfolgreich hinzugefügt!');
    }
}

async function toggleLike(title, author) {
    // Prevent liking in viewer mode
    if (isViewerMode) {
        alert('Im Zuschauer-Modus können keine Herzen vergeben werden.');
        return;
    }
    
    const book = books.find(b => b.title === title && b.author === author);
    if (!book) return;
    
    const userLikeIndex = book.likes.findIndex(like => like.user === currentUser);
    
    if (userLikeIndex > -1) {
        // Remove like
        book.likes.splice(userLikeIndex, 1);
    } else {
        // Add like
        book.likes.push({
            user: currentUser,
            likedAt: new Date().toISOString()
        });
    }
    
    book.likeCount = book.likes.length;
    
    showLoading();
    const success = await saveBooks();
    hideLoading();
    
    if (success) {
        renderBooks();
    }
}

// Edit functionality
function editBook(title, author) {
    const book = books.find(b => b.title === title && b.author === author);
    if (!book) return;
    
    // Store reference to the book being edited
    editingBook = book;
    
    // Populate the edit form
    document.getElementById('editBookTitle').value = book.title;
    document.getElementById('editBookAuthor').value = book.author;
    document.getElementById('editBookDescription').value = book.description || '';
    document.getElementById('editBookPages').value = book.pages || '';
    document.getElementById('editBookYear').value = book.year || '';
    // Show the edit modal
    showEditModal();
}

function showEditModal() {
    const modal = document.getElementById('editModal');
    modal.classList.add('show');
    document.getElementById('editBookTitle').focus();
}

function hideEditModal() {
    const modal = document.getElementById('editModal');
    modal.classList.remove('show');
    editingBook = null;
}

async function saveEditedBook() {
    if (!editingBook) return;
    
    const title = document.getElementById('editBookTitle').value.trim();
    const author = document.getElementById('editBookAuthor').value.trim();
    const description = document.getElementById('editBookDescription').value.trim();
    const pages = document.getElementById('editBookPages').value.trim();
    const year = document.getElementById('editBookYear').value.trim();
    
    if (!title || !author) {
        alert('Bitte gib sowohl Titel als auch Autor an.');
        return;
    }
    
    // Check for duplicates (excluding the current book)
    const duplicate = books.find(book => 
        book !== editingBook &&
        book.title.toLowerCase() === title.toLowerCase() && 
        book.author.toLowerCase() === author.toLowerCase()
    );
    
    if (duplicate) {
        alert('Ein Buch mit diesem Titel und Autor existiert bereits.');
        return;
    }
    
    // Update the book
    editingBook.title = title;
    editingBook.author = author;
    editingBook.description = description;
    editingBook.pages = pages ? parseInt(pages) : null;
    editingBook.year = year ? parseInt(year) : null;
    
    showLoading();
    const success = await saveBooks();
    hideLoading();
    
    if (success) {
        hideEditModal();
        renderBooks();
        showSuccess('Buchvorschlag erfolgreich aktualisiert!');
    }
}

async function deleteBook() {
    if (!editingBook) return;
    
    if (!confirm('Möchtest du diesen Buchvorschlag wirklich löschen?')) {
        return;
    }
    
    // Remove the book from the array
    const index = books.indexOf(editingBook);
    if (index > -1) {
        books.splice(index, 1);
    }
    
    showLoading();
    const success = await saveBooks();
    hideLoading();
    
    if (success) {
        hideEditModal();
        renderBooks();
        showSuccess('Buchvorschlag erfolgreich gelöscht!');
    }
}

// Rendering functions
function renderBooks() {
    const booksList = document.getElementById('booksList');
    const filteredBooks = getFilteredBooks();
    
    // Update user filter dropdown
    updateUserFilterDropdown();
    
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
    
    // Build book details HTML
    let detailsHTML = '';
    const details = [];
    
    // Add author as a chip
    details.push(`<div class="md3-book-detail-chip"><span class="material-icons-round" style="font-size: 16px;">person</span>${escapeHtml(book.author)}</div>`);
    
    if (book.pages) {
        details.push(`<div class="md3-book-detail-chip"><span class="material-icons-round" style="font-size: 16px;">menu_book</span>${book.pages} Seiten</div>`);
    }
    if (book.year) {
        details.push(`<div class="md3-book-detail-chip"><span class="material-icons-round" style="font-size: 16px;">calendar_today</span>${book.year}</div>`);
    }
    
    if (details.length > 0) {
        detailsHTML = `<div class="md3-book-card-details">${details.join('')}</div>`;
    }
    
    return `
        <div class="md3-book-card">
            <div class="md3-book-card-header">
                <div class="md3-book-card-info">
                    <h3 class="md3-book-card-title">${escapeHtml(book.title)}</h3>
                    <div class="md3-book-card-meta">
                        Vorgeschlagen von ${escapeHtml(book.suggestedBy)} • ${formatDate(book.suggestedAt)}
                    </div>
                </div>
                ${isMyBook && !isViewerMode ? `
                <button class="md3-icon-button" onclick="editBook('${escapeHtml(book.title)}', '${escapeHtml(book.author)}')" title="Bearbeiten">
                    <span class="material-icons-round">edit</span>
                </button>
                ` : ''}
            </div>
            
            ${detailsHTML}
            
            ${book.description ? `<div class="md3-book-card-description">${escapeHtml(book.description)}</div>` : ''}
            
            <div class="md3-book-card-actions">
                <div class="md3-heart-counter">
                    <span class="material-icons-round" style="font-size: 16px;">favorite</span>
                    <span>${book.likes.length}</span>
                </div>
                
                ${isViewerMode ? '' : `
                <button 
                    class="md3-heart-button ${userHasLiked ? 'md3-heart-button-liked' : ''}"
                    onclick="toggleLike('${escapeHtml(book.title)}', '${escapeHtml(book.author)}')"
                    ${isMyBook ? 'disabled title="Ja, schon klar, dass du deinen eigenen Vorschlag gut findest"' : ''}
                >
                    ${userHasLiked ? '❤️' : '🤍'}
                </button>
                `}
            </div>
        </div>
    `;
}

function getFilteredBooks() {
    let filteredBooks = books;
    
    // Apply user filter first
    if (currentUserFilter !== 'all') {
        filteredBooks = filteredBooks.filter(book => book.suggestedBy === currentUserFilter);
    }
    
    // In viewer mode, only show all books (but still apply user filter)
    if (isViewerMode) {
        return filteredBooks;
    }
    
    // Apply category filter
    switch (currentFilter) {
        case 'my':
            return filteredBooks.filter(book => book.suggestedBy === currentUser);
        case 'liked':
            return filteredBooks.filter(book => book.likes.some(like => like.user === currentUser));
        default:
            return filteredBooks;
    }
}

function getEmptyStateHTML() {
    switch (currentFilter) {
        case 'my':
            return `
                <div class="md3-empty-state">
                    <h3>Noch keine Vorschläge</h3>
                    <p>Du hast noch keine Bücher vorgeschlagen. Füge deinen ersten Vorschlag oben hinzu!</p>
                </div>
            `;
        case 'liked':
            return `
                <div class="md3-empty-state">
                    <h3>Noch keine Favoriten</h3>
                    <p>Du hast noch keine Bücher geliket. Durchstöbere alle Bücher und like deine Favoriten!</p>
                </div>
            `;
        default:
            return `
                <div class="md3-empty-state">
                    <h3>Noch keine Bücher</h3>
                    <p>Sei der erste, der ein Buch für den Buchclub vorschlägt!</p>
                </div>
            `;
    }
}

// Filter functions
function setActiveFilter(filter) {
    currentFilter = filter;
    
    // Update active tab
    document.querySelectorAll('.md3-tab').forEach(btn => {
        btn.classList.remove('md3-tab-active');
    });
    document.querySelector(`[data-filter="${filter}"]`).classList.add('md3-tab-active');
    
    renderBooks();
}

// Update user filter dropdown
function updateUserFilterDropdown() {
    const userFilter = document.getElementById('userFilter');
    const uniqueUsers = [...new Set(books.map(book => book.suggestedBy))].sort();
    
    // Clear existing options except "Alle Vorschlagenden"
    userFilter.innerHTML = '<option value="all">Alle Vorschlagenden</option>';
    
    // Add option for each unique user
    uniqueUsers.forEach(user => {
        const option = document.createElement('option');
        option.value = user;
        option.textContent = user;
        userFilter.appendChild(option);
    });
    
    // Reset to "all" if current selection no longer exists
    if (currentUserFilter !== 'all' && !uniqueUsers.includes(currentUserFilter)) {
        currentUserFilter = 'all';
        userFilter.value = 'all';
    } else {
        userFilter.value = currentUserFilter;
    }
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
