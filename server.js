const Brevo = require('@getbrevo/brevo');
const brevoClient = new Brevo.TransactionalEmailsApi();
brevoClient.authentications['apiKey'].apiKey = process.env.BREVO_API_KEY;
const jwt = require('jsonwebtoken');
const express = require('express');
const helmet  = require('helmet');
const http    = require('http');
const { Server } = require('socket.io');
const path    = require('path');
const bcrypt  = require('bcryptjs');
const crypto  = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { OAuth2Client } = require('google-auth-library');
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// ── Startup secret validation — fail fast if any required env var is missing ──
const REQUIRED_ENV = ['JWT_SECRET', 'ADMIN_PASSWORD', 'TURN_SECRET', 'SUPABASE_URL', 'SUPABASE_KEY', 'BREVO_API_KEY', 'GOOGLE_CLIENT_ID'];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`FATAL: Required environment variable "${key}" is not set. Refusing to start.`);
    process.exit(1);
  }
}
const JWT_SECRET     = process.env.JWT_SECRET;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

const app    = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;
const SITE_URL = process.env.SITE_URL || `http://localhost:${PORT}`;
const io     = new Server(server, { cors: { origin: SITE_URL } });

// Trust the first proxy hop so req.ip reflects the real client IP correctly.
// This makes X-Forwarded-For safe to use (Express validates the chain).
app.set('trust proxy', 1);

app.use(helmet({
  // Explicitly disable these two policies so Google's popup can freely talk to your site
  crossOriginOpenerPolicy: false,
  crossOriginEmbedderPolicy: false,
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "'unsafe-inline'",
        "https://cdn.socket.io",
        "https://accounts.google.com",
        "https://www.googletagmanager.com"
      ],
      
      // FIX: This is the magic line that unfreezes your buttons!
      scriptSrcAttr: ["'unsafe-inline'"], 
      
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://accounts.google.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "blob:", "https:"],
      connectSrc: ["'self'", "wss:", "https:"],
      frameSrc: ["'self'", "https://accounts.google.com"],
      objectSrc: ["'none'"],
    },
  },
}));
app.use(express.json());

// ── Rate Limiting ──
const rateLimitMap = new Map();
function rateLimit(maxRequests, windowMs) {
  return (req, res, next) => {
    const ip  = req.ip || req.socket.remoteAddress;
    const key = `${ip}:${req.path}`;
    const now = Date.now();
    if (!rateLimitMap.has(key)) { rateLimitMap.set(key, { count: 1, start: now }); return next(); }
    const data = rateLimitMap.get(key);
    if (now - data.start > windowMs) { rateLimitMap.set(key, { count: 1, start: now }); return next(); }
    if (data.count >= maxRequests) return res.status(429).json({ ok: false, message: 'طلبات كثيرة — حاول بعد قليل' });
    data.count++;
    next();
  };
}
setInterval(() => {
  const now = Date.now();
  for (const [key, data] of rateLimitMap.entries()) {
    if (now - data.start > 10 * 60 * 1000) rateLimitMap.delete(key);
  }
}, 10 * 60 * 1000);

// ── Supabase ──
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Reset streaks for users who missed yesterday and today (runs hourly)
setInterval(async () => {
  try {
    const today     = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    await supabase.from('users').update({ streak_count: 0 }).not('streak_last_date', 'in', `(${today},${yesterday})`).gt('streak_count', 0);
  } catch (err) { console.error('[streak-reset]', err.message); }
}, 60 * 60 * 1000);

// ── Auth Middleware ──
async function authMiddleware(req, res, next) {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ ok: false, message: 'غير مصرح' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    if (decoded.userId) {
      const { data } = await supabase.from('users').select('is_banned, token_version').eq('id', decoded.userId).single();
      if (data?.is_banned) return res.status(403).json({ ok: false, message: 'تم حظر هذا الحساب' });
      // Tokens issued before versioning had no tv claim — treat as version 1 (backward compat)
      const tokenVersion = decoded.tv ?? 1;
      if (data?.token_version != null && tokenVersion !== data.token_version) {
        return res.status(401).json({ ok: false, message: 'انتهت الجلسة — سجّل دخول مجدداً', session_expired: true });
      }
    }
    next();
  } catch {
    return res.status(401).json({ ok: false, message: 'غير مصرح' });
  }
}

// ── Admin Middleware — verifies short-lived admin JWT ──
function adminMiddleware(req, res, next) {
  const token = req.headers['x-admin-token'] || '';
  if (!token) return res.status(401).json({ ok: false, message: 'غير مصرح' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin') throw new Error('not admin');
    next();
  } catch {
    return res.status(401).json({ ok: false, message: 'غير مصرح' });
  }
}

// ── Qatar IP Filter ──
app.use(async (req, res, next) => {
  if (process.env.QATAR_ONLY !== 'true') return next();
  if (req.path.startsWith('/admin') ||
      req.path.startsWith('/socket.io') ||
      req.path.includes('coming-soon') ||
      req.path.includes('.css') ||
      req.path.includes('.js') ||
      req.path.includes('.ico')) return next();
  const ip = req.ip || req.socket.remoteAddress;
  if (!ip || ip === '127.0.0.1' || ip === '::1' || ip?.startsWith('::ffff:127')) return next();
  try {
    // ipwho.is: free tier, HTTPS, returns JSON with country_code field
    const ipRes  = await fetch(`https://ipwho.is/${ip}`);
    const ipData = await ipRes.json();
    if (ipData.country_code !== 'QA') {
      if (req.path.startsWith('/login') || req.path.startsWith('/register') ||
          req.path.startsWith('/profile') || req.path.startsWith('/friends') ||
          req.path.startsWith('/stats') || req.path.startsWith('/api') ||
          req.path.startsWith('/save-chat') || req.path.startsWith('/update-stats') ||
          req.path.startsWith('/messages') || req.path.startsWith('/game')) {
        return res.status(403).json({ ok: false, message: 'هذه الخدمة غير متاحة في منطقتك' });
      }
      return res.redirect('/coming-soon');
    }
  } catch { return next(); }
  next();
});

// ── Clean URL routing ──
app.get('/qatar-chat.html',   (req, res) => res.redirect(301, '/'));
app.get('/qemy.html',         (req, res) => res.redirect(301, '/qemy'));
app.get('/qemy-board.html',   (req, res) => { const q = req.url.split('?')[1]; res.redirect(301, '/qemy-board' + (q ? '?' + q : '')); });
app.get('/profile.html',      (req, res) => { const q = req.url.split('?')[1]; res.redirect(301, '/profile'      + (q ? '?' + q : '')); });
app.get('/admin.html',        (req, res) => res.redirect(301, '/admin'));
app.get('/coming-soon.html',  (req, res) => res.redirect(301, '/coming-soon'));
app.get('/verify-email.html', (req, res) => { const q = req.url.split('?')[1]; res.redirect(301, '/verify-email'  + (q ? '?' + q : '')); });
app.get('/reset-password.html',(req, res) => { const q = req.url.split('?')[1]; res.redirect(301, '/reset-password'+ (q ? '?' + q : '')); });
app.get('/tasks.html',        (req, res) => res.redirect(301, '/tasks'));
// Serve the Terms & Conditions page for Google Auth
app.get('/terms-conditions', (req, res) => {
  res.sendFile(path.join(__dirname, 'terms-conditions.html'));
});
// Serve the Privacy Policy page for Google Auth
app.get('/policy', (req, res) => {
  res.sendFile(path.join(__dirname, 'policy.html'));
});
// Serve the About Us / Contact page
app.get('/about', (req, res) => {
  res.sendFile(path.join(__dirname, 'about.html'));
});

// ── Character showcase pages (shareable links with OG tags) ──────────────��
const CHAR_IDS = ['robot','ninja','wizard','alien','fox','ghost','knight','scientist','hacker'];
const CHAR_META = {
  robot:     { nameAr:'الروبوت',        nameEn:'Robot',      descEn:'Logical, precise, solves problems scientifically' },
  ninja:     { nameAr:'النينجا',         nameEn:'Ninja',      descEn:'Fast, silent, strikes and vanishes' },
  wizard:    { nameAr:'الساحر',          nameEn:'Wizard',     descEn:'Mysterious, creative, with extraordinary powers' },
  alien:     { nameAr:'الكائن الفضائي', nameEn:'Alien',      descEn:'Weird, unique, nobody understands them' },
  fox:       { nameAr:'الثعلب',          nameEn:'Fox',        descEn:'Smart, cunning, exploits every opportunity' },
  ghost:     { nameAr:'الشبح',           nameEn:'Ghost',      descEn:'Quiet, mysterious, avoids people' },
  knight:    { nameAr:'الفارس',          nameEn:'Knight',     descEn:'Disciplined, brave, faces problems head-on' },
  scientist: { nameAr:'العالم',          nameEn:'Scientist',  descEn:'Curious, precise, loves experiments' },
  hacker:    { nameAr:'الهاكر',          nameEn:'Hacker',     descEn:'Finds loopholes, thinks outside the box' },
};

app.get('/character/:type', (req, res) => {
  const type = req.params.type.toLowerCase();
  if (!CHAR_IDS.includes(type)) return res.redirect('/');
  const m       = CHAR_META[type];
  const siteUrl = SITE_URL;
  res.send(`<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0"/>
<title>${m.nameAr} / ${m.nameEn} \u2014 Qemistry</title>
<meta name="description" content="${m.descEn} | \u0627\u0643\u062a\u0634\u0641 \u0634\u062e\u0635\u064a\u062a\u0643 \u0639\u0644\u0649 Qemistry"/>
<meta property="og:type" content="website"/>
<meta property="og:url" content="${siteUrl}/character/${type}"/>
<meta property="og:title" content="I'm ${m.nameEn} (${m.nameAr}) on Qemistry!"/>
<meta property="og:description" content="${m.descEn} \u2014 Discover your character on Qemistry"/>
<meta property="og:site_name" content="Qemistry"/>
<meta name="twitter:card" content="summary"/>
<meta name="twitter:title" content="I'm ${m.nameEn} on Qemistry!"/>
<meta name="twitter:description" content="${m.descEn} \u2014 Discover your character on Qemistry"/>
<link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;700;900&display=swap" rel="stylesheet"/>
<script src="/avatars.js"></script>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
body{font-family:'Tajawal',sans-serif;background:#0d0d1a;color:#f1f5f9;
  min-height:100vh;display:flex;flex-direction:column;align-items:center;
  justify-content:center;padding:24px;text-align:center;}
body::before{content:'';position:fixed;inset:0;pointer-events:none;
  background:radial-gradient(ellipse 70% 60% at 50% 30%,var(--c,#9d4edd)20,transparent 70%);}
.char-wrap{margin-bottom:20px;animation:cf 2.2s ease-in-out infinite;will-change:transform;}
@keyframes cf{0%,100%{transform:translateY(0);}50%{transform:translateY(-12px);}}
@media(prefers-reduced-motion:reduce){.char-wrap{animation:none;}}
h1{font-size:clamp(26px,6vw,52px);font-weight:900;margin-bottom:8px;}
.sub{font-size:clamp(14px,3vw,20px);color:var(--c,#9d4edd);margin-bottom:10px;font-weight:700;}
.desc{font-size:clamp(13px,2.8vw,16px);color:#94a3b8;margin-bottom:28px;max-width:380px;line-height:1.7;}
.rank{font-size:13px;color:#64748b;margin-bottom:28px;}
.cta{display:inline-block;padding:16px 36px;border-radius:14px;font-family:'Tajawal',sans-serif;
  font-size:clamp(15px,3vw,18px);font-weight:700;color:#fff;text-decoration:none;
  background:var(--c,#9d4edd);transition:opacity .2s;}
.cta:hover{opacity:.85;}
.brand{margin-top:24px;font-size:13px;color:#475569;}
</style>
</head>
<body>
<div id="app"><div style="color:#475569;margin-top:40vh">Loading...</div></div>
<script>
(function(){
  var type='${type}';
  var ch=window.AVATARS&&window.AVATARS.getById(type);
  if(!ch){window.location.replace('/');return;}
  document.documentElement.style.setProperty('--c',ch.color);
  var lang=localStorage.getItem('qc_lang')||'ar';
  var nameMain=lang==='ar'?ch.nameAr:ch.nameEn;
  var nameSub=lang==='ar'?ch.nameEn:ch.nameAr;
  var desc=lang==='ar'?ch.descAr:ch.descEn;
  var ctaText=lang==='ar'?'\u0627\u0643\u062a\u0634\u0641 \u0634\u062e\u0635\u064a\u062a\u0643 \u2190':'Discover your character \u2192';
  var app=document.getElementById('app');
  app.innerHTML='<div class="char-wrap" id="cw"></div>'
    +'<h1>'+nameMain+'</h1>'
    +'<div class="sub">'+nameSub+'</div>'
    +'<div class="desc">'+desc+'</div>'
    +'<div class="rank" id="cr"></div>'
    +'<a class="cta" href="/quiz">'+ctaText+'</a>'
    +'<div class="brand">\u26DB Qemistry</div>';
  var cw=document.getElementById('cw');
  cw.innerHTML=window.AVATARS.renderSVG(type,140);
  var svg=cw.querySelector('svg');
  if(svg)svg.style.filter='drop-shadow(0 0 20px '+ch.color+'bb)';
  fetch('/api/leaderboard?mode=teams').then(function(r){return r.json();}).then(function(data){
    var teams=data.teams||[];
    var idx=teams.findIndex(function(t){return t.character_type===type;});
    if(idx===-1)return;
    var el=document.getElementById('cr');
    if(el)el.textContent=lang==='ar'
      ?'\u0641\u0631\u064a\u0642\u0643 \u0641\u064a \u0627\u0644\u0645\u0631\u062a\u0628\u0629 #'+(idx+1)+' \ud83c\udfc6'
      :'Team rank #'+(idx+1)+' \ud83c\udfc6';
  }).catch(function(){});
})();
</script>
</body>
</html>`);
});

// Block server-side files that express.static would otherwise expose
const BLOCKED_STATIC = new Set([
  '/server.js', '/game-logic.js',
  '/package.json', '/package-lock.json', '/nixpacks.toml',
]);
app.use((req, res, next) => {
  const p = req.path.toLowerCase();
  if (BLOCKED_STATIC.has(p) || p.endsWith('.md') || p === '/.env') {
    return res.status(404).end();
  }
  next();
});
app.use(express.static(path.join(__dirname)));

app.get('/',              (req, res) => res.sendFile(path.join(__dirname, 'qatar-chat.html')));
app.get('/character-story-slides', (req, res) => res.sendFile(path.join(__dirname, 'character-story-slides.html')));
app.get('/qemy',          (req, res) => res.sendFile(path.join(__dirname, 'qemy.html')));
app.get('/qemy-board',    (req, res) => res.sendFile(path.join(__dirname, 'qemy-board.html')));
app.get('/profile', async (req, res) => {
  const id = req.query.id;
  if (id) {
    const { data } = await supabase.from('users').select('username').eq('id', id).single();
    if (data?.username) return res.redirect(301, '/u/' + encodeURIComponent(data.username));
  }
  res.sendFile(path.join(__dirname, 'profile.html'));
});
app.get('/u/:username',   (req, res) => res.sendFile(path.join(__dirname, 'profile.html')));
app.get('/admin',         (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/coming-soon',   (req, res) => res.sendFile(path.join(__dirname, 'coming-soon.html')));
app.get('/verify-email',  (req, res) => res.sendFile(path.join(__dirname, 'verify-email.html')));
app.get('/reset-password',(req, res) => res.sendFile(path.join(__dirname, 'reset-password.html')));
app.get('/tasks',         (req, res) => res.sendFile(path.join(__dirname, 'tasks.html')));
app.get('/leaderboard',   (req, res) => res.sendFile(path.join(__dirname, 'leaderboard.html')));
app.get('/discover',      (req, res) => res.sendFile(path.join(__dirname, 'discover.html')));
app.get('/imposter',      (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
//auth
app.post('/accept-terms', authMiddleware, async (req, res) => {
  const { error } = await supabase.from('users').update({ terms_accepted: true }).eq('id', req.userId);
  if (error) return res.json({ ok: false, message: 'Failed to update' });
  res.json({ ok: true });
});
// ── Chat History Auto-Delete ──
setInterval(async () => {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    await supabase.from('chat_history').delete().lt('chatted_at', thirtyDaysAgo);
  } catch (err) { console.error('[chat-history-cleanup]', err.message); }
}, 2 * 60 * 60 * 1000);

// ══ ICE CONFIG — Hetzner TURN Server ══════════════════
// Public endpoint — no auth required so guests on mobile get TURN too
app.get('/api/ice-config', rateLimit(30, 60 * 1000), (req, res) => {
  const secret = process.env.TURN_SECRET;
  const ttl = 24 * 3600;
  const timestamp = Math.floor(Date.now() / 1000) + ttl;
  const username = `${timestamp}:qemistry`;
  const hmac = crypto.createHmac('sha1', secret);
  hmac.update(username);
  const credential = hmac.digest('base64');

  res.json({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:178.105.89.151:3478' },
      { urls: 'turn:178.105.89.151:3478',               username, credential },
      { urls: 'turn:178.105.89.151:3478?transport=tcp', username, credential }
    ]
  });
});

// ══ POINTS SYSTEM ══════════════════════════════════════
const POINT_VALUES = {
  chat_complete:   10,
  friend_accepted: 15,
  qemy_win:        25,
  imposter_win:    20,
  daily_login:      5,
  quiz_complete:   50
};

async function awardPoints(userId, action) {
  if (!userId || !POINT_VALUES[action]) return;
  try {
    await supabase.rpc('increment_points', { uid: userId, amount: POINT_VALUES[action] });
  } catch (_) {}
}

// Only daily_login is client-callable — all other actions are awarded server-side only
app.post('/api/points/add', authMiddleware, async (req, res) => {
  const { action } = req.body;
  if (action !== 'daily_login') return res.json({ ok: false, message: 'action غير معروف' });

  const today = new Date().toISOString().split('T')[0];
  const { data: u } = await supabase.from('users').select('last_login_date').eq('id', req.userId).single();
  if (u?.last_login_date === today) return res.json({ ok: true, awarded: false });
  await supabase.from('users').update({ last_login_date: today }).eq('id', req.userId);
  updateTaskProgress(req.userId, 'login_days_3').catch(() => {});

  await awardPoints(req.userId, 'daily_login');
  res.json({ ok: true, awarded: true, points: POINT_VALUES['daily_login'] });
});

// ══ FRAMES & BADGES ════════════════════════════════════
const EARLY_BIRD_CUTOFF = new Date('2026-07-15T00:00:00Z');

const FRAME_UNLOCKS = {
  default: () => true,
  chatter: (u) => (u.total_chats   || 0) >= 50,
  social:  (u, fc) => (fc          || 0) >= 10,
  gamer:   (u) => ((u.game_wins    || 0) + (u.imposter_rounds || 0)) >= 10,
  elite:   (u) => (u.points        || 0) >= 500,
};

async function getFriendCount(userId) {
  const { count } = await supabase.from('friendships')
    .select('id', { count: 'exact', head: true })
    .or(`user_id.eq.${userId},friend_id.eq.${userId}`)
    .eq('status', 'accepted');
  return count || 0;
}

async function checkAndAwardBadges(userId) {
  if (!userId) return;
  try {
    const { data: u } = await supabase.from('users')
      .select('created_at, game_wins, imposter_rounds, points, earned_badges, character_type, character_is_temp')
      .eq('id', userId).single();
    if (!u) return;
    const current = u.earned_badges || [];
    const toAdd = [];

    if (!current.includes('early_bird') && new Date(u.created_at) < EARLY_BIRD_CUTOFF)
      toAdd.push('early_bird');
    if (!current.includes('qemy_master') && (u.game_wins || 0) >= 20)
      toAdd.push('qemy_master');
    if (!current.includes('ghost') && (u.imposter_rounds || 0) >= 20)
      toAdd.push('ghost');
    if (!current.includes('chat_king')) {
      const { data: top10 } = await supabase.from('users')
        .select('id').order('points', { ascending: false }).limit(10);
      if (top10?.some(r => r.id === userId)) toAdd.push('chat_king');
    }
    // Backfill quiz badges for users who completed the quiz before badge awarding was added
    if (u.character_type && !u.character_is_temp) {
      if (!current.includes('quiz_taker')) toAdd.push('quiz_taker');
      const teamBadge = `team_${u.character_type}`;
      if (!current.includes(teamBadge)) toAdd.push(teamBadge);
    }
    if (toAdd.length > 0) {
      await supabase.from('users')
        .update({ earned_badges: [...current, ...toAdd] }).eq('id', userId);
    }
  } catch (_) {}
}

// ══ WEEKLY TASKS ════════════════════════════════════════
const WEEKLY_TASKS = [
  { id: 'chats_3',      label: 'أجرِ 3 محادثات فيديو',           target: 3, reward: 30 },
  { id: 'qemy_wins_2',  label: 'افوز بلعبتين Qemy',               target: 2, reward: 40 },
  { id: 'imposter_1',   label: 'العب جولة في برا السالفة',         target: 1, reward: 20 },
  { id: 'new_friend_1', label: 'أضف صديقاً جديداً',               target: 1, reward: 25 },
  { id: 'login_days_3', label: 'سجّل دخولك 3 أيام هذا الأسبوع',  target: 3, reward: 35 },
];

function getWeekStart() {
  const now = new Date();
  const day = now.getUTCDay(); // 0=Sun … 6=Sat
  const diff = day === 0 ? -6 : 1 - day; // back to Monday
  const d = new Date(now);
  d.setUTCDate(now.getUTCDate() + diff);
  return d.toISOString().split('T')[0];
}

async function ensureWeeklyTasks(userId) {
  const weekStart = getWeekStart();
  const rows = WEEKLY_TASKS.map(t => ({
    user_id: userId, week_start: weekStart, task_id: t.id,
    progress: 0, completed: false, rewarded: false
  }));
  await supabase.from('weekly_tasks').upsert(rows, {
    onConflict: 'user_id,week_start,task_id',
    ignoreDuplicates: true
  });
}

async function updateTaskProgress(userId, taskId) {
  if (!userId) return;
  try {
    await ensureWeeklyTasks(userId);
    const weekStart = getWeekStart();
    const { data: row } = await supabase.from('weekly_tasks')
      .select('progress, completed')
      .eq('user_id', userId).eq('week_start', weekStart).eq('task_id', taskId)
      .single();
    if (!row || row.completed) return;
    const task = WEEKLY_TASKS.find(t => t.id === taskId);
    if (!task) return;
    const newProgress = Math.min(row.progress + 1, task.target);
    const nowComplete = newProgress >= task.target;
    await supabase.from('weekly_tasks')
      .update({ progress: newProgress, completed: nowComplete, rewarded: nowComplete })
      .eq('user_id', userId).eq('week_start', weekStart).eq('task_id', taskId);
    if (nowComplete) {
      await supabase.rpc('increment_points', { uid: userId, amount: task.reward });
    }
  } catch (_) {}
}

app.get('/api/weekly-tasks', authMiddleware, async (req, res) => {
  await ensureWeeklyTasks(req.userId);
  const weekStart = getWeekStart();
  const { data } = await supabase.from('weekly_tasks')
    .select('task_id, progress, completed')
    .eq('user_id', req.userId).eq('week_start', weekStart);
  const tasks = WEEKLY_TASKS.map(def => {
    const row = (data || []).find(r => r.task_id === def.id) || { progress: 0, completed: false };
    return { id: def.id, label: def.label, target: def.target, reward: def.reward,
             progress: row.progress, completed: row.completed };
  });
  res.json({ ok: true, tasks, weekStart });
});

// ── Notifications ──
async function createNotif(userId, type, fromUserId, fromUsername, fromAvatar, message, link) {
  if (!userId) return;
  try {
    await supabase.from('notifications').insert([{
      user_id: userId, type,
      from_user_id: fromUserId || null,
      from_username: fromUsername || null,
      from_avatar: fromAvatar || null,
      message, link: link || null
    }]);
  } catch (_) {}
}

app.get('/api/notifications', authMiddleware, async (req, res) => {
  const { data } = await supabase.from('notifications')
    .select('*').eq('user_id', req.userId)
    .order('created_at', { ascending: false }).limit(20);
  res.json({ ok: true, notifications: data || [] });
});

// Static route MUST be registered before /:id/read to avoid param capture
app.patch('/api/notifications/read-all', authMiddleware, async (req, res) => {
  await supabase.from('notifications').update({ read: true })
    .eq('user_id', req.userId).eq('read', false);
  res.json({ ok: true });
});

app.patch('/api/notifications/:id/read', authMiddleware, async (req, res) => {
  const { id } = req.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return res.json({ ok: false });
  await supabase.from('notifications').update({ read: true })
    .eq('id', id).eq('user_id', req.userId);
  res.json({ ok: true });
});

// ── Frame equip ──
app.patch('/api/profile/frame', authMiddleware, async (req, res) => {
  const { frame } = req.body;
  const valid = ['default', 'chatter', 'social', 'gamer', 'elite'];
  if (!valid.includes(frame)) return res.json({ ok: false, message: 'إطار غير صالح' });
  if (frame !== 'default') {
    const { data: u } = await supabase.from('users')
      .select('total_chats, game_wins, imposter_rounds, points')
      .eq('id', req.userId).single();
    const fc = await getFriendCount(req.userId);
    if (!FRAME_UNLOCKS[frame]?.(u || {}, fc))
      return res.json({ ok: false, message: 'لم تفتح هذا الإطار بعد' });
  }
  await supabase.from('users').update({ equipped_frame: frame }).eq('id', req.userId);
  res.json({ ok: true });
});

// ── Discover ──
app.get('/api/discover', authMiddleware, async (req, res) => {
  const userId = req.userId;
  const rawInterests = req.query.interests || '';
  const interestFilter = rawInterests
    ? rawInterests.split(',').map(s => s.trim()).filter(s => s.length > 0 && s.length < 30).slice(0, 10)
    : null;

  // Collect all IDs to exclude: self + anyone in any friendship (pending or accepted)
  const { data: friendships } = await supabase.from('friendships')
    .select('user_id, friend_id')
    .or(`user_id.eq.${userId},friend_id.eq.${userId}`);

  const excludeIds = [userId];
  for (const f of (friendships || [])) {
    if (!excludeIds.includes(f.user_id))   excludeIds.push(f.user_id);
    if (!excludeIds.includes(f.friend_id)) excludeIds.push(f.friend_id);
  }

  let query = supabase.from('users')
    .select('id, username, avatar_url, points, hobbies, equipped_frame, earned_badges')
    .not('id', 'in', `(${excludeIds.join(',')})`)
    .order('points', { ascending: false })
    .limit(20);

  if (interestFilter?.length) {
    query = query.overlaps('hobbies', interestFilter);
  }

  const { data, error } = await query;
  if (error) return res.json({ ok: false, users: [] });
  res.json({ ok: true, users: data || [] });
});

// ── Leaderboard (public) ──
app.get('/api/leaderboard', async (req, res) => {
  if (req.query.mode === 'teams') {
    const { data, error } = await supabase.rpc('leaderboard_teams');
    if (error) {
      // Fallback: manual aggregation if RPC doesn't exist yet
      const { data: rows } = await supabase.from('users')
        .select('character_type, points')
        .not('character_type', 'is', null);
      const teams = {};
      (rows || []).forEach(u => {
        if (!teams[u.character_type]) teams[u.character_type] = { character_type: u.character_type, total_points: 0, member_count: 0 };
        teams[u.character_type].total_points  += (u.points || 0);
        teams[u.character_type].member_count  += 1;
      });
      const sorted = Object.values(teams).sort((a, b) => b.total_points - a.total_points);
      return res.json({ ok: true, teams: sorted });
    }
    return res.json({ ok: true, teams: data || [] });
  }
  const { data, error } = await supabase.from('users')
    .select('id, username, avatar_url, points, character_type')
    .order('points', { ascending: false })
    .limit(50);
  if (error) return res.json({ ok: false, users: [] });
  res.json({ ok: true, users: data || [] });
});

// ── Online presence ──
app.get('/api/online-count', (req, res) => {
  res.json({ count: getOnlineCount() });
});

app.get('/api/online-status', authMiddleware, (req, res) => {
  const ids = (req.query.ids || '').split(',')
    .map(s => s.trim()).filter(s => /^[0-9a-f-]{36}$/.test(s)).slice(0, 100);
  const onlineIds = new Set([...userMeta.values()].filter(m => m.userId).map(m => m.userId));
  const status = {};
  for (const id of ids) {
    status[id] = { online: onlineIds.has(id), lastSeen: lastSeen.get(id) || null };
  }
  res.json({ ok: true, status });
});

// ══ AUTH ROUTES ════════════════════════════════════════

app.post('/register', rateLimit(5, 60 * 60 * 1000), async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) return res.json({ ok: false, message: 'أكمل جميع الحقول' });
  if (typeof username !== 'string' || username.length < 3 || username.length > 20)
    return res.json({ ok: false, message: 'اسم المستخدم يجب أن يكون بين 3 و 20 حرفاً' });
  if (!/^[a-zA-Z0-9_\u0600-\u06FF]+$/.test(username))
    return res.json({ ok: false, message: 'اسم مستخدم غير صالح' });
  if (typeof email !== 'string' || email.length > 254)
    return res.json({ ok: false, message: 'البريد الإلكتروني غير صالح' });
  if (typeof password !== 'string' || password.length < 8 || password.length > 128)
    return res.json({ ok: false, message: 'كلمة المرور يجب أن تكون بين 8 و 128 حرفاً' });

  const hash = await bcrypt.hash(password, 10);
  
  // We just add "terms_accepted: true" to the end of this single insert array
  const { data, error } = await supabase.from('users')
    .insert([{ username, email, password_hash: hash, terms_accepted: true }]).select();
    
  if (error) return res.json({ ok: false, message: 'البريد أو الاسم مستخدم مسبقاً' });
  const token = jwt.sign({ userId: data[0].id, tv: data[0].token_version || 1 }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ ok: true, user: { id: data[0].id, username: data[0].username, email: data[0].email, created_at: data[0].created_at }, token });
});

app.post('/login', rateLimit(10, 60 * 60 * 1000), async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.json({ ok: false, message: 'أدخل البريد وكلمة المرور' });
  const { data } = await supabase.from('users').select().eq('email', email).single();
  if (!data) return res.json({ ok: false, message: 'البريد أو كلمة المرور خاطئة' });
  if (data.is_banned) return res.json({ ok: false, message: 'تم حظر هذا الحساب' });
  const match = await bcrypt.compare(password, data.password_hash);
  if (!match) return res.json({ ok: false, message: 'البريد أو كلمة المرور خاطئة' });
  const token = jwt.sign({ userId: data.id, tv: data.token_version || 1 }, JWT_SECRET, { expiresIn: '30d' });
  // Change the res.json line to include terms_accepted:
  res.json({ ok: true, user: { id: data.id, username: data.username, email: data.email, avatar_url: data.avatar_url, bio: data.bio, birthdate: data.birthdate, hobbies: data.hobbies, created_at: data.created_at, email_verified: data.email_verified, terms_accepted: data.terms_accepted }, token });
});
app.post('/google-login', rateLimit(10, 60 * 60 * 1000), async (req, res) => {
  const { credential } = req.body;
  if (!credential) return res.json({ ok: false, message: 'لم يتم توفير بيانات الدخول' });

  try {
    // 1. Verify the token with Google
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const email = payload.email;
    
    // 2. Generate a clean username from their Google name
    let username = payload.name.replace(/[^a-zA-Z0-9_\u0600-\u06FF]/g, '').substring(0, 15);
    if (username.length < 3) username = 'User' + Math.floor(Math.random() * 10000);

    // 3. Check if this user already exists in your database
    let { data: user } = await supabase.from('users').select().eq('email', email).single();

    if (!user) {
      // 4. If they don't exist, create a new account automatically!
      const { data, error } = await supabase.from('users').insert([{
        username: username,
        email: email,
        avatar_url: payload.picture,
        email_verified: true,
        terms_accepted: true,
        password_hash: 'GOOGLE_AUTH_NO_PASSWORD' // So they can't login via normal email/pass without resetting
      }]).select().single();

      if (error) return res.json({ ok: false, message: 'فشل إنشاء الحساب عبر جوجل' });
      user = data;
    } else if (user.is_banned) {
      return res.json({ ok: false, message: 'تم حظر هذا الحساب' });
    }

    // 5. Issue your custom Qemistry JWT so the rest of your app works normally
    const token = jwt.sign({ userId: user.id, tv: user.token_version || 1 }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ 
      ok: true, 
      user: { id: user.id, username: user.username, email: user.email, avatar_url: user.avatar_url, bio: user.bio, hobbies: user.hobbies, created_at: user.created_at, email_verified: user.email_verified, terms_accepted: user.terms_accepted }, 
      token 
    });

  } catch (err) {
    console.error('Google Auth Error:', err.message);
    res.json({ ok: false, message: 'فشل التحقق من جوجل' });
  }
});

// ══ PROFILE ROUTES ════════════════════════════════════

app.get('/api/profile/by-username/:username', async (req, res) => {
  let requesterId = null;
  const token = req.headers['authorization']?.split(' ')[1];
  if (token) { try { requesterId = jwt.verify(token, JWT_SECRET).userId; } catch {} }
  const { data: lookup } = await supabase.from('users').select('id').eq('username', req.params.username).single();
  if (!lookup) return res.json({ ok: false, message: 'المستخدم غير موجود' });
  const userId = lookup.id;
  const isSelf = requesterId === userId;
  if (isSelf) await checkAndAwardBadges(userId).catch(() => {});
  const publicFields  = 'id, username, avatar_url, bio, hobbies, created_at, total_seconds, total_chats, streak_count, game_wins, imposter_rounds, points, equipped_frame, earned_badges, character_type, character_is_temp';
  const privateFields = publicFields + ', birthdate, streak_last_date, email_verified, is_banned, terms_accepted';
  const { data } = await supabase.from('users').select(isSelf ? privateFields : publicFields).eq('id', userId).single();
  if (!data) return res.json({ ok: false, message: 'المستخدم غير موجود' });
  const friendCount = await getFriendCount(userId);
  res.json({ ok: true, user: { ...data, friend_count: friendCount } });
});

app.get('/api/profile/:userId', async (req, res) => {
  // Determine if the requester is viewing their own profile so we can
  // include sensitive fields (email_verified, birthdate, terms_accepted, etc.)
  let requesterId = null;
  const token = req.headers['authorization']?.split(' ')[1];
  if (token) {
    try { requesterId = jwt.verify(token, JWT_SECRET).userId; } catch {}
  }
  const isSelf = requesterId === req.params.userId;
  if (isSelf) await checkAndAwardBadges(req.params.userId).catch(() => {});
  const publicFields  = 'id, username, avatar_url, bio, hobbies, created_at, total_seconds, total_chats, streak_count, game_wins, imposter_rounds, points, equipped_frame, earned_badges, character_type, character_is_temp';
  const privateFields = publicFields + ', birthdate, streak_last_date, email_verified, is_banned, terms_accepted';
  const { data } = await supabase.from('users')
    .select(isSelf ? privateFields : publicFields)
    .eq('id', req.params.userId).single();
  if (!data) return res.json({ ok: false, message: 'المستخدم غير موجود' });
  const friendCount = await getFriendCount(req.params.userId);
  res.json({ ok: true, user: { ...data, friend_count: friendCount } });
});

app.post('/update-profile', authMiddleware, async (req, res) => {
  const { username } = req.body;
  if (!username) return res.json({ ok: false, message: 'بيانات ناقصة' });
  if (typeof username !== 'string' || username.length < 3 || username.length > 20)
    return res.json({ ok: false, message: 'اسم المستخدم يجب أن يكون بين 3 و 20 حرفاً' });
  if (!/^[a-zA-Z0-9_\u0600-\u06FF]+$/.test(username))
    return res.json({ ok: false, message: 'اسم مستخدم غير صالح' });
  const { error } = await supabase.from('users').update({ username }).eq('id', req.userId);
  if (error) return res.json({ ok: false, message: 'الاسم مستخدم مسبقاً' });
  res.json({ ok: true });
});

app.post('/update-password', rateLimit(5, 60 * 60 * 1000), authMiddleware, async (req, res) => {
  const { password } = req.body;
  if (!password) return res.json({ ok: false, message: 'بيانات ناقصة' });
  if (typeof password !== 'string' || password.length < 8 || password.length > 128)
    return res.json({ ok: false, message: 'كلمة المرور يجب أن تكون بين 8 و 128 حرفاً' });
  const hash = await bcrypt.hash(password, 10);
  const { data: cur } = await supabase.from('users').select('token_version').eq('id', req.userId).single();
  const newVersion = (cur?.token_version || 1) + 1;
  const { error } = await supabase.from('users')
    .update({ password_hash: hash, token_version: newVersion })
    .eq('id', req.userId);
  if (error) return res.json({ ok: false, message: 'فشل تغيير كلمة المرور' });
  const newToken = jwt.sign({ userId: req.userId, tv: newVersion }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ ok: true, token: newToken });
});

app.post('/logout-all', authMiddleware, async (req, res) => {
  const { data: cur } = await supabase.from('users').select('token_version').eq('id', req.userId).single();
  const newVersion = (cur?.token_version || 1) + 1;
  await supabase.from('users').update({ token_version: newVersion }).eq('id', req.userId);
  const newToken = jwt.sign({ userId: req.userId, tv: newVersion }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ ok: true, token: newToken });
});

app.post('/update-profile-info', authMiddleware, async (req, res) => {
  const { bio, birthdate, hobbies } = req.body;
  if (bio !== undefined && bio !== null && (typeof bio !== 'string' || bio.length > 200))
    return res.json({ ok: false, message: 'النبذة لا تتجاوز 200 حرف' });
  if (Array.isArray(hobbies)) {
    if (hobbies.length > 3) return res.json({ ok: false, message: 'لا يمكن اختيار أكثر من 3 اهتمامات' });
    if (hobbies.some(h => typeof h !== 'string' || h.length > 50))
      return res.json({ ok: false, message: 'قيمة اهتمام غير صالحة' });
  }
  if (birthdate !== undefined && birthdate !== null) {
    if (typeof birthdate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(birthdate))
      return res.json({ ok: false, message: 'تاريخ الميلاد غير صالح' });
    const d = new Date(birthdate);
    if (isNaN(d.getTime()) || d > new Date())
      return res.json({ ok: false, message: 'تاريخ الميلاد غير صالح' });
  }
  const { error } = await supabase.from('users').update({ bio, birthdate, hobbies }).eq('id', req.userId);
  if (error) return res.json({ ok: false, message: 'فشل التحديث' });
  res.json({ ok: true });
});

// ══ AVATAR ROUTES ══════════════════════════════════════

// Validate image file by checking actual magic bytes, not just Content-Type header
function validateImageMagicBytes(buffer, contentType) {
  if (buffer.length < 12) return false;
  const type = contentType.split(';')[0].trim();
  if (type === 'image/jpeg' || type === 'image/jpg') {
    return buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF;
  }
  if (type === 'image/png') {
    return buffer[0] === 0x89 && buffer[1] === 0x50 &&
           buffer[2] === 0x4E && buffer[3] === 0x47;
  }
  if (type === 'image/webp') {
    // RIFF....WEBP
    return buffer[0] === 0x52 && buffer[1] === 0x49 &&
           buffer[2] === 0x46 && buffer[3] === 0x46 &&
           buffer[8] === 0x57 && buffer[9] === 0x45 &&
           buffer[10] === 0x42 && buffer[11] === 0x50;
  }
  return false;
}

app.post('/upload-avatar', authMiddleware, rateLimit(5, 60 * 60 * 1000), async (req, res) => {
  const userId = req.userId;
  if (!userId) return res.json({ ok: false, message: 'غير مصرح' });
  const contentType = req.headers['content-type'] || '';
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
  if (!allowedTypes.includes(contentType.split(';')[0].trim())) {
    return res.json({ ok: false, message: 'نوع الملف غير مدعوم' });
  }
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', async () => {
    const buffer   = Buffer.concat(chunks);
    if (buffer.length === 0) return res.json({ ok: false, message: 'الملف فارغ' });
    if (buffer.length > 2 * 1024 * 1024) return res.json({ ok: false, message: 'الملف أكبر من 2MB' });
    // Validate actual file content matches the declared type
    if (!validateImageMagicBytes(buffer, contentType)) {
      return res.json({ ok: false, message: 'محتوى الملف لا يطابق النوع المعلن' });
    }
    const ext      = contentType.split('/')[1].split(';')[0].trim();
    const filename = `avatars/${userId}.${ext}`;
    const exts = ['jpeg', 'jpg', 'png', 'webp'];
    for (const e of exts) await supabase.storage.from('avatars').remove([`avatars/${userId}.${e}`]);
    const { error: upErr } = await supabase.storage.from('avatars').upload(filename, buffer, { contentType: req.headers['content-type'], upsert: true });
    if (upErr) return res.json({ ok: false, message: 'فشل رفع الصورة' });
    const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(filename);
    const urlWithTimestamp = `${urlData.publicUrl}?t=${Date.now()}`;
    await supabase.from('users').update({ avatar_url: urlWithTimestamp }).eq('id', userId);
    res.json({ ok: true, url: urlWithTimestamp });
  });
});

app.post('/delete-avatar', authMiddleware, async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.json({ ok: false });
  if (req.userId !== userId) return res.json({ ok: false, message: 'غير مصرح' });
  const ext = ['jpeg', 'jpg', 'png', 'webp'];
  for (const e of ext) await supabase.storage.from('avatars').remove([`avatars/${userId}.${e}`]);
  await supabase.from('users').update({ avatar_url: null }).eq('id', userId);
  res.json({ ok: true });
});

// ══ STATS ROUTES ═══════════════════════════════════════

app.get('/stats/:userId', authMiddleware, async (req, res) => {
  if (req.userId !== req.params.userId) return res.status(403).json({ ok: false, message: 'غير مصرح' });
  const { data } = await supabase.from('users').select('total_seconds, total_chats').eq('id', req.params.userId).single();
  res.json({ total_seconds: data?.total_seconds || 0, total_chats: data?.total_chats || 0 });
});

app.post('/update-stats', authMiddleware, rateLimit(10, 60 * 60 * 1000), async (req, res) => {
  const { userId, seconds } = req.body;
  if (!userId) return res.json({ ok: false });
  if (req.userId !== userId) return res.json({ ok: false, message: 'غير مصرح' });
  // Only update total_seconds — total_chats is counted exclusively by /save-chat
  const cappedSeconds = Math.min(Math.max(0, parseInt(seconds) || 0), 8 * 3600);
  const { data } = await supabase.from('users').select('total_seconds').eq('id', userId).single();
  await supabase.from('users').update({
    total_seconds: (data?.total_seconds || 0) + cappedSeconds,
  }).eq('id', userId);
  res.json({ ok: true });
});

// ══ QUIZ ROUTES ════════════════════════════════════════
// NOTE: Run these once in Supabase SQL editor before deploying:
//   ALTER TABLE users ADD COLUMN IF NOT EXISTS character_type VARCHAR(20) DEFAULT NULL;
//   ALTER TABLE users ADD COLUMN IF NOT EXISTS character_is_temp BOOLEAN DEFAULT FALSE;

const VALID_CHARACTERS = ['robot','ninja','wizard','alien','fox','ghost','knight','scientist','hacker'];

app.post('/api/quiz/result', authMiddleware, async (req, res) => {
  const { character_type, is_temp } = req.body;
  if (!VALID_CHARACTERS.includes(character_type)) return res.json({ ok: false, message: 'شخصية غير صالحة' });
  const { error } = await supabase.from('users').update({
    character_type,
    character_is_temp: is_temp === true
  }).eq('id', req.userId);
  if (error) return res.json({ ok: false, message: error.message });
  if (!is_temp) {
    try {
      const { data: u } = await supabase.from('users').select('earned_badges').eq('id', req.userId).single();
      const current = u?.earned_badges || [];
      const toAdd = [];
      // Only award points once — quiz_taker badge is the idempotency gate
      if (!current.includes('quiz_taker')) {
        toAdd.push('quiz_taker');
        awardPoints(req.userId, 'quiz_complete').catch(() => {});
      }
      const teamBadge = `team_${character_type}`;
      if (!current.includes(teamBadge)) toAdd.push(teamBadge);
      if (toAdd.length) {
        await supabase.from('users').update({ earned_badges: [...current, ...toAdd] }).eq('id', req.userId);
      }
    } catch (_) {}
  }
  const { data: updated } = await supabase.from('users')
    .select('id, username, avatar_url, character_type, character_is_temp, earned_badges, points, email_verified, terms_accepted, bio, hobbies, birthdate, created_at')
    .eq('id', req.userId).single();
  res.json({ ok: true, user: updated });
});

app.get('/api/character/:id', (req, res) => {
  const chars = {
    robot:     { nameAr:'الروبوت',          nameEn:'Robot',     color:'#4cc9f0' },
    ninja:     { nameAr:'النينجا',           nameEn:'Ninja',     color:'#9d4edd' },
    wizard:    { nameAr:'الساحر',            nameEn:'Wizard',    color:'#c77dff' },
    alien:     { nameAr:'الكائن الفضائي',   nameEn:'Alien',     color:'#2ec4b6' },
    fox:       { nameAr:'الثعلب',            nameEn:'Fox',       color:'#ff8c42' },
    ghost:     { nameAr:'الشبح',             nameEn:'Ghost',     color:'#4cc9f0' },
    knight:    { nameAr:'الفارس',            nameEn:'Knight',    color:'#4361ee' },
    scientist: { nameAr:'العالم',            nameEn:'Scientist', color:'#ffd60a' },
    hacker:    { nameAr:'الهاكر',            nameEn:'Hacker',    color:'#3a86ff' },
  };
  const ch = chars[req.params.id];
  if (!ch) return res.status(404).json({ ok: false });
  res.json({ ok: true, character: { id: req.params.id, ...ch } });
});

app.get('/quiz',        (req, res) => res.sendFile(path.join(__dirname, 'quiz.html')));
app.get('/talent-show', (req, res) => res.sendFile(path.join(__dirname, 'talent-show.html')));

// ══ TALENT SHOW WAITLIST ═══════════════════════════════

const TALENT_OPTIONS = new Set(['singing','dancing','music','comedy','art','acting','sports','other']);

app.post('/api/talent-waitlist', authMiddleware, rateLimit(3, 60 * 60 * 1000), async (req, res) => {
  const { name, talent } = req.body;
  if (!name || !talent) return res.json({ ok: false, message: 'أكمل جميع الحقول' });
  if (typeof name !== 'string' || name.length < 2 || name.length > 80)
    return res.json({ ok: false, message: 'اسم غير صالح' });
  if (!TALENT_OPTIONS.has(talent))
    return res.json({ ok: false, message: 'موهبة غير صالحة' });

  const { data: user } = await supabase.from('users').select('email').eq('id', req.userId).single();
  if (!user) return res.json({ ok: false, message: 'المستخدم غير موجود' });

  const { error } = await supabase.from('talent_waitlist').insert([{
    name: name.trim(),
    email: user.email,
    talent
  }]);

  if (error?.code === '23505') return res.json({ ok: false, duplicate: true });
  if (error) return res.json({ ok: false, message: 'خطأ في الخادم' });
  res.json({ ok: true });
});

app.get('/admin/talent-waitlist', adminMiddleware, async (req, res) => {
  const { data, error } = await supabase.from('talent_waitlist')
    .select('id, name, email, talent, created_at')
    .order('created_at', { ascending: false });
  if (error) return res.json({ ok: false, message: error.message });
  res.json({ ok: true, signups: data || [] });
});

// ══ CHAT HISTORY ROUTES ════════════════════════════════

app.post('/save-chat', authMiddleware, rateLimit(200, 24 * 60 * 60 * 1000), async (req, res) => {
  const userId = req.userId; // always use the JWT-verified identity
  const { peerId, peerName, chatSeconds } = req.body;
  // Cap chatSeconds — client-supplied value, cannot trust values over 8 hours
  const safeSecs = Math.min(Math.max(0, parseInt(chatSeconds) || 0), 8 * 3600);
  // Ignore sessions shorter than 30 seconds — not a real session
  if (safeSecs < 30) return res.json({ ok: true });

  await supabase.from('chat_history').insert([{
    user_id:   userId,
    peer_id:   peerId || null,
    peer_name: peerName || 'ضيف'
  }]);

  // Count this as one completed session
  const { data: uStats } = await supabase.from('users').select('total_chats').eq('id', userId).single();
  await supabase.from('users').update({ total_chats: (uStats?.total_chats || 0) + 1 }).eq('id', userId);

  if (safeSecs >= 60) {
    awardPoints(userId, 'chat_complete').catch(() => {});
    updateTaskProgress(userId, 'chats_3').catch(() => {});
  }

  if (safeSecs >= 120) {
    const today = new Date().toISOString().split('T')[0];
    const { data: user } = await supabase.from('users')
      .select('streak_count, streak_last_date').eq('id', userId).single();
    if (user) {
      const last      = user.streak_last_date ? user.streak_last_date.split('T')[0] : null;
      const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
      let newStreak = 1;
      if (last === yesterday) newStreak = (user.streak_count || 0) + 1;
      else if (last === today) newStreak = user.streak_count || 1;
      await supabase.from('users').update({ streak_count: newStreak, streak_last_date: today }).eq('id', userId);
    }
  }

  res.json({ ok: true });
});

app.get('/chat-history/me', authMiddleware, async (req, res) => {
  const { data } = await supabase.from('chat_history').select('*')
    .eq('user_id', req.userId).order('chatted_at', { ascending: false }).limit(50);
  const history = await Promise.all((data || []).map(async h => {
    if (h.peer_id) {
      const { data: u } = await supabase.from('users').select('avatar_url').eq('id', h.peer_id).single();
      return { ...h, avatar_url: u?.avatar_url || null };
    }
    return { ...h, avatar_url: null };
  }));
  res.json({ history });
});

// ══ FRIENDS ROUTES ═════════════════════════════════════

app.get('/friends/me', authMiddleware, async (req, res) => {
  const userId = req.userId;
  const { data, error } = await supabase.from('friendships').select('*')
    .or(`user_id.eq.${userId},friend_id.eq.${userId}`);
  if (error) return res.json({ friends: [] });
  const friends = await Promise.all((data || []).map(async f => {
    const otherId = f.user_id === userId ? f.friend_id : f.user_id;
    const { data: u } = await supabase.from('users').select('username, avatar_url').eq('id', otherId).single();
    return { user_id: f.user_id, friend_id: f.friend_id, status: f.status, username: u?.username, avatar_url: u?.avatar_url };
  }));
  res.json({ friends });
});

app.post('/friend-request', authMiddleware, async (req, res) => {
  const senderId = req.userId; // always use the JWT-verified identity
  const { targetId } = req.body;
  if (!targetId) return res.json({ ok: false });
  if (senderId === targetId) return res.json({ ok: false });
  const { error } = await supabase.from('friendships')
    .insert([{ user_id: senderId, friend_id: targetId, status: 'pending' }]);
  if (error) return res.json({ ok: false });
  const { data: sender } = await supabase.from('users')
    .select('username, avatar_url').eq('id', senderId).single();
  const senderName   = sender?.username   || 'شخص ما';
  const senderAvatar = sender?.avatar_url || null;
  for (const [socketId, meta] of userMeta.entries()) {
    if (meta.userId === targetId) {
      io.to(socketId).emit('friend-request-notification', { fromUsername: senderName });
      break;
    }
  }
  createNotif(targetId, 'friend_request', senderId, senderName, senderAvatar,
    `${senderName} أرسل لك طلب صداقة`, '/#dashboard').catch(() => {});
  res.json({ ok: true });
});

app.post('/friend-respond', authMiddleware, async (req, res) => {
  const userId = req.userId; // always use the JWT-verified identity
  const { fromUserId, accept } = req.body;
  if (!fromUserId) return res.json({ ok: false });
  if (accept) {
    await supabase.from('friendships').update({ status: 'accepted' })
      .eq('user_id', fromUserId).eq('friend_id', userId);
    // Award points to the person who sent the request (their request was accepted)
    awardPoints(fromUserId, 'friend_accepted').catch(() => {});
    updateTaskProgress(fromUserId, 'new_friend_1').catch(() => {});
    const { data: accepter } = await supabase.from('users')
      .select('username, avatar_url').eq('id', userId).single();
    const accepterName   = accepter?.username   || 'شخص ما';
    const accepterAvatar = accepter?.avatar_url || null;
    createNotif(fromUserId, 'friend_accept', userId, accepterName, accepterAvatar,
      `${accepterName} قبل طلب صداقتك`, `/u/${encodeURIComponent(accepterName)}`).catch(() => {});
  } else {
    await supabase.from('friendships').delete()
      .eq('user_id', fromUserId).eq('friend_id', userId);
  }
  res.json({ ok: true });
});

app.post('/friend-remove', authMiddleware, async (req, res) => {
  const userId = req.userId; // always use the JWT-verified identity
  const { targetId } = req.body;
  if (!targetId) return res.json({ ok: false });
  await supabase.from('friendships').delete()
    .or(`and(user_id.eq.${userId},friend_id.eq.${targetId}),and(user_id.eq.${targetId},friend_id.eq.${userId})`);
  res.json({ ok: true });
});

// ══ EMAIL ROUTES ═══════════════════════════════════════

function genToken() { return crypto.randomBytes(32).toString('hex'); }

app.post('/send-verification', authMiddleware, rateLimit(3, 60 * 60 * 1000), async (req, res) => {
  // Use the userId from the verified JWT — never trust the request body for this
  const userId = req.userId;
  const { data: dbUser } = await supabase.from('users').select('email, username').eq('id', userId).single();
  if (!dbUser) return res.json({ ok: false });
  const { email, username } = dbUser;

  const token   = genToken();
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await supabase.from('email_tokens').insert([{ user_id: userId, token, type: 'verify', expires_at: expires.toISOString() }]);
  
  const link = `${SITE_URL}/verify-email?token=${token}`;
  
  // 🛡️ The Try/Catch Safety Net prevents server crashes!
  try {
    await brevoClient.sendTransacEmail({
      sender: { name: 'Qemistry', email: 'brightanddark.store@gmail.com' },
      to: [{ email }],
      subject: 'تأكيد حسابك في Qemistry',
      htmlContent: `<div dir="rtl" style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;padding:20px;"><h2>Qemistry</h2><p>أهلاً ${username}!</p><p>اضغط على الزر أدناه لتأكيد حسابك:</p><a href="${link}" style="display:inline-block;background:linear-gradient(135deg,#8D1B3D,#7C3AED);color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;">تأكيد الحساب</a><p style="color:#888;font-size:12px;">الرابط صالح لمدة 24 ساعة</p></div>`
    });
  } catch (error) {
    console.error('Brevo failed to send email. Limit reached?', error.message);
  }

  // We return OK so the user can still enter the app even if the email failed
  res.json({ ok: true });
});

app.get('/api/verify-email', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.json({ ok: false, message: 'رابط غير صالح' });
  const { data } = await supabase.from('email_tokens').select('*').eq('token', token).eq('type', 'verify').eq('used', false).single();
  if (!data) return res.json({ ok: false, message: 'الرابط غير صالح أو منتهي الصلاحية' });
  if (new Date(data.expires_at) < new Date()) return res.json({ ok: false, message: 'انتهت صلاحية الرابط' });
  await supabase.from('users').update({ email_verified: true }).eq('id', data.user_id);
  await supabase.from('email_tokens').update({ used: true }).eq('id', data.id);
  res.json({ ok: true });
});

app.post('/forgot-password', rateLimit(3, 60 * 60 * 1000), async (req, res) => {
  const { email } = req.body;
  if (!email) return res.json({ ok: false });
  const { data: user } = await supabase.from('users').select('id, username').eq('email', email).single();
  if (!user) return res.json({ ok: true }); // Don't reveal whether the email exists
  const token   = genToken();
  const expires = new Date(Date.now() + 60 * 60 * 1000);
  await supabase.from('email_tokens').insert([{ user_id: user.id, token, type: 'reset', expires_at: expires.toISOString() }]);
  const link = `${SITE_URL}/reset-password?token=${token}`;
  try {
    await brevoClient.sendTransacEmail({
      sender: { name: 'Qemistry', email: 'brightanddark.store@gmail.com' },
      to: [{ email }],
      subject: 'إعادة تعيين كلمة المرور — Qemistry',
      htmlContent: `<div dir="rtl" style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;padding:20px;"><h2>Qemistry</h2><p>أهلاً ${user.username}!</p><a href="${link}" style="display:inline-block;background:linear-gradient(135deg,#8D1B3D,#7C3AED);color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;">إعادة تعيين كلمة المرور</a><p style="color:#888;font-size:12px;">الرابط صالح لمدة ساعة وحدة</p></div>`
    });
  } catch (err) {
    console.error('[forgot-password] Brevo error:', err.message);
  }
  res.json({ ok: true });
});

app.post('/reset-password', rateLimit(10, 15 * 60 * 1000), async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.json({ ok: false });
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) return res.json({ ok: false, message: 'كلمة المرور يجب أن تكون بين 8 و 128 حرفاً' });
  const { data } = await supabase.from('email_tokens').select('*').eq('token', token).eq('type', 'reset').eq('used', false).single();
  if (!data) return res.json({ ok: false, message: 'الرابط غير صالح أو منتهي الصلاحية' });
  if (new Date(data.expires_at) < new Date()) return res.json({ ok: false, message: 'انتهت صلاحية الرابط' });
  const hash = await bcrypt.hash(password, 10);
  await supabase.from('users').update({ password_hash: hash }).eq('id', data.user_id);
  await supabase.from('email_tokens').update({ used: true }).eq('id', data.id);
  res.json({ ok: true });
});

// ══ STAFF ROUTES ═══════════════════════════════════════

app.post('/staff/login', rateLimit(5, 15 * 60 * 1000), async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.json({ ok: false, message: 'أدخل البيانات' });
  const { data } = await supabase.from('staff').select('*').eq('username', username).single();
  if (!data) return res.json({ ok: false, message: 'اسم المستخدم غير صحيح' });
  const valid = await bcrypt.compare(password, data.password_hash);
  if (!valid) return res.json({ ok: false, message: 'كلمة المرور غير صحيحة' });
  const token = jwt.sign({ staffId: data.id }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ ok: true, staff: { id: data.id, username: data.username, name: data.name }, token });
});

app.get('/staff/tasks/:staffId', async (req, res) => {
  const { staffId } = req.params;
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.json({ ok: false, message: 'غير مصرح' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.staffId !== staffId) return res.json({ ok: false, message: 'غير مصرح' });
  } catch { return res.json({ ok: false, message: 'غير مصرح' }); }
  const { data } = await supabase.from('tasks').select('*').eq('assigned_staff', staffId).order('created_at', { ascending: false });
  res.json({ ok: true, tasks: data || [] });
});

app.post('/staff/tasks/:taskId/update', async (req, res) => {
  const { taskId } = req.params;
  const { notes, status } = req.body;
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.json({ ok: false, message: 'غير مصرح' });
  let staffId;
  try { staffId = jwt.verify(token, JWT_SECRET).staffId; }
  catch { return res.json({ ok: false, message: 'غير مصرح' }); }
  if (!staffId) return res.json({ ok: false, message: 'غير مصرح' });
  // Verify this task is actually assigned to this staff member
  const { data: task } = await supabase.from('tasks').select('assigned_staff').eq('id', taskId).single();
  if (!task || task.assigned_staff !== staffId) return res.json({ ok: false, message: 'غير مصرح' });
  await supabase.from('tasks').update({ notes, status, updated_at: new Date().toISOString() }).eq('id', taskId);
  res.json({ ok: true });
});

// ══ TASK COMMENTS ══════════════════════════════════════

app.get('/tasks/:taskId/comments', async (req, res) => {
  const { taskId } = req.params;
  const bearerToken = req.headers['authorization']?.split(' ')[1];
  const adminToken  = req.headers['x-admin-token'];
  if (!bearerToken && !adminToken) return res.json({ ok: false, message: 'غير مصرح' });
  if (bearerToken) {
    try { jwt.verify(bearerToken, JWT_SECRET); }
    catch { return res.json({ ok: false, message: 'غير مصرح' }); }
  }
  if (adminToken) {
    try {
      const d = jwt.verify(adminToken, JWT_SECRET);
      if (d.role !== 'admin') throw new Error();
    } catch { return res.json({ ok: false, message: 'غير مصرح' }); }
  }
  const { data } = await supabase.from('task_comments').select('*').eq('task_id', taskId).order('created_at', { ascending: true });
  res.json({ ok: true, comments: data || [] });
});

app.post('/tasks/:taskId/comments', async (req, res) => {
  const { taskId } = req.params;
  const { content } = req.body;
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.json({ ok: false, message: 'غير مصرح' });
  let staffId;
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!decoded.staffId) return res.json({ ok: false, message: 'غير مصرح' });
    staffId = decoded.staffId;
  } catch { return res.json({ ok: false, message: 'غير مصرح' }); }
  // Verify this staff member is assigned to the task
  const { data: task } = await supabase.from('tasks').select('assigned_staff').eq('id', taskId).single();
  if (!task || task.assigned_staff !== staffId) return res.json({ ok: false, message: 'غير مصرح' });
  if (!content?.trim()) return res.json({ ok: false, message: 'أدخل تعليقاً' });
  if (typeof content !== 'string' || content.trim().length > 1000)
    return res.json({ ok: false, message: 'التعليق طويل جداً (1000 حرف كحد أقصى)' });
  const { data } = await supabase.from('task_comments').insert([{ task_id: taskId, author: 'staff', content: content.trim() }]).select().single();
  res.json({ ok: true, comment: data });
});

app.post('/admin/tasks/:taskId/comments', adminMiddleware, async (req, res) => {
  const { taskId } = req.params;
  const { content } = req.body;
  if (!content?.trim()) return res.json({ ok: false, message: 'أدخل تعليقاً' });
  if (typeof content !== 'string' || content.trim().length > 1000)
    return res.json({ ok: false, message: 'التعليق طويل جداً (1000 حرف كحد أقصى)' });
  const { data } = await supabase.from('task_comments').insert([{ task_id: taskId, author: 'admin', content: content.trim() }]).select().single();
  res.json({ ok: true, comment: data });
});

// ══ TASKS ROUTES ═══════════════════════════════════════

app.get('/tasks/:userId', authMiddleware, async (req, res) => {
  if (req.userId !== req.params.userId) return res.status(403).json({ ok: false });
  const { data } = await supabase.from('tasks').select('*').eq('assigned_to', req.params.userId).order('created_at', { ascending: false });
  res.json({ ok: true, tasks: data || [] });
});

app.post('/tasks/:taskId/update', authMiddleware, async (req, res) => {
  const { taskId } = req.params;
  const { notes, status } = req.body;
  // Verify this task belongs to the authenticated user
  const { data: task } = await supabase.from('tasks').select('assigned_to').eq('id', taskId).single();
  if (!task || task.assigned_to !== req.userId) return res.status(403).json({ ok: false, message: 'غير مصرح' });
  await supabase.from('tasks').update({ notes, status, updated_at: new Date().toISOString() }).eq('id', taskId);
  res.json({ ok: true });
});

// ══ ADMIN ROUTES ═══════════════════════════════════════

app.post('/admin/login', rateLimit(5, 15 * 60 * 1000), (req, res) => {
  const { password } = req.body;
  let valid = false;
  try {
    const a = Buffer.from(String(password || ''));
    const b = Buffer.from(ADMIN_PASSWORD);
    valid = a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch { valid = false; }
  if (!valid) return res.json({ ok: false, message: 'كلمة المرور خاطئة' });
  // Issue a short-lived signed token — the password is never stored client-side
  const adminToken = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '8h' });
  res.json({ ok: true, token: adminToken });
});

app.get('/admin/stats', adminMiddleware, async (req, res) => {
  const { count: totalUsers }   = await supabase.from('users').select('*', { count: 'exact', head: true });
  const { count: totalReports } = await supabase.from('reports').select('*', { count: 'exact', head: true });
  const { count: newReports }   = await supabase.from('reports').select('*', { count: 'exact', head: true }).eq('reviewed', false);
  const { count: bannedUsers }  = await supabase.from('users').select('*', { count: 'exact', head: true }).eq('is_banned', true);
  const onlineCount = io.engine.clientsCount;
  res.json({ ok: true, stats: { totalUsers, totalReports, newReports, bannedUsers, onlineCount } });
});

app.post('/reports', authMiddleware, rateLimit(5, 60 * 60 * 1000), async (req, res) => {
  const reporterId = req.userId;
  const { reported_id, reason } = req.body;
  if (!reported_id || typeof reported_id !== 'string') return res.json({ ok: false });
  if (reporterId === reported_id) return res.json({ ok: false });
  const cleanReason = String(reason || '').trim().slice(0, 500);
  const { error } = await supabase.from('reports').insert([{
    reporter_id: reporterId,
    reported_id,
    reason: cleanReason
  }]);
  if (error) return res.json({ ok: false });
  res.json({ ok: true });
});

app.get('/admin/reports', adminMiddleware, async (req, res) => {
  const { data } = await supabase.from('reports')
    .select('*, reporter:users!reports_reporter_id_fkey(username, email), reported:users!reports_reported_id_fkey(username, email, is_banned)')
    .order('created_at', { ascending: false });
  res.json({ ok: true, reports: data || [] });
});

app.get('/admin/suspicious', adminMiddleware, async (req, res) => {
  // Count ALL reports (not just unreviewed) so reviewing without banning doesn't reset the count
  const { data } = await supabase.from('reports')
    .select('reported_id, users!reports_reported_id_fkey(username, email, is_banned, avatar_url)');
  const counts = {};
  (data || []).forEach(r => {
    const id = r.reported_id;
    if (!counts[id]) counts[id] = { count: 0, user: r.users, id };
    counts[id].count++;
  });
  const suspicious = Object.values(counts).filter(u => u.count >= 10).sort((a, b) => b.count - a.count);
  res.json({ ok: true, suspicious });
});

app.get('/admin/users', adminMiddleware, async (req, res) => {
  const { data } = await supabase.from('users')
    .select('id, username, email, is_banned, avatar_url, created_at, total_chats, total_seconds')
    .order('created_at', { ascending: false });
  res.json({ ok: true, users: data || [] });
});

app.post('/admin/ban', adminMiddleware, async (req, res) => {
  const { userId } = req.body;
  await supabase.from('users').update({ is_banned: true }).eq('id', userId);
  for (const [socketId, meta] of userMeta.entries()) {
    if (meta.userId === userId) {
      io.sockets.sockets.get(socketId)?.emit('banned');
      io.sockets.sockets.get(socketId)?.disconnect(true);
      break;
    }
  }
  res.json({ ok: true });
});

app.post('/admin/unban', adminMiddleware, async (req, res) => {
  const { userId } = req.body;
  await supabase.from('users').update({ is_banned: false }).eq('id', userId);
  res.json({ ok: true });
});

app.post('/admin/review-report', adminMiddleware, async (req, res) => {
  const { reportId } = req.body;
  await supabase.from('reports').update({ reviewed: true }).eq('id', reportId);
  res.json({ ok: true });
});

app.get('/admin/user-reports/:userId', adminMiddleware, async (req, res) => {
  const { data } = await supabase.from('reports')
    .select('*, reporter:users!reports_reporter_id_fkey(username, email)')
    .eq('reported_id', req.params.userId).order('created_at', { ascending: false });
  res.json({ ok: true, reports: data || [] });
});

app.post('/admin/delete-user', adminMiddleware, async (req, res) => {
  const { userId } = req.body;
  await supabase.from('users').delete().eq('id', userId);
  res.json({ ok: true });
});

app.get('/admin/staff', adminMiddleware, async (req, res) => {
  const { data } = await supabase.from('staff').select('id, username, name, created_at').order('created_at', { ascending: false });
  res.json({ ok: true, staff: data || [] });
});

app.post('/admin/staff/create', adminMiddleware, async (req, res) => {
  const { username, password, name } = req.body;
  if (!username || !password || !name) return res.json({ ok: false, message: 'أكمل البيانات' });
  const hash = await bcrypt.hash(password, 10);
  const { data, error } = await supabase.from('staff').insert([{ username, password_hash: hash, name }]).select().single();
  if (error) return res.json({ ok: false, message: 'اسم المستخدم مستخدم' });
  res.json({ ok: true, staff: data });
});

app.post('/admin/staff/delete', adminMiddleware, async (req, res) => {
  const { staffId } = req.body;
  await supabase.from('staff').delete().eq('id', staffId);
  res.json({ ok: true });
});

app.get('/admin/tasks', adminMiddleware, async (req, res) => {
  const { data } = await supabase.from('tasks')
    .select('*, assigned_user:users!tasks_assigned_to_fkey(username, avatar_url), assigned_staff_user:staff!tasks_assigned_staff_fkey(name, username)')
    .order('created_at', { ascending: false });
  res.json({ ok: true, tasks: data || [] });
});

app.post('/admin/tasks/create', adminMiddleware, async (req, res) => {
  const { title, description, assignedTo, assignedStaff, deadline } = req.body;
  const { data, error } = await supabase.from('tasks').insert([{
    title, description,
    assigned_to:    assignedTo    || null,
    assigned_staff: assignedStaff || null,
    deadline:       deadline      || null,
    status:         'pending'
  }]).select().single();
  if (error) return res.json({ ok: false, message: error.message });
  res.json({ ok: true, task: data });
});

app.post('/admin/tasks/edit', adminMiddleware, async (req, res) => {
  const { taskId, title, description, deadline } = req.body;
  await supabase.from('tasks').update({
    title, description,
    deadline: deadline ? new Date(deadline).toISOString() : null,
    updated_at: new Date().toISOString()
  }).eq('id', taskId);
  res.json({ ok: true });
});

app.post('/admin/tasks/delete', adminMiddleware, async (req, res) => {
  const { taskId } = req.body;
  await supabase.from('tasks').delete().eq('id', taskId);
  res.json({ ok: true });
});

// ══ MESSAGES ROUTES ════════════════════════════════════

app.get('/messages/:userId/:friendId', authMiddleware, async (req, res) => {
  const { userId, friendId } = req.params;
  if (req.userId !== userId) return res.json({ ok: false, message: 'غير مصرح' });
  const { data } = await supabase.from('messages')
    .select('*')
    .or(`and(sender_id.eq.${userId},receiver_id.eq.${friendId}),and(sender_id.eq.${friendId},receiver_id.eq.${userId})`)
    .order('created_at', { ascending: true })
    .limit(50);
  await supabase.from('messages').update({ read: true })
    .eq('receiver_id', userId).eq('sender_id', friendId).eq('read', false);
  res.json({ ok: true, messages: data || [] });
});

app.post('/messages/send', authMiddleware, async (req, res) => {
  const { receiverId, content } = req.body;
  const senderId = req.userId;
  if (!senderId || !receiverId || !content?.trim()) return res.json({ ok: false });
  if (typeof content !== 'string' || content.trim().length > 1000)
    return res.json({ ok: false, message: 'الرسالة طويلة جداً (1000 حرف كحد أقصى)' });
  const { data } = await supabase.from('messages')
    .insert([{ sender_id: senderId, receiver_id: receiverId, content: content.trim() }])
    .select().single();
  for (const [socketId, meta] of userMeta.entries()) {
    if (meta.userId === receiverId) {
      io.to(socketId).emit('new-message', { from: senderId, content: content.trim() });
      break;
    }
  }
  res.json({ ok: true, message: data });
});

app.get('/messages/unread/:userId', authMiddleware, async (req, res) => {
  if (req.userId !== req.params.userId) return res.status(403).json({ ok: false });
  const { data } = await supabase.from('messages')
    .select('sender_id').eq('receiver_id', req.params.userId).eq('read', false);
  const counts = {};
  (data || []).forEach(m => { counts[m.sender_id] = (counts[m.sender_id] || 0) + 1; });
  res.json({ ok: true, counts });
});

// ══ GAME ROUTES ════════════════════════════════════════════════════════════

app.post('/game/create-room', authMiddleware, async (req, res) => {
  const { maxPlayers } = req.body;
  const roomCode = gameEngine.genRoomCode();
  const { error } = await supabase.from('game_rooms').insert([{
    room_code:   roomCode,
    host_id:     req.userId,
    status:      'waiting',
    max_players: Math.min(4, Math.max(2, parseInt(maxPlayers) || 4))
  }]);
  if (error) return res.json({ ok: false, message: 'فشل إنشاء الغرفة' });
  gameEngine.createGameRoom(roomCode, req.userId, maxPlayers);
  res.json({ ok: true, roomCode });
});

app.get('/game/friends-rooms', authMiddleware, async (req, res) => {
  const userId = req.userId;
  const { data: friends } = await supabase.from('friendships').select('user_id, friend_id')
    .eq('status', 'accepted').or(`user_id.eq.${userId},friend_id.eq.${userId}`);
  const friendIds = (friends || []).map(f => f.user_id === userId ? f.friend_id : f.user_id);
  if (!friendIds.length) return res.json({ ok: true, rooms: [] });
  const openRooms = gameEngine.getOpenRooms().filter(r => friendIds.includes(r.hostId));
  const enriched  = await Promise.all(openRooms.map(async r => {
    const { data: host } = await supabase.from('users').select('username, avatar_url').eq('id', r.hostId).single();
    return { ...r, hostUsername: host?.username || '?', hostAvatar: host?.avatar_url || null };
  }));
  res.json({ ok: true, rooms: enriched });
});

app.get('/game/my-invites/:userId', authMiddleware, async (req, res) => {
  if (req.userId !== req.params.userId) return res.json({ ok: false });
  const { data } = await supabase.from('game_invites')
    .select('*').eq('to_user_id', req.params.userId).eq('status', 'pending')
    .order('created_at', { ascending: false });
  const enriched = await Promise.all((data || []).map(async inv => {
    const { data: from } = await supabase.from('users').select('username, avatar_url').eq('id', inv.from_user_id).single();
    return { ...inv, fromUsername: from?.username || '?', fromAvatar: from?.avatar_url || null };
  }));
  res.json({ ok: true, invites: enriched });
});

app.get('/game/history/me', authMiddleware, async (req, res) => {
  const { data } = await supabase.from('game_history')
    .select('*').contains('player_ids', [req.userId])
    .order('played_at', { ascending: false }).limit(20);
  res.json({ ok: true, history: data || [] });
});

// ══ SOCKET STATE ═══════════════════════════════════════
const waiting  = [];
const rooms    = new Map();
const userMeta = new Map();
const lastSeen = new Map(); // userId → timestamp (ms), set on disconnect
const onlineNotifSent = new Set(); // "fromId-friendId" — prevents repeat "online" notifs per server session

async function notifyFriendsOnline(userId, username) {
  try {
    const { data: friendships } = await supabase.from('friendships')
      .select('user_id, friend_id')
      .or(`user_id.eq.${userId},friend_id.eq.${userId}`)
      .eq('status', 'accepted');
    if (!friendships?.length) return;
    const { data: me } = await supabase.from('users').select('avatar_url').eq('id', userId).single();
    const avatar = me?.avatar_url || null;
    for (const f of friendships) {
      const friendId = f.user_id === userId ? f.friend_id : f.user_id;
      const key = `${userId}-${friendId}`;
      if (onlineNotifSent.has(key)) continue;
      onlineNotifSent.add(key);
      createNotif(friendId, 'friend_online', userId, username, avatar,
        `${username} أصبح متاحاً الآن`, '/').catch(() => {});
      notifyDefault(friendId, 'friend-came-online', { userId, username, avatarUrl: avatar });
    }
  } catch (_) {}
}

function genRoomId() { return crypto.randomBytes(6).toString('hex'); }

function getOnlineCount() {
  const userIds = new Set();
  let guests = 0;
  for (const meta of userMeta.values()) {
    if (meta.userId) userIds.add(meta.userId);
    else guests++;
  }
  return userIds.size + guests;
}

function sharedInterests(a, b) {
  if (!a.length || !b.length) return true;
  return a.some(i => b.includes(i));
}

function findMatch(socket, meta) {
  for (let i = 0; i < waiting.length; i++) {
    const candidate = waiting[i];
    if (candidate.socketId === socket.id) continue;
    const cMeta = userMeta.get(candidate.socketId);
    if (!cMeta) continue;
    // Never match the same account with itself
    if (meta.userId && cMeta.userId && meta.userId === cMeta.userId) continue;
    if (meta.qatarOnly && cMeta.qatarOnly) {}
    else if (meta.qatarOnly || cMeta.qatarOnly) continue;
    if (!sharedInterests(meta.interests, cMeta.interests)) continue;
    waiting.splice(i, 1);
    return candidate;
  }
  return null;
}

io.on('connection', (socket) => {
  socket.emit('online-count', getOnlineCount());

  socket.on('join', ({ username, interests = [], qatarOnly = true, token = null }) => {
    let verifiedUserId = null;
    if (token) {
      try { verifiedUserId = jwt.verify(token, JWT_SECRET).userId || null; }
      catch { /* guest or invalid token — no userId */ }
    }
    // Check BEFORE set: was this user already connected on another socket?
    const wasAlreadyOnline = verifiedUserId &&
      [...userMeta.values()].some(m => m.userId === verifiedUserId);
    userMeta.set(socket.id, { username, interests, qatarOnly, userId: verifiedUserId });
    io.emit('online-count', getOnlineCount());
    // Only notify friends on first socket (not every reconnect / page change)
    if (verifiedUserId && !wasAlreadyOnline) {
      notifyFriendsOnline(verifiedUserId, username).catch(() => {});
    }
  });

  socket.on('find-match', () => {
    const meta  = userMeta.get(socket.id) || { interests: [], qatarOnly: false };
    // Guard: same socket or same userId already in queue
    if (waiting.some(w => {
      if (w.socketId === socket.id) return true;
      if (meta.userId) {
        const wMeta = userMeta.get(w.socketId);
        if (wMeta?.userId === meta.userId) return true;
      }
      return false;
    })) return;
    // Guard: same userId already in an active room (two tabs trying to chat)
    if (meta.userId) {
      for (const members of rooms.values()) {
        for (const sid of members) {
          if (sid !== socket.id && userMeta.get(sid)?.userId === meta.userId) {
            socket.emit('already-in-chat');
            return;
          }
        }
      }
    }
    const match = findMatch(socket, meta);
    if (match) {
      const roomId   = genRoomId();
      const myMeta   = userMeta.get(socket.id);
      const peerMeta = userMeta.get(match.socketId);
      rooms.set(roomId, [socket.id, match.socketId]);
      socket.join(roomId);
      io.sockets.sockets.get(match.socketId)?.join(roomId);
      socket.emit('matched', { roomId, initiator: true,  peerId: peerMeta?.userId || null, peerName: peerMeta?.username || 'ضيف' });
      io.to(match.socketId).emit('matched', { roomId, initiator: false, peerId: myMeta?.userId || null, peerName: myMeta?.username || 'ضيف' });
    } else {
      waiting.push({ socketId: socket.id });
      socket.emit('waiting');
    }
  });

  socket.on('chat-msg', ({ roomId, text }) => {
    if (!roomId || typeof text !== 'string') return;
    const clean = text.trim().slice(0, 500);
    if (!clean) return;
    const members = rooms.get(roomId);
    if (!members?.includes(socket.id)) return;
    socket.to(roomId).emit('chat-msg', { text: clean });
  });

  // Only relay signals for rooms this socket belongs to
  socket.on('signal', ({ roomId, data }) => {
    const members = rooms.get(roomId);
    if (!members?.includes(socket.id)) return;
    socket.to(roomId).emit('signal', { data });
  });

  socket.on('next', ({ roomId }) => {
    if (roomId) { socket.to(roomId).emit('peer-left'); leaveRoom(socket, roomId); }
    // Guard against duplicate waiting entries
    if (waiting.some(w => w.socketId === socket.id)) return;
    const meta  = userMeta.get(socket.id) || { interests: [], qatarOnly: false };
    const match = findMatch(socket, meta);
    if (match) {
      const newRoom  = genRoomId();
      const myMeta   = userMeta.get(socket.id);
      const peerMeta = userMeta.get(match.socketId);
      rooms.set(newRoom, [socket.id, match.socketId]);
      socket.join(newRoom);
      io.sockets.sockets.get(match.socketId)?.join(newRoom);
      socket.emit('matched', { roomId: newRoom, initiator: true,  peerId: peerMeta?.userId || null, peerName: peerMeta?.username || 'ضيف' });
      io.to(match.socketId).emit('matched', { roomId: newRoom, initiator: false, peerId: myMeta?.userId || null, peerName: myMeta?.username || 'ضيف' });
    } else {
      waiting.push({ socketId: socket.id });
      socket.emit('waiting');
    }
  });

  socket.on('report', async ({ roomId, reason }) => {
    const reporterMeta = userMeta.get(socket.id);
    let reportedMeta = null;
    if (roomId) {
      const members = rooms.get(roomId) || [];
      const peerSocketId = members.find(id => id !== socket.id);
      if (peerSocketId) reportedMeta = userMeta.get(peerSocketId);
    }
    if (reporterMeta?.userId && reportedMeta?.userId) {
      const cleanReason = String(reason || '').trim().slice(0, 500);
      await supabase.from('reports').insert([{ reporter_id: reporterMeta.userId, reported_id: reportedMeta.userId, reason: cleanReason }]);
    }
    socket.emit('report-received');
  });

  socket.on('send-game-invite', async ({ toUserId, roomCode }) => {
    const fromUserId = userMeta.get(socket.id)?.userId;
    if (!fromUserId || !toUserId || !roomCode) return;
    const { data: fs } = await supabase.from('friendships').select('id')
      .or(`and(user_id.eq.${fromUserId},friend_id.eq.${toUserId}),and(user_id.eq.${toUserId},friend_id.eq.${fromUserId})`)
      .eq('status', 'accepted').single();
    if (!fs) return;
    await supabase.from('game_invites').insert([{
      room_code: roomCode, from_user_id: fromUserId, to_user_id: toUserId, status: 'pending'
    }]);
    const fromMeta = userMeta.get(socket.id);
    const fromUsername = fromMeta?.username || '؟';
    for (const [sid, meta] of userMeta.entries()) {
      if (meta.userId === toUserId) {
        io.to(sid).emit('game-invite-received', { fromUserId, fromUsername, roomCode });
        break;
      }
    }
    // Persist notification so offline users see it when they next open the bell
    const { data: fromUser } = await supabase.from('users')
      .select('avatar_url').eq('id', fromUserId).single();
    createNotif(toUserId, 'game_invite', fromUserId, fromUsername,
      fromUser?.avatar_url || null,
      `${fromUsername} دعاك للعب Qemy`, '/qemy').catch(() => {});
  });

  socket.on('respond-game-invite', async ({ roomCode, accepted, fromUserId }) => {
    const myUserId  = userMeta.get(socket.id)?.userId;
    const myMeta    = userMeta.get(socket.id);
    if (!myUserId) return;
    await supabase.from('game_invites')
      .update({ status: accepted ? 'accepted' : 'declined' })
      .eq('room_code', roomCode).eq('to_user_id', myUserId);
    for (const [sid, meta] of userMeta.entries()) {
      if (meta.userId === fromUserId) {
        if (accepted) {
          io.to(sid).emit('game-invite-accepted', { byUserId: myUserId, byUsername: myMeta?.username, roomCode });
        } else {
          io.to(sid).emit('game-invite-declined', { byUsername: myMeta?.username });
        }
        break;
      }
    }
  });

  socket.on('friend-msg', async ({ toUserId, content, fromUserId }) => {
    if (!content?.trim() || !toUserId || !fromUserId) return;
    if (userMeta.get(socket.id)?.userId !== fromUserId) return;
    if (typeof content !== 'string' || content.trim().length > 1000) return;
    await supabase.from('messages').insert([{
      sender_id: fromUserId,
      receiver_id: toUserId,
      content: content.trim()
    }]);
    for (const [socketId, meta] of userMeta.entries()) {
      if (meta.userId === toUserId) {
        io.to(socketId).emit('new-message', { from: fromUserId, content: content.trim() });
        break;
      }
    }
  });

  socket.on('disconnect', () => {
    const disconnectedUserId = userMeta.get(socket.id)?.userId;
    if (disconnectedUserId) lastSeen.set(disconnectedUserId, Date.now());
    userMeta.delete(socket.id);
    const idx = waiting.findIndex(w => w.socketId === socket.id);
    if (idx !== -1) waiting.splice(idx, 1);
    for (const [roomId, members] of rooms.entries()) {
      if (members.includes(socket.id)) {
        socket.to(roomId).emit('peer-left');
        rooms.delete(roomId);
        break;
      }
    }
    io.emit('online-count', getOnlineCount());
  });
});

function leaveRoom(socket, roomId) {
  socket.leave(roomId);
  const members = rooms.get(roomId);
  if (members) {
    rooms.set(roomId, members.filter(id => id !== socket.id));
    if (rooms.get(roomId).length === 0) rooms.delete(roomId);
  }
}

// ══ IMPOSTER GAME ═════════════════════════════════════════════════════════════
(function setupImposter() {
  const TOPICS = [
    {category:'فواكه',      words:['تفاح','برتقال','موز','عنب','مانجا','فراولة','بطيخ','خوخ','كمثرى','أناناس','رمان','توت']},
    {category:'رياضات',     words:['كرة القدم','كرة السلة','سباحة','تنس','ملاكمة','كرة طائرة','جري','ركوب دراجات','جودو','غولف','تنس الطاولة','كرة يد']},
    {category:'حيوانات',    words:['أسد','نمر','فيل','زرافة','دلفين','ببغاء','تمساح','ذئب','قرد','نسر','حصان','ضبع']},
    {category:'مشروبات',    words:['قهوة','شاي','عصير برتقال','لبن','كوكاكولا','ماء','عصير تفاح','شاي أخضر','عصير رمان','كرك','شاي أحمر','ريد بول']},
    {category:'دول',        words:['الإمارات','السعودية','الكويت','مصر','تركيا','فرنسا','اليابان','البرازيل','أستراليا','ألمانيا','إيطاليا','إسبانيا']},
    {category:'مهن',        words:['طبيب','مهندس','معلم','طيار','شرطي','محامي','ممرض','مصور','طاهي','مبرمج','صحفي','معمار']},
    {category:'أكلات',      words:['مجبوس','بريياني','كبسة','شاورما','فلافل','هامبرغر','سشمي','باستا','بيتزا','مشاوي','مندي','ملوخية']},
    {category:'سيارات',     words:['تويوتا','بي إم دبليو','مرسيدس','لاند روفر','بورشه','فيراري','نيسان','فولفو','هوندا','فورد','لكزس','أودي']},
    {category:'أماكن',words:['سوق واقف','الكورنيش','لوسيل','مطار حمد','فيلا جيريا','كتارا','الزعبل','ام سليم','لاقونا','البرج الخليفة']},
    {category:'آلات موسيقية',words:['بيانو','جيتار','كمان','طبل','ناي','عود','أكورديون','ترومبيت','ساكسفون','هارب','باس','دف']},
    {category:'أجهزة إلكترونية',words:['آيفون','بلايستيشن','لابتوب','تلفزيون','ساعة ذكية','سماعات','تابلت','كاميرا','سبيكر','إكس بوكس']},
    {category:'حيوانات بحرية',words:['دلفين','أخطبوط','سمكة قرش','حصان البحر','سلحفاة','حبار','نجم البحر','قنديل البحر','تونة','أنقليس']},
  ];

  // rooms[roomId] = { id, hostId, players:[{id,name,avatar,avatarUrl,userId}], phase, maxRounds, currentRound, roundsDone,
  //                   topic:{category,words[]}, imposterId, playerWords:{socketId->word},
  //                   pairSequence:[{asker,answerer}], currentPairIndex, votes:{id->count}, playerVotes:{id->id} }
  const iRooms = {};
  const pairTimers = {};

  function genCode() {
    const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from({length:6}, () => c[crypto.randomInt(c.length)]).join('');
  }

  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length-1; i > 0; i--) { const j = Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; }
    return a;
  }

  function buildPairs(players) {
    const s = shuffle(players);
    return s.map((p, i) => ({ asker: p.id, answerer: s[(i+1) % s.length].id }));
  }

  function publicRoom(r) {
    return {
      roomId: r.id, hostId: r.hostId, phase: r.phase,
      maxRounds: r.maxRounds, currentRound: r.currentRound, roundsDone: r.roundsDone,
      players: r.players.map(p => ({ id:p.id, name:p.name, avatar:p.avatar, avatarUrl:p.avatarUrl||null })),
      pairSequence: r.pairSequence, currentPairIndex: r.currentPairIndex,
      votes: r.phase === 'results' ? r.votes : {},
      playerVotes: r.phase === 'results' ? r.playerVotes : {},
      imposterId: r.phase === 'results' ? r.imposterId : null,
      
      // FIX: Now sends the category during all active phases, not just results
      topicCategory: r.phase !== 'lobby' ? r.topic?.category : null,
      playerWords: r.phase === 'results' ? r.playerWords : null,
    };
  }

  function broadcast(r) {
    r.players.forEach(p => {
      io.to(p.id).emit('imposter:update', publicRoom(r));
    });
  }

  function getRoomBySocket(sid) {
    return Object.values(iRooms).find(r => r.players.some(p => p.id === sid));
  }

  function advancePair(r) {
    clearTimeout(pairTimers[r.id]);
    r.currentPairIndex++;
    if (r.currentPairIndex >= r.pairSequence.length) {
      r.roundsDone++;
      r.phase = 'round_end';
      broadcast(r);
    } else {
      broadcast(r);
      startPairTimer(r);
    }
  }

  function startPairTimer(r) {
    clearTimeout(pairTimers[r.id]);
    // FIX: Changed from 60 to 30 seconds
    r.players.forEach(p => io.to(p.id).emit('imposter:pair_timer', { seconds: 30 }));
    pairTimers[r.id] = setTimeout(() => {
      if (iRooms[r.id] && r.phase === 'discussion') advancePair(r);
    }, 32000); // FIX: 32000 ms (gives a 2 second buffer for network lag)
  }

  function finalizeVotes(r) {
    clearTimeout(r._voteTimer);
    r.phase = 'results';

    // Determine who won and award points
    let maxVotes = 0, mostVotedSocketId = null;
    for (const [sid, count] of Object.entries(r.votes)) {
      if (count > maxVotes) { maxVotes = count; mostVotedSocketId = sid; }
    }
    const impostorPlayer = r.players.find(p => p.id === r.imposterId);
    if (mostVotedSocketId === r.imposterId) {
      // Impostor correctly identified — reward all non-impostor players
      r.players.forEach(p => {
        if (p.id !== r.imposterId && p.userId) awardPoints(p.userId, 'imposter_win').catch(() => {});
      });
    } else if (impostorPlayer?.userId) {
      // Impostor survived — reward the impostor
      awardPoints(impostorPlayer.userId, 'imposter_win').catch(() => {});
    }
    // Award imposter_1 weekly task progress + increment imposter_rounds + check badges
    r.players.forEach(p => {
      if (!p.userId) return;
      updateTaskProgress(p.userId, 'imposter_1').catch(() => {});
      supabase.rpc('increment_imposter_rounds', { uid: p.userId })
        .then(() => checkAndAwardBadges(p.userId))
        .catch(() => {});
    });

    broadcast(r);
  }

  // Attach verified userId from JWT to every socket on the default namespace
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (token) {
      try { socket.verifiedUserId = jwt.verify(token, JWT_SECRET).userId || null; }
      catch { socket.verifiedUserId = null; }
    } else {
      socket.verifiedUserId = null;
    }
    next();
  });

  // Register imposter socket events on every new connection
  io.on('connection', (socket) => {
    // ── IMPOSTER WEBRTC SIGNALING RELAY ──
    socket.on('imposter:signal', ({ targetId, type, data }) => {
      // Only relay to sockets that are in the same imposter room as the sender
      const senderRoom = getRoomBySocket(socket.id);
      if (!senderRoom) return;
      const targetIsInRoom = senderRoom.players.some(p => p.id === targetId);
      if (!targetIsInRoom) return;
      io.to(targetId).emit('imposter:signal', {
        senderId: socket.id,
        type,
        data
      });
    });

    socket.on('imposter:create', ({ name, avatar, avatarUrl }) => {
      const userId = socket.verifiedUserId;
      const roomId = genCode();
      iRooms[roomId] = {
        id:roomId, hostId:socket.id, phase:'lobby',
        maxRounds:2, currentRound:1, roundsDone:0,
        players:[{ id:socket.id, name, avatar, avatarUrl:avatarUrl||null, userId }],
        topic:null, imposterId:null, playerWords:{},
        pairSequence:[], currentPairIndex:0,
        votes:{}, playerVotes:{}
      };
      socket.join(roomId);
      socket.emit('imposter:created', { roomId });
      broadcast(iRooms[roomId]);
    });

    socket.on('imposter:join', ({ roomId, name, avatar, avatarUrl }) => {
      const userId = socket.verifiedUserId;
      const r = iRooms[roomId];
      if (!r) return socket.emit('imposter:error', { msg:'الغرفة غير موجودة' });
      // Reconnect: same userId, new socketId
      const existing = r.players.find(p => p.userId && p.userId===userId);
      if (existing) {
        const oldId = existing.id;
        existing.id = socket.id;
        // Update playerWords key if needed
        if (r.playerWords[oldId] !== undefined) { r.playerWords[socket.id] = r.playerWords[oldId]; delete r.playerWords[oldId]; }
        // Update imposterId if needed
        if (r.imposterId === oldId) r.imposterId = socket.id;
        // Update pairSequence
        r.pairSequence = r.pairSequence.map(p => ({
          asker:    p.asker    === oldId ? socket.id : p.asker,
          answerer: p.answerer === oldId ? socket.id : p.answerer
        }));
        socket.join(roomId);
        socket.emit('imposter:joined', { roomId });
        if (r.phase !== 'lobby' && r.phase !== 'results') {
          const isImp = r.imposterId === socket.id;
          socket.emit('imposter:role', { role:isImp?'imposter':'normal', word:isImp?null:r.playerWords[socket.id], category:r.topic?.category });
          if (r.phase === 'discussion') socket.emit('imposter:pair_timer', { seconds:30 });
        }
        broadcast(r);
        return;
      }
      if (r.phase !== 'lobby') return socket.emit('imposter:error', { msg:'اللعبة بدأت بالفعل' });
      if (r.players.length >= 8) return socket.emit('imposter:error', { msg:'الغرفة ممتلئة (8/8)' });
      r.players.push({ id:socket.id, name, avatar, avatarUrl:avatarUrl||null, userId });
      socket.join(roomId);
      socket.emit('imposter:joined', { roomId });
      broadcast(r);
      io.to(roomId).emit('toast', { msg:`${name} انضم للغرفة 👋`, type:'info' });
    });

    socket.on('imposter:set_rounds', ({ roomId, maxRounds }) => {
      const r = iRooms[roomId];
      if (!r || r.hostId!==socket.id) return;
      r.maxRounds = Math.max(1, Math.min(4, maxRounds));
      broadcast(r);
    });

    socket.on('imposter:start', ({ roomId }) => {
      const r = iRooms[roomId];
      if (!r || r.hostId!==socket.id) return;
      if (r.players.length < 3) return socket.emit('imposter:error', { msg:'تحتاج 3 لاعبين على الأقل' });
      const t = TOPICS[Math.floor(Math.random()*TOPICS.length)];
      r.topic      = t;
      r.imposterId = r.players[Math.floor(Math.random()*r.players.length)].id;
      const words  = shuffle(t.words);
      r.playerWords = {};
      
      // FIX: Grab one single word and give it to everyone who isn't the Imposter
      const roomWord = words[0];
      r.players.forEach(p => { if (p.id!==r.imposterId) r.playerWords[p.id] = roomWord; });
      
      r.pairSequence    = buildPairs(r.players);
      r.currentPairIndex = 0;
      r.votes = {}; r.playerVotes = {};
      r.roundsDone   = 0;
      r.phase        = 'role_reveal';
      r.currentRound = 1;
      broadcast(r);
      r.players.forEach(p => {
        const isImp = p.id===r.imposterId;
        io.to(p.id).emit('imposter:role', { role:isImp?'imposter':'normal', word:isImp?null:r.playerWords[p.id], category:t.category });
      });
      setTimeout(() => {
        if (iRooms[roomId] && r.phase==='role_reveal') { r.phase='discussion'; broadcast(r); startPairTimer(r); }
      }, 15000);
    });

    socket.on('imposter:pair_done', ({ roomId }) => {
      const r = iRooms[roomId];
      if (!r || r.hostId!==socket.id) return;
      advancePair(r);
    });

    socket.on('imposter:another_round', ({ roomId }) => {
      const r = iRooms[roomId];
      if (!r || r.hostId!==socket.id || r.roundsDone>=r.maxRounds) return;
      r.pairSequence     = buildPairs(r.players);
      r.currentPairIndex = 0;
      r.currentRound     = r.roundsDone + 1;
      r.phase = 'discussion';
      broadcast(r);
      startPairTimer(r);
    });

    socket.on('imposter:vote', ({ roomId }) => {
      const r = iRooms[roomId];
      if (!r || r.hostId!==socket.id) return;
      clearTimeout(pairTimers[r.id]);
      r.phase='voting'; r.votes={}; r.playerVotes={};
      broadcast(r);
      r.players.forEach(p => io.to(p.id).emit('imposter:vote_timer', { seconds:45 }));
      r._voteTimer = setTimeout(() => { if (iRooms[roomId] && r.phase==='voting') finalizeVotes(r); }, 47000);
    });

    socket.on('imposter:cast_vote', ({ roomId, votedForId }) => {
      const r = iRooms[roomId];
      if (!r || r.phase!=='voting') return;
      if (r.playerVotes[socket.id]!==undefined) return;
      if (!r.players.find(p=>p.id===socket.id)) return;
      r.playerVotes[socket.id] = votedForId;
      r.votes[votedForId] = (r.votes[votedForId]||0) + 1;
      const prog = { votedCount:Object.keys(r.playerVotes).length, total:r.players.length };
      r.players.forEach(p => io.to(p.id).emit('imposter:vote_progress', prog));
      if (prog.votedCount >= prog.total) finalizeVotes(r);
    });

    // Lobby cleanup on disconnect only
    socket.on('disconnecting', () => {
      const r = getRoomBySocket(socket.id);
      if (!r || r.phase!=='lobby') return;
      const p = r.players.find(x=>x.id===socket.id);
      if (!p) return;
      r.players = r.players.filter(x=>x.id!==socket.id);
      if (r.players.length===0) { delete iRooms[r.id]; return; }
      if (r.hostId===socket.id) r.hostId = r.players[0].id;
      io.to(r.id).emit('toast', { msg:`${p.name} غادر الغرفة`, type:'error' });
      broadcast(r);
    });
  });
})();

// ══ GAME ENGINE ════════════════════════════════════════
function notifyDefault(userId, event, data) {
  for (const [sid, meta] of userMeta.entries()) {
    if (meta.userId === userId) { io.to(sid).emit(event, data); break; }
  }
}
const gameEngine = require('./game-logic')(io, supabase, JWT_SECRET, notifyDefault, updateTaskProgress, checkAndAwardBadges, awardPoints);

app.use((req, res) => { res.status(404).sendFile(path.join(__dirname, '404.html')); });
server.listen(PORT, () => console.log(`Qemistry running on port ${PORT}`));
