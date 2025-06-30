document.addEventListener('DOMContentLoaded', () => {
    // Please don't use my Firebase
    const firebaseConfig = {
      apiKey: "AIzaSyDAwiZsXwnup77vlCY_RdaW_S7KVXiIPcE", // Paste your secure API Key
      authDomain: "class8b-quiz-zin.firebaseapp.com",
      databaseURL: "https://class8b-quiz-zin-default-rtdb.firebaseio.com",
      projectId: "class8b-quiz-zin",
      storageBucket: "class8b-quiz-zin.firebasestorage.app",
      messagingSenderId: "793435657168",
      appId: "1:793435657168:web:d9901dbe300dba2939dfd5"
    };
    // --- Initialize Firebase ---
    firebase.initializeApp(firebaseConfig);
    const db = firebase.database();

    const GEMINI_API_KEY = 'AIzaSyA-hdZ5GMHLXMgLlqtVizXOCpzg62EJHC8';
    const AVATAR_LIST = [
        'download.jpg', 'spider.jpg', 'gojo.jpg', 'tungtungsahur.jpg',
        'giyu.jpg', 'tanjiro.jpg', 'shinobu.jpg', 'shinobou.jpg'
    ];
    // App state
    const app = { users: [], quizzes: [], rooms: [], currentUser: null, currentRoomId: null, currentQuiz: null, gameState: {}, questionTimer: null, adminEmail: "lychayzooba@gmail.com" };
    let lastProcessedBroadcastId = null;

    // DOM selectors
    const $ = (selector) => document.querySelector(selector);
    const $$ = (selector) => document.querySelectorAll(selector);
    const views = { login: $('#login-view'), signup: $('#signup-view'), home: $('#home-view'), admin: $('#admin-view'), lobby: $('#quiz-lobby-view'), game: $('#quiz-game-view'), leaderboard: $('#leaderboard-view'), modal: $('#modal-overlay') };

    // --- Core Functions ---
    const showView = (viewName) => { Object.values(views).forEach(v => v.style.display = 'none'); if(views[viewName]) views[viewName].style.display = ['login', 'signup', 'leaderboard'].includes(viewName) ? 'flex' : 'block'; if (viewName === 'lobby') views.lobby.style.display = 'flex'; };
    const encodeEmail = (email) => email.replace(/\./g, ',');
    const decodeEmail = (encodedEmail) => encodedEmail.replace(/,/g, '.');
    
    // --- UI Helpers ---
    const showModal = (title, bodyHtml, onOk) => { $('#modal-title').textContent = title; $('#modal-body').innerHTML = bodyHtml; views.modal.style.display = 'flex'; const okButton = $('#modal-ok-btn'); if (okButton) okButton.onclick = () => { views.modal.style.display = 'none'; if (onOk) onOk(); }; const copyBtn = $('#copy-link-btn'); if (copyBtn) copyBtn.onclick = () => { navigator.clipboard.writeText($('#room-link-input').value).then(() => { copyBtn.textContent = 'បានចម្លង!'; setTimeout(() => { copyBtn.textContent = 'ចម្លង'; }, 2000); }); }; };
    const showNotification = (message) => { const notif = $('#global-notification'); notif.textContent = message; notif.style.display = 'block'; setTimeout(() => { notif.style.display = 'none'; }, 4000); };

    // --- App Initialization & State Management ---
    const init = () => {
        addEventListeners();
        // Load local user session
        app.currentUser = JSON.parse(localStorage.getItem('quiz8b_currentUser'));

        // Setup Firebase Listeners for real-time data
        db.ref('users').on('value', snapshot => {
            const usersData = snapshot.val();
            app.users = usersData ? Object.values(usersData) : [];
            if (!app.users.find(u => u.email === app.adminEmail)) {
                 const adminUser = { username: 'Admin', email: app.adminEmail, password: 'admin', isAdmin: true, banned: false };
                 db.ref('users/' + encodeEmail(app.adminEmail)).set(adminUser);
            }
            updateUIbasedOnState();
        });
        db.ref('quizzes').on('value', snapshot => {
            const quizzesData = snapshot.val();
            app.quizzes = quizzesData ? Object.values(quizzesData) : [];
            updateUIbasedOnState();
        });
        db.ref('rooms').on('value', snapshot => {
            const roomsData = snapshot.val();
            app.rooms = roomsData ? Object.values(roomsData) : [];
            updateUIbasedOnState();
        });
        db.ref('broadcast').on('value', snapshot => {
            const broadcastData = snapshot.val();
            if (broadcastData) {
                checkAndShowBroadcast(broadcastData);
            }
        });

        // This timeout ensures that data from Firebase has a chance to load before we check the URL
        setTimeout(() => {
            const urlParams = new URLSearchParams(window.location.search);
            const roomIdFromUrl = urlParams.get('room');

            if (app.currentUser) {
                const user = app.users.find(u => u.email === app.currentUser.email);
                if (!user || (user.banned && !app.currentUser.isGuest)) {
                    return handleLogout();
                }
                if (roomIdFromUrl) {
                    joinRoom(roomIdFromUrl);
                } else {
                    goHome();
                }
            } else {
                if (roomIdFromUrl) {
                    handleGuestLogin(roomIdFromUrl);
                } else {
                    showView('login');
                }
            }
        }, 500); // 500ms delay to allow initial data load
    };
    
    function updateUIbasedOnState() {
        if (app.currentUser) {
            const liveUser = app.users.find(u => u.email === app.currentUser.email);
            if(liveUser && liveUser.banned && !app.currentUser.isGuest) {
                 showModal("Access Denied", "<p>Your account has been banned by an administrator.</p><button id='modal-ok-btn' class='modal-btn'>OK</button>", handleLogout);
                 return;
            }
        }
        if (views.home.style.display === 'block' || views.home.style.display === 'flex') { updateHomeUI(); }
        if (views.admin.style.display === 'block') { updateAdminUI(); }
        if (views.lobby.style.display === 'flex' && app.currentRoomId) { 
            const room = app.rooms.find(r => r.id === app.currentRoomId); 
            if (room) { 
                updateLobbyUI(room); 
                if (room.status === 'active' && views.game.style.display === 'none') { 
                    app.currentQuiz = app.quizzes.find(q => q.id === room.quizId); 
                    if (app.currentQuiz) startGame(); 
                } 
            } else { 
                showModal("ព័ត៌មាន", "<p>អ្នកគ្រប់គ្រងបានបិទបន្ទប់នេះហើយ ឬ Link មិនត្រឹមត្រូវ។</p><button id='modal-ok-btn' class='modal-btn'>យល់ព្រម</button>", goHome); 
                app.currentRoomId = null;
            } 
        }
    }
    
    const goHome = () => { app.currentRoomId = null; app.currentQuiz = null; if (window.location.search) window.history.pushState({}, '', window.location.pathname); showView('home'); updateHomeUI(); };
    
    // --- User & Authentication ---
    const updateHomeHeader = () => { const c = $('#user-actions'); if (app.currentUser && !app.currentUser.isGuest) { c.innerHTML = `<span id="user-display">សូមស្វាគមន៍, ${app.currentUser.username}</span><button id="logout-btn">ចាកចេញ</button>${app.currentUser.isAdmin ? '<button id="admin-panel-btn">ផ្ទាំងគ្រប់គ្រង</button>' : ''}`; } else { c.innerHTML = `<button id="show-login-btn">ចូលគណនី / បង្កើតគណនី</button>`; } };
    const handleGuestLogin = (roomId) => { showModal("ចូលរួមជាភ្ញៀវ", `<p>សូមបញ្ចូលឈ្មោះអ្នកប្រើប្រាស់របស់អ្នកដើម្បីលេង។</p><input type="text" id="guest-username-input" placeholder="ឈ្មោះអ្នកប្រើប្រាស់"><button id="guest-join-btn" class="modal-btn">ចូលរួមលេង</button>`); $('#guest-join-btn').onclick = () => { const username = $('#guest-username-input').value.trim(); if (username) { app.currentUser = { username, email: `guest_${Date.now()}@quiz8b.com`, isGuest: true, isAdmin: false }; localStorage.setItem('quiz8b_currentUser', JSON.stringify(app.currentUser)); views.modal.style.display = 'none'; joinRoom(roomId); } else { alert("សូមបញ្ចូលឈ្មោះអ្នកប្រើប្រាស់។"); } }; };
    const handleLogin = () => { const user = app.users.find(u => u.email === $('#login-email').value.trim() && u.password === $('#login-password').value); if (user) { if (user.banned) return alert('គណនីរបស់អ្នកត្រូវបានហាមឃាត់។'); app.currentUser = { email: user.email, username: user.username, isAdmin: user.isAdmin }; localStorage.setItem('quiz8b_currentUser', JSON.stringify(app.currentUser)); goHome(); } else alert('អ៊ីមែល ឬពាក្យសម្ងាត់មិនត្រឹមត្រូវ។'); };
    const handleSignup = () => { const u = $('#signup-username').value.trim(), e = $('#signup-email').value.trim(), p = $('#signup-password').value; if (!u || !e || !p) return alert('សូមបញ្ចូលព័ត៌មានទាំងអស់។'); if (app.users.find(user => user.email === e)) return alert('អ៊ីមែលនេះត្រូវបានប្រើប្រាស់រួចហើយ។'); const newUser = { username: u, email: e, password: p, isAdmin: false, banned: false }; db.ref('users/' + encodeEmail(e)).set(newUser); app.currentUser = { email: e, username: u, isAdmin: false }; localStorage.setItem('quiz8b_currentUser', JSON.stringify(app.currentUser)); goHome(); };
    const handleLogout = () => { app.currentUser = null; app.currentRoomId = null; localStorage.removeItem('quiz8b_currentUser'); showView('login'); };
    
    // --- Home Screen ---
    const updateHomeUI = () => { updateHomeHeader(); renderRooms(); };
    const renderRooms = () => { $('#rooms-list').innerHTML = ''; const available = app.rooms.filter(r => r.status === 'waiting'); if (available.length === 0) { $('#rooms-list').innerHTML = '<p>មិនមានបន្ទប់ណាមួយនៅឡើយទេ។</p>'; return; } available.forEach(room => { const quiz = app.quizzes.find(q => q.id === room.quizId); const host = app.users.find(u => u.email === room.host); if (quiz) { const card = document.createElement('div'); card.className = 'room-card'; card.addEventListener('click', () => { if (app.currentUser) { joinRoom(room.id); } else { handleGuestLogin(room.id); } }); const playerCount = room.players ? Object.keys(room.players).length : 0; card.innerHTML = `<h3>${quiz.title}</h3><p>បង្កើតដោយ៖ ${host ? host.username : 'N/A'}</p><p>អ្នកលេង៖ ${playerCount}</p>`; $('#rooms-list').appendChild(card); } }); };
    
    // --- Admin Panel ---
    const updateAdminUI = () => { if (!app.currentUser || !app.currentUser.isAdmin) return; $('#manage-quizzes-list').innerHTML = ''; app.quizzes.forEach(q => { const li = document.createElement('li'); li.innerHTML = `<span>${q.title} (${q.questions.length})</span><div><button class="host-quiz-btn" data-quiz-id="${q.id}">បង្ហោះ</button><button class="delete-quiz-btn" data-quiz-id="${q.id}">លុប</button></div>`; $('#manage-quizzes-list').appendChild(li); }); $('#manage-users-list').innerHTML = ''; $('#broadcast-recipient').innerHTML = '<option value="all">អ្នកប្រើប្រាស់ទាំងអស់</option>'; app.users.filter(u => !u.isAdmin).forEach(user => { const li = document.createElement('li'); li.innerHTML = `<span>${user.username} ${user.banned ? '(BANNED)' : ''}</span><button class="ban-user-btn" data-user-email="${user.email}">${user.banned ? 'Unban' : 'Ban'}</button>`; $('#manage-users-list').appendChild(li); const opt = document.createElement('option'); opt.value = user.email; opt.textContent = user.username; $('#broadcast-recipient').appendChild(opt); }); };
    async function generateQuizFromImages(files, existingQuestions = []) { if (GEMINI_API_KEY === 'YOUR_API_KEY_HERE' || !GEMINI_API_KEY) { alert('សូមដាក់ Gemini API Key របស់អ្នកក្នុង script.js ជាមុនសិន។'); return null; } const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`; let PROMPT = `You are an expert quiz creator. Analyze these images of a lesson. Generate 5 new multiple-choice questions in Khmer based on the content from ALL images combined. Each question must have exactly 4 options. Ensure one option is correct.`; if (existingQuestions.length > 0) PROMPT += ` IMPORTANT: Do not repeat or create similar questions to these existing ones: ${existingQuestions.join(', ')}.`; PROMPT += ` Respond STRICTLY with a valid JSON object, without any explanatory text or markdown backticks. The JSON format must be: {"questions": [{"question": "...", "options": ["...", "...", "...", "..."], "correct_answer_index": 0}]}`; const imageParts = await Promise.all(Array.from(files).map(file => { return new Promise(resolve => { const reader = new FileReader(); reader.onloadend = () => resolve({ inline_data: { mime_type: file.type, data: reader.result.split(',')[1] } }); reader.readAsDataURL(file); }); })); try { const res = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: PROMPT }, ...imageParts] }], generationConfig: { response_mime_type: "application/json" } }) }); if (!res.ok) { const errorBody = await res.text(); throw new Error(`API Error: ${res.status} - ${errorBody}`); } const data = await res.json(); return data.candidates[0].content.parts[0].text; } catch (error) { console.error("AI Error:", error); alert(`មានបញ្ហាក្នុងការបង្កើតសំណួរពី AI: ${error.message}.`); return null; } }
    const handleBotCreate = async () => { const files = $('#bot-image-upload').files; if (files.length === 0) return alert("សូមជ្រើសរើសរូបភាព។"); $('#bot-status').style.display = 'block'; $('#bot-create-btn').disabled = true; const aiResultText = await generateQuizFromImages(files); $('#bot-status').style.display = 'none'; $('#bot-create-btn').disabled = false; if (aiResultText) { try { const aiResult = JSON.parse(aiResultText); if (aiResult && aiResult.questions) { if ($('#quiz-title').value.trim() === '') $('#quiz-title').value = "កម្រងសំណួរពី AI"; aiResult.questions.forEach(q => populateQuestionFromData(q)); alert("AI បានបង្កើតសំណួរដោយជោគជ័យ!"); $('#request-more-ai-btn').style.display = 'block'; } else { throw new Error("Invalid JSON structure."); } } catch (e) { alert("AI បានឆ្លើយតបមក ប៉ុន្តែទម្រង់មិនត្រឹមត្រូវ។"); } } };
    const handleRequestMoreAI = async () => { const files = $('#bot-image-upload').files; if (files.length === 0) return alert("សូមជ្រើសរើសរូបភាពដដែល ឬរូបភាពថ្មី។"); const existingQuestions = Array.from($$('.question-text')).map(el => el.value); $('#bot-status').style.display = 'block'; $('#request-more-ai-btn').disabled = true; const aiResultText = await generateQuizFromImages(files, existingQuestions); $('#bot-status').style.display = 'none'; $('#request-more-ai-btn').disabled = false; if (aiResultText) { try { const aiResult = JSON.parse(aiResultText); if (aiResult && aiResult.questions) { aiResult.questions.forEach(q => populateQuestionFromData(q)); alert("AI បានបង្កើតសំនួរបន្ថែមដោយជោគជ័យ!"); } } catch (e) { alert("AI បានឆ្លើយតបមក ប៉ុន្តែទម្រង់មិនត្រឹមត្រូវ។"); } } };
    const populateQuestionFromData = (qData) => { const node = $('#question-template').content.cloneNode(true); const qIndex = $('#questions-container').children.length; node.querySelector('h4').textContent = `សំណួរទី ${qIndex + 1}`; node.querySelectorAll('input[type="radio"]').forEach(r => r.name = `correct_answer_${qIndex}`); node.querySelector('.question-text').value = qData.question || ''; node.querySelectorAll('.answer-text').forEach((input, i) => input.value = qData.options[i] || ''); if (qData.correct_answer_index !== undefined && node.querySelector(`input[value="${qData.correct_answer_index}"]`)) { node.querySelector(`input[value="${qData.correct_answer_index}"]`).checked = true; } $('#questions-container').appendChild(node); };
    const handleSaveQuiz = () => { const title = $('#quiz-title').value.trim(); if (!title) return alert('សូមបញ្ចូលចំណងជើង។'); const editors = $$('#questions-container .question-editor'); if (editors.length === 0) return alert('សូមបន្ថែមសំណួរ។'); let questions = [], isValid = true; editors.forEach(e => { const text = e.querySelector('.question-text').value.trim(), answers = Array.from(e.querySelectorAll('.answer-text')).map(i => i.value.trim()), correct = e.querySelector('input[type="radio"]:checked'); if (!text || answers.some(a => !a) || !correct) isValid = false; questions.push({ text, answers, correct: parseInt(correct.value) }); }); if (!isValid) return alert('សូមបំពេញព័ត៌មានទាំងអស់សម្រាប់សំណួរនីមួយៗ។'); const newQuiz = { id: `quiz_${Date.now()}`, title, questions, createdBy: app.currentUser.email }; db.ref('quizzes/' + newQuiz.id).set(newQuiz); alert('រក្សាទុកវា'); $('#quiz-title').value = ''; $('#questions-container').innerHTML = ''; $('#file-list').innerHTML = ''; $('#request-more-ai-btn').style.display = 'none'; updateAdminUI(); };
    const handleBroadcast = () => { const recipient = $('#broadcast-recipient').value; const message = $('#broadcast-message-input').value.trim(); if (!message) return alert('Please enter a message.'); db.ref('broadcast').set({ id: Date.now(), recipient, message }); showNotification('Broadcast sent!'); $('#broadcast-message-input').value = ''; };
    function checkAndShowBroadcast(broadcastData) { if (broadcastData && broadcastData.id !== lastProcessedBroadcastId) { if (app.currentUser && (broadcastData.recipient === 'all' || broadcastData.recipient === app.currentUser.email)) { showNotification(`សារពី Admin: ${broadcastData.message}`); lastProcessedBroadcastId = broadcastData.id; } } }

    // --- Lobby & Game Flow ---
    const joinRoom = (roomId) => { const room = app.rooms.find(r => r.id === roomId); if (!room) { alert('រកមិនឃើញបន្ទប់នេះទេ ឬត្រូវបានបិទហើយ។'); goHome(); return; } if (room.status !== 'waiting') { alert('បន្ទប់នេះបានចាប់ផ្តើមលេងហើយ។'); goHome(); return; } app.currentRoomId = roomId; const encodedPlayerEmail = encodeEmail(app.currentUser.email); const playerRef = db.ref(`rooms/${roomId}/players/${encodedPlayerEmail}`); playerRef.once('value', snapshot => { if (!snapshot.exists()) { const playerInfo = { email: app.currentUser.email, username: app.currentUser.username, avatarUrl: AVATAR_LIST[Math.floor(Math.random() * AVATAR_LIST.length)] }; playerRef.set(playerInfo).then(() => { showView('lobby'); setupLobby(playerInfo); updateLobbyUI(room); }); } else { const playerInfo = snapshot.val(); showView('lobby'); setupLobby(playerInfo); updateLobbyUI(room); } }); };
    const setupLobby = (playerInfo) => { $('#player-username-display').textContent = playerInfo.username; const avatarGrid = $('#avatar-selection'); avatarGrid.innerHTML = ''; AVATAR_LIST.forEach((url) => { const img = document.createElement('img'); img.src = url; img.className = 'avatar-option'; if (url === playerInfo.avatarUrl) { img.classList.add('selected'); $('#player-avatar-display').src = url; } img.onclick = () => { const selected = $('.avatar-option.selected'); if (selected) selected.classList.remove('selected'); img.classList.add('selected'); $('#player-avatar-display').src = img.src; const playerEmailEncoded = encodeEmail(app.currentUser.email); db.ref(`rooms/${app.currentRoomId}/players/${playerEmailEncoded}/avatarUrl`).set(img.src); }; avatarGrid.appendChild(img); }); };
    
    const updateLobbyUI = (room) => {
        const quiz = app.quizzes.find(q => q.id === room.quizId);
        $('#lobby-quiz-title').textContent = quiz ? quiz.title : 'Loading Quiz...';
        const joinLink = `${window.location.origin}${window.location.pathname}?room=${room.id}`;
        $('#lobby-join-link-input').value = joinLink;
        const players = room.players ? Object.values(room.players) : [];
        $('#player-count').textContent = players.length;
        const playerListContainer = $('#lobby-player-list-main');
        playerListContainer.innerHTML = '';
        players.forEach(p => {
            const playerItem = document.createElement('div');
            playerItem.className = 'lobby-player-item';
            playerItem.innerHTML = `<img src="${p.avatarUrl || AVATAR_LIST[0]}" alt="avatar"><span>${p.username}</span>`;
            playerListContainer.appendChild(playerItem);
        });
        const isHost = app.currentUser && app.currentUser.email === room.host;
        $('#start-game-btn').style.display = isHost ? 'block' : 'none';
        $('#close-room-btn').style.display = isHost ? 'block' : 'none';
        $('#lobby-wait-message').style.display = isHost ? 'none' : 'block';
    };
    
    const handleStartGameClick = () => { const roomRef = db.ref('rooms/' + app.currentRoomId); roomRef.once('value', snapshot => { const room = snapshot.val(); if (room && room.host === app.currentUser.email) { let initialScores = {}; if (room.players) { Object.keys(room.players).forEach(playerKey => { initialScores[playerKey] = 0; }); } roomRef.update({ status: 'active', scores: initialScores }); } }); };
    const startGame = () => { showView('game'); $('#countdown-overlay').style.display = 'flex'; let count = 5; $('#countdown-timer').textContent = count; const i = setInterval(() => { count--; if (count > 0) $('#countdown-timer').textContent = count; else if (count === 0) $('#countdown-timer').textContent = "GO!"; else { clearInterval(i); $('#countdown-overlay').style.display = 'none'; app.gameState = { score: 0, streak: 0, powerUps: { glitch: 1, shield: 1 }, playerAnswers: [], shieldActive: false }; runQuestion(); } }, 1000); };
    
    const runQuestion = () => {
        if (!app.currentQuiz || app.currentQuiz.questions.length <= app.gameState.playerAnswers.length) return endGame();
        const qIndex = app.gameState.playerAnswers.length;
        app.currentQuestionIndex = qIndex;
        const q = app.currentQuiz.questions[qIndex];
        const answerContainer = $('#answer-options-container');
        answerContainer.innerHTML = '';
        q.answers.forEach((ans, i) => { answerContainer.innerHTML += `<button class="answer-btn" data-index="${i}"><span>${ans || ''}</span></button>`; });
        
        const room = app.rooms.find(r => r.id === app.currentRoomId);
        if (room && room.glitchInfo && room.glitchInfo.target === app.currentUser.email) {
            if (app.gameState.shieldActive) {
                showNotification('Your Shield protected you from a Glitch Attack!');
                app.gameState.shieldActive = false; // Shield is consumed
            } else {
                $('.question-content').classList.add('glitched');
                $('#glitch-overlay').style.display = 'block';
                const activator = room.players ? Object.values(room.players).find(p => p.email === room.glitchInfo.activator) : null;
                showNotification(`You've been Glitched by ${activator ? activator.username : 'someone'}!`);
                setTimeout(() => { $('.question-content').classList.remove('glitched'); $('#glitch-overlay').style.display = 'none'; }, 3000);
            }
            // Clear the glitch info from the database once it has been processed
            db.ref(`rooms/${app.currentRoomId}/glitchInfo`).remove();
        }

        $('#question-number').textContent = qIndex + 1;
        $('#total-questions').textContent = app.currentQuiz.questions.length;
        $('#player-score').textContent = app.gameState.score;
        $('#streak-count').textContent = app.gameState.streak;
        $('#game-question-text').textContent = q.text;
        $('#powerup-glitch-count').textContent = `(${app.gameState.powerUps.glitch})`;
        $('#powerup-glitch-btn').disabled = app.gameState.powerUps.glitch <= 0;
        $('#powerup-shield-count').textContent = `(${app.gameState.powerUps.shield})`;
        $('#powerup-shield-btn').disabled = app.gameState.powerUps.shield <= 0 || app.gameState.shieldActive;
        $('#time-bar').style.transition = 'none';
        $('#time-bar').style.width = '100%';
        setTimeout(() => { $('#time-bar').style.transition = 'width 10s linear'; $('#time-bar').style.width = '0%'; }, 100);
        app.questionTimer = setTimeout(() => handleAnswer({ isTimeout: true }), 10000);
    };

    const handleAnswer = (e) => { clearTimeout(app.questionTimer); const selIdx = e && !e.isTimeout ? parseInt(e.currentTarget.dataset.index) : -1; const q = app.currentQuiz.questions[app.currentQuestionIndex]; if (!q) return; const isCorrect = selIdx === q.correct; $$('#answer-options-container .answer-btn').forEach(b => {b.disabled = true; b.classList.add('disabled');}); let pts = 0; if (isCorrect) { if (e && !e.isTimeout) e.currentTarget.classList.add('correct'); app.gameState.streak++; const timeBonus = Math.floor(parseFloat(getComputedStyle($('#time-bar')).width) / $('#time-bar').parentElement.offsetWidth * 100); pts = 1000 + (timeBonus * 10) + (app.gameState.streak * 50); app.gameState.score += pts; showFeedback(true, pts); $('.streak-counter').classList.add('flash'); } else { if (e && !e.isTimeout) e.currentTarget.classList.add('incorrect'); app.gameState.streak = 0; if($$('#answer-options-container .answer-btn')[q.correct]) $$('#answer-options-container .answer-btn')[q.correct].classList.add('correct'); showFeedback(false, 0); } app.gameState.playerAnswers.push({ qText: q.text, sel: selIdx > -1 ? q.answers[selIdx] : "គ្មាន", cor: q.answers[q.correct], isCor: isCorrect }); setTimeout(() => { $('.streak-counter').classList.remove('flash'); runQuestion(); }, 2000); };
    
    const usePowerUp = (type) => {
        const room = app.rooms.find(r => r.id === app.currentRoomId);
        if (!room) return;
        if (type === 'glitch' && app.gameState.powerUps.glitch > 0) {
            const otherPlayers = room.players ? Object.values(room.players).filter(p => p.email !== app.currentUser.email) : [];
            if (otherPlayers.length === 0) return showNotification("No other players to target!");
            let playerListHtml = '<h4>Select a player to Glitch:</h4>';
            otherPlayers.forEach(p => { playerListHtml += `<label class="player-select-label"><input type="radio" name="glitch-target" value="${p.email}"><img src="${p.avatarUrl}" class="player-select-avatar"><span>${p.username}</span></label>`; });
            playerListHtml += '<button id="confirm-glitch-btn" class="modal-btn">Attack!</button>';
            showModal('Glitch Attack', playerListHtml);
            $('#confirm-glitch-btn').onclick = () => {
                const selectedTarget = $('input[name="glitch-target"]:checked');
                if (!selectedTarget) return alert("Please select a target.");
                app.gameState.powerUps.glitch--;
                $('#powerup-glitch-btn').disabled = true;
                $('#powerup-glitch-count').textContent = `(${app.gameState.powerUps.glitch})`;
                db.ref(`rooms/${app.currentRoomId}/glitchInfo`).set({ activator: app.currentUser.email, target: selectedTarget.value });
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

    const showFeedback = (correct, points) => { const fb = $('#game-feedback-overlay'); fb.style.animation = 'none'; fb.offsetHeight; fb.style.animation = null; fb.style.display = 'flex'; if (correct) { $('#feedback-text').textContent = 'ត្រឹមត្រូវ!'; $('#feedback-text').style.color = 'var(--correct-green)'; $('#feedback-points').textContent = `+${points}`; } else { $('#feedback-text').textContent = 'ខុសហើយ!'; $('#feedback-text').style.color = 'var(--incorrect-red)'; $('#feedback-points').textContent = ''; } };
    
    // --- End Game & Leaderboard ---
    const endGame = () => {
        const playerEmailEncoded = encodeEmail(app.currentUser.email);
        const roomRef = db.ref('rooms/' + app.currentRoomId);
    
        // Update score
        roomRef.child('scores').child(playerEmailEncoded).set(app.gameState.score);
    
        // Check if all players have finished
        roomRef.once('value', snapshot => {
            const room = snapshot.val();
            const totalPlayers = room.players ? Object.keys(room.players).length : 0;
            const finishedPlayers = room.scores ? Object.keys(room.scores).length : 0;
            // The host can finalize the game
            if (finishedPlayers >= totalPlayers && room.host === app.currentUser.email) {
                roomRef.update({ status: 'finished' });
            }
        });
    
        showView('leaderboard');
        displayLeaderboard();
    };

    const displayLeaderboard = () => {
        const room = app.rooms.find(r => r.id === app.currentRoomId);
        if (!room || !room.scores) {
            $('#leaderboard-list').innerHTML = '<p>Waiting for scores...</p>';
             return;
        }
        const players = room.players ? Object.values(room.players) : [];
        const sorted = Object.entries(room.scores).map(([encodedEmail, score]) => { 
            const player = players.find(p => p.email === decodeEmail(encodedEmail));
            return { 
                email: player ? player.email : 'Unknown', 
                score, 
                username: player ? player.username : 'Unknown Player', 
                avatarUrl: player ? player.avatarUrl || AVATAR_LIST[0] : AVATAR_LIST[0] 
            }; 
        }).sort((a, b) => b.score - a.score);
        
        const podiums = [ { el: $('.place-1'), data: sorted[0] }, { el: $('.place-2'), data: sorted[1] }, { el: $('.place-3'), data: sorted[2] } ];
        podiums.forEach(p => {
            if (p.data) {
                p.el.style.visibility = 'visible';
                p.el.querySelector('.podium-name').textContent = p.data.username;
                p.el.querySelector('.podium-score').textContent = `${p.data.score} ពិន្ទុ`;
                p.el.querySelector('.podium-avatar').src = p.data.avatarUrl;
            } else {
                p.el.style.visibility = 'hidden';
            }
        });

        $('#leaderboard-list').innerHTML = ''; sorted.slice(3).forEach((p, i) => { const li = document.createElement('li'); li.innerHTML = `<img src="${p.avatarUrl}" class="leaderboard-list-avatar"><span>#${i + 4} ${p.username}</span><span class="leaderboard-score">${p.score} ពិន្ទុ</span>`; $('#leaderboard-list').appendChild(li); });
        $('#answer-review-container').innerHTML = ''; (app.gameState.playerAnswers || []).forEach(ans => { const item = document.createElement('div'); item.className = `review-item ${ans.isCor ? 'correct' : 'incorrect'}`; item.innerHTML = `<p><strong>${ans.qText}</strong></p><p>ចម្លើយរបស់អ្នក៖ ${ans.sel}</p>${!ans.isCor ? `<p>ចម្លើយត្រឹមត្រូវ៖ ${ans.cor}</p>` : ''}`; $('#answer-review-container').appendChild(item); });
    };

    // --- Event Listeners ---
    function addEventListeners() {
        document.body.addEventListener('click', e => {
            const target = e.target;
            if (target.matches('#show-login-btn')) showView('login');
            if (target.matches('#logout-btn')) handleLogout();
            if (target.matches('#admin-panel-btn')) { showView('admin'); updateAdminUI(); }
            if (target.matches('#login-btn')) handleLogin();
            if (target.matches('#go-to-signup-btn')) showView('signup');
            if (target.matches('.back-to-home-link')) goHome();
            if (target.matches('#signup-btn')) handleSignup();
            if (target.matches('#back-to-login-link')) showView('login');
            if (target.matches('#back-to-home-admin-btn')) goHome();
            if (target.matches('#add-question-btn')) populateQuestionFromData({ options: [] });
            if (target.matches('#save-quiz-btn')) handleSaveQuiz();
            if (target.matches('#bot-create-btn')) handleBotCreate();
            if (target.matches('#request-more-ai-btn')) handleRequestMoreAI();
            if (target.matches('#send-broadcast-btn')) handleBroadcast();
            if (target.matches('#lobby-copy-link-btn')) { const linkInput = $('#lobby-join-link-input'); linkInput.select(); navigator.clipboard.writeText(linkInput.value).then(() => { showNotification('Link copied to clipboard!'); }); }
            if (target.closest('.ban-user-btn')) { const userEmail = target.closest('.ban-user-btn').dataset.userEmail; const user = app.users.find(u => u.email === userEmail); if(user) { db.ref('users/' + encodeEmail(userEmail) + '/banned').set(!user.banned); } }
            if (target.closest('.host-quiz-btn')) { const quizId = target.closest('.host-quiz-btn').dataset.quizId; const room = { id: `room_${Date.now()}`, quizId, host: app.currentUser.email, status: 'waiting', players: {}, scores: {} }; db.ref('rooms/' + room.id).set(room); const joinLink = `${window.location.origin}${window.location.pathname}?room=${room.id}`; showModal("បន្ទប់ត្រូវបានបង្កើត!", `<div class="link-container"><p>ចែករំលែក Link នេះដើម្បីអញ្ជើញអ្នកលេង:</p><input id="room-link-input" type="text" value="${joinLink}" readonly><button id="copy-link-btn">ចម្លង</button></div><button id='modal-ok-btn' class="modal-btn">ចូលរួមបន្ទប់ឥឡូវនេះ</button>`, () => joinRoom(room.id)); }
            if (target.closest('.delete-quiz-btn')) { if (confirm('តើអ្នកពិតជាចង់លុបកម្រងសំណួរនេះមែនទេ?')) { const quizId = target.closest('.delete-quiz-btn').dataset.quizId; db.ref('quizzes/' + quizId).remove(); } }
            if (target.closest('.remove-question-btn')) target.closest('.question-editor').remove();
            if (target.matches('#start-game-btn')) handleStartGameClick();
            if (target.matches('#powerup-glitch-btn')) usePowerUp('glitch');
            if (target.matches('#powerup-shield-btn')) usePowerUp('shield');
            if (target.matches('#back-to-home-from-leaderboard-btn')) goHome();
            if (target.matches('#close-room-btn')) { if (confirm('តើអ្នកពិតជាចង់បិទបន្ទប់?')) { db.ref('rooms/' + app.currentRoomId).remove(); goHome(); } }
            const answerBtn = target.closest('.answer-btn'); if (answerBtn && !answerBtn.disabled) handleAnswer({ currentTarget: answerBtn });
        });
        $('#bot-image-upload').addEventListener('change', () => { const fileList = $('#file-list'); fileList.innerHTML = ''; Array.from($('#bot-image-upload').files).forEach(f => fileList.innerHTML += `<p>${f.name}</p>`); });
    };
    
    init();
});
