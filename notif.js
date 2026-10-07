(function () {
  'use strict';

  let rawToken = localStorage.getItem('qc_token');
  // FIX: Explicitly block the literal strings "null" and "undefined"
  if (!rawToken || rawToken === 'null' || rawToken === 'undefined') {
    return; // Completely stop the script for guests
  }
  
  const TOKEN = rawToken;
  const SERVER_URL = '';
  let _notifs = [];
  let _open = false;

  // ── Inject styles ────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    .g-nav-bell{position:relative;background:none;border:none;cursor:pointer;
      padding:6px 9px;border-radius:8px;font-size:16px;color:#64748b;
      transition:color .15s,background .15s;line-height:1;flex-shrink:0;}
    .g-nav-bell:hover{color:#e2e8f0;background:rgba(255,255,255,0.06);}
    .g-nav-bell-badge{position:absolute;top:2px;right:2px;min-width:16px;height:16px;
      background:#ef4444;border-radius:8px;font-size:10px;font-weight:700;color:#fff;
      display:flex;align-items:center;justify-content:center;padding:0 4px;line-height:1;
      pointer-events:none;}

    .notif-dropdown{position:fixed;top:50px;right:16px;width:320px;max-height:480px;
      background:#0f1218;border:1px solid rgba(255,255,255,0.1);border-radius:16px;
      box-shadow:0 16px 48px rgba(0,0,0,.6);z-index:9999;display:none;
      flex-direction:column;overflow:hidden;font-family:'Tajawal',sans-serif;}
    .notif-dropdown.open{display:flex;}

    .notif-dd-header{display:flex;align-items:center;justify-content:space-between;
      padding:14px 16px 12px;border-bottom:1px solid rgba(255,255,255,0.07);flex-shrink:0;}
    .notif-dd-title{font-size:14px;font-weight:700;color:#e2e8f0;}
    .notif-read-all{background:none;border:none;cursor:pointer;font-size:12px;
      color:#64748b;font-family:'Tajawal',sans-serif;padding:4px 8px;border-radius:6px;
      transition:color .15s,background .15s;}
    .notif-read-all:hover{color:#c4b5fd;background:rgba(139,92,246,.12);}

    .notif-dd-list{overflow-y:auto;flex:1;}
    .notif-dd-list::-webkit-scrollbar{width:4px;}
    .notif-dd-list::-webkit-scrollbar-track{background:transparent;}
    .notif-dd-list::-webkit-scrollbar-thumb{background:rgba(255,255,255,.1);border-radius:2px;}

    .notif-item{display:flex;align-items:flex-start;gap:10px;padding:12px 16px;
      cursor:pointer;transition:background .15s;border-bottom:1px solid rgba(255,255,255,0.05);}
    .notif-item:last-child{border-bottom:none;}
    .notif-item:hover{background:rgba(255,255,255,0.04);}
    .notif-item.unread{background:rgba(139,92,246,0.07);}
    .notif-item.unread:hover{background:rgba(139,92,246,0.12);}

    .notif-av{width:36px;height:36px;border-radius:50%;overflow:hidden;flex-shrink:0;
      background:#1a2030;border:1.5px solid rgba(255,255,255,.1);
      display:flex;align-items:center;justify-content:center;font-size:17px;}
    .notif-av img{width:100%;height:100%;object-fit:cover;}

    .notif-body{flex:1;min-width:0;}
    .notif-msg{font-size:13px;color:#cbd5e1;line-height:1.5;word-break:break-word;}
    .notif-time{font-size:11px;color:#475569;margin-top:3px;}

    .notif-dot{width:8px;height:8px;border-radius:50%;background:#8b5cf6;
      flex-shrink:0;margin-top:4px;}

    .notif-empty{padding:32px 16px;text-align:center;color:#475569;font-size:13px;}

    @media(max-width:380px){
      .notif-dropdown{right:8px;left:8px;width:auto;}
    }
  `;
  document.head.appendChild(style);

  // ── Helpers ──────────────────────────────────────────────
  function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function relTime(ts) {
    const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
    if (s < 60)    return 'الآن';
    if (s < 3600)  return Math.floor(s / 60) + ' د';
    if (s < 86400) return Math.floor(s / 3600) + ' س';
    return Math.floor(s / 86400) + ' ي';
  }

  // ── Badge ────────────────────────────────────────────────
  function updateBadge() {
    const badge = document.getElementById('g-nav-bell-badge');
    if (!badge) return;
    const count = _notifs.filter(n => !n.read).length;
    if (count > 0) {
      badge.textContent = count > 99 ? '99+' : count;
      badge.style.display = '';
    } else {
      badge.style.display = 'none';
    }
  }

  // ── Render list ──────────────────────────────────────────
  function renderList() {
    const list = document.getElementById('notif-dd-list');
    if (!list) return;
    if (!_notifs.length) {
      list.innerHTML = '<div class="notif-empty">لا توجد إشعارات</div>';
      return;
    }
    list.innerHTML = _notifs.map(n => {
      const av = n.from_avatar && n.from_avatar.startsWith('http')
        ? `<img src="${esc(n.from_avatar)}" alt=""/>`
        : '😊';
      return `<div class="notif-item${n.read ? '' : ' unread'}" data-id="${esc(n.id)}" data-link="${esc(n.link || '')}">
        <div class="notif-av">${av}</div>
        <div class="notif-body">
          <div class="notif-msg">${esc(n.message)}</div>
          <div class="notif-time">${relTime(n.created_at)}</div>
        </div>
        ${n.read ? '' : '<div class="notif-dot"></div>'}
      </div>`;
    }).join('');

    list.querySelectorAll('.notif-item').forEach(el => {
      el.addEventListener('click', async () => {
        const id   = el.dataset.id;
        const link = el.dataset.link;
        // Mark read optimistically
        const n = _notifs.find(x => x.id === id);
        if (n && !n.read) {
          n.read = true;
          updateBadge();
          renderList();
          fetch(SERVER_URL + '/api/notifications/' + id + '/read', {
            method: 'PATCH', headers: { authorization: 'Bearer ' + TOKEN }
          }).catch(() => {});
        }
        if (link) window.location.href = link;
      });
    });
  }

  // ── Fetch ────────────────────────────────────────────────
  async function fetchNotifs() {
    try {
      const res  = await fetch(SERVER_URL + '/api/notifications',
        { headers: { authorization: 'Bearer ' + TOKEN } });
      const data = await res.json();
      _notifs = data.notifications || [];
      updateBadge();
      if (_open) renderList();
    } catch (_) {}
  }

  // ── Init ─────────────────────────────────────────────────
  function init() {
    const bell = document.getElementById('g-nav-bell');
    if (!bell) return;

    // Build dropdown and attach to body
    const dd = document.createElement('div');
    dd.id = 'notif-dropdown';
    dd.className = 'notif-dropdown';
    dd.innerHTML = `
      <div class="notif-dd-header">
        <span class="notif-dd-title">الإشعارات</span>
        <button class="notif-read-all" id="notif-read-all">مسح الكل</button>
      </div>
      <div class="notif-dd-list" id="notif-dd-list">
        <div class="notif-empty">جاري التحميل...</div>
      </div>`;
    document.body.appendChild(dd);

    // Toggle on bell click
    bell.addEventListener('click', e => {
      e.stopPropagation();
      _open = !_open;
      dd.classList.toggle('open', _open);
      if (_open) renderList();
    });

    // Close on outside click
    document.addEventListener('click', e => {
      if (_open && !dd.contains(e.target) && e.target !== bell) {
        _open = false;
        dd.classList.remove('open');
      }
    });

    // Mark all read
    document.getElementById('notif-read-all').addEventListener('click', async () => {
      await fetch(SERVER_URL + '/api/notifications/read-all', {
        method: 'PATCH', headers: { authorization: 'Bearer ' + TOKEN }
      });
      _notifs.forEach(n => { n.read = true; });
      updateBadge();
      renderList();
    });

    fetchNotifs();
    setInterval(fetchNotifs, 30000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
