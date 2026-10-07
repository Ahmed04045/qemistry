// ══ Qemy Game Client ═══════════════════════════════════════════════════════
// Adapted for Qatar Chat: JWT auth, userId-based turns, bilingual UI

(function () {
  // ── Auth check ─────────────────────────────────────────────────────────────
  const currentUser = JSON.parse(localStorage.getItem('qc_currentUser') || 'null');
  const authToken   = localStorage.getItem('qc_token');
  if (!currentUser || !authToken) {
    window.location.href = '/?next=game';
    return;
  }

  const myUserId   = currentUser.id;
  const myUsername = currentUser.username;
  const myAvatar   = currentUser.avatar_url || null;
  const lang       = localStorage.getItem('qc_lang') || 'ar';
  const isAr       = lang === 'ar';
  const roomCode   = new URLSearchParams(window.location.search).get('room');

  if (!roomCode) { window.location.href = '/qemy'; return; }

  // ── i18n helper ──────────────────────────────────────────────────────────
  function gt(key) {
    const map = {
      ar: {
        your_turn:        'دورك! 🎯',
        their_turn:       'دور ',
        choose_color:     'اختر لوناً',
        red:   'أحمر', yellow: 'أصفر', green: 'أخضر', blue: 'أزرق',
        reaction:         'التفاعل الكيميائي',
        you_win:          'فزت! 🏆',
        game_over:        'انتهت اللعبة',
        back:             'العودة',
        badge_earned:     '🏆 حصلت على شارة انتصار جديدة!',
        played_card:      'لعب ورقة',
        drew_card:        'سحب ورقة',
        force_draws:      'يسحب',
        force_draws2:     'أوراق! 😬',
        reaction_fired:   'فعّل التفاعل الكيميائي! 🧪 تبادلت الأوراق!',
        player_left:      'غادر اللعبة',
        player_back:      'عاد للعبة',
        timeout:          'انتهت مهلة إعادة الاتصال',
        uno:              'UNO! 🔴',
        start_btn:        'ابدأ اللعبة',
        waiting:          'في انتظار اللاعبين...',
        copy:             'نسخ الرمز',
        copied:           '✅ تم النسخ',
        wins:             'فوز',
        room_not_found:   'الغرفة غير موجودة',
        game_started:     'اللعبة بدأت مسبقاً',
        room_full:        'الغرفة ممتلئة',
        need_more:        'تحتاج لاعبَين على الأقل',
        chat_title:       'المحادثة',
      },
      en: {
        your_turn:        'Your turn! 🎯',
        their_turn:       "'s turn",
        choose_color:     'Choose a color',
        red:   'Red', yellow: 'Yellow', green: 'Green', blue: 'Blue',
        reaction:         'Chemical Reaction',
        you_win:          'You Win! 🏆',
        game_over:        'Game Over',
        back:             'Back',
        badge_earned:     '🏆 You earned a new win badge!',
        played_card:      'played a card',
        drew_card:        'drew a card',
        force_draws:      'draws',
        force_draws2:     'cards! 😬',
        reaction_fired:   'triggered a Chemical Reaction! 🧪 Hands swapped!',
        player_left:      'left the game',
        player_back:      'reconnected',
        timeout:          'reconnect time expired',
        uno:              'UNO! 🔴',
        start_btn:        'Start Game',
        waiting:          'Waiting for players...',
        copy:             'Copy Code',
        copied:           '✅ Copied!',
        wins:             'win(s)',
        room_not_found:   'Room not found',
        game_started:     'Game already started',
        room_full:        'Room is full',
        need_more:        'Need at least 2 players',
        chat_title:       'Chat',
      }
    };
    return (map[lang] || map.ar)[key] || key;
  }

  // ── Socket.io connection to /game namespace ─────────────────────────────
  const SERVER_URL = window.SERVER_URL || (window.location.origin);
  const socket = io(SERVER_URL + '/game', {
    auth: { token: authToken }
  });

  // ── Game state ──────────────────────────────────────────────────────────
  let myIndex         = -1;
  let myHand          = [];
  let players         = [];
  let myTurn          = false;
  let activeColor     = null;
  let currentBoardCard = null;
  let currentBoardType = null;
  let pendingWild     = null;
  let hasReactionBtn  = false;
  let isHost          = false;

  // ── DOM refs ────────────────────────────────────────────────────────────
  const lobbyScreen   = document.getElementById('qlobbyScreen');
  const gameScreen    = document.getElementById('qgameScreen');
  const myHandEl      = document.getElementById('qmyHand');
  const myLabelEl     = document.getElementById('qmyLabel');
  const topZone       = document.getElementById('qtopZone');
  const leftZone      = document.getElementById('qleftZone');
  const rightZone     = document.getElementById('qrightZone');
  const turnBanner    = document.getElementById('qturnBanner');
  const boardCardEl   = document.getElementById('qboardCardInner');
  const colorDotEl    = document.getElementById('qcolorDot');
  const reactionBtn   = document.getElementById('qreactionBtn');
  const colorChooser  = document.getElementById('qcolorChooser');
  const toastWrap     = document.getElementById('qtoastWrap');
  const gameOverlay   = document.getElementById('qgameOverlay');
  const waitingMsg    = document.getElementById('qwaitingMsg');
  const startBtn      = document.getElementById('qstartBtn');
  const roomCodeEl    = document.getElementById('qroomCode');
  const playerListEl  = document.getElementById('qwaitingPlayers');

  // Set up lobby UI
  if (roomCodeEl)   roomCodeEl.textContent = roomCode;
  if (waitingMsg)   waitingMsg.textContent  = gt('waiting');
  if (startBtn)     startBtn.textContent    = gt('start_btn');
  const copyBtnEl = document.getElementById('qcopyBtn');
  if (copyBtnEl) copyBtnEl.textContent = gt('copy');

  // Apply lang direction
  document.documentElement.dir  = isAr ? 'rtl' : 'ltr';
  document.documentElement.lang = lang;

  // ── Connect ─────────────────────────────────────────────────────────────
  socket.on('connect', () => {
    socket.emit('join-game', { roomCode, username: myUsername });
  });

  socket.on('connect_error', (err) => {
    if (err.message === 'NO_AUTH' || err.message === 'BAD_TOKEN') {
      localStorage.removeItem('qc_token');
      window.location.href = '/';
    }
  });

  socket.on('joinError', (code) => {
    const msgs = {
      room_not_found: gt('room_not_found'),
      game_started:   gt('game_started'),
      room_full:      gt('room_full'),
      need_more_players: gt('need_more')
    };
    alert(msgs[code] || code);
    window.location.href = '/qemy';
  });

  // ── Lobby events ─────────────────────────────────────────────────────────
  socket.on('joinedRoom', ({ playerIndex, players: pl, maxPlayers, hostId }) => {
    myIndex = playerIndex;
    players = pl;
    isHost  = (hostId === myUserId);
    _updateLobbyPlayers(pl, maxPlayers);
    if (isHost && pl.length >= 2 && startBtn) startBtn.style.display = 'block';
  });

  socket.on('lobbyUpdate', ({ players: pl, maxPlayers, hostId }) => {
    players = pl;
    isHost  = (hostId === myUserId);
    _updateLobbyPlayers(pl, maxPlayers);
    if (isHost && pl.length >= 2 && startBtn) startBtn.style.display = 'block';
  });

  function _updateLobbyPlayers(pl, maxPlayers) {
    if (!playerListEl) return;
    playerListEl.innerHTML = pl.map(p => `
      <div class="qplayer-chip">
        <div class="qplayer-avatar qchip-av" style="width:24px;height:24px;font-size:12px;">
          ${p.userId === myUserId && myAvatar
            ? `<img src="${myAvatar}" class="qchip-avatar"/>`
            : _emojiFor(pl.indexOf(p))}
        </div>
        <span>${p.name}</span>
      </div>`).join('');
    if (waitingMsg) waitingMsg.textContent = `${pl.length} / ${maxPlayers} ${isAr ? 'لاعبين' : 'players'}`;
  }

  // ── Game start ────────────────────────────────────────────────────────────
  socket.on('gameStart', ({ players: pl, cardOnBoard, activeColor: ac, currentTurnUserId, reactionHolderUserId }) => {
    players     = pl;
    activeColor = ac;
    hasReactionBtn = (reactionHolderUserId === myUserId);

    // Determine myIndex from players array
    myIndex = pl.findIndex(p => p.userId === myUserId);

    // Hide game-over overlay (rematch) and clean up consent UI + confetti
    if (!gameOverlay.classList.contains('qhidden')) {
      gameOverlay.classList.add('qhidden');
      gameOverlay.classList.remove('qwin-state', 'qloss-state');
      document.querySelectorAll('.qconfetti-piece').forEach(p => p.remove());
      _resetRematchUI();
    }

    lobbyScreen.classList.add('qhidden');
    // BUG-01: blobs are position:fixed and escape the parent's hidden state
    document.querySelectorAll('.qblob').forEach(b => b.style.display = 'none');
    gameScreen.classList.remove('qhidden');

    _setupLayout(pl);
    _renderBoardCard(cardOnBoard, ac);
    if (hasReactionBtn) reactionBtn.classList.remove('qhidden');
    _handleTurnChange(currentTurnUserId);

    // Set initial opp hand counts
    pl.forEach((p, i) => { if (i !== myIndex) _renderOppHand(i, 8); });
    connectToPeers(pl);
  });

  // Reconnect to ongoing game
  socket.on('reconnected', ({ players: pl, cardOnBoard, activeColor: ac, currentTurnUserId, reactionHolderUserId, myIndex: idx }) => {
    players     = pl;
    activeColor = ac;
    myIndex     = idx;
    hasReactionBtn = (reactionHolderUserId === myUserId);

    lobbyScreen.classList.add('qhidden');
    document.querySelectorAll('.qblob').forEach(b => b.style.display = 'none');
    gameScreen.classList.remove('qhidden');

    _setupLayout(pl);
    _renderBoardCard(cardOnBoard, ac);
    // Always sync button visibility — not just on show, so a used reaction
    // button stays hidden after a disconnect/reconnect cycle.
    hasReactionBtn ? reactionBtn.classList.remove('qhidden') : reactionBtn.classList.add('qhidden');
    _handleTurnChange(currentTurnUserId);
    pl.forEach((p, i) => { if (i !== myIndex) _renderOppHand(i, p.handSize); });
    connectToPeers(pl);
  });

  // ── Receive hand ───────────────────────────────────────────────────────────
  socket.on('haveCard', (hand) => {
    _playingCard = false; // server confirmed — unlock card play
    const isNew = hand.length > myHand.length;
    myHand = hand;
    _renderMyHand(hand, isNew);
  });

  // ── Turn handling ──────────────────────────────────────────────────────────
  socket.on('turnChanged', ({ currentTurnUserId, playerName, playerIndex }) => {
    _handleTurnChange(currentTurnUserId, playerName);
  });

  function _handleTurnChange(currentTurnUserId, pName) {
    myTurn = (currentTurnUserId === myUserId);

    // Clear all turn-active highlights before reapplying
    document.querySelectorAll('.qturn-active').forEach(el => el.classList.remove('qturn-active'));
    const deckPile = document.getElementById('qdeckPile');

    if (myTurn) {
      turnBanner.textContent = gt('your_turn');
      turnBanner.classList.add('qmy-turn');
      myHandEl.querySelectorAll('.qcard').forEach(c => {
        const n = parseInt(c.dataset.card);
        if (_isPlayable(n)) c.classList.add('qplayable');
        else c.classList.remove('qplayable');
      });
      // Glow the deck pile on my turn
      if (deckPile) deckPile.classList.add('qmy-turn-deck');
      // Ring my avatar
      const myAv = myLabelEl.querySelector('.qplayer-avatar');
      if (myAv) myAv.classList.add('qturn-active');
    } else {
      const name = pName || players.find(p => p.userId === currentTurnUserId)?.name || '?';
      turnBanner.textContent = isAr ? `دور ${name}` : `${name}${gt('their_turn')}`;
      turnBanner.classList.remove('qmy-turn');
      myHandEl.querySelectorAll('.qcard').forEach(c => c.classList.remove('qplayable'));
      if (deckPile) deckPile.classList.remove('qmy-turn-deck');
      // Highlight the active opponent's avatar and label
      players.forEach((p, idx) => {
        if (p.userId === currentTurnUserId && idx !== myIndex) {
          const lbl = document.getElementById(`qoppLabel${idx}`);
          const av  = lbl?.parentElement?.querySelector('.qplayer-avatar');
          if (lbl) lbl.classList.add('qturn-active');
          if (av)  av.classList.add('qturn-active');
        }
      });
      // If the color chooser is still open (e.g. turn timed out server-side),
      // close it and discard the pending wild so it can't fire on the next turn.
      if (!colorChooser.classList.contains('qhidden')) {
        colorChooser.classList.add('qhidden');
        pendingWild = null;
      }
    }
  }

  // ── Card events ────────────────────────────────────────────────────────────
  socket.on('cardPlayed', ({ playerIndex, playerName: pn, card, activeColor: ac }) => {
    activeColor = ac;
    _renderBoardCard(card, ac);
    // Only update opponent hand display — own hand is updated via 'haveCard'
    if (playerIndex !== myIndex) _updateOppHandSize(playerIndex, -1);
    _showToast(`${pn} ${gt('played_card')}`, '');
    _updateColorDot(ac);
  });

  socket.on('cardDrawn', ({ playerIndex, playerName: pn }) => {
    if (playerIndex !== myIndex) {
      _updateOppHandSize(playerIndex, 1);
      _showToast(`${pn} ${gt('drew_card')}`, '');
    }
  });

  socket.on('forceDraw', ({ playerName: pn, count, playerIndex }) => {
    _showToast(`${pn} ${gt('force_draws')} ${count} ${gt('force_draws2')}`, 'qred');
    // Update victim's visible hand size for all observers (their own is updated via haveCard)
    if (playerIndex !== undefined && playerIndex !== myIndex) {
      _updateOppHandSize(playerIndex, count);
    }
  });

  socket.on('unoAlert', ({ playerName: pn }) => {
    _showToast(`${pn} ${gt('uno')}`, 'qred');
  });

  // NOTE: server embeds activeColor inside 'cardPlayed' — no separate 'colorChosen' event.

  // ── In-game chat ───────────────────────────────────────────────────────────
  let chatOpen   = false;
  let chatUnread = 0;
  const chatPanel    = document.getElementById('qchatPanel');
  const chatMessages = document.getElementById('qchatMessages');
  const chatBadge    = document.getElementById('qchatBadge');
  const chatTitle    = document.getElementById('qchatTitle');
  // NOTE: isAr is already declared at the top of this IIFE — do not redeclare.

  if (chatTitle) chatTitle.textContent = gt('chat_title');

  socket.on('chat-msg', ({ name, text }) => {
    const isMe = (name === myUsername);
    const bubble = document.createElement('div');
    bubble.className = `qchat-bubble ${isMe ? 'me' : 'them'}`;
    if (!isMe) {
      const nameEl = document.createElement('div');
      nameEl.className = 'qchat-bubble-name';
      nameEl.textContent = name;
      bubble.appendChild(nameEl);
    }
    const textEl = document.createElement('div');
    textEl.textContent = text;
    bubble.appendChild(textEl);
    chatMessages?.appendChild(bubble);
    chatMessages?.scrollTo({ top: chatMessages.scrollHeight, behavior: 'smooth' });
    if (!chatOpen && !isMe) {
      chatUnread++;
      if (chatBadge) {
        chatBadge.textContent = chatUnread;
        chatBadge.classList.remove('qhidden');
      }
    }
  });

  window.toggleChat = function () {
    chatOpen = !chatOpen;
    if (chatOpen) {
      chatPanel?.classList.remove('qhidden');
      chatUnread = 0;
      if (chatBadge) { chatBadge.textContent = '0'; chatBadge.classList.add('qhidden'); }
      setTimeout(() => document.getElementById('qchatInput')?.focus(), 50);
    } else {
      chatPanel?.classList.add('qhidden');
    }
  };

  window.sendChatMsg = function () {
    const input = document.getElementById('qchatInput');
    const text  = input?.value.trim();
    if (!text || !roomCode) return;
    input.value = '';
    socket.emit('chat-msg', { roomCode, text });
  };

  // ── Reaction button ────────────────────────────────────────────────────────
  socket.on('reactionButton', ({ hasButton }) => {
    hasReactionBtn = hasButton;
    // BUG-02: defer DOM update so layout is ready before showing/hiding the button
    setTimeout(() => {
      hasButton ? reactionBtn.classList.remove('qhidden') : reactionBtn.classList.add('qhidden');
      reactionBtn.disabled = false;
    }, 0);
  });

  socket.on('reactionFired', ({ playerName: pn }) => {
    myHandEl.classList.add('qshake');
    setTimeout(() => myHandEl.classList.remove('qshake'), 500);
    _showToast(`⚗️ ${pn} ${gt('reaction_fired')}`, 'qpurple');
    reactionBtn.classList.add('qhidden');
  });

  window.fireReaction = function () {
    if (!hasReactionBtn) return;
    reactionBtn.disabled = true; // prevent double-fire immediately
    socket.emit('reaction-button', { roomCode });
    hasReactionBtn = false;
  };

  // ── Disconnect / reconnect ─────────────────────────────────────────────────
  socket.on('playerDisconnect', ({ playerName: pn }) => {
    _showToast(`${pn} ${gt('player_left')}`, 'qred');
  });
  socket.on('playerReconnected', ({ playerName: pn }) => {
    _showToast(`${pn} ${gt('player_back')}`, 'qgreen');
  });
  socket.on('playerTimeout', ({ playerName: pn }) => {
    _showToast(`${pn} — ${gt('timeout')}`, 'qred');
  });

  // ── Game over ──────────────────────────────────────────────────────────────
  socket.on('gameOver', ({ winnerName, winnerUserId }) => {
    const iWon = winnerUserId === myUserId;

    // Clean up transient UI state
    reactionBtn.classList.add('qhidden');
    hasReactionBtn = false;
    colorChooser.classList.add('qhidden');
    pendingWild = null;
    currentBoardCard = null;
    activeColor = null;
    const deckPile = document.getElementById('qdeckPile');
    if (deckPile) deckPile.classList.remove('qmy-turn-deck');

    document.getElementById('qgoEmoji').textContent = iWon ? '🏆' : '😔';
    document.getElementById('qgoTitle').textContent = iWon ? gt('you_win') : gt('game_over');
    document.getElementById('qgoName').textContent  = iWon ? '' : `${winnerName} ${isAr ? 'فاز!' : 'wins!'}`;

    const badge = document.getElementById('qgoBadge');
    if (iWon && badge) {
      badge.textContent = gt('badge_earned');
      badge.style.display = 'block';
    } else if (!iWon && badge) {
      badge.textContent = isAr ? '!قريب — حاول مرة أخرى' : 'So close — try again!';
      badge.style.display = 'block';
      badge.style.color = '#6b7280';
    }

    // Show rematch button
    const rematchBtn = document.getElementById('qgoRematchBtn');
    if (rematchBtn) rematchBtn.style.display = 'inline-flex';

    // Win/loss overlay state classes
    gameOverlay.classList.remove('qwin-state', 'qloss-state');
    gameOverlay.classList.add(iWon ? 'qwin-state' : 'qloss-state');

    // Confetti burst on win
    if (iWon) _launchConfetti();

    gameOverlay.classList.remove('qhidden');
  });

  // ── Confetti ───────────────────────────────────────────────────────────────
  function _launchConfetti() {
    const colors = ['#ef4444','#f4c430','#2a9d8f','#457b9d','#f4a261','#a855f7','#fff'];
    for (let i = 0; i < 52; i++) {
      const piece = document.createElement('div');
      piece.className = 'qconfetti-piece';
      const color = colors[i % colors.length];
      const size  = 6 + Math.random() * 8;
      const delay = Math.random() * 1.2;
      const dur   = 2.4 + Math.random() * 1.6;
      const left  = Math.random() * 100;
      const isCircle = Math.random() > 0.6;
      piece.style.cssText = `left:${left}vw;background:${color};width:${size}px;height:${size}px;border-radius:${isCircle ? '50%' : '2px'};animation-duration:${dur}s;animation-delay:${delay}s;`;
      gameOverlay.appendChild(piece);
      setTimeout(() => piece.remove(), (dur + delay + 0.6) * 1000);
    }
  }

  function _resetRematchUI() {
    const rematchBtn  = document.getElementById('qgoRematchBtn');
    const acceptBtn   = document.getElementById('qgoAcceptBtn');
    const declineBtn  = document.getElementById('qgoDeclineBtn');
    const waitingEl   = document.getElementById('qgoWaiting');
    if (rematchBtn)  { rematchBtn.disabled = false; rematchBtn.style.display = 'none'; rematchBtn.textContent = isAr ? 'لعبة جديدة ↩' : 'Rematch ↩'; }
    if (acceptBtn)   acceptBtn.style.display  = 'none';
    if (declineBtn)  declineBtn.style.display = 'none';
    if (waitingEl)   waitingEl.style.display  = 'none';
  }

  window.requestRematch = function () {
    const rematchBtn = document.getElementById('qgoRematchBtn');
    const waitingEl  = document.getElementById('qgoWaiting');
    if (rematchBtn) { rematchBtn.disabled = true; rematchBtn.style.display = 'none'; }
    if (waitingEl)  { waitingEl.textContent = isAr ? '⏳ في انتظار موافقة الآخرين...' : '⏳ Waiting for others to accept...'; waitingEl.style.display = 'block'; }
    socket.emit('request-rematch', { roomCode });
  };

  window.acceptRematch = function () {
    const acceptBtn  = document.getElementById('qgoAcceptBtn');
    const declineBtn = document.getElementById('qgoDeclineBtn');
    if (acceptBtn)  { acceptBtn.disabled = true; }
    if (declineBtn) declineBtn.style.display = 'none';
    socket.emit('accept-rematch', { roomCode });
  };

  window.declineRematch = function () {
    _resetRematchUI();
    const rematchBtn = document.getElementById('qgoRematchBtn');
    if (rematchBtn) rematchBtn.style.display = 'inline-flex';
    socket.emit('decline-rematch', { roomCode });
  };

  socket.on('rematch-requested', ({ byName, byUserId }) => {
    if (byUserId === myUserId) return; // requester already sees the waiting state
    _showToast(`🔄 ${byName} ${isAr ? 'يريد إعادة اللعبة!' : 'wants a rematch!'}`, 'qpurple');
    const acceptBtn  = document.getElementById('qgoAcceptBtn');
    const declineBtn = document.getElementById('qgoDeclineBtn');
    const rematchBtn = document.getElementById('qgoRematchBtn');
    const acceptLbl  = document.getElementById('qgoAcceptLabel');
    const declineLbl = document.getElementById('qgoDeclineLabel');
    if (acceptLbl)  acceptLbl.textContent  = isAr ? 'موافق' : 'Accept';
    if (declineLbl) declineLbl.textContent = isAr ? 'رفض'   : 'Decline';
    if (rematchBtn) rematchBtn.style.display = 'none';
    if (acceptBtn)  { acceptBtn.disabled = false; acceptBtn.style.display  = 'inline-flex'; }
    if (declineBtn) declineBtn.style.display = 'inline-flex';
  });

  socket.on('rematch-accepted', ({ byName, byUserId }) => {
    if (byUserId !== myUserId) {
      _showToast(`✅ ${byName} ${isAr ? 'وافق على الإعادة' : 'accepted rematch'}`, 'qgreen');
    }
  });

  socket.on('rematch-declined', ({ byName }) => {
    _showToast(`❌ ${byName} ${isAr ? 'رفض الإعادة' : 'declined rematch'}`, 'qred');
    _resetRematchUI();
    const rematchBtn = document.getElementById('qgoRematchBtn');
    if (rematchBtn) rematchBtn.style.display = 'inline-flex';
  });

  window.goBack = function () { window.location.href = '/qemy'; };

  // ── Layout setup ─────────────────────────────────────────────────────────
  function _setupLayout(pl) {
    topZone.innerHTML = '';
    leftZone.innerHTML = ''; leftZone.classList.add('qhidden');
    rightZone.innerHTML = ''; rightZone.classList.add('qhidden');

    const opps = [];
    for (let i = 1; i < pl.length; i++) {
      const idx = (myIndex + i) % pl.length;
      opps.push({ name: pl[idx].name, userId: pl[idx].userId, index: idx });
    }

    const layout = pl.length === 2 ? { top: opps[0] }
                 : pl.length === 3 ? { top: opps[0], left: opps[1] }
                 : { left: opps[0], top: opps[1], right: opps[2] };

    if (layout.top)   topZone.appendChild(_makeOppZone(layout.top.name, layout.top.index, 'h'));
    if (layout.left)  { leftZone.classList.remove('qhidden');  leftZone.appendChild(_makeOppZone(layout.left.name, layout.left.index, 'v')); }
    if (layout.right) { rightZone.classList.remove('qhidden'); rightZone.appendChild(_makeOppZone(layout.right.name, layout.right.index, 'v')); }

    _renderMyProfile();
  }

  function _makeOppZone(name, idx, dir) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:4px;';

    const av   = document.createElement('div'); av.className = 'qplayer-avatar'; av.textContent = _emojiFor(idx);
    const lbl  = document.createElement('div'); lbl.className = 'qopp-label'; lbl.id = `qoppLabel${idx}`; lbl.textContent = name;
    const hand = document.createElement('div'); hand.className = 'qopp-hand'; hand.id = `qoppHand${idx}`; hand.dataset.count = '8';
    if (dir === 'v') hand.style.flexDirection = 'column';
    const cnt  = document.createElement('div'); cnt.className = 'qcount-badge'; cnt.id = `qoppCount${idx}`; cnt.textContent = isAr ? '8 أوراق' : '8 cards';

    wrap.append(av, lbl, hand, cnt);
    return wrap;
  }

  function _renderMyProfile() {
    if (!myLabelEl) return;
    myLabelEl.innerHTML = '';
    const av = document.createElement('div');
    av.className = 'qplayer-avatar qmy-avatar';
    av.innerHTML = myAvatar
      ? `<img src="${myAvatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;"/>`
      : _emojiFor((myIndex + 5) % 10);
    const nm = document.createElement('div'); nm.className = 'qmy-name'; nm.textContent = myUsername;
    myLabelEl.append(av, nm);
  }

  // ── My hand rendering ──────────────────────────────────────────────────────
  function _renderMyHand(hand, isNew) {
    myHandEl.innerHTML = '';
    hand.forEach((num, i) => {
      const el = _makeCardFront(num);
      el.dataset.card = num;
      el.classList.add('qdealing');
      el.style.animationDelay = `${i * 35}ms`;
      if (myTurn && _isPlayable(num)) el.classList.add('qplayable');
      el.addEventListener('click', () => _onPlayCard(num));
      myHandEl.appendChild(el);
    });
  }

  function _isPlayable(num) {
    const color = _cardColor(num);
    const type  = _cardType(num);
    if (color === 'black') return true;                    // wilds always playable
    if (color === activeColor) return true;                // same active color
    if (currentBoardCard !== null && num % 14 === currentBoardCard % 14) return true; // same face value
    if (type !== 'Number' && type === currentBoardType) return true; // same special type
    return false;
  }

  let _playingCard = false; // debounce: prevents double-tap sending two play-card events

  function _onPlayCard(num) {
    if (!myTurn) return;
    if (_playingCard) return; // debounce
    if (_cardColor(num) === 'black') {
      pendingWild = num;
      colorChooser.classList.remove('qhidden');
    } else {
      if (!_isPlayable(num)) return;
      _playingCard = true;
      _animatePlay(num);
      socket.emit('play-card', { roomCode, card: num });
      // Reset after server responds (via haveCard) or after 1.5s timeout
      setTimeout(() => { _playingCard = false; }, 1500);
    }
  }

  window.pickColor = function (color) {
    colorChooser.classList.add('qhidden');
    // Guard: if turn changed while chooser was open, discard the pending wild
    if (pendingWild !== null && myTurn && !_playingCard) {
      _playingCard = true;
      _animatePlay(pendingWild);
      socket.emit('play-card', { roomCode, card: pendingWild, chosenColor: color });
      setTimeout(() => { _playingCard = false; }, 1500);
    }
    pendingWild = null;
  };

  function _animatePlay(num) {
    const el = myHandEl.querySelector(`[data-card="${num}"]`);
    if (el) {
      el.classList.remove('qplayable');
      el.classList.add('qplaying');
      el.style.pointerEvents = 'none';
      setTimeout(() => el.remove(), 380);
    }
  }

  window.onDrawCard = function () {
    if (!myTurn) return;
    socket.emit('draw-card', { roomCode });
    const deck = document.getElementById('qdeckPile');
    if (deck) { deck.style.animation = 'none'; void deck.offsetWidth; deck.style.animation = 'qdrawpulse 0.5s ease'; }
  };

  // ── Board card & color dot ─────────────────────────────────────────────────
  function _renderBoardCard(num, color) {
    currentBoardCard = num;
    currentBoardType = _cardType(num);
    const front = _makeCardFront(num);
    front.classList.add('qplaying');
    boardCardEl.innerHTML = '';
    boardCardEl.appendChild(front);
    _updateColorDot(color || _cardColor(num));
  }

  function _updateColorDot(color) {
    colorDotEl.classList.remove('qhidden');
    const map = { red:'#e63946', yellow:'#f4c430', green:'#2a9d8f', blue:'#457b9d', black:'#333' };
    colorDotEl.style.background = map[color] || '#333';
  }

  // ── Opp hand rendering ────────────────────────────────────────────────────
  function _renderOppHand(idx, count) {
    const el  = document.getElementById(`qoppHand${idx}`);
    const cnt = document.getElementById(`qoppCount${idx}`);
    if (!el) return;
    el.innerHTML = '';
    const max = Math.min(count, 14);
    for (let i = 0; i < max; i++) {
      const c = document.createElement('div'); c.className = 'qopp-card qsliding';
      c.style.animationDelay = `${i * 30}ms`;
      el.appendChild(c);
    }
    if (cnt) {
      cnt.textContent = count === 1 ? (isAr ? 'ورقة — UNO!' : '1 card — UNO!') : `${count} ${isAr ? 'أوراق' : 'cards'}`;
      cnt.className   = count === 1 ? 'quno-badge' : 'qcount-badge';
    }
    el.dataset.count = count;
  }

  function _updateOppHandSize(idx, delta) {
    const el  = document.getElementById(`qoppHand${idx}`);
    if (!el) return;
    const cur = parseInt(el.dataset.count || '8');
    _renderOppHand(idx, Math.max(0, cur + delta));
  }

  // ── Card helpers ───────────────────────────────────────────────────────────
  function _cardColor(n) {
    if (n % 14 === 13) return 'black';
    switch (Math.floor(n / 14)) {
      case 0: case 4: return 'red';
      case 1: case 5: return 'yellow';
      case 2: case 6: return 'green';
      case 3: case 7: return 'blue';
    }
  }

  function _cardType(n) {
    switch (n % 14) {
      case 10: return 'Skip';
      case 11: return 'Reverse';
      case 12: return 'Draw2';
      case 13: return Math.floor(n / 14) >= 4 ? 'Draw4' : 'Wild';
      default: return 'Number';
    }
  }

  function _cardLabel(n) {
    switch (n % 14) {
      case 10: return '⊘';
      case 11: return '⇄';
      case 12: return '+2';
      case 13: return Math.floor(n / 14) >= 4 ? '+4' : '★';
      default: return String(n % 14);
    }
  }

  function _makeCardFront(n) {
    const color = _cardColor(n);
    const label = _cardLabel(n);
    const card  = document.createElement('div');
    card.className = `qcard qcard-front qcard-${color}`;
    const tl = document.createElement('div'); tl.className = 'qcard-tl'; tl.textContent = label;
    const nm = document.createElement('div'); nm.className = 'qcard-number'; nm.textContent = label;
    const br = document.createElement('div'); br.className = 'qcard-br'; br.textContent = label;
    card.append(tl, nm, br);
    return card;
  }

  // ── Toast ──────────────────────────────────────────────────────────────────
  function _showToast(msg, cls) {
    const t = document.createElement('div');
    t.className = `qtoast ${cls || ''}`;
    t.textContent = msg;
    toastWrap.appendChild(t);
    setTimeout(() => t.remove(), 3200);
  }

  // ── Emojis for players ────────────────────────────────────────────────────
  const EMOJIS = ['🧪','🔬','⚗️','🧬','🌡️','💊','🔭','🧲','⚡','🌊'];
  function _emojiFor(idx) { return EMOJIS[idx % EMOJIS.length]; }

  // ── Copy room code ─────────────────────────────────────────────────────────
  window.copyRoomCode = function () {
    navigator.clipboard.writeText(roomCode).then(() => {
      const btn = document.getElementById('qcopyBtn');
      if (btn) { btn.textContent = gt('copied'); setTimeout(() => btn.textContent = gt('copy'), 2000); }
    });
  };

  // ── Host start early ──────────────────────────────────────────────────────
  window.hostStartEarly = function () {
    socket.emit('start-game', { roomCode });
  };

  // ── VOICE CHAT (MESH WEBRTC) ──────────────────────────────────────────────
  let iceConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
  const _iceReady = fetch('/api/ice-config')
    .then(r => r.json()).then(cfg => { iceConfig = cfg; }).catch(() => {});

  let _audioCtx = null;
  function _unlockAudio() {
    try {
      if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (_audioCtx.state === 'suspended') _audioCtx.resume();
    } catch (_) {}
  }

  let localAudioStream = null;
  let peerConnections  = {};  // userId → RTCPeerConnection
  let pendingCandidates = {}; // userId → RTCIceCandidate[]
  let isMicOn      = false;
  let voiceEnabled = false;

  window.toggleVoiceChat = async function () {
    const btn = document.getElementById('qmicBtn');
    if (!voiceEnabled) {
      _unlockAudio();
      await _iceReady;
      try {
        localAudioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
          .catch(() => navigator.mediaDevices.getUserMedia({ audio: true }));
        voiceEnabled = true;
        isMicOn = true;
        btn.textContent = '🎤';
        btn.style.color = 'var(--green)';
        _showToast(isAr ? 'تم تفعيل المايك ✓' : 'Mic on ✓', 'qgreen');
        // Close any stale connections from before voice was enabled, then reconnect clean
        Object.values(peerConnections).forEach(pc => pc.close());
        peerConnections = {};
        pendingCandidates = {};
        // Notify peers that we're ready — the initiator will (re-)send offers
        socket.emit('qemy:voice-ready', {});
        connectToPeers(players);
      } catch {
        _showToast(isAr ? 'يرجى السماح بالمايكروفون' : 'Mic access denied', 'qred');
      }
      return;
    }
    isMicOn = !isMicOn;
    localAudioStream.getAudioTracks()[0].enabled = isMicOn;
    btn.textContent = isMicOn ? '🎤' : '🔇';
    btn.style.color = isMicOn ? 'var(--green)' : 'var(--text2)';
  };

  function createPeerConnection(peerUserId, isInitiator) {
    if (peerConnections[peerUserId]) return peerConnections[peerUserId];
    const pc = new RTCPeerConnection(iceConfig);
    peerConnections[peerUserId] = pc;

    if (localAudioStream) {
      localAudioStream.getTracks().forEach(t => pc.addTrack(t, localAudioStream));
    }

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        socket.emit('qemy:signal', { targetUserId: peerUserId, type: 'ice', data: e.candidate });
      }
    };

    pc.ontrack = (e) => {
      let el = document.getElementById('qaudio-' + peerUserId);
      if (!el) {
        // Use <video> not <audio>: iOS routes <audio> to earpiece, <video> to speaker
        el = document.createElement('video');
        el.id = 'qaudio-' + peerUserId;
        el.autoplay = true;
        el.setAttribute('playsinline', '');
        el.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;';
        document.getElementById('qaudio-container').appendChild(el);
      }
      const stream = (e.streams && e.streams[0])
        ? e.streams[0]
        : (() => { const s = new MediaStream(); s.addTrack(e.track); return s; })();
      el.srcObject = stream;
      el.play().catch(() => {
        try { if (_audioCtx) _audioCtx.createMediaStreamSource(stream).connect(_audioCtx.destination); } catch (_) {}
      });
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
        const el = document.getElementById('qaudio-' + peerUserId);
        if (el) el.remove();
        delete peerConnections[peerUserId];
      }
    };

    if (isInitiator) {
      pc.createOffer()
        .then(offer => pc.setLocalDescription(offer))
        .then(() => socket.emit('qemy:signal', { targetUserId: peerUserId, type: 'offer', data: pc.localDescription }));
    }
    return pc;
  }

  function connectToPeers(pl) {
    if (!voiceEnabled || !pl) return;
    pl.forEach(p => {
      if (p.userId !== myUserId && !peerConnections[p.userId]) {
        const isInitiator = myUserId < p.userId;
        createPeerConnection(p.userId, isInitiator);
      }
    });
  }

  // When a peer enables their mic, the initiator re-sends a fresh offer
  socket.on('qemy:voice-ready', ({ senderUserId }) => {
    if (!voiceEnabled) return;
    if (myUserId < senderUserId) {
      const ex = peerConnections[senderUserId];
      // Resend if: no connection, ICE failed/closed/disconnected, OR offer was sent
      // but answer never came back (remoteDescription is null — peer dropped the offer)
      const stale = !ex
        || !ex.remoteDescription
        || ex.iceConnectionState === 'failed'
        || ex.iceConnectionState === 'closed'
        || ex.iceConnectionState === 'disconnected';
      if (stale) {
        if (ex) { ex.close(); delete peerConnections[senderUserId]; }
        if (pendingCandidates[senderUserId]) delete pendingCandidates[senderUserId];
        createPeerConnection(senderUserId, true);
      }
    }
  });

  socket.on('qemy:signal', async ({ senderUserId, type, data }) => {
    if (!voiceEnabled) return;
    let pc = peerConnections[senderUserId];
    if (!pc) pc = createPeerConnection(senderUserId, false);

    if (type === 'offer') {
      await pc.setRemoteDescription(new RTCSessionDescription(data));
      for (const c of (pendingCandidates[senderUserId] || [])) {
        await pc.addIceCandidate(c).catch(() => {});
      }
      delete pendingCandidates[senderUserId];
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('qemy:signal', { targetUserId: senderUserId, type: 'answer', data: pc.localDescription });
    } else if (type === 'answer') {
      await pc.setRemoteDescription(new RTCSessionDescription(data));
      for (const c of (pendingCandidates[senderUserId] || [])) {
        await pc.addIceCandidate(c).catch(() => {});
      }
      delete pendingCandidates[senderUserId];
    } else if (type === 'ice') {
      if (pc.remoteDescription) {
        await pc.addIceCandidate(new RTCIceCandidate(data)).catch(() => {});
      } else {
        if (!pendingCandidates[senderUserId]) pendingCandidates[senderUserId] = [];
        pendingCandidates[senderUserId].push(new RTCIceCandidate(data));
      }
    }
  });
  // ─────────────────────────────────────────────────────────────────────────

})();
