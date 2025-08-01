document.addEventListener('DOMContentLoaded', () => {
    // --- Firebase Configuration ---
    const firebaseConfig = {
        apiKey: "AIzaSyDqeV4EtSlkvT47bCHdN4_P55U6kagePzs",
        authDomain: "quiz-8b-ngs.firebaseapp.com",
        databaseURL: "https://quiz-8b-ngs-default-rtdb.firebaseio.com",
        projectId: "quiz-8b-ngs",
        storageBucket: "quiz-8b-ngs.firebasestorage.app",
        messagingSenderId: "270361998184",
        appId: "1:270361998184:web:49a0ebbc2118c055fb1cdd",
    };
    firebase.initializeApp(firebaseConfig);
    const db = firebase.database();
    const storage = firebase.storage();

    // --- Global Constants & App State ---
    const GEMINI_API_KEY = 'AIzaSyC3snF41mT0A9hsoz12X6CysV9cMLLlNGM';
    const AVATAR_LIST = ['download.jpg', 'spider.jpg', 'gojo.jpg', 'tungtungsahur.jpg', 'giyu.jpg', 'tanjiro.jpg', 'shinobu.jpg', 'shinobou.jpg'];
    const app = {
        users: [], quizzes: [], rooms: [], currentUser: null, currentRoomId: null,
        currentQuiz: null, gameState: {}, questionTimer: null,
        adminEmails: ["lychayzooba@gmail.com", "thathetsophearith@gmail.com"],
        aiConversationHistory: []
    };
    let dataLoaded = false;
    let lastProcessedBroadcastId = null;

    // --- DOM Selectors & UI Helpers ---
    const $ = (selector) => document.querySelector(selector);
    const $$ = (selector) => document.querySelectorAll(selector);
    const views = { login: $('#login-view'), signup: $('#signup-view'), home: $('#home-view'), admin: $('#admin-view'), lobby: $('#quiz-lobby-view'), game: $('#quiz-game-view'), leaderboard: $('#leaderboard-view'), modal: $('#modal-overlay') };
    const showView = (viewName) => { Object.values(views).forEach(v => v.style.display = 'none'); if (views[viewName]) { views[viewName].style.display = ['login', 'signup', 'leaderboard', 'lobby'].includes(viewName) ? 'flex' : 'block'; } };
    const encodeEmail = (email) => email ? email.replace(/\./g, ',') : '';
    const decodeEmail = (encodedEmail) => encodedEmail ? encodedEmail.replace(/,/g, '.') : '';
    const showModal = (title, bodyHtml, onOk) => { $('#modal-title').textContent = title; $('#modal-body').innerHTML = bodyHtml; views.modal.style.display = 'flex'; const okButton = $('#modal-ok-btn'); if (okButton) { okButton.onclick = () => { views.modal.style.display = 'none'; if (onOk) onOk(); }; } };
    const showNotification = (message, duration = 4000) => { const notif = $('#global-notification'); notif.textContent = message; notif.style.display = 'block'; setTimeout(() => { if (notif.textContent === message) notif.style.display = 'none'; }, duration); };

    // --- Main Initializer ---
    const init = () => {
        addEventListeners();
        app.currentUser = JSON.parse(localStorage.getItem('quiz8b_currentUser'));
        
        const urlParamsImmediate = new URLSearchParams(window.location.search);
        const roomIdFromUrlImmediate = urlParamsImmediate.get('room');
        if (roomIdFromUrlImmediate && !app.currentUser) {
            handleGuestLogin(roomIdFromUrlImmediate);
        }
        
        let loadedCount = 0;
        const onDataLoaded = () => {
            dataLoaded = true;
            updateUIbasedOnState(); // Initial update
            const urlParams = new URLSearchParams(window.location.search);
            const roomIdFromUrl = urlParams.get('room');
            if (app.currentUser) {
                const user = app.users.find(u => u.email === app.currentUser.email);
                if (user && user.banned && !app.currentUser.isGuest) return handleLogout();
                if (roomIdFromUrl) { joinRoom(roomIdFromUrl); } else { goHome(); }
            } else {
                if (!roomIdFromUrl) { showView('login'); }
            }
        };
        const checkAllLoaded = () => { if (++loadedCount >= 4) onDataLoaded(); };
        db.ref('users').on('value', s => { app.users = s.val() ? Object.values(s.val()) : []; app.adminEmails.forEach(adminEmail => { if (!app.users.find(u => u.email === adminEmail)) { db.ref('users/' + encodeEmail(adminEmail)).set({ username: 'Admin', email: adminEmail, password: 'admin', isAdmin: true, banned: false }); } }); if (!dataLoaded) checkAllLoaded(); else updateUIbasedOnState(); });
        db.ref('quizzes').on('value', s => { app.quizzes = s.val() ? Object.values(s.val()) : []; if (!dataLoaded) checkAllLoaded(); else updateUIbasedOnState(); });
        db.ref('rooms').on('value', s => { app.rooms = s.val() ? Object.values(s.val()) : []; if (app.currentRoomId && !app.rooms.find(r => r.id === app.currentRoomId) && (views.game.style.display === 'flex' || views.lobby.style.display === 'flex')) { forceGoHome("The room was closed by the host."); } if (!dataLoaded) checkAllLoaded(); else updateUIbasedOnState(); });
        db.ref('broadcast').on('value', s => { checkAndShowBroadcast(s.val()); if (!dataLoaded) checkAllLoaded(); });
    };

    function updateUIbasedOnState() {
        if (!dataLoaded) return;
        if (views.home.style.display !== 'none') updateHomeUI();
        if (views.admin.style.display !== 'none') updateAdminUI();

        if (app.currentRoomId) {
            const room = app.rooms.find(r => r.id === app.currentRoomId);
            if (room) {
                if (views.lobby.style.display !== 'none') {
                    updateLobbyUI(room);
                    if (room.status === 'active' && views.game.style.display !== 'flex') {
                        app.currentQuiz = app.quizzes.find(q => q.id === room.quizId);
                        if (app.currentQuiz) startGame();
                    }
                }
                if (views.game.style.display !== 'none') {
                    updateLiveRank();
                }
                if (views.leaderboard.style.display !== 'none') {
                    displayLeaderboard(room);
                }
            }
        }
    }
    const forceGoHome = (message) => { showModal("Room Closed", `<p>${message}</p><button id='modal-ok-btn' class='modal-btn'>OK</button>`, goHome); };
    const goHome = () => { app.currentRoomId = null; app.currentQuiz = null; localStorage.removeItem('quiz8b_gameState'); if (window.location.search) window.history.pushState({}, '', window.location.pathname); showView('home'); updateHomeUI(); };

    // --- User & Auth ---
    const handleLogout = () => { app.currentUser = null; app.currentRoomId = null; localStorage.removeItem('quiz8b_currentUser'); localStorage.removeItem('quiz8b_gameState'); showView('login'); };
    const handleLogin = () => { const user = app.users.find(u => u.email === $('#login-email').value.trim() && u.password === $('#login-password').value); if (user) { if (user.banned) return alert('Your account has been banned.'); app.currentUser = { email: user.email, username: user.username, isAdmin: user.isAdmin }; localStorage.setItem('quiz8b_currentUser', JSON.stringify(app.currentUser)); goHome(); } else alert('Invalid email or password.'); };
    const handleSignup = () => { const u = $('#signup-username').value.trim(); const e = $('#signup-email').value.trim(); const p = $('#signup-password').value; if (!u || !e || !p) return alert('Please fill in all fields.'); if (app.users.find(user => user.email === e)) return alert('This email is already in use.'); const newUser = { username: u, email: e, password: p, isAdmin: app.adminEmails.includes(e), banned: false }; db.ref('users/' + encodeEmail(e)).set(newUser); app.currentUser = { email: e, username: u, isAdmin: newUser.isAdmin }; localStorage.setItem('quiz8b_currentUser', JSON.stringify(app.currentUser)); goHome(); };
    const handleGuestLogin = (roomId) => { showModal("Join as Guest", `<p>Please enter your username to play.</p><input type="text" id="guest-username-input" placeholder="Username"><button id="guest-join-btn" class="modal-btn">Join Game</button>`); $('#guest-join-btn').onclick = () => { const username = $('#guest-username-input').value.trim(); if (username) { app.currentUser = { username, email: `guest_${Date.now()}@quiz8b.com`, isGuest: true, isAdmin: false }; localStorage.setItem('quiz8b_currentUser', JSON.stringify(app.currentUser)); views.modal.style.display = 'none'; joinRoom(roomId); } else { alert("Please enter a username."); } }; };
    const updateHomeUI = () => { const c = $('#user-actions'); if (app.currentUser && !app.currentUser.isGuest) { c.innerHTML = `<span id="user-display">Welcome, ${app.currentUser.username}</span><button id="logout-btn">Logout</button>${app.currentUser.isAdmin ? '<button id="admin-panel-btn">Admin Panel</button>' : ''}`; } else { c.innerHTML = `<button id="show-login-btn">Login / Sign Up</button>`; } renderRooms(); };
    const renderRooms = () => { $('#rooms-list').innerHTML = ''; const available = app.rooms.filter(r => r.status === 'waiting'); if (available.length === 0) { $('#rooms-list').innerHTML = '<p>No available rooms.</p>'; return; } available.forEach(room => { const quiz = app.quizzes.find(q => q.id === room.quizId); const host = app.users.find(u => u.email === room.host); if (quiz) { const card = document.createElement('div'); card.className = 'room-card'; card.addEventListener('click', () => { if (app.currentUser) { joinRoom(room.id); } else { handleGuestLogin(room.id); } }); const playerCount = room.players ? Object.keys(room.players).length : 0; card.innerHTML = `<h3>${quiz.title}</h3><p>Hosted by: ${host ? host.username : 'N/A'}</p><p>Players: ${playerCount}</p>`; $('#rooms-list').appendChild(card); } }); };

    // --- Admin & AI ---
    const updateAdminUI = () => { 
        if (!app.currentUser || !app.currentUser.isAdmin) return;
        $('#manage-quizzes-list').innerHTML = ''; 
        (app.quizzes || []).forEach(q => { const li = document.createElement('li'); li.innerHTML = `<span>${q.title} (${q.questions ? q.questions.length : 0})</span><div><button class="host-quiz-btn" data-quiz-id="${q.id}">បង្ហោះ</button><button class="delete-quiz-btn" data-quiz-id="${q.id}">លុប</button></div>`; $('#manage-quizzes-list').appendChild(li); }); 
        $('#manage-users-list').innerHTML = ''; 
        app.users.filter(u => !app.adminEmails.includes(u.email)).forEach(user => { const li = document.createElement('li'); li.innerHTML = `<span>${user.username} ${user.banned ? '(BANNED)' : ''}</span><button class="ban-user-btn" data-user-email="${user.email}">${user.banned ? 'Unban' : 'Ban'}</button>`; $('#manage-users-list').appendChild(li);}); 

        const recipientSelect = $('#broadcast-recipient');
        const currentRecipient = recipientSelect.value;
        recipientSelect.innerHTML = '<option value="all">All Users</option>';
        app.users.forEach(user => {
            if (!user.isGuest) {
                 recipientSelect.innerHTML += `<option value="${user.email}">${user.username} (${user.email})</option>`;
            }
        });
        if (currentRecipient) {
            recipientSelect.value = currentRecipient;
        }
    };
    async function generateQuizFromContent(content, prompt) { if (!GEMINI_API_KEY) { alert('សូមដាក់ Gemini API Key.'); return null; } const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`; content.unshift({ text: prompt }); try { const res = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: content }], generationConfig: { response_mime_type: "application/json" } }) }); if (!res.ok) { throw new Error(`API Error: ${res.status} - ${await res.text()}`); } const data = await res.json(); return data.candidates[0].content.parts[0].text; } catch (error) { console.error("AI Error:", error); alert(`មានបញ្ហាក្នុងការបង្កើតសំណួរពី AI: ${error.message}.`); return null; } }
    async function fileToGenerativePart(file) { const base64EncodedData = await new Promise(resolve => { const reader = new FileReader(); reader.onloadend = () => resolve(reader.result.split(',')[1]); reader.readAsDataURL(file); }); return { inline_data: { mime_type: file.type, data: base64EncodedData } }; }
    const handleImageBotCreate = async () => { app.aiConversationHistory = []; const files = $('#bot-image-upload').files; if (files.length === 0) return alert("សូមជ្រើសរើសរូបភាព។"); $('#bot-status').style.display = 'block'; $('#bot-image-create-btn').disabled = true; let PROMPT = `You are a helpful assistant for creating quizzes. Your primary language for all communication and content generation is Khmer. Analyze these images of a lesson. Generate 5 new multiple-choice questions in Khmer. Each question must have exactly 4 options, one correct. Respond STRICTLY with a valid JSON object: {"questions": [{"question": "...", "options": ["...", "...", "...", "..."], "correct_answer_index": 0}]}`; app.aiConversationHistory = await Promise.all(Array.from(files).map(fileToGenerativePart)); const aiResultText = await generateQuizFromContent(app.aiConversationHistory, PROMPT); $('#bot-status').style.display = 'none'; $('#bot-image-create-btn').disabled = false; if (aiResultText) { try { const aiResult = JSON.parse(aiResultText); if (aiResult && aiResult.questions) { if ($('#quiz-title').value.trim() === '') $('#quiz-title').value = "កម្រងសំណួរពី AI"; $('#questions-container').innerHTML = ''; aiResult.questions.forEach(q => populateQuestionFromData(q)); alert("AI បានបង្កើតសំណួរដោយជោគជ័យ!"); $('#refine-ai-btn').style.display = 'block'; app.aiConversationHistory.push({ text: PROMPT }, { text: aiResultText }); } else { throw new Error("Invalid JSON structure."); } } catch (e) { alert("AI បានឆ្លើយតបមក ប៉ុន្តែទម្រង់មិនត្រឹមត្រូវ។"); } } };
    const handleTextBotCreate = async () => { app.aiConversationHistory = []; const textInput = $('#bot-text-input').value.trim(); if (!textInput) return alert("សូមសរសេរប្រធានបទ។"); $('#bot-status').style.display = 'block'; $('#bot-text-create-btn').disabled = true; let PROMPT = `You are a helpful assistant for creating quizzes. Your primary language for all communication and content generation is Khmer. Based on the following topic or text, generate 5 new multiple-choice questions in Khmer. Each question must have exactly 4 options, one correct. Respond STRICTLY with a valid JSON object: {"questions": [{"question": "...", "options": ["...", "...", "...", "..."], "correct_answer_index": 0}]}`; app.aiConversationHistory = [{text: textInput}]; const aiResultText = await generateQuizFromContent(app.aiConversationHistory, PROMPT); $('#bot-status').style.display = 'none'; $('#bot-text-create-btn').disabled = false; if (aiResultText) { try { const aiResult = JSON.parse(aiResultText); if (aiResult && aiResult.questions) { if ($('#quiz-title').value.trim() === '') $('#quiz-title').value = textInput.substring(0, 30); $('#questions-container').innerHTML = ''; aiResult.questions.forEach(q => populateQuestionFromData(q)); alert("AI បានបង្កើតសំណួរដោយជោគជ័យ!"); $('#refine-ai-btn').style.display = 'block'; app.aiConversationHistory.push({ text: PROMPT }, { text: aiResultText }); } else { throw new Error("Invalid JSON structure."); } } catch (e) { alert("AI បានឆ្លើយតបមក ប៉ុន្តែទម្រង់មិនត្រឹមត្រូវ។"); } } };
    const handleRefineAI = () => { showModal('ចរចាជាមួយ AI', `<div id="ai-chat-history"></div><textarea id="ai-chat-input" placeholder="សរសេរសំណើររបស់អ្នកជាភាសាខ្មែរ..."></textarea><div style="display:flex; gap:10px; margin-top:10px;"><button id="send-refinement-btn" class="modal-btn">ផ្ញើ</button><button id="ai-chat-close-btn" class="modal-btn secondary-btn">បិទ</button></div>`); const historyDiv = $('#ai-chat-history'); historyDiv.innerHTML = '<div class="ai-chat-message bot">សួស្តី! តើខ្ញុំអាចជួយអ្វីបាន? សូមសរសេរសំណើររបស់អ្នកជាភាសាខ្មែរ។</div>'; $('#ai-chat-close-btn').onclick = () => views.modal.style.display = 'none'; $('#send-refinement-btn').onclick = async () => { const input = $('#ai-chat-input'); const userMessage = input.value.trim(); if (!userMessage) return; historyDiv.innerHTML += `<div class="ai-chat-message user">${userMessage}</div>`; input.value = ''; input.disabled = true; $('#send-refinement-btn').disabled = true; historyDiv.scrollTop = historyDiv.scrollHeight; let PROMPT = `You are a helpful quiz creation assistant who MUST speak and respond in Khmer. Based on our previous conversation and the context (images or text), refine the quiz using this new Khmer instruction: "${userMessage}". The existing questions are in the history. Provide a complete, updated JSON object for the entire quiz, ensuring all text is in Khmer.`; app.aiConversationHistory.push({ text: userMessage }); const aiResultText = await generateQuizFromContent(app.aiConversationHistory, PROMPT); input.disabled = false; $('#send-refinement-btn').disabled = false; if (aiResultText) { historyDiv.innerHTML += `<div class="ai-chat-message bot">តាមសំណើររបស់លោកអ្នក! ខ្ញុំបានកែសម្រួលសំណួររួចរាល់ហើយ។</div>`; try { const aiResult = JSON.parse(aiResultText); if (aiResult && aiResult.questions) { $('#questions-container').innerHTML = ''; aiResult.questions.forEach(q => populateQuestionFromData(q)); app.aiConversationHistory.push({ text: aiResultText }); showNotification('Quiz updated by AI!'); } } catch (e) { showNotification('AI response was not valid JSON.'); } } else { historyDiv.innerHTML += `<div class="ai-chat-message bot">សូមអភ័យទោស! ខ្ញុំមានបញ្ហាក្នុងការដំណើរការ។</div>`; } historyDiv.scrollTop = historyDiv.scrollHeight; }; };
    const populateQuestionFromData = (qData) => { const node = $('#question-template').content.cloneNode(true); const qIndex = $('#questions-container').children.length; node.querySelector('h4').textContent = `Question ${qIndex + 1}`; node.querySelectorAll('input[type="radio"]').forEach(r => r.name = `correct_answer_${qIndex}`); node.querySelector('.question-text').value = qData.question || ''; node.querySelectorAll('.answer-text').forEach((input, i) => input.value = qData.options[i] || ''); if (qData.correct_answer_index !== undefined) node.querySelector(`input[value="${qData.correct_answer_index}"]`).checked = true; const preview = node.querySelector('.question-image-preview'); const removeBtn = node.querySelector('.remove-image-btn'); if (qData.imageUrl) { preview.src = qData.imageUrl; preview.style.display = 'block'; removeBtn.style.display = 'inline-block'; } $('#questions-container').appendChild(node); };
    async function uploadQuestionImage(file) { if (!file) return null; const filePath = `question_images/${Date.now()}_${file.name}`; const fileRef = storage.ref(filePath); await fileRef.put(file); return await fileRef.getDownloadURL(); }
    
    const handleSaveQuiz = async () => {
        const saveButton = $('#save-quiz-btn');
        const notif = $('#global-notification');
        saveButton.disabled = true;
        
        try {
            const title = $('#quiz-title').value.trim();
            if (!title) throw new Error('Please enter a quiz title.');
            
            const editors = $$('#questions-container .question-editor');
            if (editors.length === 0) throw new Error('Please add at least one question.');

            let questions = [];
            const uploadTasks = [];

            for (const [i, e] of editors.entries()) {
                const qNum = i + 1;
                const text = e.querySelector('.question-text').value.trim();
                const answers = Array.from(e.querySelectorAll('.answer-text')).map(inp => inp.value.trim());
                const correct = e.querySelector('input[type="radio"]:checked');

                if (!text) throw new Error(`Error in Question ${qNum}: The question text cannot be empty.`);
                if (answers.some(a => !a)) throw new Error(`Error in Question ${qNum}: All four answer options must be filled out.`);
                if (!correct) throw new Error(`Error in Question ${qNum}: Please select a correct answer.`);

                const imageFile = e.querySelector('.question-image-upload').files[0];
                const preview = e.querySelector('.question-image-preview');
                let imageUrl = null;

                if (preview.style.display !== 'none' && preview.src && preview.src.startsWith('http')) {
                    imageUrl = preview.src;
                }
                
                if (imageFile) {
                    uploadTasks.push({ file: imageFile, questionIndex: i });
                }

                questions.push({ text, answers, correct: parseInt(correct.value), imageUrl });
            }

            if (uploadTasks.length > 0) {
                showNotification(`Uploading ${uploadTasks.length} image(s)...`, 60000); // Long timeout
                const uploadPromises = uploadTasks.map(task => uploadQuestionImage(task.file));
                const downloadedUrls = await Promise.all(uploadPromises);
                
                uploadTasks.forEach((task, index) => {
                    questions[task.questionIndex].imageUrl = downloadedUrls[index];
                });
            }

            showNotification('Finalizing save...', 5000);
            const newQuiz = { id: `quiz_${Date.now()}`, title, questions, createdBy: app.currentUser.email };
            await db.ref('quizzes/' + newQuiz.id).set(newQuiz);

            notif.style.display = 'none';
            alert('Quiz saved successfully!');
            $('#quiz-title').value = '';
            $('#questions-container').innerHTML = '';
            $('#bot-text-input').value = '';
            $('#file-list').innerHTML = '';
            $('#bot-image-upload').value = '';
            $('#refine-ai-btn').style.display = 'none';
            updateAdminUI();

        } catch (error) {
            // --- FIX: Ensure notification is hidden on error ---
            notif.style.display = 'none';
            console.error("Error saving quiz:", error);
            alert(`Failed to save quiz: ${error.message}`);
        } finally {
            saveButton.disabled = false;
        }
    };

    const handleBroadcast = () => { const recipient = $('#broadcast-recipient').value; const message = $('#broadcast-message-input').value.trim(); if (!message) return alert('Please enter a message.'); db.ref('broadcast').set({ id: Date.now(), recipient, message }); showNotification('Broadcast sent!'); };
    function checkAndShowBroadcast(broadcastData) {
        if (broadcastData && broadcastData.id !== lastProcessedBroadcastId) {
            const forEveryone = broadcastData.recipient === 'all';
            const forThisUser = app.currentUser && broadcastData.recipient === app.currentUser.email;
            if (forEveryone || forThisUser) {
                showNotification(`សារពី Admin: ${broadcastData.message}`);
                lastProcessedBroadcastId = broadcastData.id;
            }
        }
    }

    // --- Lobby & Game Flow ---
    const joinRoom = (roomId) => { const room = app.rooms.find(r => r.id === roomId); if (!room) { return forceGoHome("Room not found or has been closed."); } if (room.status !== 'waiting') { return alert('This room has already started.'); } app.currentRoomId = roomId; const encodedPlayerEmail = encodeEmail(app.currentUser.email); const playerRef = db.ref(`rooms/${roomId}/players/${encodedPlayerEmail}`); playerRef.once('value', snapshot => { let playerInfo = snapshot.val(); if (!playerInfo) { playerInfo = { email: app.currentUser.email, username: app.currentUser.username, avatarUrl: AVATAR_LIST[Math.floor(Math.random() * AVATAR_LIST.length)] }; playerRef.set(playerInfo); } showView('lobby'); setupLobby(playerInfo); updateLobbyUI(room); }); };
    const setupLobby = (playerInfo) => { $('#player-username-display').textContent = playerInfo.username; const avatarGrid = $('#avatar-selection'); avatarGrid.innerHTML = ''; AVATAR_LIST.forEach((url) => { const img = document.createElement('img'); img.src = url; img.className = 'avatar-option'; if (url === playerInfo.avatarUrl) { img.classList.add('selected'); $('#player-avatar-display').src = url; } img.onclick = () => { const selected = $('.avatar-option.selected'); if (selected) selected.classList.remove('selected'); img.classList.add('selected'); $('#player-avatar-display').src = img.src; db.ref(`rooms/${app.currentRoomId}/players/${encodeEmail(app.currentUser.email)}/avatarUrl`).set(img.src); }; avatarGrid.appendChild(img); }); };
    const updateLobbyUI = (room) => { const quiz = app.quizzes.find(q => q.id === room.quizId); $('#lobby-quiz-title').textContent = quiz ? quiz.title : 'Loading Quiz...'; $('#lobby-join-link-input').value = `${window.location.origin}${window.location.pathname}?room=${room.id}`; const players = room.players ? Object.values(room.players) : []; $('#player-count').textContent = players.length; const playerListContainer = $('#lobby-player-list-main'); playerListContainer.innerHTML = ''; players.forEach(p => { playerListContainer.innerHTML += `<div class="lobby-player-item"><img src="${p.avatarUrl || AVATAR_LIST[0]}" alt="avatar"><span>${p.username}</span></div>`; }); const isHost = app.currentUser && app.currentUser.email === room.host; $('#start-game-btn').style.display = isHost ? 'block' : 'none'; $('#close-room-btn').style.display = isHost ? 'block' : 'none'; $('#lobby-wait-message').style.display = isHost ? 'none' : 'block'; };
    const handleStartGameClick = () => { const roomRef = db.ref('rooms/' + app.currentRoomId); roomRef.once('value', snapshot => { const room = snapshot.val(); if (room && room.host === app.currentUser.email) { let initialScores = {}; if (room.players) { Object.keys(room.players).forEach(playerKey => { initialScores[playerKey] = 0; }); } roomRef.update({ status: 'active', scores: initialScores }); } }); };
    const startGame = () => {
        localStorage.removeItem('quiz8b_gameState');
        showView('game');
        const countdownOverlay = $('#countdown-overlay');
        const countdownTimer = $('#countdown-timer');
        countdownOverlay.style.display = 'flex';
        let count = 5;
        const countdownInterval = setInterval(() => {
            countdownTimer.className = ''; void countdownTimer.offsetWidth; countdownTimer.className = 'pop';
            if (count > 0) { countdownTimer.textContent = count; } 
            else if (count === 0) { countdownTimer.textContent = "GO!"; } 
            else { clearInterval(countdownInterval); countdownOverlay.style.display = 'none'; app.gameState = { score: 0, streak: 0, powerUps: { glitch: 1, shield: 1 }, playerAnswers: [], isOvertime: false }; runQuestion(); }
            count--;
        }, 1000);
    };
    const runQuestion = () => {
        const savedStateJSON = localStorage.getItem('quiz8b_gameState');
        if (savedStateJSON) { const savedState = JSON.parse(savedStateJSON); if(savedState.roomId === app.currentRoomId) { app.gameState = savedState.state; localStorage.removeItem('quiz8b_gameState'); } }
        if (!app.currentQuiz || !app.currentQuiz.questions || app.currentQuiz.questions.length <= app.gameState.playerAnswers.length) return endGame();
        
        app.gameState.isOvertime = false;
        $('#overtime-message-overlay').style.display = 'none';
        
        const qIndex = app.gameState.playerAnswers.length;
        app.currentQuestionIndex = qIndex;
        const q = app.currentQuiz.questions[qIndex];
        const answerContainer = $('#answer-options-container'); answerContainer.innerHTML = '';
        (q.answers || []).forEach((ans, i) => { answerContainer.innerHTML += `<button class="answer-btn" data-index="${i}"><span>${ans || ''}</span></button>`; });
        
        const qImage = $('#game-question-image');
        if (q.imageUrl) { qImage.src = q.imageUrl; qImage.style.display = 'block'; } else { qImage.style.display = 'none'; }
        
        $('#question-number').textContent = qIndex + 1; $('#total-questions').textContent = app.currentQuiz.questions.length; $('#player-score').textContent = app.gameState.score; $('#streak-count').textContent = app.gameState.streak; $('#game-question-text').textContent = q.text;
        
        $('#powerup-glitch-count').textContent = `(${app.gameState.powerUps.glitch})`;
        $('#powerup-shield-count').textContent = `(${app.gameState.powerUps.shield})`;
        $('#powerup-glitch-btn').disabled = app.gameState.powerUps.glitch <= 0;
        $('#powerup-shield-btn').disabled = app.gameState.powerUps.shield <= 0 || app.gameState.shieldActive;
        
        const room = app.rooms.find(r => r.id === app.currentRoomId);
        if (room && room.glitchInfo && room.glitchInfo.target === app.currentUser.email && room.glitchInfo.qIndex === qIndex) {
            if (app.gameState.shieldActive) {
                showNotification('Your Shield protected you from a Glitch Attack!');
                app.gameState.shieldActive = false;
                db.ref(`rooms/${app.currentRoomId}/glitchInfo`).remove();
            } else {
                $('.question-content').classList.add('glitched');
                $('#glitch-overlay').style.display = 'block';
                showNotification(`You've been Glitched!`);
                db.ref(`rooms/${app.currentRoomId}/glitchInfo`).remove();
                setTimeout(() => { $('.question-content').classList.remove('glitched'); $('#glitch-overlay').style.display = 'none'; }, 3000);
            }
        }
        
        $('#time-bar').style.transition = 'none'; $('#time-bar').style.width = '100%';
        setTimeout(() => { $('#time-bar').style.transition = 'width 10s linear'; $('#time-bar').style.width = '0%'; }, 100);
        
        app.questionTimer = setTimeout(() => { app.gameState.isOvertime = true; $('#overtime-message-overlay').style.display = 'block'; $('#powerup-glitch-btn').disabled = true; $('#powerup-shield-btn').disabled = true; }, 10000);
    };
    const handleAnswer = (e) => {
        clearTimeout(app.questionTimer);
        const selIdx = parseInt(e.currentTarget.dataset.index);
        const q = app.currentQuiz.questions[app.currentQuestionIndex];
        if (!q) return;

        $$('#answer-options-container .answer-btn').forEach(b => {b.disabled = true; b.classList.add('disabled');});
        $('#overtime-message-overlay').style.display = 'none';

        let pts = 0;
        const isCorrect = selIdx === q.correct;
        
        if (app.gameState.isOvertime) { if (isCorrect) { pts = 50; app.gameState.score += pts; showFeedback(true, pts); } else { showFeedback(false, 0); } app.gameState.streak = 0; }
        else {
            if (isCorrect) {
                app.gameState.streak++;
                const timeBonus = Math.floor(parseFloat(getComputedStyle($('#time-bar')).width) / $('#time-bar').parentElement.offsetWidth * 500);
                const streakBonus = 10 * (app.gameState.streak * app.gameState.streak);
                pts = 1000 + timeBonus + streakBonus;
                app.gameState.score += pts;
                showFeedback(true, pts);
                $('.streak-counter').classList.add('flash');
            } else { app.gameState.streak = 0; showFeedback(false, 0); }
        }
        
        e.currentTarget.classList.add(isCorrect ? 'correct' : 'incorrect');
        if(!isCorrect && q.correct >= 0 && $$('#answer-options-container .answer-btn')[q.correct]) { $$('#answer-options-container .answer-btn')[q.correct].classList.add('correct'); }

        app.gameState.playerAnswers.push({ qText: q.text, sel: q.answers[selIdx], cor: q.answers[q.correct], isCor: isCorrect });
        localStorage.setItem('quiz8b_gameState', JSON.stringify({ roomId: app.currentRoomId, state: app.gameState }));
        
        db.ref(`rooms/${app.currentRoomId}/scores/${encodeEmail(app.currentUser.email)}`).set(app.gameState.score);

        setTimeout(() => { $('.streak-counter').classList.remove('flash'); runQuestion(); }, 2500);
    };
    const usePowerUp = (type) => { 
        const room = app.rooms.find(r => r.id === app.currentRoomId); 
        if (!room) return; 
        if (type === 'glitch' && app.gameState.powerUps.glitch > 0) { 
            const otherPlayers = room.players ? Object.values(room.players).filter(p => p.email !== app.currentUser.email) : []; 
            if (otherPlayers.length === 0) return showNotification("No other players to target!"); 
            let playerListHtml = '<h4>Select a player to Glitch:</h4>'; 
            otherPlayers.forEach(p => { playerListHtml += `<label class="player-select-label"><input type="radio" name="glitch-target" value="${p.email}"><img src="${p.avatarUrl}" class="player-select-avatar"><span>${p.username}</span></label>`; }); playerListHtml += '<button id="confirm-glitch-btn" class="modal-btn">Attack!</button>'; 
            showModal('Glitch Attack', playerListHtml); 
            $('#confirm-glitch-btn').onclick = () => { 
                const selectedTarget = $('input[name="glitch-target"]:checked'); 
                // --- FIX: Correct variable name and check ---
                if (!selectedTarget) return alert("Please select a target."); 
                app.gameState.powerUps.glitch--; 
                $('#powerup-glitch-btn').disabled = true; 
                $('#powerup-glitch-count').textContent = `(${app.gameState.powerUps.glitch})`; 
                db.ref(`rooms/${app.currentRoomId}/glitchInfo`).set({ activator: app.currentUser.email, target: selectedTarget.value, qIndex: app.currentQuestionIndex }); 
                showNotification(`Glitch Attack sent to your target!`); 
                views.modal.style.display = 'none'; 
            }; 
        } 
        if (type === 'shield' && app.gameState.powerUps.shield > 0) { 
            app.gameState.powerUps.shield--; 
            $('#powerup-shield-btn').disabled = true; 
            $('#powerup-shield-count').textContent = `(${app.gameState.powerUps.shield})`; 
            app.gameState.shieldActive = true; 
            showNotification('Shield is active for the next attack!'); 
        } 
    };
    const showFeedback = (correct, points) => { const fb = $('#game-feedback-overlay'); fb.style.animation = 'none'; fb.offsetHeight; fb.style.animation = null; fb.style.display = 'flex'; if (correct === true) { $('#feedback-text').textContent = 'ត្រឹមត្រូវ!'; $('#feedback-text').style.color = 'var(--correct-green)'; $('#feedback-points').textContent = `+${points}`; } else if (correct === false) { $('#feedback-text').textContent = 'ខុសហើយ!'; $('#feedback-text').style.color = 'var(--incorrect-red)'; $('#feedback-points').textContent = ''; } else { $('#feedback-text').textContent = "អស់ម៉ោង!"; $('#feedback-text').style.color = 'var(--answer-orange)'; $('#feedback-points').textContent = `+${points}`; } };
    const updateLiveRank = () => {
        if (!app.currentUser) return;
        const room = app.rooms.find(r => r.id === app.currentRoomId);
        if (!room || !room.scores) return;
        
        const sortedScores = Object.entries(room.scores).sort((a, b) => b[1] - a[1]);
        const myRank = sortedScores.findIndex(entry => entry[0] === encodeEmail(app.currentUser.email)) + 1;
        
        $('#live-rank-display').textContent = `Rank: ${myRank > 0 ? myRank : '--'}`;
        $('#player-score').textContent = app.gameState.score || 0;
    };
    
    // --- End Game & Leaderboard ---
    const endGame = () => {
        localStorage.removeItem('quiz8b_gameState');
        showView('leaderboard');
        db.ref(`rooms/${app.currentRoomId}`).once('value', s => { 
            if (s.val() && s.val().host === app.currentUser.email) { 
                db.ref(`rooms/${s.val().id}/status`).set('finished'); 
            }
        });
    };
    const displayLeaderboard = (room) => {
        if (!room || !room.scores) return;
        const players = room.players ? Object.values(room.players) : [];
        const sorted = Object.entries(room.scores)
            .map(([encodedEmail, score]) => {
                const p = players.find(player => player && player.email === decodeEmail(encodedEmail));
                return { ...p, score };
            })
            .filter(p => p && p.email)
            .sort((a, b) => b.score - a.score);

        const podiumTargets = { 0: $('.place-1'), 1: $('.place-2'), 2: $('.place-3') };
        Object.values(podiumTargets).forEach(el => el.style.visibility = 'hidden');

        sorted.slice(0, 3).forEach((p, i) => {
            const podiumEl = podiumTargets[i];
            if (podiumEl) {
                podiumEl.style.visibility = 'visible';
                podiumEl.querySelector('.podium-name').textContent = p.username;
                podiumEl.querySelector('.podium-score').textContent = `${p.score} points`;
                podiumEl.querySelector('.podium-avatar').src = p.avatarUrl;
            }
        });

        $('#leaderboard-list').innerHTML = '';
        sorted.slice(3).forEach((p, i) => {
            if (p) $('#leaderboard-list').innerHTML += `<li><img src="${p.avatarUrl}" class="leaderboard-list-avatar"><span>#${i + 4} ${p.username}</span><span class="leaderboard-score">${p.score} ពិន្ទុ</span></li>`;
        });
        
        if ($('#answer-review-container').innerHTML === '') {
            (app.gameState.playerAnswers || []).forEach(ans => {
                $('#answer-review-container').innerHTML += `<div class="review-item ${ans.isCor ? 'correct' : 'incorrect'}"><p><strong>${ans.qText}</strong></p><p>ចម្លើយរបស់អ្នក៖ ${ans.sel}</p>${!ans.isCor ? `<p>ចម្លើយត្រឹមត្រូវ៖ ${ans.cor}</p>` : ''}</div>`;
            });
        }
    };
    
    // --- All Event Listeners ---
    function addEventListeners() {
        document.body.addEventListener('click', e => {
            const target = e.target;
            if (target.matches('#show-login-btn')) showView('login');
            if (target.matches('#logout-btn')) handleLogout();
            if (target.matches('#admin-panel-btn')) { showView('admin'); updateAdminUI(); }
            if (target.matches('#login-btn')) handleLogin();
            if (target.matches('#go-to-signup-btn')) showView('signup');
            if (target.matches('.back-to-home-link') || target.matches('#back-to-home-admin-btn') || target.matches('#back-to-home-from-leaderboard-btn')) goHome();
            if (target.matches('#signup-btn')) handleSignup();
            if (target.matches('#back-to-login-link')) showView('login');
            if (target.matches('#add-question-btn')) populateQuestionFromData({ options: [] });
            if (target.matches('#save-quiz-btn')) handleSaveQuiz();
            if (target.matches('#bot-image-create-btn')) handleImageBotCreate();
            if (target.matches('#bot-text-create-btn')) handleTextBotCreate();
            if (target.matches('#refine-ai-btn')) handleRefineAI();
            if (target.matches('#send-broadcast-btn')) handleBroadcast();
            if (target.closest('.ban-user-btn')) { const userEmail = target.closest('.ban-user-btn').dataset.userEmail; const user = app.users.find(u => u.email === userEmail); if(user) { db.ref('users/' + encodeEmail(userEmail) + '/banned').set(!user.banned); } }
            if (target.closest('.host-quiz-btn')) { const quizId = target.closest('.host-quiz-btn').dataset.quizId; const room = { id: `room_${Date.now()}`, quizId, host: app.currentUser.email, status: 'waiting', players: {}, scores: {} }; db.ref('rooms/' + room.id).set(room); const joinLink = `${window.location.origin}${window.location.pathname}?room=${room.id}`; showModal("បន្ទប់ត្រូវបានបង្កើត!", `<div class="link-container"><p>ចែករំលែក Link នេះដើម្បីអញ្ជើញអ្នកលេង:</p><input id="room-link-input" type="text" value="${joinLink}" readonly><button id="copy-link-btn">ចម្លង</button></div><button id='modal-ok-btn' class="modal-btn">ចូលរួមបន្ទប់ឥឡូវនេះ</button>`, () => joinRoom(room.id)); }
            if (target.closest('.delete-quiz-btn')) { if (confirm('តើអ្នកពិតជាចង់លុបកម្រងសំណួរនេះមែនទេ?')) { const quizId = target.closest('.delete-quiz-btn').dataset.quizId; db.ref('quizzes/' + quizId).remove(); } }
            if (target.closest('.remove-question-btn')) target.closest('.question-editor').remove();
            if (target.closest('.image-upload-label')) { target.closest('.image-upload-label').querySelector('input').click(); }
            if (target.matches('.remove-image-btn')) { const editor = target.closest('.question-editor'); const preview = editor.querySelector('.question-image-preview'); const uploader = editor.querySelector('.question-image-upload'); preview.src = ''; preview.style.display = 'none'; uploader.value = ''; target.style.display = 'none'; }
            if (target.matches('#lobby-copy-link-btn')) { const linkInput = $('#lobby-join-link-input'); linkInput.select(); document.execCommand('copy'); showNotification('Link copied to clipboard!'); }
            if (target.matches('#start-game-btn')) handleStartGameClick();
            if (target.matches('#close-room-btn')) { if (confirm('តើអ្នកពិតជាចង់បិទបន្ទប់?')) { db.ref('rooms/' + app.currentRoomId).remove(); goHome(); } }
            if (target.matches('#powerup-glitch-btn')) usePowerUp('glitch');
            if (target.matches('#powerup-shield-btn')) usePowerUp('shield');
            const answerBtn = target.closest('.answer-btn'); if (answerBtn && !answerBtn.disabled) handleAnswer({ currentTarget: answerBtn });
        });
        
        document.body.addEventListener('change', e => {
            if (e.target.matches('.question-image-upload')) {
                const file = e.target.files[0];
                if(file){
                    const editor = e.target.closest('.question-editor');
                    const preview = editor.querySelector('.question-image-preview');
                    const removeBtn = editor.querySelector('.remove-image-btn');
                    preview.src = URL.createObjectURL(file);
                    preview.style.display = 'block';
                    removeBtn.style.display = 'inline-block';
                }
            }
        });
        
        $('#bot-image-upload').addEventListener('change', () => { const fileList = $('#file-list'); fileList.innerHTML = ''; Array.from($('#bot-image-upload').files).forEach(f => fileList.innerHTML += `<p>${f.name}</p>`); });
    };

    // --- Start the Application ---
    init();
});
