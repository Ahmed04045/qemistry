const SERVER_URL = window.SERVER_URL;
const ICE_SERVERS = null; // يتحمل من السيرفر عند الاتصال

let username     = 'ضيف';
let currentUser  = null;
let authToken    = null;
let sessionStart = null;
let totalSeconds = 0;

window.addEventListener('load', () => {
  const savedUser = localStorage.getItem('qc_currentUser');
  if (savedUser) {
    currentUser  = JSON.parse(savedUser);
    username     = currentUser.username;
    sessionStart = Date.now();
    authToken    = localStorage.getItem('qc_token');
    updateLandingState();
    // Check if an existing logged-in user needs to accept terms
  if (currentUser && currentUser.terms_accepted === false) {
    document.getElementById('tcOverlay').classList.add('open');
  }
  }
  if (currentUser) loadUnreadCounts();
// اتصال للإشعارات
if (currentUser) initNotifSocket();
  const hash = window.location.hash.replace('#', '');
  if (hash && ['landing', 'auth', 'interests', 'dashboard', 'verify'].includes(hash)) {
    showPage(hash);
  } else {
    history.replaceState({ page: 'landing' }, '', '#landing');
  }

  // Back/forward browser navigation
  window.addEventListener('popstate', (e) => {
    const page = e.state?.page || window.location.hash.replace('#', '');
    if (page && ['landing', 'auth', 'interests', 'dashboard', 'verify'].includes(page)) {
      showPage(page);
    }
  });

  // تحقق من الحظر كل 30 ثانية
  setInterval(async () => {
    if (!currentUser || !authToken) return;
    const res  = await fetch(`${SERVER_URL}/api/profile/${currentUser.id}`);
    const data = await res.json();
    if (!data.ok || data.user?.is_banned) {
      showToast('⚠️ تم حظر حسابك');
      setTimeout(() => logout(), 2000);
    }
  }, 30000);
});


function updateLandingState() {
  const actions       = document.getElementById('landing-actions');
  const loggedIn      = document.getElementById('landing-loggedin');
  const landingAvatar = document.getElementById('landing-avatar');
  if (currentUser) {
    actions.style.setProperty('display', 'none', 'important');
    loggedIn.style.setProperty('display', 'flex', 'important');
    loggedIn.style.flexDirection = 'column';
    loggedIn.style.alignItems    = 'center';
    loggedIn.style.gap           = '14px';
    const w = document.getElementById('landing-welcome');
    if (w) w.textContent = t('toast-welcome') + currentUser.username + '!';
    if (currentUser.avatar_url && currentUser.avatar_url.startsWith('http')) {
      const _img = document.createElement('img');
      _img.src = currentUser.avatar_url;
      _img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%;';
      landingAvatar.innerHTML = '';
      landingAvatar.appendChild(_img);
    } else {
      landingAvatar.innerHTML = '😊';
    }
  } else {
    actions.style.setProperty('display', 'flex', 'important');
    loggedIn.style.setProperty('display', 'none', 'important');
  }
}

function showPage(id) {
  if (id === 'dashboard' && !currentUser) return showPage('auth');
  if (id !== 'verify' && id !== 'auth' && id !== 'landing' && currentUser && !currentUser.email_verified) {
    return showPage('verify');
  }
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + id).classList.add('active');
  const gNav = document.querySelector('.g-nav');
  if (gNav) gNav.style.display = (id === 'landing' || id === 'auth' || id === 'verify') ? 'none' : '';
  if (id === 'dashboard') loadDashboard();
  if (id === 'landing')   updateLandingState();
  if (id === 'verify')    startVerifyCheck();
  history.pushState({ page: id }, '', '#' + id);
}

function setLoading(btnId, loading, originalText) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled = loading;
  btn.textContent = loading ? t('toast-loading') : originalText;
}

async function fetchStats() {
  const res  = await fetch(`${SERVER_URL}/stats/${currentUser.id}`, {
    headers: { 'authorization': `Bearer ${authToken}` }
  });
  const data = await res.json();
  return { seconds: data.total_seconds || 0, chats: data.total_chats || 0 };
}

async function loadDashboard() {
  if (!currentUser) return;

  const res  = await fetch(`${SERVER_URL}/api/profile/${currentUser.id}`, {
    headers: { 'authorization': `Bearer ${authToken}` }
  });
  const data = await res.json();
  if (data.ok) {
    currentUser.bio               = data.user.bio;
    currentUser.birthdate         = data.user.birthdate;
    currentUser.hobbies           = data.user.hobbies;
    currentUser.character_type    = data.user.character_type;
    currentUser.character_is_temp = data.user.character_is_temp;
    currentUser.earned_badges     = data.user.earned_badges;
    localStorage.setItem('qc_currentUser', JSON.stringify(currentUser));

    // Show quiz nudge if user has no permanent character
    const nudge = document.getElementById('dash-quiz-nudge');
    if (nudge && (!data.user.character_type || data.user.character_is_temp)) {
      nudge.style.display = 'flex';
    }
  }
// الستريك
if (data.user?.streak_count > 0) {
  const streakBadge = document.getElementById('streak-badge');
  if (streakBadge) streakBadge.textContent = `🔥 ${data.user.streak_count}`;
}
  document.getElementById('dash-nav-username').textContent     = currentUser.username;
  updateAvatarUI(currentUser.avatar_url);
  document.getElementById('profile-display-name').textContent  = currentUser.username;
  document.getElementById('profile-display-email').textContent = currentUser.email || '—';
  document.getElementById('edit-email-display').textContent    = currentUser.email || '—';
  document.getElementById('edit-username').value               = currentUser.username;

  if (currentUser.created_at) {
    const d = new Date(currentUser.created_at);
    const lang = getCurrentLang();
    document.getElementById('profile-join-badge').textContent =
      '📅 ' + d.toLocaleDateString(lang === 'ar' ? 'ar-QA' : 'en-US', { year:'numeric', month:'long' });
  }

  if (currentUser.bio)       document.getElementById('edit-bio').value       = currentUser.bio;
  if (currentUser.birthdate) document.getElementById('edit-birthdate').value = currentUser.birthdate;
  if (currentUser.hobbies?.length) {
    document.querySelectorAll('#hobby-chips .interest-chip').forEach(chip => {
      chip.classList.remove('selected');
      if (currentUser.hobbies.includes(chip.dataset.hobby)) chip.classList.add('selected');
    });
  }

  // Display points from profile data
  const pointsEl = document.getElementById('dash-stat-points');
  if (pointsEl) pointsEl.textContent = data.user?.points || 0;

  // Daily login checkin (server deduplicates to once per day)
  if (authToken) {
    fetch(`${SERVER_URL}/api/points/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'authorization': `Bearer ${authToken}` },
      body: JSON.stringify({ action: 'daily_login' })
    }).then(r => r.json()).then(d => {
      if (d.awarded && pointsEl) pointsEl.textContent = (parseInt(pointsEl.textContent) || 0) + 5;
    }).catch(() => {});
  }

  const { seconds, chats } = await fetchStats();
  const hrs  = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
const isAr = getCurrentLang() === 'ar';
document.getElementById('dash-stat-hours').textContent = hrs > 0
  ? hrs + (isAr ? 'س ' : 'h ') + mins + (isAr ? 'د' : 'm')
  : mins + (isAr ? 'د' : 'm');document.getElementById('dash-stat-chats').textContent = chats;
  // Frames & badges
  renderEquippedFrame(data.user?.equipped_frame || 'default');
  renderDashBadges(data.user?.earned_badges || []);
  loadFramePicker(data.user || {});

  loadFriends();
  loadChatHistory();
  loadGameHistory();
  loadWeeklyTasks();
}

// ── FRAMES ──────────────────────────────────────────────
const FRAME_DEFS = [
  { id: 'default', name: 'الافتراضي',     emoji: '⚪', cond: 'متاح للجميع',          unlocked: () => true },
  { id: 'chatter', name: 'المحادث 💬',    emoji: '💬', cond: '50 محادثة فيديو',       unlocked: (u) => (u.total_chats   || 0) >= 50 },
  { id: 'social',  name: 'الاجتماعي 🤝',  emoji: '🤝', cond: '10 أصدقاء',             unlocked: (u) => (u.friend_count  || 0) >= 10 },
  { id: 'gamer',   name: 'الجيمر 🎮',     emoji: '🎮', cond: '10 انتصارات (Qemy+برا)', unlocked: (u) => ((u.game_wins || 0) + (u.imposter_rounds || 0)) >= 10 },
  { id: 'elite',   name: 'النخبة ⚡',     emoji: '⚡', cond: '500 نقطة',              unlocked: (u) => (u.points       || 0) >= 500 },
];

function _getBadgeLabel(b) {
  const key = 'badge-' + b.replace(/_/g, '-');
  return (typeof t === 'function' && t(key) !== key) ? t(key) : b;
}

function renderEquippedFrame(frame) {
  const av = document.getElementById('profile-avatar-display');
  if (av) av.dataset.frame = frame || 'default';
}

function renderDashBadges(badges) {
  const el = document.getElementById('dash-earned-badges');
  if (!el) return;
  if (!badges?.length) { el.innerHTML = ''; return; }
  el.innerHTML = badges.map(b =>
    `<span class="earned-badge" data-badge-id="${_esc(b)}">${_esc(_getBadgeLabel(b))}</span>`
  ).join('');
}

async function loadFramePicker(user) {
  const grid = document.getElementById('frames-grid');
  if (!grid) return;
  const equipped = user.equipped_frame || 'default';

  grid.innerHTML = FRAME_DEFS.map(f => {
    const isUnlocked = f.unlocked(user);
    const isEquipped = f.id === equipped;
    return `<div class="frame-item${isEquipped ? ' equipped' : ''}${isUnlocked ? '' : ' locked'}"
              onclick="${isUnlocked ? `equipFrame('${f.id}')` : ''}">
      <div class="frame-preview" data-frame="${f.id}">${f.emoji}</div>
      <div class="frame-name">${f.name}</div>
      ${isEquipped ? '<div class="frame-equipped-lbl">✓ مُفعَّل</div>'
        : isUnlocked ? '<div class="frame-cond" style="color:#22c55e">✓ مفتوح</div>'
        : `<div class="frame-cond">${_esc(f.cond)}</div>`}
    </div>`;
  }).join('');

  // Badges section
  const badgesSec = document.getElementById('earned-badges-section');
  const badgesList = document.getElementById('earned-badges-list');
  const badges = user.earned_badges || [];
  if (badgesSec && badgesList && badges.length) {
    badgesList.innerHTML = badges.map(b =>
      `<span class="earned-badge" data-badge-id="${_esc(b)}">${_esc(_getBadgeLabel(b))}</span>`
    ).join('');
    badgesSec.style.display = '';
  }
}

async function equipFrame(frameId) {
  if (!authToken) return;
  const res  = await fetch(`${SERVER_URL}/api/profile/frame`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'authorization': `Bearer ${authToken}` },
    body: JSON.stringify({ frame: frameId })
  });
  const data = await res.json();
  if (data.ok) {
    renderEquippedFrame(frameId);
    // Update grid active state
    document.querySelectorAll('.frame-item').forEach(el => {
      const isThis = el.querySelector('.frame-preview')?.dataset.frame === frameId;
      el.classList.toggle('equipped', isThis);
      const lbl = el.querySelector('.frame-equipped-lbl, .frame-cond[style*="22c55e"]');
      if (isThis && !el.classList.contains('locked')) {
        if (lbl) lbl.outerHTML = '<div class="frame-equipped-lbl">✓ مُفعَّل</div>';
      } else if (!isThis && !el.classList.contains('locked')) {
        const prev = el.querySelector('.frame-equipped-lbl');
        if (prev) prev.outerHTML = '<div class="frame-cond" style="color:#22c55e">✓ مفتوح</div>';
      }
    });
    showToast(t('toast-frame-equipped'));
  } else {
    showToast(t('toast-frame-failed'));
  }
}

async function loadWeeklyTasks() {
  if (!authToken) return;
  const el = document.getElementById('weekly-tasks-list');
  if (!el) return;
  try {
    const res  = await fetch(`${SERVER_URL}/api/weekly-tasks`, { headers: { authorization: `Bearer ${authToken}` } });
    const data = await res.json();
    if (!data.tasks || !data.tasks.length) { el.innerHTML = `<div class="empty-state">${t('wt-empty')}</div>`; return; }
    el.innerHTML = data.tasks.map(t => {
      const pct  = Math.min(100, Math.round((t.progress / t.target) * 100));
      const done = t.progress >= t.target;
      return `<div class="wt-item${done ? ' wt-done' : ''}">
        <div class="wt-top">
          <span class="wt-label">${_esc(t.label)}</span>
          <span class="wt-badge">+${t.reward} نقطة</span>
          <span class="wt-check">${done ? '✅' : '⬜'}</span>
        </div>
        <div class="wt-progress-wrap"><div class="wt-progress-bar" style="width:${pct}%"></div></div>
        <div class="wt-count">${t.progress} / ${t.target}</div>
      </div>`;
    }).join('');
  } catch (_) {
    el.innerHTML = `<div class="empty-state">${t('wt-error')}</div>`;
  }
}
async function resendVerification() {
  await sendVerification();
  showToast(t('toast-email-resent'));
}

let _verifyInterval = null;
function startVerifyCheck() {
  if (!currentUser) return showPage('auth');
  document.getElementById('verify-email-display').textContent = currentUser.email;
  if (_verifyInterval) { clearInterval(_verifyInterval); _verifyInterval = null; }
  _verifyInterval = setInterval(async () => {
    if (!currentUser) { clearInterval(_verifyInterval); _verifyInterval = null; return; }
    const res  = await fetch(`${SERVER_URL}/api/profile/${currentUser.id}`, {
      headers: { 'authorization': `Bearer ${authToken}` }
    });
    const data = await res.json();
    if (data.ok && data.user.email_verified) {
      clearInterval(_verifyInterval);
      _verifyInterval = null;
      currentUser.email_verified = true;
      localStorage.setItem('qc_currentUser', JSON.stringify(currentUser));
      showToast(t('toast-email-verified'));
      // New users go to the character quiz first; returning users go to interests
      if (!data.user.character_type || data.user.character_is_temp) {
        window.location.href = '/quiz';
      } else {
        showPage('interests');
      }
    }
  }, 3000);
}

function updateAvatarUI(url) {
  const isImg  = url && url.startsWith('http');
  const charId = currentUser?.character_type && !currentUser?.character_is_temp ? currentUser.character_type : null;
  const charSVG = (charId && window.AVATARS) ? window.AVATARS.renderSVG(charId, 80) : null;
  const fallback = charSVG || `<span id="profile-avatar-icon">😊</span>`;
  const fallbackSmall = (charId && window.AVATARS) ? window.AVATARS.renderSVG(charId, 36) : `<span id="dash-corner-icon">😊</span>`;
  const fallbackChat  = (charId && window.AVATARS) ? window.AVATARS.renderSVG(charId, 36) : `<span id="chat-avatar-icon">😊</span>`;

  const bigAvatar = document.getElementById('profile-avatar-display');
  if (bigAvatar) {
    bigAvatar.innerHTML = isImg ? `<img src="${url}" alt="avatar"/>` : fallback;
    bigAvatar.style.borderRadius = (charSVG && !isImg) ? '14px' : '';
  }

  const cornerBtn = document.getElementById('dash-corner-avatar');
  if (cornerBtn) {
    cornerBtn.innerHTML = isImg
      ? `<img src="${url}" alt="avatar" style="width:100%;height:100%;object-fit:cover;border-radius:50%;"/>`
      : fallbackSmall;
    cornerBtn.style.borderRadius = (charSVG && !isImg) ? '10px' : '';
  }

  const chatAvatarBtn = document.getElementById('chat-avatar-btn');
  if (chatAvatarBtn) {
    chatAvatarBtn.innerHTML = isImg
      ? `<img src="${url}" alt="avatar" style="width:100%;height:100%;object-fit:cover;border-radius:50%;"/>`
      : fallbackChat;
    chatAvatarBtn.style.borderRadius = (charSVG && !isImg) ? '10px' : '';
  }

  const landingAvatar = document.getElementById('landing-avatar');
  if (landingAvatar) landingAvatar.innerHTML = isImg
    ? `<img src="${url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;"/>`
    : (charId && window.AVATARS ? window.AVATARS.renderSVG(charId, 36) : '😊');
}

async function handleAvatarChange(e) {
  const file = e.target.files[0];
  if (!file || !currentUser) return;
  if (file.size > 2 * 1024 * 1024) return showToast(t('toast-img-size'));
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return showToast(t('toast-img-format'));
  showToast(t('toast-img-uploading'));
  const res  = await fetch(`${SERVER_URL}/upload-avatar`, {
    method: 'POST',
    headers: { 'Content-Type': file.type, 'x-user-id': currentUser.id, 'authorization': `Bearer ${authToken}` },
    body: file
  });
  const data = await res.json();
  if (data.ok) {
    currentUser.avatar_url = data.url;
    localStorage.setItem('qc_currentUser', JSON.stringify(currentUser));
    updateAvatarUI(data.url);
    showToast(t('toast-img-updated'));
  } else showToast(t('toast-img-failed'));
}

async function deleteAvatar() {
  if (!currentUser) return;
  if (!confirm(t('confirm-delete-photo'))) return;
  const res  = await fetch(`${SERVER_URL}/delete-avatar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'authorization': `Bearer ${authToken}` },
    body: JSON.stringify({ userId: currentUser.id })
  });
  const data = await res.json();
  if (data.ok) {
    currentUser.avatar_url = null;
    localStorage.setItem('qc_currentUser', JSON.stringify(currentUser));
    updateAvatarUI(null);
    showToast(t('toast-img-deleted'));
  } else showToast(t('toast-img-delete-failed'));
}

async function saveUsername() {
  const newName = document.getElementById('edit-username').value.trim();
  if (!newName || !currentUser) return;
  if (newName.length < 3) return showToast(t('toast-username-short'));
  if (newName.length > 20) return showToast(t('toast-username-long'));
  if (!/^[a-zA-Z0-9_\u0600-\u06FF]+$/.test(newName)) return showToast(t('toast-username-invalid'));
  const res  = await fetch(`${SERVER_URL}/update-profile`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'authorization': `Bearer ${authToken}` },
    body: JSON.stringify({ username: newName })
  });
  const data = await res.json();
  if (data.ok) {
    currentUser.username = newName; username = newName;
    localStorage.setItem('qc_currentUser', JSON.stringify(currentUser));
    document.getElementById('profile-display-name').textContent = newName;
    document.getElementById('dash-nav-username').textContent    = newName;
    showToast(t('toast-username-saved'));
  } else showToast('⚠️ ' + (data.message || 'فشل التحديث'));
}

async function savePassword() {
  const newPass = document.getElementById('edit-password').value.trim();
  if (!newPass || !currentUser) return;
  if (newPass.length < 8) return showToast(t('toast-password-short'));
  const res  = await fetch(`${SERVER_URL}/update-password`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'authorization': `Bearer ${authToken}` },
    body: JSON.stringify({ password: newPass })
  });
  const data = await res.json();
  if (data.ok) {
    document.getElementById('edit-password').value = '';
    if (data.token) { authToken = data.token; localStorage.setItem('qc_token', data.token); }
    showToast(t('toast-password-changed'));
  } else showToast('⚠️ ' + (data.message || 'فشل التغيير'));
}

function toggleHobby(el) {
  const selected = document.querySelectorAll('#hobby-chips .interest-chip.selected');
  if (!el.classList.contains('selected') && selected.length >= 3) {
    showToast(t('toast-hobbies-max'));
    return;
  }
  el.classList.toggle('selected');
}

async function saveProfileInfo() {
  if (!currentUser) return;
  const bio       = document.getElementById('edit-bio')?.value.trim() || '';
  const birthdate = document.getElementById('edit-birthdate')?.value || null;
  const hobbies   = [...document.querySelectorAll('#hobby-chips .interest-chip.selected')]
                      .map(c => c.dataset.hobby);
  const res  = await fetch(`${SERVER_URL}/update-profile-info`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'authorization': `Bearer ${authToken}` },
    body: JSON.stringify({ bio, birthdate, hobbies })
  });
  const data = await res.json();
  if (data.ok) {
    currentUser.bio       = bio;
    currentUser.birthdate = birthdate;
    currentUser.hobbies   = hobbies;
    localStorage.setItem('qc_currentUser', JSON.stringify(currentUser));
    showToast(t('toast-profile-saved'));
  } else showToast('⚠️ ' + (data.message || 'فشل الحفظ'));
}

function formatLastSeen(ts) {
  if (!ts) return 'غير متصل';
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1)  return 'غير متصل للتو';
  if (mins < 60) return `آخر ظهور قبل ${mins} دقيقة`;
  const hrs = Math.floor(mins / 60);
  if (hrs  < 24) return `آخر ظهور قبل ${hrs} ساعة`;
  return `آخر ظهور قبل ${Math.floor(hrs / 24)} يوم`;
}

async function loadFriends() {
  if (!currentUser) return;
  const res  = await fetch(`${SERVER_URL}/friends/me`, {
    headers: { 'authorization': `Bearer ${authToken}` }
  });
  const data = await res.json();
  if (data.session_expired) return handleSessionExpired();
  const friendsList = document.getElementById('friends-list');
  const reqList     = document.getElementById('friend-requests-list');
  const pending  = (data.friends || []).filter(f => f.status === 'pending' && f.friend_id === currentUser.id);
  const accepted = (data.friends || []).filter(f => f.status === 'accepted');
  document.getElementById('dash-stat-friends').textContent = accepted.length;

  reqList.innerHTML = pending.length
    ? pending.map(f => `
      <div class="friend-item">
        <div class="friend-avatar" style="cursor:pointer" onclick="window.location.href='/u/${_jesc(f.username)}'">
          ${f.avatar_url ? `<img src="${_esc(f.avatar_url)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;"/>` : '😊'}
        </div>
        <div style="flex:1">
          <div class="friend-name" style="cursor:pointer" onclick="window.location.href='/u/${_jesc(f.username)}'">${_esc(f.username || 'مستخدم')}</div>
          <div class="friend-status">${t('friend-request-pending')}</div>
        </div>
<button class="btn-sm" onclick="respondFriend('${_jesc(f.user_id)}', true)">${t('friend-accept')}</button>
<button class="btn-sm danger" style="margin-right:6px" onclick="respondFriend('${_jesc(f.user_id)}', false)">${t('friend-decline')}</button>
      </div>`).join('')
    : '<div class="empty-state">لا توجد طلبات صداقة جديدة</div>';

  friendsList.innerHTML = accepted.length
    ? accepted.map(f => {
        const otherId = f.friend_id === currentUser.id ? f.user_id : f.friend_id;
        return `
        <div class="friend-item" data-friend-id="${otherId}">
          <div class="friend-avatar" style="cursor:pointer" onclick="window.location.href='/u/${_jesc(f.username)}'">
            ${f.avatar_url ? `<img src="${_esc(f.avatar_url)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;"/>` : '😊'}
          </div>
          <div style="flex:1">
            <div class="friend-name" style="cursor:pointer" onclick="window.location.href='/u/${_jesc(f.username)}'">${_esc(f.username || 'مستخدم')}</div>
            <div class="friend-status" id="presence-${otherId}">...</div>
          </div>
<button class="friend-game-btn" title="${t('friend-challenge-title')}" onclick="challengeFriend('${_jesc(otherId)}','${_jesc(f.username || '')}')">🎮</button>
<button class="btn-sm" onclick="window.location.href='/u/${_jesc(f.username)}'">${t('friend-view-profile')}</button>
<button class="btn-sm danger" style="margin-right:6px" onclick="removeFriend('${_jesc(f.user_id)}', '${_jesc(f.friend_id)}')">${t('friend-remove')}</button>
        </div>`;
      }).join('')
    : '<div class="empty-state">لم تضف أصدقاء بعد</div>';

  // Patch presence dots onto each accepted friend card
  if (accepted.length && authToken) {
    const ids = accepted.map(f => f.friend_id === currentUser.id ? f.user_id : f.friend_id);
    try {
      const pr  = await fetch(`${SERVER_URL}/api/online-status?ids=${ids.join(',')}`, {
        headers: { authorization: `Bearer ${authToken}` }
      });
      const pd  = await pr.json();
      for (const id of ids) {
        const el = document.getElementById(`presence-${id}`);
        if (!el) continue;
        const s = pd.status?.[id];
        if (s?.online) {
          el.innerHTML = '<span class="presence-dot online"></span> متصل الآن';
        } else {
          el.innerHTML = `<span class="presence-dot offline"></span> ${formatLastSeen(s?.lastSeen)}`;
        }
      }
    } catch { /* silently leave dots as "..." if request fails */ }
  }
}

async function removeFriend(userId, friendId) {
  if (!confirm(t('confirm-remove-friend'))) return;
  await fetch(`${SERVER_URL}/friend-remove`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'authorization': `Bearer ${authToken}` },
    body: JSON.stringify({ targetId: userId === currentUser.id ? friendId : userId })
  });
  showToast(t('toast-friend-removed'));
  loadFriends();
}

async function loadChatHistory() {
  if (!currentUser) return;
  const res  = await fetch(`${SERVER_URL}/chat-history/me`, {
    headers: { 'authorization': `Bearer ${authToken}` }
  });
  const data = await res.json();
  if (data.session_expired) return handleSessionExpired();
  const list = document.getElementById('chat-history-list');
  if (!data.history?.length) {
    list.innerHTML = '<div class="empty-state">لا توجد محادثات بعد</div>';
    return;
  }
 list.innerHTML = data.history.map(h => {
    const date = new Date(h.chatted_at).toLocaleDateString('ar-QA', { year:'numeric', month:'long', day:'numeric' });
    const time = new Date(h.chatted_at).toLocaleTimeString('ar-QA', { hour:'2-digit', minute:'2-digit' });
    return `
      <div class="friend-item">
  <div class="friend-avatar" style="cursor:${h.peer_id ? 'pointer' : 'default'}"
  ${h.peer_name ? `onclick="window.location.href='/u/${_jesc(h.peer_name)}'"` : ''}>
  ${h.avatar_url ? `<img src="${_esc(h.avatar_url)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;"/>` : '😊'}
</div>
        <div style="flex:1">
          <div class="friend-name">${_esc(h.peer_name || 'ضيف')}</div>
          <div class="friend-status">${date} — ${time}</div>
        </div>
        ${h.peer_name ? `<button class="btn-sm" onclick="window.location.href='/u/${_jesc(h.peer_name)}'">${t('friend-view-profile')}</button>` : ''}
      </div>`;
  }).join('');
}

async function respondFriend(fromUserId, accept) {
  await fetch(`${SERVER_URL}/friend-respond`, {
    method:'POST', headers:{'Content-Type':'application/json', 'authorization': `Bearer ${authToken}`},
    body: JSON.stringify({ fromUserId, accept })
  });
  showToast(accept ? t('toast-request-accepted') : t('toast-request-declined'));
  loadFriends();
}

async function saveStats() {
  if (!currentUser || !sessionStart) return;
  const secs = totalChatSeconds;
  totalChatSeconds = 0;
  await fetch(`${SERVER_URL}/update-stats`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'authorization': `Bearer ${authToken}` },
    body: JSON.stringify({ userId: currentUser.id, seconds: secs })
  });
  sessionStart = Date.now();
}

async function logout() {
  await saveStats();
  if (_verifyInterval) { clearInterval(_verifyInterval); _verifyInterval = null; }
  currentUser  = null;
  username     = 'ضيف';
  sessionStart = null;
  localStorage.removeItem('qc_currentUser');
  localStorage.removeItem('qc_token');
  authToken    = null;
  updateLandingState();
  showPage('landing');
  showToast(t('toast-logged-out'));
}

async function logoutAllDevices() {
  if (!authToken) return;
  try {
    const res  = await fetch(SERVER_URL + '/logout-all', {
      method: 'POST', headers: { 'authorization': `Bearer ${authToken}` }
    });
    const data = await res.json();
    if (data.ok && data.token) {
      authToken = data.token;
      localStorage.setItem('qc_token', data.token);
      showToast('✅ ' + (getCurrentLang() === 'ar' ? 'تم تسجيل الخروج من جميع الأجهزة الأخرى' : 'Logged out of all other devices'));
    }
  } catch { showToast('⚠️ فشل الاتصال'); }
}

function handleSessionExpired() {
  showToast('⚠️ ' + (getCurrentLang() === 'ar' ? 'انتهت الجلسة — سجّل دخول مجدداً' : 'Session expired — please log in again'));
  logout();
}

function guestLogin() {
  username = 'ضيف_' + Math.floor(Math.random() * 9000 + 1000);
  showPage('interests');
}

async function savePendingCharacter(token) {
  const pending = localStorage.getItem('qc_pending_character');
  if (!pending) return;
  try {
    const res  = await fetch(SERVER_URL + '/api/quiz/result', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'authorization': `Bearer ${token}` },
      body: JSON.stringify({ character_type: pending, is_temp: false })
    });
    const data = await res.json();
    if (data.ok) localStorage.removeItem('qc_pending_character');
  } catch (_) {}
}

async function doLogin() {
  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value.trim();
  if (!email || !password) return showToast(t('toast-login-fields'));
  setLoading('btn-login', true, t('btn-login'));
  const res  = await fetch(SERVER_URL + '/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const data = await res.json();
  setLoading('btn-login', false, t('btn-login'));
  if (!data.ok) return showToast('⚠️ ' + data.message);
 currentUser  = data.user;
currentUser.email_verified = data.user.email_verified;
username     = data.user.username;
sessionStart = Date.now();
authToken    = data.token;
localStorage.setItem('qc_token', data.token);
localStorage.setItem('qc_currentUser', JSON.stringify(currentUser));
  updateLandingState();
    if (!data.user.email_verified) {
    showToast(t('toast-email-not-verified'));
    showPage('verify');
    return;
  }
await savePendingCharacter(data.token);
showToast(t('toast-welcome-back') + username + '!');
  showPage('interests');
}

async function forgotPassword() {
  const email = document.getElementById('forgot-email').value.trim();
  if (!email) return showToast(t('toast-email-required'));
  const res  = await fetch(SERVER_URL + '/forgot-password', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email })
  });
  const data = await res.json();
  showToast(t('toast-reset-sent'));
  document.getElementById('forgot-form').style.display = 'none';
}

async function doRegister() {
  const u = document.getElementById('reg-username').value.trim();
  const e = document.getElementById('reg-email').value.trim();
  const p = document.getElementById('reg-password').value.trim();

  // 1. Check Terms FIRST!
  const termsEl = document.getElementById('reg-terms');
  if (termsEl && !termsEl.checked) {
    return showToast('يجب الموافقة على الشروط والأحكام أولاً');
  }

  // 2. Standard validations
  if (!u || !e || !p) return showToast(t('toast-fields-required'));
  if (u.length < 3) return showToast(t('toast-username-short'));
  if (u.length > 20) return showToast(t('toast-username-long'));
  if (!/^[a-zA-Z0-9_\u0600-\u06FF]+$/.test(u)) return showToast(t('toast-username-invalid'));
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(e)) return showToast(t('toast-invalid-email'));
  if (p.length < 8) return showToast(t('toast-password-short'));
  if (!/[A-Z]/.test(p)) return showToast(t('toast-password-uppercase'));
  if (!/[0-9]/.test(p)) return showToast(t('toast-password-digit'));

  setLoading('btn-register', true, t('btn-register'));

  try {
    const res  = await fetch(SERVER_URL + '/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: u, email: e, password: p })
    });
    const data = await res.json();

    setLoading('btn-register', false, t('btn-register'));

    if (!data.ok) return showToast('⚠️ ' + data.message);

    currentUser  = data.user;
    username     = data.user.username;
    sessionStart = Date.now();
    authToken    = data.token;
    localStorage.setItem('qc_token', data.token);
    localStorage.setItem('qc_currentUser', JSON.stringify(currentUser));

    updateLandingState();
    await savePendingCharacter(data.token);
    showToast(t('toast-account-created'));
    showPage('verify');
    sendVerification();

  } catch (err) {
    // If the server crashes, this stops the button from spinning forever
    setLoading('btn-register', false, t('btn-register'));
    showToast('⚠️ خطأ في الاتصال بالسيرفر');
  }
}


async function sendVerification() {
  if (!currentUser || !authToken) return;
  await fetch(SERVER_URL + '/send-verification', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'authorization': `Bearer ${authToken}` },
  });
  showToast(t('toast-verify-sent'));
}

function switchTab(event, tab) {
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
  event.target.classList.add('active');
  document.getElementById('form-login').style.display    = tab === 'login'    ? 'block' : 'none';
  document.getElementById('form-register').style.display = tab === 'register' ? 'block' : 'none';
}
function toggleChip(el) { el.classList.toggle('selected'); }
function getSelectedInterests() {
  const useInterests = document.getElementById('filter-interests')?.checked;
  if (!useInterests) return [];
  return [...document.querySelectorAll('.interest-chip.selected')].map(c => c.dataset.interest);
}
function _esc(str) {
  const d = document.createElement('div');
  d.textContent = String(str || '');
  return d.innerHTML;
}
// Use _jesc() when injecting values inside JS string literals in onclick attributes.
// _esc() HTML-encodes but doesn't escape JS string delimiters (single quotes, backslashes).
function _jesc(str) {
  return String(str || '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/</g, '\\x3C')
    .replace(/>/g, '\\x3E');
}

let toastTimer;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}

applyTranslations();
document.getElementById('lang-btn-text').textContent = getCurrentLang() === 'ar' ? 'EN' : 'عر';

window.addEventListener('beforeunload', () => { saveStats(); });

let currentChatFriend = null;
let unreadCounts = {};

function initNotifSocket() {
  if (window._notifSocket) return;
  window._notifSocket = io(SERVER_URL);
  window._notifSocket.on('connect', () => {
    window._notifSocket.emit('join', {
      username: currentUser.username,
      interests: [],
      qatarOnly: false,
      token: localStorage.getItem('qc_token') || null
    });
  });
  window._notifSocket.on('online-count', n => {
    const el1 = document.getElementById('online-num');
    const el2 = document.getElementById('stat-online');
    if (el1) el1.textContent = n;
    if (el2) el2.textContent = n;
  });
  window._notifSocket.on('friend-request-notification', ({ fromUsername }) => {
    showToast(t('toast-friend-request-notif').replace('{name}', fromUsername));
  });
  window._notifSocket.on('new-message', ({ from, content }) => {
    if (currentChatFriend?.id === from) {
      const msgs = document.getElementById('friend-messages');
      if (msgs) {
        const empty = msgs.querySelector('.empty-state');
        if (empty) empty.remove();
        const div = document.createElement('div');
        div.className = 'msg them';
        div.textContent = content;
        msgs.appendChild(div);
        msgs.scrollTop = msgs.scrollHeight;
      }
    } else {
      unreadCounts[from] = (unreadCounts[from] || 0) + 1;
      updateChatBtnBadge();
      showToast(t('toast-new-message'));
    }
  });

  window._notifSocket.on('game-invite-received', (invite) => {
    showGameInviteToast(invite);
  });
  window._notifSocket.on('game-invite-cancelled', () => {
    hideGameInviteToast();
    showToast('❌ ' + t('game-invite-cancelled'));
  });
  window._notifSocket.on('game-invite-accepted', ({ byUsername, roomCode }) => {
    showToast(`✅ ${byUsername} ${t('game-invite-accepted')}`);
  });
  window._notifSocket.on('game-invite-declined', ({ byUsername }) => {
    showToast(`❌ ${byUsername} ${t('game-invite-declined')}`);
  });
}

async function openFriendsChat() {
  document.getElementById('friends-chat-overlay').classList.add('open');
  loadFriendsList();
  loadUnreadCounts();
}

function closeFriendsChat() {
  document.getElementById('friends-chat-overlay').classList.remove('open');
  currentChatFriend = null;
}

async function loadUnreadCounts() {
  if (!currentUser) return;

  // FIX: The Bouncer! Explicitly block literal string "null" and "undefined"
  if (!authToken || authToken === 'null' || authToken === 'undefined') return;

  try {
    const res = await fetch(`${SERVER_URL}/messages/unread/${currentUser.id}`, {
      headers: { 'authorization': `Bearer ${authToken}` }
    });
    
    // Safety net: If the server still says NO (like an expired token), just stop quietly.
    if (!res.ok) return; 

    const data = await res.json();
    unreadCounts = data.counts || {};
    updateChatBtnBadge();
  } catch (err) {
    console.warn("Failed to fetch unread messages:", err);
  }
}

function updateChatBtnBadge() {
  const total = Object.values(unreadCounts).reduce((a, b) => a + b, 0);
  const btn = document.getElementById('friends-chat-btn');
  if (!btn) return;
  if (total > 0) {
    btn.innerHTML = `💬<span style="position:absolute;top:-4px;right:-4px;background:#ef4444;color:#fff;border-radius:50%;width:18px;height:18px;font-size:10px;display:flex;align-items:center;justify-content:center;">${total}</span>`;
    btn.style.position = 'fixed';
  } else {
    btn.innerHTML = '💬';
  }
}

async function loadFriendsList() {
  if (!currentUser) {
    document.getElementById('friends-chat-body').innerHTML = `<div class="empty-state">${t('login-to-chat')}</div>`;
    return;
  }
  const res  = await fetch(`${SERVER_URL}/friends/me`, {
    headers: { 'authorization': `Bearer ${authToken}` }
  });
  const data = await res.json();
  const accepted = (data.friends || []).filter(f => f.status === 'accepted');
  const body = document.getElementById('friends-chat-body');
  document.getElementById('friends-chat-title').textContent = t('messages-title');

  if (!accepted.length) {
    body.innerHTML = `<div class="empty-state">${t('no-friends-for-chat')}</div>`;
    return;
  }

  body.innerHTML = accepted.map(f => {
    const otherId   = f.friend_id === currentUser.id ? f.user_id : f.friend_id;
    const unread    = unreadCounts[otherId] || 0;
    return `
      <div class="friend-chat-item" onclick="openChat('${_jesc(otherId)}', '${_jesc(f.username)}', '${_jesc(f.avatar_url || '')}')">
        <div class="friend-avatar" style="flex-shrink:0;">
          ${f.avatar_url ? `<img src="${_esc(f.avatar_url)}" style="width:38px;height:38px;border-radius:50%;object-fit:cover;"/>` : '<span style="font-size:20px;">😊</span>'}
        </div>
        <div style="flex:1;font-size:14px;font-weight:600;">${_esc(f.username)}</div>
        ${unread > 0 ? `<div class="unread-badge">${unread}</div>` : ''}
      </div>`;
  }).join('');
}

async function openChat(friendId, friendName, friendAvatar) {
  currentChatFriend = { id: friendId, name: friendName, avatar: friendAvatar };
  const gameLabel = t('challenge-label');
  document.getElementById('friends-chat-title').innerHTML = `
    <button onclick="loadFriendsList()" style="background:none;border:none;color:var(--accent);cursor:pointer;font-size:14px;">${t('back-btn')}</button>
    <span style="margin-right:8px;flex:1;">${_esc(friendName)}</span>
    <button class="chat-game-btn" onclick="challengeFriend('${_jesc(friendId)}','${_jesc(friendName)}')">${gameLabel}</button>
  `;
  const body = document.getElementById('friends-chat-body');
  body.innerHTML = `
    <div class="chat-messages-wrap" id="friend-messages"></div>
    <div class="chat-input-row">
      <input class="msg-input" id="friend-msg-input" placeholder="اكتب رسالة..." onkeydown="if(event.key==='Enter')sendFriendMsg()"/>
      <button class="send-btn" onclick="sendFriendMsg()">↑</button>
    </div>
  `;
  await loadChatMessages(friendId);
}

async function loadChatMessages(friendId) {
  const res  = await fetch(`${SERVER_URL}/messages/${currentUser.id}/${friendId}`, {
    headers: { 'authorization': `Bearer ${authToken}` }
  });
  const data = await res.json();
  const msgs = document.getElementById('friend-messages');
  if (!msgs) return;
  if (!data.messages?.length) {
    msgs.innerHTML = `<div class="empty-state">${t('no-messages-start')}</div>`;
    return;
  }
  msgs.innerHTML = '';
  data.messages.forEach(m => {
    const div = document.createElement('div');
    div.className = `msg ${m.sender_id === currentUser.id ? 'me' : 'them'}`;
    div.textContent = m.content;
    msgs.appendChild(div);
  });
  msgs.scrollTop = msgs.scrollHeight;
  if (unreadCounts[friendId]) {
    delete unreadCounts[friendId];
    updateChatBtnBadge();
  }
}

async function sendFriendMsg() {
  const input = document.getElementById('friend-msg-input');
  const content = input.value.trim();
  if (!content || !currentChatFriend) return;
  input.value = '';

  const msgs = document.getElementById('friend-messages');
  if (msgs) {
    const empty = msgs.querySelector('.empty-state');
    if (empty) empty.remove();
    const div = document.createElement('div');
    div.className = 'msg me';
    div.textContent = content;
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
  }

  // Use REST so messages are persisted even if the socket is disconnected
  fetch(`${SERVER_URL}/messages/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'authorization': `Bearer ${authToken}` },
    body: JSON.stringify({ receiverId: currentChatFriend.id, content })
  });
}

// ══ Qemy Game ════════════════════════════════════════════════════════════════

window._pendingGameInvite = null;
let _inviteToastTimer = null;

function showGameInviteToast(invite) {
  window._pendingGameInvite = invite;
  const toast = document.getElementById('gameInviteToast');
  const sub   = document.getElementById('gameInviteToastSub');
  if (sub) sub.textContent = `${invite.fromUsername} ${t('game-invite-title')}`;
  const acceptBtn  = document.getElementById('gameInviteAcceptBtn');
  const declineBtn = document.getElementById('gameInviteDeclineBtn');
  if (acceptBtn)  acceptBtn.textContent  = t('game-invite-accept');
  if (declineBtn) declineBtn.textContent = t('game-invite-decline');
  toast?.classList.add('show');
  clearTimeout(_inviteToastTimer);
  _inviteToastTimer = setTimeout(() => hideGameInviteToast(), 30000);
}

function hideGameInviteToast() {
  document.getElementById('gameInviteToast')?.classList.remove('show');
  clearTimeout(_inviteToastTimer);
  window._pendingGameInvite = null;
}

function respondGameInvite(accept) {
  const invite = window._pendingGameInvite;
  if (!invite || !window._notifSocket) return;
  window._notifSocket.emit('respond-game-invite', {
    roomCode:   invite.roomCode,
    fromUserId: invite.fromUserId,
    accepted:   accept
  });
  hideGameInviteToast();
  if (accept) {
    window.open(`/qemy-board?room=${invite.roomCode}`, '_blank');
  } else {
    showToast(t('toast-game-invite-declined-self'));
  }
}

async function challengeFriend(friendId, friendName) {
  if (!currentUser) return;
  try {
    const res = await fetch(`${SERVER_URL}/game/create-room`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'authorization': `Bearer ${authToken}` },
      body: JSON.stringify({ hostId: currentUser.id, maxPlayers: 2 })
    });
    const data = await res.json();
    if (!data.ok) { showToast(t('toast-room-creation-failed')); return; }
    const roomCode = data.roomCode;
    window._notifSocket?.emit('send-game-invite', {
      fromUserId:   currentUser.id,
      fromUsername: currentUser.username,
      toUserId:     friendId,
      roomCode
    });
    showToast(t('toast-invite-sent-to') + friendName);
    window.open(`/qemy-board?room=${roomCode}`, '_blank');
  } catch (e) {
    showToast(t('toast-error'));
  }
}

async function loadGameHistory() {
  if (!currentUser) return;
  const list = document.getElementById('game-history-list');
  if (!list) return;
  try {
    const res  = await fetch(`${SERVER_URL}/game/history/me`, {
      headers: { 'authorization': `Bearer ${authToken}` }
    });
    const data = await res.json();
    const isAr = getCurrentLang() === 'ar';
    if (!data.history?.length) {
      list.innerHTML = `<div class="empty-state">${t('game-history-empty')}</div>`;
      return;
    }
    list.innerHTML = '<div class="game-history-list">' + data.history.map(h => {
      const won    = h.winner_id === currentUser.id;
      const date   = new Date(h.played_at).toLocaleDateString(isAr ? 'ar-QA' : 'en-GB', { year:'numeric', month:'short', day:'numeric' });
      const players = (h.player_names || []).join(isAr ? '، ' : ', ');
      return `
        <div class="game-history-item ${won ? 'won' : ''}">
          <div class="game-history-trophy">${won ? '🏆' : '🃏'}</div>
          <div class="game-history-body">
            <div class="game-history-players">${players || '—'}</div>
            <div class="game-history-meta">${date}</div>
          </div>
          ${won ? `<div class="game-history-winner-badge">${t('game-history-won')}</div>` : ''}
        </div>`;
    }).join('') + '</div>';
  } catch (e) {
    // silently fail
  }
}
//BUTTON OF ACCEDERE
async function acceptTerms() {
  if (currentUser) {
    // Save to DB for existing users
    await fetch(SERVER_URL + '/accept-terms', {
      method: 'POST',
      headers: { 'authorization': `Bearer ${authToken}` }
    });
    currentUser.terms_accepted = true;
    localStorage.setItem('qc_currentUser', JSON.stringify(currentUser));
  } else {
    // Save to browser for guests
    localStorage.setItem('qc_guest_terms', 'true');
  }
  
  document.getElementById('tcOverlay').classList.remove('open');
  showToast('✅ تم قبول الشروط والأحكام');
  
  // If a guest was trying to start a chat, resume it
  if (window._pendingGuestChat) {
    window._pendingGuestChat = false;
    startChat();
  }
}
async function handleGoogleLogin(response) {
  try {
    const res = await fetch('/google-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: response.credential })
    });
    const data = await res.json();
    
    // FIX 1: Define the language variable locally so it doesn't crash
    const isArabic = (localStorage.getItem('qc_lang') || 'ar') === 'ar';
    
    if (data.ok) {
      // Save their info exactly like you do for normal login
      localStorage.setItem('qc_token', data.token);
      localStorage.setItem('qc_currentUser', JSON.stringify(data.user));

      await savePendingCharacter(data.token);
      showToast(isArabic ? 'تم تسجيل الدخول بنجاح!' : 'Logged in successfully!');

      window.location.hash = 'dashboard';
      window.location.reload();
    } else {
      showToast(data.message);
    }
  } catch (err) {
    const isArabic = (localStorage.getItem('qc_lang') || 'ar') === 'ar';
    showToast(isArabic ? 'حدث خطأ في الاتصال' : 'Connection error');
  }
}

// Guarantee Google can trigger it!
window.handleGoogleLogin = handleGoogleLogin;
