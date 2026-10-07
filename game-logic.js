// ══ Qemy Game Engine ═══════════════════════════════════════════════════════
// Embedded in Qatar Chat server — handles /game Socket.io namespace
// Exposes { genRoomCode, createGameRoom, getOpenRooms } to server.js

const jwt    = require('jsonwebtoken');
const crypto = require('crypto');

module.exports = function setupGame(io, supabase, JWT_SECRET, notifyDefault, updateTaskProgress, checkAndAwardBadges, awardPoints) {

  // ── Deck helpers ───────────────────────────────────────────────────────────
  // 108 unique cards (112 minus the 4 duplicate zeros that Qemy removes)
  // Frozen so module-level state is never mutated on hot-reload
  const baseDeck = Object.freeze(
    Array.from({ length: 112 }, (_, i) => i)
      .filter((_, i) => ![95, 82, 69, 56].includes(i))
  );

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = crypto.randomInt(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  function cardColor(num) {
    if (num % 14 === 13) return 'black';
    switch (Math.floor(num / 14)) {
      case 0: case 4: return 'red';
      case 1: case 5: return 'yellow';
      case 2: case 6: return 'green';
      case 3: case 7: return 'blue';
    }
  }

  function cardType(num) {
    switch (num % 14) {
      case 10: return 'Skip';
      case 11: return 'Reverse';
      case 12: return 'Draw2';
      case 13: return Math.floor(num / 14) >= 4 ? 'Draw4' : 'Wild';
      default: return 'Number';
    }
  }

  function drawFromDeck(room) {
    if (room.deck.length === 0) {
      // Rebuild deck excluding cards in all hands and the current board card
      const inHands = new Set(room.players.flatMap(p => p.hand));
      room.deck = [...baseDeck].filter(c => c !== room.cardOnBoard && !inHands.has(c));
      shuffle(room.deck);
    }
    if (room.deck.length === 0) {
      // Last resort: all cards are in hands — rebuild excluding only in-hand cards
      const inHands = new Set(room.players.flatMap(p => p.hand));
      room.deck = [...baseDeck].filter(c => !inHands.has(c));
      shuffle(room.deck);
    }
    // If still empty (impossible in normal play), return a safe fallback rather than undefined
    return room.deck.shift() ?? 0;
  }

  function nextIdx(room) {
    const step = room.reverse ? -1 : 1;
    return (room.turn + step + room.players.length) % room.players.length;
  }

  // ── In-memory state ────────────────────────────────────────────────────────
  const gameRooms = {};        // roomCode → room state
  const dcTimers  = {};        // userId → setTimeout handle (reconnect window)

  // ── /game Socket.io namespace ──────────────────────────────────────────────
  const gameNs = io.of('/game');

  // JWT auth middleware — runs before every connection
  gameNs.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('NO_AUTH'));
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      socket.userId = decoded.userId;
      next();
    } catch {
      next(new Error('BAD_TOKEN'));
    }
  });

  gameNs.on('connection', (socket) => {
    const userId = socket.userId;

    // Clear any pending disconnect timer (reconnect within 60s)
    if (dcTimers[userId]) {
      clearTimeout(dcTimers[userId]);
      delete dcTimers[userId];
    }

    // Auto-reconnect: check if player is already in an active game.
    // We only pre-reconnect here; join-game will also handle it, so we set a
    // flag so the join-game handler can skip the duplicate reconnect path.
    let autoReconnectedRoom = null;
    for (const [roomCode, room] of Object.entries(gameRooms)) {
      const player = room.players.find(p => p.userId === userId);
      if (player && room.started) {
        player.socketId  = socket.id;
        player.connected = true;
        socket.join(roomCode);
        socket.emit('haveCard', player.hand);
        socket.emit('reconnected', _stateSnapshot(room, player));
        // Re-sync reaction button state so a previously-fired button stays hidden
        socket.emit('reactionButton', { hasButton: room.reactionHolder === player.userId });
        gameNs.to(roomCode).emit('playerReconnected', { playerName: player.name });
        autoReconnectedRoom = roomCode;
        break;
      }
    }

    // ── join-game ────────────────────────────────────────────────────────────
    socket.on('join-game', async ({ roomCode, username }) => {
      const room = gameRooms[roomCode];
      if (!room) { socket.emit('joinError', 'room_not_found'); return; }

      const existingPlayer = room.players.find(p => p.userId === userId);

      // Reconnect to in-progress game
      if (existingPlayer && room.started) {
        // Skip if already handled by the auto-reconnect block on connection
        if (autoReconnectedRoom === roomCode) return;
        existingPlayer.socketId  = socket.id;
        existingPlayer.connected = true;
        socket.join(roomCode);
        if (dcTimers[userId]) { clearTimeout(dcTimers[userId]); delete dcTimers[userId]; }
        socket.emit('haveCard', existingPlayer.hand);
        socket.emit('reconnected', _stateSnapshot(room, existingPlayer));
        // Re-sync reaction button state so a previously-fired button stays hidden
        socket.emit('reactionButton', { hasButton: room.reactionHolder === userId });
        gameNs.to(roomCode).emit('playerReconnected', { playerName: existingPlayer.name });
        return;
      }

      // Rejoin lobby slot
      if (existingPlayer && !room.started) {
        existingPlayer.socketId  = socket.id;
        existingPlayer.connected = true;
        socket.join(roomCode);
        socket.emit('joinedRoom', _lobbyPayload(room, existingPlayer));
        gameNs.to(roomCode).emit('lobbyUpdate', _lobbyUpdate(room));
        return;
      }

      if (room.started)                            { socket.emit('joinError', 'game_started'); return; }
      if (room.players.length >= room.maxPlayers)  { socket.emit('joinError', 'room_full');    return; }

      // New player joining
      const newPlayer = { userId, socketId: socket.id, name: username || 'Player', hand: [], connected: true };
      room.players.push(newPlayer);
      socket.join(roomCode);

      // Persist to DB (best-effort)
      try {
        const { data: row } = await supabase.from('game_rooms').select('id').eq('room_code', roomCode).single();
        if (row) await supabase.from('game_players').upsert([{ room_id: row.id, user_id: userId }]);
      } catch (_) {}

      socket.emit('joinedRoom', _lobbyPayload(room, newPlayer));
      gameNs.to(roomCode).emit('lobbyUpdate', _lobbyUpdate(room));

      // Auto-start when room is full
      if (room.players.length === room.maxPlayers) {
        setTimeout(() => _startGame(roomCode), 1500);
      }
    });

    // ── start-game (host only) ───────────────────────────────────────────────
    socket.on('start-game', ({ roomCode }) => {
      const room = gameRooms[roomCode];
      if (!room || room.started || room.hostId !== userId) return;
      if (room.players.length < 2) { socket.emit('joinError', 'need_more_players'); return; }
      _startGame(roomCode);
    });

    // ── draw-card ────────────────────────────────────────────────────────────
    socket.on('draw-card', ({ roomCode }) => {
      const room = gameRooms[roomCode];
      if (!room || !room.started) return;
      const cp = room.players[room.turn];
      if (cp.socketId !== socket.id) return;

      const card = drawFromDeck(room);
      cp.hand.push(card);
      socket.emit('haveCard', cp.hand);
      gameNs.to(roomCode).emit('cardDrawn', { playerIndex: room.turn, playerName: cp.name });
      _advanceTurn(room, roomCode);
    });

    // ── play-card ────────────────────────────────────────────────────────────
    socket.on('play-card', ({ roomCode, card, chosenColor }) => {
      const room = gameRooms[roomCode];
      if (!room || !room.started) return;
      const cp = room.players[room.turn];
      if (cp.socketId !== socket.id) return;

      const idx = cp.hand.indexOf(card);
      if (idx === -1) return;

      const type  = cardType(card);
      const color = cardColor(card);
      const isWild = color === 'black';
      const boardNum = room.cardOnBoard % 14;
      const validColors = ['red', 'yellow', 'green', 'blue'];

      // Validate legality
      if (!isWild && color !== room.activeColor && card % 14 !== boardNum) return;

      // Validate chosenColor for wild cards
      if (isWild && chosenColor && !validColors.includes(chosenColor)) return;

      cp.hand.splice(idx, 1);
      room.cardOnBoard = card;
      room.activeColor = isWild ? (chosenColor || 'red') : color;

      gameNs.to(roomCode).emit('cardPlayed', {
        playerIndex: room.turn, playerName: cp.name,
        card, activeColor: room.activeColor
      });
      socket.emit('haveCard', cp.hand);

      if (cp.hand.length === 0) { _handleWin(roomCode, cp); return; }
      if (cp.hand.length === 1) gameNs.to(roomCode).emit('unoAlert', { playerName: cp.name });

      // Special card effects
      if (type === 'Reverse') {
        room.reverse = !room.reverse;
        _advanceTurn(room, roomCode);
        if (room.players.length === 2) _advanceTurn(room, roomCode); // Reverse = Skip in 2-player
      } else if (type === 'Skip') {
        _advanceTurn(room, roomCode);
        _advanceTurn(room, roomCode);
      } else if (type === 'Draw2') {
        _forceDraw(room, roomCode, 2);
      } else if (type === 'Draw4') {
        _forceDraw(room, roomCode, 4);
      } else {
        _advanceTurn(room, roomCode);
      }
    });

    // ── reaction-button ──────────────────────────────────────────────────────
    socket.on('reaction-button', ({ roomCode }) => {
      const room = gameRooms[roomCode];
      if (!room || !room.started || room.reactionHolder !== userId) return;

      // Shuffle all hands randomly between players
      const hands = room.players.map(p => [...p.hand]);
      shuffle(hands);
      room.players.forEach((p, i) => {
        p.hand = hands[i];
        gameNs.to(p.socketId).emit('haveCard', p.hand);
      });
      room.reactionHolder = null;
      const player = room.players.find(p => p.userId === userId);
      gameNs.to(roomCode).emit('reactionFired', { playerName: player?.name || '?' });
    });

    // ── request-rematch ──────────────────────────────────────────────────────
    socket.on('request-rematch', ({ roomCode }) => {
      const room = gameRooms[roomCode];
      if (!room || room.started) return;
      const requester = room.players.find(p => p.userId === userId);
      if (!requester) return;

      if (!room.rematchVotes) room.rematchVotes = new Set();
      room.rematchVotes.add(userId);

      gameNs.to(roomCode).emit('rematch-requested', { byName: requester.name, byUserId: userId });

      const connected = room.players.filter(p => p.connected);
      if (connected.every(p => room.rematchVotes.has(p.userId))) {
        room.rematchVotes = null;
        _doRematch(room, roomCode);
      }
    });

    // ── accept-rematch ───────────────────────────────────────────────────────
    socket.on('accept-rematch', ({ roomCode }) => {
      const room = gameRooms[roomCode];
      if (!room || room.started || !room.rematchVotes) return;
      const player = room.players.find(p => p.userId === userId);
      if (!player) return;

      room.rematchVotes.add(userId);
      gameNs.to(roomCode).emit('rematch-accepted', { byName: player.name, byUserId: userId });

      const connected = room.players.filter(p => p.connected);
      if (connected.every(p => room.rematchVotes.has(p.userId))) {
        room.rematchVotes = null;
        _doRematch(room, roomCode);
      }
    });

    // ── decline-rematch ──────────────────────────────────────────────────────
    socket.on('decline-rematch', ({ roomCode }) => {
      const room = gameRooms[roomCode];
      if (!room || room.started) return;
      const player = room.players.find(p => p.userId === userId);
      if (!player) return;

      room.rematchVotes = null;
      gameNs.to(roomCode).emit('rematch-declined', { byName: player.name });
    });

    // ── chat-msg ─────────────────────────────────────────────────────────────
    socket.on('chat-msg', ({ roomCode, text }) => {
      const room = gameRooms[roomCode];
      if (!room) return;
      const player = room.players.find(p => p.socketId === socket.id);
      if (!player) return;
      const clean = String(text).trim().slice(0, 200);
      if (!clean) return;
      gameNs.to(roomCode).emit('chat-msg', { name: player.name, text: clean });
    });

    // ── qemy:signal (voice chat WebRTC relay) ────────────────────────────────
    socket.on('qemy:signal', ({ targetUserId, type, data }) => {
      for (const room of Object.values(gameRooms)) {
        if (!room.players.some(p => p.socketId === socket.id)) continue;
        const target = room.players.find(p => p.userId === targetUserId);
        if (!target) return;
        gameNs.to(target.socketId).emit('qemy:signal', { senderUserId: socket.userId, type, data });
        return;
      }
    });

    // ── qemy:voice-ready (mic enabled — triggers initiator to re-offer) ──────
    socket.on('qemy:voice-ready', () => {
      for (const room of Object.values(gameRooms)) {
        if (!room.players.some(p => p.socketId === socket.id)) continue;
        room.players.forEach(p => {
          if (p.socketId !== socket.id) {
            gameNs.to(p.socketId).emit('qemy:voice-ready', { senderUserId: userId });
          }
        });
        return;
      }
    });

    // ── disconnect ───────────────────────────────────────────────────────────
    socket.on('disconnecting', () => {
      for (const roomCode of socket.rooms) {
        if (roomCode === socket.id) continue;
        const room = gameRooms[roomCode];
        if (!room) continue;
        const player = room.players.find(p => p.socketId === socket.id);
        if (!player) continue;

        player.connected = false;
        if (room.rematchVotes) {
          room.rematchVotes = null;
          gameNs.to(roomCode).emit('rematch-declined', { byName: player.name });
        }
        gameNs.to(roomCode).emit('playerDisconnect', { playerName: player.name });

        // 60s reconnect window
        dcTimers[userId] = setTimeout(() => {
          delete dcTimers[userId];
          // If game running and nobody connected, clean up
          const alive = room.players.filter(p => p.connected).length;
          if (room.started && alive < 1) {
            supabase.from('game_rooms').update({ status: 'finished' }).eq('room_code', roomCode).then(() => {});
            delete gameRooms[roomCode];
          } else if (room.started) {
            gameNs.to(roomCode).emit('playerTimeout', { playerName: player.name });
          }
        }, 60000);
      }
    });
  });

  // ── Game helpers ───────────────────────────────────────────────────────────

  async function _startGame(roomCode) {
    const room = gameRooms[roomCode];
    if (!room || room.started || room.players.length < 2) return;
    room.started = true;

    // Update DB status
    await supabase.from('game_rooms').update({ status: 'playing' }).eq('room_code', roomCode);

    // Cancel all pending invites for this room and notify invitees
    try {
      const { data: pending } = await supabase.from('game_invites')
        .select('to_user_id').eq('room_code', roomCode).eq('status', 'pending');
      if (pending?.length) {
        await supabase.from('game_invites').update({ status: 'cancelled' })
          .eq('room_code', roomCode).eq('status', 'pending');
        pending.forEach(inv => notifyDefault(inv.to_user_id, 'game-invite-cancelled', { roomCode }));
      }
    } catch (_) {}

    // Fresh deck
    const deck = [...baseDeck];
    shuffle(deck);
    room.deck = deck;

    // Deal 8 cards each
    room.players.forEach(p => { p.hand = []; });
    for (let i = 0; i < room.players.length * 8; i++) {
      room.players[i % room.players.length].hand.push(drawFromDeck(room));
    }

    // Pick a non-black starting card (bounded to prevent infinite loop)
    let startCard;
    let startTries = 0;
    do {
      startCard = drawFromDeck(room);
      startTries++;
    } while (cardColor(startCard) === 'black' && startTries < 20);
    // If still black after 20 tries, force a red zero as fallback
    if (cardColor(startCard) === 'black') startCard = 0;
    room.cardOnBoard = startCard;
    room.activeColor = cardColor(startCard);
    room.turn        = 0;
    room.reverse     = false;

    // Assign reaction button to random player
    const reactionIdx   = Math.floor(Math.random() * room.players.length);
    room.reactionHolder = room.players[reactionIdx].userId;

    // Send each player their hand + reaction status
    room.players.forEach(p => {
      gameNs.to(p.socketId).emit('haveCard', p.hand);
      gameNs.to(p.socketId).emit('reactionButton', {
        hasButton:       room.reactionHolder === p.userId,
        holderUserId:    room.reactionHolder
      });
    });

    // Broadcast game start
    gameNs.to(roomCode).emit('gameStart', {
      players: room.players.map((p, i) => ({
        name: p.name, userId: p.userId, handSize: p.hand.length, index: i
      })),
      cardOnBoard:       room.cardOnBoard,
      activeColor:       room.activeColor,
      currentTurnUserId: room.players[room.turn].userId,
      reactionHolderUserId: room.reactionHolder
    });

    // Emit initial turn
    gameNs.to(roomCode).emit('turnChanged', {
      currentTurnUserId: room.players[room.turn].userId,
      playerName:        room.players[room.turn].name,
      playerIndex:       room.turn
    });
  }

  function _advanceTurn(room, roomCode) {
    // Guard: if no players are connected at all, do not emit a turn event
    const anyConnected = room.players.some(p => p.connected);
    if (!anyConnected) return;

    // Skip disconnected players (bounded by player count to prevent infinite loop)
    let tries = 0;
    do {
      room.turn = nextIdx(room);
      tries++;
    } while (!room.players[room.turn].connected && tries < room.players.length);

    gameNs.to(roomCode).emit('turnChanged', {
      currentTurnUserId: room.players[room.turn].userId,
      playerName:        room.players[room.turn].name,
      playerIndex:       room.turn
    });
  }

  function _forceDraw(room, roomCode, count) {
    const ni = nextIdx(room);
    const np = room.players[ni];
    for (let i = 0; i < count; i++) np.hand.push(drawFromDeck(room));
    gameNs.to(np.socketId).emit('haveCard', np.hand);
    // Include playerIndex so clients can update the victim's displayed hand size
    gameNs.to(roomCode).emit('forceDraw', { playerName: np.name, count, playerIndex: ni });
    // Advance past the victim in one step: set turn to victim first, then advance
    // once more — but emit turnChanged only for the final destination, not for the
    // intermediate victim position.
    room.turn = ni;                    // point at victim silently (no emit)
    _advanceTurn(room, roomCode);      // advance past victim and emit once
  }

  function _doRematch(room, roomCode) {
    // Cancel any pending post-win cleanup so the room isn't deleted mid-rematch
    if (room.cleanupTimer) { clearTimeout(room.cleanupTimer); room.cleanupTimer = null; }
    room.started = true;
    const deck = [...baseDeck];
    shuffle(deck);
    room.deck = deck;

    room.players.forEach(p => { p.hand = []; });
    for (let i = 0; i < room.players.length * 8; i++) {
      room.players[i % room.players.length].hand.push(drawFromDeck(room));
    }

    let startCard;
    let tries = 0;
    do { startCard = drawFromDeck(room); tries++; }
    while (cardColor(startCard) === 'black' && tries < 20);
    if (cardColor(startCard) === 'black') startCard = 0;

    room.cardOnBoard  = startCard;
    room.activeColor  = cardColor(startCard);
    room.turn         = 0;
    room.reverse      = false;

    const reactionIdx   = Math.floor(Math.random() * room.players.length);
    room.reactionHolder = room.players[reactionIdx].userId;

    room.players.forEach(p => {
      gameNs.to(p.socketId).emit('haveCard', p.hand);
      gameNs.to(p.socketId).emit('reactionButton', {
        hasButton: room.reactionHolder === p.userId,
        holderUserId: room.reactionHolder
      });
    });

    gameNs.to(roomCode).emit('gameStart', {
      players: room.players.map((p, i) => ({
        name: p.name, userId: p.userId, handSize: p.hand.length, index: i
      })),
      cardOnBoard:          room.cardOnBoard,
      activeColor:          room.activeColor,
      currentTurnUserId:    room.players[room.turn].userId,
      reactionHolderUserId: room.reactionHolder
    });
  }

  async function _handleWin(roomCode, winner) {
    const room = gameRooms[roomCode];
    if (!room) return;
    room.started = false;

    gameNs.to(roomCode).emit('gameOver', {
      winnerName:   winner.name,
      winnerUserId: winner.userId
    });

    // Persist to game_history (best-effort — don't crash on DB error)
    try {
      const playerIds   = room.players.map(p => p.userId);
      const playerNames = room.players.map(p => p.name);
      await supabase.from('game_history').insert([{
        room_code:    roomCode,
        winner_id:    winner.userId,
        winner_name:  winner.name,
        player_ids:   playerIds,
        player_names: playerNames
      }]);

      await supabase.rpc('increment_game_wins', { uid: winner.userId });
      awardPoints(winner.userId, 'qemy_win').catch(() => {});

      // Weekly task: qemy_wins_2
      if (typeof updateTaskProgress === 'function') {
        updateTaskProgress(winner.userId, 'qemy_wins_2').catch(() => {});
      }
      // Check badge unlocks after win (qemy_master at 20 wins)
      if (typeof checkAndAwardBadges === 'function') {
        checkAndAwardBadges(winner.userId).catch(() => {});
      }
    } catch (_) {}

    await supabase.from('game_rooms').update({ status: 'finished' }).eq('room_code', roomCode);

    // Clean up memory after 5 minutes — handle stored so rematch can cancel it
    if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
    room.cleanupTimer = setTimeout(() => { delete gameRooms[roomCode]; }, 5 * 60 * 1000);
  }

  // ── Snapshot helpers ───────────────────────────────────────────────────────

  function _stateSnapshot(room, player) {
    return {
      roomCode:             room.code,
      players:              room.players.map((p, i) => ({ name: p.name, userId: p.userId, handSize: p.hand.length, index: i })),
      cardOnBoard:          room.cardOnBoard,
      activeColor:          room.activeColor,
      currentTurnUserId:    room.players[room.turn].userId,
      reactionHolderUserId: room.reactionHolder,
      myIndex:              room.players.indexOf(player)
    };
  }

  function _lobbyPayload(room, player) {
    return {
      roomCode:    room.code,
      playerIndex: room.players.indexOf(player),
      players:     room.players.map(p => ({ name: p.name, userId: p.userId })),
      maxPlayers:  room.maxPlayers,
      hostId:      room.hostId
    };
  }

  function _lobbyUpdate(room) {
    return {
      players:    room.players.map(p => ({ name: p.name, userId: p.userId })),
      maxPlayers: room.maxPlayers,
      hostId:     room.hostId,
      roomCode:   room.code
    };
  }

  // ── Public API (called from server.js) ────────────────────────────────────

  function genRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = crypto.randomBytes(8);
    return Array.from(bytes, b => chars[b % chars.length]).join('');
  }

  return {
    genRoomCode,

    createGameRoom(roomCode, hostId, maxPlayers) {
      gameRooms[roomCode] = {
        code:           roomCode,
        hostId,
        maxPlayers:     Math.min(4, Math.max(2, maxPlayers || 4)),
        players:        [],
        deck:           [],
        cardOnBoard:    null,
        activeColor:    null,
        turn:           0,
        reverse:        false,
        started:        false,
        reactionHolder: null
      };
    },

    getOpenRooms() {
      return Object.values(gameRooms)
        .filter(r => !r.started)
        .map(r => ({
          roomCode:    r.code,
          hostId:      r.hostId,
          playerCount: r.players.length,
          maxPlayers:  r.maxPlayers,
          players:     r.players.map(p => ({ name: p.name, userId: p.userId }))
        }));
    }
  };
};
