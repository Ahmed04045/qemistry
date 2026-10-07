let socket, pc;
let localStream  = null;
let currentRoom  = null;
let micOn = true, camOn = true;
let currentPeerId   = null;
let currentPeerName = null;
let chatStart = null;
let totalChatSeconds = 0;
let guestChatStart = null;
let lastSavedPeerId = null;
const GUEST_LIMIT_MS = 15 * 60 * 1000;
let guestInterval = null;
let guestDisplayInterval = null;
let pendingCandidates = [];

function resetPeerLabel() {
  const lbl = document.getElementById('peer-label');
  if (!lbl) return;
  lbl.setAttribute('data-t', 'label-stranger');
  lbl.textContent = t('label-stranger');
}

function connectSocket() {
  if (socket && socket.connected) return;
  // Explicitly destroy old socket to prevent auto-reconnect racing a new connection
  if (socket) { socket.disconnect(); socket = null; }

  socket = io(SERVER_URL);

  socket.on('connect', () => {
    showToast(getCurrentLang() === 'ar' ? '✅ متصل بالسيرفر' : '✅ Connected!');
    socket.emit('join', {
      username,
      interests: getSelectedInterests(),
      qatarOnly: document.getElementById('filter-qatar')?.checked ?? true,
      token: localStorage.getItem('qc_token') || null
    });
    socket.emit('find-match');
  });
socket.on('new-message', ({ from, content }) => {
  if (currentChatFriend?.id === from) {
    loadChatMessages(from);
  } else {
    unreadCounts[from] = (unreadCounts[from] || 0) + 1;
    updateChatBtnBadge();
    showToast('💬 رسالة جديدة!');
  }
});
  socket.on('online-count', n => {
    document.getElementById('online-num').textContent  = n;
    document.getElementById('stat-online').textContent = n;
  });

  socket.on('waiting', () => {
    if (getCurrentLang() === 'ar') {
      setStrangerStatus('🔍', 'في قائمة الانتظار...', 'نبحث عن مطابقة');
    } else {
      setStrangerStatus('🔍', 'Waiting for a match...', 'Searching');
    }
  });

  socket.on('matched', async ({ roomId, initiator, peerId, peerName }) => {
    if (!currentUser) {
      guestChatStart = Date.now();
      clearInterval(guestInterval);
      guestInterval = setInterval(() => {
        const used = parseInt(localStorage.getItem('qc_guest_time') || '0');
        const current = Date.now() - guestChatStart;
        if (used + current >= GUEST_LIMIT_MS) {
          clearInterval(guestInterval);
          guestInterval = null;
          showToast('⚠️ انتهت مدة التجربة — سجل حساباً للمتابعة');
          leaveChat();
          showPage('auth');
        }
      }, 60000);
    }
    currentRoom     = roomId;
    currentPeerId   = peerId   || null;
    currentPeerName = peerName || 'ضيف';
    chatStart = Date.now();
    lastSavedPeerId = null;
    setStrangerStatus('⚡', 'تم الإيجاد! جاري الاتصال...');
    const peerLabel = document.getElementById('peer-label');
    if (peerLabel && peerName) {
      peerLabel.removeAttribute('data-t');
      peerLabel.textContent = peerName;
    }
    await setupPeerConnection(initiator);
  });

  socket.on('signal', async ({ data }) => {
    if (!pc) return;
    try {
      if (data.type === 'offer') {
        await pc.setRemoteDescription(new RTCSessionDescription(data));
        for (const candidate of pendingCandidates) {
          await pc.addIceCandidate(candidate);
        }
        pendingCandidates = [];
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('signal', { roomId: currentRoom, data: answer });
      } else if (data.type === 'answer') {
        await pc.setRemoteDescription(new RTCSessionDescription(data));
        for (const candidate of pendingCandidates) {
          await pc.addIceCandidate(candidate);
        }
        pendingCandidates = [];
      } else if (data.candidate) {
        if (!pc.remoteDescription) {
          pendingCandidates.push(new RTCIceCandidate(data));
        } else {
          await pc.addIceCandidate(new RTCIceCandidate(data));
        }
      }
    } catch (err) {
      console.error('[signal] WebRTC error:', err);
      showToast('⚠️ خطأ في الاتصال — حاول مجدداً');
    }
  });

  socket.on('peer-left', () => {
    showToast('👋 غادر الشخص المحادثة');
    setStrangerStatus('👋', 'غادر الشخص...', 'اضغط "التالي" لإيجاد شخص آخر');
    const rv = document.getElementById('remoteVideo');
    rv.closest('.video-box')?.classList.remove('connected');
    rv.style.display = 'none';
    document.getElementById('stranger-placeholder').style.display = 'flex';
    resetPeerLabel();
    currentRoom     = null;
    currentPeerId   = null;
    currentPeerName = null;
    closePC();
  });

socket.on('chat-msg', ({ text }) => {
  appendMsg(text, 'them');
  appendMsgMobile(text, 'them');
});

  socket.on('already-in-chat', () => {
    showToast('⚠️ حسابك مستخدم في محادثة أخرى');
    leaveChat();
  });

  socket.on('banned', () => {
    showToast('⚠️ تم حظر حسابك');
    setTimeout(() => logout(), 2000);
  });

  socket.on('friend-request-notification', ({ fromUsername }) => {
    showToast(`👥 ${fromUsername} أرسل لك طلب صداقة!`);
  });

  socket.on('connect_error', (err) => {
    showToast(getCurrentLang() === 'ar' ? '⚠️ تعذّر الاتصال بالسيرفر — حاول مجدداً' : '⚠️ Could not connect — retrying...');
    console.error('[socket] connect_error', err.message);
  });

  socket.on('disconnect', () => showToast(getCurrentLang() === 'ar' ? '⚠️ انقطع الاتصال بالسيرفر' : '⚠️ Disconnected'));
}

async function setupPeerConnection(initiator) {
  closePC();

  // If camera permission dialog is still open, wait up to 15s for the user to respond
  if (window._cameraPromise) {
    await Promise.race([
      window._cameraPromise,
      new Promise(resolve => setTimeout(resolve, 15000))
    ]);
  }

  // Wait for TURN credentials — critical on mobile (carrier NAT); cap at 3s so we don't stall forever
  if (window._iceConfigReady) {
    await Promise.race([window._iceConfigReady, new Promise(resolve => setTimeout(resolve, 3000))]);
  }
  const iceConfig = window._cachedIceConfig || { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
  pc = new RTCPeerConnection(iceConfig);

  // Always re-enable tracks and reset UI — mute state from a previous call must not carry over
  if (localStream) {
    micOn = true; camOn = true;
    const micBtn = document.getElementById('micBtn');
    const camBtn = document.getElementById('camBtn');
    if (micBtn) { micBtn.textContent = '🎤'; micBtn.classList.remove('active'); }
    if (camBtn) { camBtn.textContent = '📷'; camBtn.classList.remove('active'); }
    localStream.getTracks().forEach(t => { t.enabled = true; pc.addTrack(t, localStream); });
  }

  // Mobile Safari fires ontrack without e.streams — build the stream manually
  pc.ontrack = e => {
    const rv = document.getElementById('remoteVideo');
    if (e.streams && e.streams[0]) {
      rv.srcObject = e.streams[0];
    } else {
      if (!rv.srcObject) rv.srcObject = new MediaStream();
      rv.srcObject.addTrack(e.track);
    }
    // iOS Safari won't autoplay unmuted video without an explicit .play() call
    rv.play().catch(() => {});
    rv.style.display = 'block';
    document.getElementById('stranger-placeholder').style.display = 'none';
    rv.closest('.video-box')?.classList.add('connected');
    showToast('🟢 متصل!');
  };

  pc.onicecandidate = e => { if (e.candidate) socket.emit('signal', { roomId: currentRoom, data: e.candidate }); };
  pc.onconnectionstatechange = () => {
    if (!pc) return;
    if (pc.connectionState === 'failed') {
      showToast('⚠️ فشل الاتصال — اضغط "التالي" للمحاولة مجدداً');
    } else if (pc.connectionState === 'disconnected') {
      showToast('⚠️ انقطع الاتصال — تحقق من الشبكة');
    }
  };
  if (initiator) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('signal', { roomId: currentRoom, data: offer });
  }
}

function closePC() {
  pendingCandidates = [];
  if (pc) { pc.close(); pc = null; }
}

async function startCamera() {
  const constraints = [
    { video: true, audio: true },
    { video: false, audio: true },
    { video: true, audio: false },
  ];
  for (const c of constraints) {
    try {
      localStream = await navigator.mediaDevices.getUserMedia(c);
      const lv = document.getElementById('localVideo');
      if (localStream.getVideoTracks().length) {
        lv.srcObject = localStream; lv.style.display = 'block';
        document.getElementById('local-placeholder').style.display = 'none';
      }
      if (!localStream.getAudioTracks().length) {
        showToast('⚠️ المايك غير متاح — تحقق من صلاحيات المتصفح');
      }
      return;
    } catch (_) {}
  }
  showToast('⚠️ تعذّر الوصول للكاميرا والمايك — تحقق من صلاحيات المتصفح');
  localStream = null;
}

function toggleMic() {
  micOn = !micOn;
  localStream?.getAudioTracks().forEach(t => t.enabled = micOn);
  const btn = document.getElementById('micBtn');
  btn.textContent = micOn ? '🎤' : '🔇';
  btn.classList.toggle('active', !micOn);
}

function toggleCam() {
  camOn = !camOn;
  localStream?.getVideoTracks().forEach(t => t.enabled = camOn);
  const btn = document.getElementById('camBtn');
  btn.textContent = camOn ? '📷' : '🚫';
  btn.classList.toggle('active', !camOn);
}

async function startChat() {
  const friendsBtn = document.getElementById('friends-chat-btn');
  if (friendsBtn) friendsBtn.style.display = 'none';

  if (!currentUser) {
    // Intercept guest if they haven't accepted terms
    if (!localStorage.getItem('qc_guest_terms')) {
      window._pendingGuestChat = true; // Remember they wanted to chat
      document.getElementById('tcOverlay').classList.add('open');
      return; // Stop the chat from starting
    }

    const guestUsed = parseInt(localStorage.getItem('qc_guest_time') || '0');
    if (guestUsed >= GUEST_LIMIT_MS) {
      showToast('⚠️ انتهت مدة التجربة — سجل حساباً للمتابعة');
      showPage('auth');
      return;
    }
    const savedStart = localStorage.getItem('qc_guest_start');
    guestChatStart = savedStart ? parseInt(savedStart) : Date.now();
    if (!savedStart) localStorage.setItem('qc_guest_start', guestChatStart);
    const timerEl = document.getElementById('guest-timer');
    if (timerEl) {
      timerEl.style.display = 'block';
      clearInterval(guestDisplayInterval);
      guestDisplayInterval = setInterval(() => {
        const used = parseInt(localStorage.getItem('qc_guest_time') || '0');
        const current = Date.now() - guestChatStart;
        const remaining = GUEST_LIMIT_MS - used - current;
        if (remaining <= 0) { timerEl.textContent = '⏰ انتهى الوقت'; return; }
        const mins = Math.floor(remaining / 60000);
        const secs = Math.floor((remaining % 60000) / 1000);
        timerEl.textContent = `⏰ ${mins}:${secs.toString().padStart(2,'0')}`;
      }, 1000);
    }
  }

  if (window.innerWidth <= 700) {
    const btn = document.getElementById('chat-toggle-btn');
    if (btn) btn.style.display = 'flex';
  }

  showPage('chat');

  // Fetch ICE config immediately (fast, no user interaction needed)
  window._iceConfigReady = fetch(`${SERVER_URL}/api/ice-config`)
    .then(r => r.json())
    .then(cfg => { window._cachedIceConfig = cfg; })
    .catch(() => { window._cachedIceConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }; });

  // Start camera — runs in background, setupPeerConnection will wait for it
  window._cameraPromise = startCamera().finally(() => { window._cameraPromise = null; });

  // Connect socket immediately — don't wait for camera permission dialog
  connectSocket();
}

async function leaveChat() {
  const friendsBtn = document.getElementById('friends-chat-btn');
if (friendsBtn) friendsBtn.style.display = 'flex';
  if (!currentUser && guestChatStart) {
    const used = parseInt(localStorage.getItem('qc_guest_time') || '0');
    localStorage.setItem('qc_guest_time', used + (Date.now() - guestChatStart));
    localStorage.removeItem('qc_guest_start');
    guestChatStart = null;
  }
  if (chatStart) {
    totalChatSeconds += Math.floor((Date.now() - chatStart) / 1000);
    chatStart = null;
  }
  if (currentUser && currentPeerId && currentPeerId !== lastSavedPeerId) {
    lastSavedPeerId = currentPeerId;
    await fetch(`${SERVER_URL}/save-chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'authorization': `Bearer ${authToken}` },
      body: JSON.stringify({
        userId:   currentUser.id,
        peerId:   currentPeerId   || null,
        peerName: currentPeerName || 'ضيف',
        chatSeconds: totalChatSeconds
      })
    });
    totalChatSeconds = 0;
  }
  clearInterval(guestInterval);
  guestInterval = null;
  clearInterval(guestDisplayInterval);
  guestDisplayInterval = null;
  closePC();
  localStream?.getTracks().forEach(t => t.stop());
  localStream = null;
  const localVideo = document.getElementById('localVideo');
  if (localVideo) {
    localVideo.srcObject = null;
    localVideo.style.display = 'none';
  }
  document.getElementById('local-placeholder')?.style && (document.getElementById('local-placeholder').style.display = 'flex');
  const remoteVideo = document.getElementById('remoteVideo');
  if (remoteVideo) {
    remoteVideo.srcObject = null;
    remoteVideo.style.display = 'none';
    remoteVideo.closest('.video-box')?.classList.remove('connected');
  }
  document.getElementById('stranger-placeholder')?.style && (document.getElementById('stranger-placeholder').style.display = 'flex');
  resetPeerLabel();
  socket?.disconnect();
  socket = null;
  currentRoom     = null;
  currentPeerId   = null;
  currentPeerName = null;
  const btn = document.getElementById('chat-toggle-btn');
if (btn) btn.style.display = 'none';
  showPage('landing');
}

async function nextStranger() {
  if (!currentUser && guestChatStart) {
    const used = parseInt(localStorage.getItem('qc_guest_time') || '0');
    localStorage.setItem('qc_guest_time', used + (Date.now() - guestChatStart));
    localStorage.removeItem('qc_guest_start');
    guestChatStart = null;
  }
  if (chatStart) {
    totalChatSeconds += Math.floor((Date.now() - chatStart) / 1000);
    chatStart = null;
  }
  if (currentUser && currentPeerId && currentPeerId !== lastSavedPeerId) {
    lastSavedPeerId = currentPeerId;
    await fetch(`${SERVER_URL}/save-chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'authorization': `Bearer ${authToken}` },
      body: JSON.stringify({
        userId:   currentUser.id,
        peerId:   currentPeerId || null,
        peerName: currentPeerName || 'ضيف',
        chatSeconds: totalChatSeconds
      })
    });
    totalChatSeconds = 0;
  }
  clearInterval(guestInterval);
  guestInterval = null;
  clearInterval(guestDisplayInterval);
  guestDisplayInterval = null;
  document.getElementById('messages').innerHTML = '';
  const mobileMessages = document.getElementById('messages-mobile');
  if (mobileMessages) mobileMessages.innerHTML = '';
  const rvNext = document.getElementById('remoteVideo');
  rvNext.closest('.video-box')?.classList.remove('connected');
  rvNext.style.display = 'none';
  document.getElementById('stranger-placeholder').style.display = 'flex';
  resetPeerLabel();
  setStrangerStatus('🔍', 'جاري البحث...');
  closePC();
  socket?.emit('next', { roomId: currentRoom });
  currentRoom = null;
}

function sendMsg() {
  const inp  = document.getElementById('msgInput');
  const text = inp.value.trim();
  if (!text || !currentRoom) return;
  socket?.emit('chat-msg', { roomId: currentRoom, text });
  appendMsg(text, 'me');
  appendMsgMobile(text, 'me');
  inp.value = '';
}

function appendMsg(text, side) {
  const msgs = document.getElementById('messages');
  const div  = document.createElement('div');
  div.className = 'msg ' + side; div.textContent = text;
  msgs.appendChild(div); msgs.scrollTop = msgs.scrollHeight;
}

function openReport()  { document.getElementById('reportOverlay').classList.add('open'); }
function closeReport() { document.getElementById('reportOverlay').classList.remove('open'); }

function submitReport(reason) {
  socket?.emit('report', { roomId: currentRoom, reason });
  closeReport(); showToast('✅ تم إرسال البلاغ'); nextStranger();
}

// Build status DOM safely without innerHTML to prevent any future XSS risk
function setStrangerStatus(icon, mainText, subText) {
  const statusEl = document.getElementById('stranger-status');
  if (!statusEl) return;
  statusEl.textContent = '';
  const main = document.createElement('span');
  main.textContent = mainText;
  statusEl.appendChild(main);
  if (subText) {
    statusEl.appendChild(document.createElement('br'));
    const sub = document.createElement('span');
    sub.style.fontSize = '11px';
    sub.style.color = 'var(--text3)';
    sub.textContent = subText;
    statusEl.appendChild(sub);
  }
}
function toggleMobileChat() {
  const overlay = document.getElementById('chat-mobile-overlay');
  overlay.classList.toggle('open');
}

function sendMsgMobile() {
  const inp  = document.getElementById('msgInput-mobile');
  const text = inp.value.trim();
  if (!text || !currentRoom) return;
  socket?.emit('chat-msg', { roomId: currentRoom, text });
  appendMsgMobile(text, 'me');
  appendMsg(text, 'me');
  inp.value = '';
}

function appendMsgMobile(text, side) {
  const msgs = document.getElementById('messages-mobile');
  if (!msgs) return;
  const div = document.createElement('div');
  div.className = 'msg ' + side; div.textContent = text;
  msgs.appendChild(div); msgs.scrollTop = msgs.scrollHeight;
}
