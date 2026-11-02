/**
 * This function must be in the global scope so that the Google Sign-In
 * library can call it after a user signs in.
 */
function handleGoogleSignIn(response) {
    const idToken = response.credential;    
    console.log("Handling Google Sign-In...");

    fetch(`${API_BASE_URL}/auth/google`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: idToken }),
    })
    .then(res => {
        if (!res.ok) {
            return res.json().then(err => { throw new Error(err.detail || 'Authentication failed') });
        }
        return res.json();
    })
    .then(data => {
        if (data.access_token) {
            localStorage.setItem('sessionToken', data.access_token);
            window.location.reload();
        } else {
             throw new Error("Login failed: No access token received.");
        }
    })
    .catch(error => {
        console.error("Google Sign-In Error:", error);
        alert(`Login failed: ${error.message}`);
    });
}

// CORRECTED: Removed markdown formatting from the URL string.
const API_BASE_URL = 'http://127.0.0.1:8000';

document.addEventListener('DOMContentLoaded', () => {
    // --- DOM ELEMENT CACHE ---
    const dom = {
        loginSection: document.getElementById('loginSection'),
        appContent: document.getElementById('appContent'),
        userProfile: document.getElementById('userProfile'),
        userAvatar: document.getElementById('userAvatar'),
        userName: document.getElementById('userName'),
        logoutBtn: document.getElementById('logoutBtn'),
        fileInput: document.getElementById('fileInput'),
        fileNameEl: document.getElementById('fileName'),
        uploadBtn: document.getElementById('uploadBtn'),
        uploadBtnIcon: document.getElementById('button-icon'),
        uploadBtnText: document.getElementById('button-text'),
        progressContainer: document.getElementById('progressContainer'),
        progressBar: document.getElementById('progressBar'),
        progressText: document.getElementById('progressText'),
        resultsSection: document.getElementById('resultsSection'),
        qaSection: document.getElementById('qaSection'),
        documentInfo: document.getElementById('documentInfo'),
        tabs: document.querySelectorAll('.tab-btn'),
        tabPanes: document.querySelectorAll('.tab-pane'),
        outputText: document.getElementById('outputText'),
        summary: document.getElementById('summary'),
        keywordsContainer: document.getElementById('keywordsContainer'),
        piiContainer: document.getElementById('piiContainer'),
        entitiesContainer: document.getElementById('entitiesContainer'),
        analyticsContainer: document.getElementById('analyticsContainer'),
        searchInput: document.getElementById('searchInput'),
        searchBtn: document.getElementById('searchBtn'),
        searchResults: document.getElementById('searchResults'),
        questionInput: document.getElementById('questionInput'),
        askBtn: document.getElementById('askBtn'),
        askBtnIcon: document.getElementById('ask-button-icon'),
        askBtnText: document.getElementById('ask-button-text'),
        answer: document.getElementById('answer'),
        suggestionBtns: document.querySelectorAll('.suggestion-btn'),
        themeToggle: document.getElementById('themeToggle'),
        helpBtn: document.getElementById('helpBtn'),
        helpModal: document.getElementById('helpModal'),
        closeHelpBtn: document.getElementById('closeHelpBtn'),
        historyContainer: document.getElementById('historyContainer'),
        clearHistoryBtn: document.getElementById('clearHistoryBtn'),
        copyTextBtn: document.getElementById('copyTextBtn'),
        downloadTextBtn: document.getElementById('downloadTextBtn'),
        copySummaryBtn: document.getElementById('copySummaryBtn'),
        translateControls: document.getElementById('translateControls'),
        translateLangSelect: document.getElementById('translateLangSelect'),
        translateBtn: document.getElementById('translateBtn'),
        showOriginalBtn: document.getElementById('showOriginalBtn'),
        redactPiiCheckbox: document.getElementById('redactPiiCheckbox'),
        listenTextBtn: document.getElementById('listenTextBtn'),
        listenSummaryBtn: document.getElementById('listenSummaryBtn'),
        audioPlayer: document.getElementById('audioPlayer'),
        quizContainer: document.getElementById('quizContainer'),
    };

    // --- STATE ---
    let sessionToken = null;
    let currentDocumentId = null;
    let currentOriginalText = '';
    let currentTranslatedText = '';
    let currentEntities = [];
    let currentQuizData = [];
    let isAudioPlaying = false;
    let activeListenButton = null;

    // --- AUTHENTICATION ---
    const showLoggedInState = (user) => {
        dom.loginSection.classList.add('hidden');
        dom.appContent.classList.remove('hidden');
        dom.userProfile.classList.remove('hidden');
        dom.userProfile.classList.add('flex');
        
        dom.userName.textContent = user.name || user.email;
        if(user.picture) dom.userAvatar.src = user.picture;

        initializeTheme();
        renderHistory();
        lucide.createIcons();
    };

    const showLoggedOutState = () => {
        dom.loginSection.classList.remove('hidden');
        dom.loginSection.querySelector('.login-card').classList.add('animate-slide-in');
        dom.appContent.classList.add('hidden');
        dom.userProfile.classList.add('hidden');
        dom.userProfile.classList.remove('flex');
    };

    const handleLogout = () => {
        localStorage.removeItem('sessionToken');
        sessionToken = null;
        showLoggedOutState();
    };
    
    const checkForAuth = async () => {
        sessionToken = localStorage.getItem('sessionToken');
        if (!sessionToken) {
            showLoggedOutState();
            return;
        }
        try {
            const res = await fetch(`${API_BASE_URL}/me`, {
                headers: { 'Authorization': `Bearer ${sessionToken}` }
            });
            if (!res.ok) throw new Error('Session invalid');
            const user = await res.json();
            showLoggedInState(user);
        } catch (error) {
            console.error("Auth check failed:", error);
            handleLogout();
        }
    };

    // --- THEME MANAGEMENT ---
    const applyTheme = (theme) => {
        const rootEl = document.documentElement;
        const themeIcon = dom.themeToggle.querySelector('.theme-icon');
        if (theme === 'dark') {
            rootEl.classList.add('dark');
            if (themeIcon) themeIcon.setAttribute('data-lucide', 'moon');
        } else {
            rootEl.classList.remove('dark');
            if (themeIcon) themeIcon.setAttribute('data-lucide', 'sun');
        }
        lucide.createIcons();
    };

    const toggleTheme = () => {
        const newTheme = document.documentElement.classList.contains('dark') ? 'light' : 'dark';
        localStorage.setItem('theme', newTheme);
        applyTheme(newTheme);
    };
    
    const initializeTheme = () => {
        const savedTheme = localStorage.getItem('theme');
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        applyTheme(savedTheme || (prefersDark ? 'dark' : 'light'));
    };

    // --- UTILITY & DISPLAY FUNCTIONS ---
    const showNotification = (message, type = 'error') => {
        const notification = document.createElement('div');
        notification.textContent = message;
        notification.className = `fixed top-5 right-5 p-4 rounded-lg text-white shadow-lg z-50 animate-fade-in-up ${type === 'error' ? 'bg-red-500' : 'bg-green-500'}`;
        document.body.appendChild(notification);
        setTimeout(() => notification.remove(), 4000);
    };

    const copyToClipboard = (text) => {
        if (!text) return;
        navigator.clipboard.writeText(text)
            .then(() => showNotification('Copied to clipboard!', 'success'))
            .catch(() => showNotification('Failed to copy.'));
    };

    const setLoadingState = (button, icon, textEl, text, isLoading) => {
        button.disabled = isLoading;
        const spinner = button.querySelector('.spinner');
        if (isLoading) {
            if (icon) icon.style.display = 'none';
            if (spinner) spinner.style.display = 'inline-block';
            if (textEl) textEl.textContent = text;
        } else {
            if (spinner) spinner.style.display = 'none';
            if (icon) icon.style.display = 'inline-block';
            if (textEl) textEl.textContent = text;
        }
    };

    const highlightEntities = (text, entities) => {
        if (!entities || entities.length === 0) {
            return text;
        }
        const sortedEntities = [...entities].sort((a, b) => b.start - a.start);

        let highlightedText = text;
        sortedEntities.forEach(entity => {
            const originalFragment = highlightedText.substring(entity.start, entity.end);
            const replacement = `<mark class="entity ${entity.label.toLowerCase()}">${originalFragment}</mark>`;
            highlightedText = highlightedText.substring(0, entity.start) + replacement + highlightedText.substring(entity.end);
        });

        return highlightedText;
    };

    // --- DOCUMENT HISTORY ---
    const renderHistory = async () => {
        dom.historyContainer.innerHTML = '';
        try {
            const res = await authenticatedFetch(`${API_BASE_URL}/documents/history`);
            if (!res.ok) throw new Error('Could not fetch history.');
            
            const historyItems = await res.json();

            if (historyItems.length === 0) {
                dom.historyContainer.innerHTML = `<div class="text-center text-gray-400 py-8 dark:text-gray-500"><i data-lucide="folder-open" class="w-12 h-12 mx-auto mb-2 opacity-50"></i><p>No documents processed yet</p></div>`;
                dom.clearHistoryBtn.classList.add('hidden');
            } else {
                dom.clearHistoryBtn.classList.remove('hidden');
                historyItems.forEach(item => {
                    const el = document.createElement('div');
                    el.className = 'history-item group';
                    
                    el.innerHTML = `
                        <div class="flex items-center gap-3 overflow-hidden">
                            <i data-lucide="file-text"></i>
                            <div class="flex-1 overflow-hidden">
                                <p class="truncate font-medium">${item.filename}</p>
                                <p class="text-xs text-light-text-sec dark:text-gray-400">${new Date(item.created_at).toLocaleString()}</p>
                            </div>
                        </div>
                        <button class="delete-item-btn p-2 rounded-md text-gray-400 hover:bg-red-100 hover:text-red-500 dark:hover:bg-red-900/50 dark:hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity" data-id="${item.id}">
                            <i data-lucide="trash-2" class="w-4 h-4"></i>
                        </button>
                    `;

                    el.querySelector('.flex').addEventListener('click', () => {
                        const analysis = JSON.parse(item.analysis_results || '{}');
                        const fullData = {
                            document_id: item.id,
                            filename: item.filename,
                            original_text: item.original_text,
                            translated_text: item.translated_text,
                            ...analysis
                        };
                        displayResults(fullData);
                        dom.resultsSection.scrollIntoView({ behavior: 'smooth' });
                    });

                    el.querySelector('.delete-item-btn').addEventListener('click', async (e) => {
                        e.stopPropagation();
                        const docId = e.currentTarget.dataset.id;
                        if (confirm('Are you sure you want to delete this document?')) {
                            try {
                                await authenticatedFetch(`${API_BASE_URL}/documents/${docId}`, { method: 'DELETE' });
                                showNotification('Document deleted.', 'success');
                                el.remove();
                                if (dom.historyContainer.children.length === 1) {
                                    renderHistory();
                                }
                            } catch (error) {
                                showNotification('Failed to delete document.');
                            }
                        }
                    });

                    dom.historyContainer.appendChild(el);
                });
            }
        } catch (error) {
            dom.historyContainer.innerHTML = `<p class="text-red-400 text-center py-4">Could not load history.</p>`;
            showNotification(error.message);
        } finally {
            lucide.createIcons();
        }
    };
    
    const displayResults = (data) => {
        currentDocumentId = data.document_id;
        currentOriginalText = data.original_text;
        currentTranslatedText = data.translated_text || '';
        currentEntities = data.entities || [];
        
        // Reset quiz state
        currentQuizData = [];
        resetQuizView();
        
        let sentimentLabel = 'Neutral';
        let sentimentColor = 'text-yellow-500';
        if (data.sentiment && data.sentiment.compound) {
            const sentimentScore = data.sentiment.compound;
            if (sentimentScore >= 0.05) {
                sentimentLabel = 'Positive';
                sentimentColor = 'text-green-500';
            } else if (sentimentScore <= -0.05) {
                sentimentLabel = 'Negative';
                sentimentColor = 'text-red-500';
            }
        }

        dom.documentInfo.innerHTML = `
            <div class="info-card"><h5>Filename</h5><p title="${data.filename}">${data.filename}</p></div>
            <div class="info-card"><h5>Detected Language</h5><p>${data.language_detection.language} (${(data.language_detection.confidence * 100).toFixed(1)}%)</p></div>
            <div class="info-card"><h5>Sentiment</h5><p class="${sentimentColor}">${sentimentLabel}</p></div>
            <div class="info-card"><h5>Word Count</h5><p>${data.statistics.word_count}</p></div>
        `;

        dom.outputText.innerHTML = highlightEntities(currentOriginalText, currentEntities);
        dom.summary.textContent = data.summary;
        
        dom.translateControls.classList.remove('hidden');
        dom.showOriginalBtn.classList.add('hidden');
        dom.translateBtn.classList.remove('hidden');
        
        if (!data.keywords || data.keywords.length === 0) {
            dom.keywordsContainer.innerHTML = '<p class="text-center text-gray-500 py-4">No keywords were extracted.</p>';
        } else {
            dom.keywordsContainer.innerHTML = data.keywords.map(kw => 
                `<span class="keyword-tag">${kw.term}</span>`
            ).join('');
        }
        
        if (!data.pii_results || data.pii_results.length === 0) {
            dom.piiContainer.innerHTML = '<p class="text-center text-gray-500 py-4">No personal information was detected.</p>';
        } else {
            const piiGroups = data.pii_results.reduce((acc, { text, type }) => {
                if (!acc[type]) acc[type] = new Set();
                acc[type].add(text);
                return acc;
            }, {});
            dom.piiContainer.innerHTML = Object.entries(piiGroups).map(([type, values]) => `
                <div class="bg-light-bg dark:bg-dark-card border border-light-border dark:border-dark-border rounded-lg p-4">
                    <h5 class="font-medium text-light-text dark:text-white mb-2">${type.replace('_', ' ')} (${values.size})</h5>
                    <div class="flex flex-wrap gap-2">${[...values].map(v => `<span class="entity pii">${v}</span>`).join('')}</div>
                </div>`).join('');
        }

        if (!data.entities || data.entities.length === 0) {
            dom.entitiesContainer.innerHTML = '<p class="text-center text-gray-500 py-4">No entities were detected.</p>';
        } else {
            const entityGroups = data.entities.reduce((acc, { text, label }) => {
                if (!acc[label]) acc[label] = new Set();
                acc[label].add(text);
                return acc;
            }, {});
            dom.entitiesContainer.innerHTML = Object.entries(entityGroups).map(([label, values]) => `
                <div class="bg-light-bg dark:bg-dark-card border border-light-border dark:border-dark-border rounded-lg p-4">
                    <h5 class="font-medium text-light-text dark:text-white mb-2">${label} (${values.size})</h5>
                    <div class="flex flex-wrap gap-2">${[...values].map(v => `<span class="entity ${label.toLowerCase()}">${v}</span>`).join('')}</div>
                </div>`).join('');
        }

        const stats = data.statistics;
        const items = {
            'Words': stats.word_count, 'Sentences': stats.sentence_count,
            'Characters': stats.character_count
        };
        dom.analyticsContainer.innerHTML = Object.entries(items).map(([label, value]) => `
            <div class="p-4 bg-light-bg dark:bg-dark-card border border-light-border dark:border-dark-border rounded-lg text-center">
                <h5 class="text-2xl font-bold text-light-text dark:text-white mb-1">${value}</h5>
                <p class="text-sm text-light-text-sec dark:text-gray-400">${label}</p>
            </div>`).join('');

        dom.resultsSection.classList.remove('hidden');
        dom.qaSection.classList.remove('hidden');
        dom.resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    // --- SECURED API CALLS ---
    const authenticatedFetch = async (url, options = {}) => {
        if (!sessionToken) {
            showNotification("Your session has expired. Please log in again.");
            handleLogout();
            throw new Error("User is not authenticated.");
        }
        const headers = { ...options.headers, 'Authorization': `Bearer ${sessionToken}` };
        const response = await fetch(url, { ...options, headers });

        if (response.status === 401) { // Unauthorized
            handleLogout();
            throw new Error("Session expired. Please log in again.");
        }
        return response;
    };

    const handleUpload = async () => {
        if (!dom.fileInput.files.length) {
            showNotification('Please select a file first.');
            return;
        }
        const formData = new FormData();
        formData.append('file', dom.fileInput.files[0]);
        formData.append('redact_pii', dom.redactPiiCheckbox.checked);

        const uploadBtnIcon = dom.uploadBtn.querySelector('.button-icon-el');
        setLoadingState(dom.uploadBtn, uploadBtnIcon, dom.uploadBtnText, 'Analyzing...', true);
        dom.progressContainer.classList.remove('hidden');
        dom.progressBar.style.width = '30%';

        try {
            const res = await authenticatedFetch(`${API_BASE_URL}/upload`, { method: 'POST', body: formData });
            if (!res.ok) throw new Error((await res.json()).detail || 'Upload failed');
            
            dom.progressBar.style.width = '100%';
            dom.progressText.textContent = 'Completed!';
            const data = await res.json();
            
            setTimeout(() => {
                dom.progressContainer.classList.add('hidden');
                displayResults(data);
                renderHistory();
            }, 500);
        } catch (error) {
            showNotification(error.message);
            dom.progressContainer.classList.add('hidden');
        } finally {
            const finalUploadBtnIcon = dom.uploadBtn.querySelector('.button-icon-el');
            setLoadingState(dom.uploadBtn, finalUploadBtnIcon, dom.uploadBtnText, 'Analyze Document', false);
            dom.progressBar.style.width = '0%';
            dom.progressText.textContent = 'Processing...';
        }
    };

    const handleTranslate = async () => {
        if (!currentDocumentId) return;

        const targetLang = dom.translateLangSelect.value;
        const translateBtn = dom.translateBtn;
        const translateBtnIcon = translateBtn.querySelector('.button-icon-el');
        const translateBtnText = translateBtn.querySelector('span:last-child');

        setLoadingState(translateBtn, translateBtnIcon, translateBtnText, 'Translating...', true);
        
        try {
            const formData = new FormData();
            formData.append('target_lang', targetLang);

            const res = await authenticatedFetch(`${API_BASE_URL}/translate/${currentDocumentId}`, {
                method: 'POST',
                body: formData,
            });

            if (!res.ok) throw new Error((await res.json()).detail || 'Translation failed');

            const data = await res.json();
            currentTranslatedText = data.translated_text;
            dom.outputText.innerHTML = currentTranslatedText;
            
            dom.translateBtn.classList.add('hidden');
            dom.showOriginalBtn.classList.remove('hidden');

        } catch (error) {
            showNotification(error.message);
        } finally {
            const finalTranslateBtnIcon = dom.translateBtn.querySelector('.button-icon-el');
            setLoadingState(translateBtn, finalTranslateBtnIcon, translateBtnText, 'Translate', false);
        }
    };
    
    const handleSearch = async () => {
        const query = dom.searchInput.value.trim();
        if (!query || !currentDocumentId) return;
        
        dom.searchResults.innerHTML = '<p class="text-center py-4">Searching...</p>';
        try {
            const formData = new FormData();
            formData.append('query', query);
            const res = await authenticatedFetch(`${API_BASE_URL}/search/${currentDocumentId}`, { method: 'POST', body: formData });
            if (!res.ok) throw new Error((await res.json()).detail);
            const data = await res.json();
            
            if (!data.results.length) {
                dom.searchResults.innerHTML = '<p class="text-center py-4">No matches found.</p>';
            } else {
                dom.searchResults.innerHTML = data.results.map(r => 
                    `<div class="p-3 bg-light-bg dark:bg-dark-card rounded-lg border border-light-border dark:border-dark-border text-sm">${r.snippet.replace(new RegExp(query, 'gi'), `<mark class="bg-yellow-200 dark:bg-yellow-600 rounded px-1">${query}</mark>`)}</div>`
                ).join('');
            }
        } catch (error) {
            showNotification(error.message);
            dom.searchResults.innerHTML = `<p class="text-red-400 text-center py-4">Search failed.</p>`;
        }
    };

    const handleQuestion = async () => {
        const question = dom.questionInput.value.trim();
        if (!question || !currentDocumentId) return;
        
        const askBtnIcon = dom.askBtn.querySelector('.button-icon-el');
        setLoadingState(dom.askBtn, askBtnIcon, dom.askBtnText, 'Asking...', true);
        dom.answer.textContent = 'Thinking...';
        
        try {
            const formData = new FormData();
            formData.append('question', question);
            const res = await authenticatedFetch(`${API_BASE_URL}/qa/${currentDocumentId}`, { method: 'POST', body: formData });
            if (!res.ok) throw new Error((await res.json()).detail);
            const data = await res.json();
            dom.answer.textContent = data.answer;
        } catch (error) {
            dom.answer.textContent = 'Error: ' + error.message;
            showNotification(error.message);
        } finally {
            const finalAskBtnIcon = dom.askBtn.querySelector('.button-icon-el');
            setLoadingState(dom.askBtn, finalAskBtnIcon, dom.askBtnText, 'Ask', false);
        }
    };

    const handleListen = async (textType) => {
        if (!currentDocumentId) return;

        const btn = textType === 'summary' ? dom.listenSummaryBtn : dom.listenTextBtn;
        const icon = btn.querySelector('.button-icon-el');
        const textEl = btn.querySelector('span');

        if (isAudioPlaying && activeListenButton === btn) {
            dom.audioPlayer.pause();
            return;
        }

        if (isAudioPlaying) {
            dom.audioPlayer.pause();
        }

        activeListenButton = btn;
        setLoadingState(btn, icon, textEl, 'Loading...', true);

        try {
            const formData = new FormData();
            formData.append('text_type', textType);
            const res = await authenticatedFetch(`${API_BASE_URL}/tts/${currentDocumentId}`, {
                method: 'POST',
                body: formData,
            });

            if (!res.ok) throw new Error((await res.json()).detail || 'Failed to generate audio.');

            const audioBlob = await res.blob();
            const audioUrl = URL.createObjectURL(audioBlob);
            dom.audioPlayer.src = audioUrl;
            dom.audioPlayer.play();
            
        } catch (error) {
            showNotification(error.message);
            setLoadingState(btn, icon, textEl, 'Listen', false);
        }
    };
    
    // --- QUIZ FUNCTIONS ---
    const resetQuizView = () => {
        dom.quizContainer.innerHTML = `
            <div class="text-center">
                <p class="text-light-text-sec dark:text-gray-400 mb-4">Generate a quiz to test your knowledge of the document.</p>
                <button id="generateQuizBtn" class="action-btn-primary px-6 py-3">
                    <i data-lucide="sparkles" class="w-5 h-5 button-icon-el"></i>
                    <span class="spinner"></span>
                    <span>Generate Quiz</span>
                </button>
            </div>
        `;
        lucide.createIcons();
        document.getElementById('generateQuizBtn').addEventListener('click', handleGenerateQuiz);
    };

    const handleGenerateQuiz = async () => {
        if (!currentDocumentId) return;
        const btn = document.getElementById('generateQuizBtn');
        const icon = btn.querySelector('.button-icon-el');
        const textEl = btn.querySelector('span:last-child');
        setLoadingState(btn, icon, textEl, 'Generating...', true);

        try {
            const res = await authenticatedFetch(`${API_BASE_URL}/quiz/${currentDocumentId}`, { method: 'POST' });
            if (!res.ok) throw new Error((await res.json()).detail || 'Failed to generate quiz.');
            const data = await res.json();
            renderQuiz(data.quiz);
        } catch (error) {
            showNotification(error.message);
            resetQuizView();
        }
    };

    const renderQuiz = (quizData) => {
        currentQuizData = quizData;
        dom.quizContainer.innerHTML = ''; // Clear the container

        quizData.forEach((q, index) => {
            const optionsHtml = q.options.map(opt => `
                <label class="quiz-option-label">
                    <input type="radio" name="question-${index}" value="${opt}" class="mr-2">
                    <span>${opt}</span>
                </label>
            `).join('');

            const questionEl = document.createElement('div');
            questionEl.className = 'quiz-question-container';
            questionEl.innerHTML = `
                <p class="font-medium mb-3">${index + 1}. ${q.question}</p>
                <div class="space-y-2 quiz-options" id="options-${index}">${optionsHtml}</div>
            `;
            dom.quizContainer.appendChild(questionEl);
        });

        dom.quizContainer.insertAdjacentHTML('beforeend', `
            <div class="flex justify-center mt-6">
                <button id="submitQuizBtn" class="action-btn-primary px-8 py-3">Submit Answers</button>
            </div>
        `);
        document.getElementById('submitQuizBtn').addEventListener('click', checkQuiz);
    };

    const checkQuiz = () => {
        let score = 0;
        currentQuizData.forEach((q, index) => {
            const optionsContainer = document.getElementById(`options-${index}`);
            const selected = optionsContainer.querySelector(`input[name="question-${index}"]:checked`);
            
            optionsContainer.querySelectorAll('.quiz-option-label').forEach(label => {
                const input = label.querySelector('input');
                label.classList.remove('correct', 'incorrect');
                input.disabled = true;

                if (input.value === q.correct_answer) {
                    label.classList.add('correct');
                }
            });

            if (selected) {
                if (selected.value !== q.correct_answer) {
                    selected.parentElement.classList.add('incorrect');
                } else {
                    score++;
                }
            }
        });

        document.getElementById('submitQuizBtn').remove();
        
        const scoreEl = document.createElement('div');
        scoreEl.className = 'text-center text-2xl font-bold p-6 rounded-lg mt-6';
        if(score / currentQuizData.length >= 0.75) {
            scoreEl.classList.add('bg-green-100', 'text-green-700', 'dark:bg-green-900/50', 'dark:text-green-300');
        } else if (score / currentQuizData.length >= 0.4) {
             scoreEl.classList.add('bg-yellow-100', 'text-yellow-700', 'dark:bg-yellow-900/50', 'dark:text-yellow-300');
        } else {
            scoreEl.classList.add('bg-red-100', 'text-red-700', 'dark:bg-red-900/50', 'dark:text-red-300');
        }
        scoreEl.innerHTML = `Your Score: ${score} / ${currentQuizData.length}`;
        dom.quizContainer.insertAdjacentElement('afterbegin', scoreEl);
    };

    // --- EVENT LISTENERS ---
    dom.logoutBtn.addEventListener('click', handleLogout);
    dom.uploadBtn.addEventListener('click', handleUpload);
    dom.fileInput.addEventListener('change', () => {
        dom.fileNameEl.textContent = dom.fileInput.files.length > 0 ? dom.fileInput.files[0].name : 'No file selected';
    });
    
    dom.themeToggle.addEventListener('click', toggleTheme);
    dom.searchBtn.addEventListener('click', handleSearch);
    dom.searchInput.addEventListener('keyup', e => e.key === 'Enter' && handleSearch());
    dom.askBtn.addEventListener('click', handleQuestion);
    dom.questionInput.addEventListener('keyup', e => e.key === 'Enter' && handleQuestion());

    dom.translateBtn.addEventListener('click', handleTranslate);
    dom.showOriginalBtn.addEventListener('click', () => {
        dom.outputText.innerHTML = highlightEntities(currentOriginalText, currentEntities);
        dom.showOriginalBtn.classList.add('hidden');
        dom.translateBtn.classList.remove('hidden');
    });

    dom.listenTextBtn.addEventListener('click', () => handleListen('original'));
    dom.listenSummaryBtn.addEventListener('click', () => handleListen('summary'));

    dom.audioPlayer.addEventListener('play', () => {
        isAudioPlaying = true;
        if (activeListenButton) {
            const icon = activeListenButton.querySelector('.button-icon-el');
            const textEl = activeListenButton.querySelector('span');
            setLoadingState(activeListenButton, icon, textEl, 'Pause', false);
            icon.setAttribute('data-lucide', 'pause-circle');
            lucide.createIcons();
        }
    });

    dom.audioPlayer.addEventListener('pause', () => {
        if (activeListenButton) {
            const icon = activeListenButton.querySelector('.button-icon-el');
            const textEl = activeListenButton.querySelector('span');
            setLoadingState(activeListenButton, icon, textEl, 'Listen', false);
            icon.setAttribute('data-lucide', 'volume-2');
            lucide.createIcons();
        }
        isAudioPlaying = false;
        activeListenButton = null;
    });

    dom.audioPlayer.addEventListener('ended', () => {
        if (activeListenButton) {
            const icon = activeListenButton.querySelector('.button-icon-el');
            const textEl = activeListenButton.querySelector('span');
            setLoadingState(activeListenButton, icon, textEl, 'Listen', false);
            icon.setAttribute('data-lucide', 'volume-2');
            lucide.createIcons();
        }
        isAudioPlaying = false;
        activeListenButton = null;
    });

    dom.suggestionBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            dom.questionInput.value = btn.textContent;
            handleQuestion();
        });
    });

    dom.tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            dom.tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            dom.tabPanes.forEach(pane => {
                pane.classList.toggle('hidden', pane.id !== `${tab.dataset.tab}-tab`);
                pane.classList.toggle('active', pane.id === `${tab.dataset.tab}-tab`);
            });
        });
    });

    dom.helpBtn.addEventListener('click', () => dom.helpModal.classList.remove('hidden'));
    dom.closeHelpBtn.addEventListener('click', () => dom.helpModal.classList.add('hidden'));
    
    dom.clearHistoryBtn.addEventListener('click', async () => {
        if (confirm('Are you sure you want to delete ALL your documents? This cannot be undone.')) {
            try {
                await authenticatedFetch(`${API_BASE_URL}/documents/history/clear`, { method: 'DELETE' });
                showNotification('All documents have been deleted.', 'success');
                renderHistory();
            } catch (error) {
                showNotification('Failed to clear history.');
            }
        }
    });

    dom.copyTextBtn.addEventListener('click', () => copyToClipboard(dom.outputText.textContent));
    dom.copySummaryBtn.addEventListener('click', () => copyToClipboard(dom.summary.textContent));
    dom.downloadTextBtn.addEventListener('click', () => {
        const text = dom.outputText.textContent;
        if (!text) return;
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${currentDocumentId || 'document'}_content.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    });

    // --- INITIALIZATION ---
    checkForAuth();
});