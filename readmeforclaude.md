# Qemistry — Claude Context File

> Read this at the start of every session before touching any code.
> Keep it updated after every session.

---

## What This Project Is

**Qemistry** (domain: `qemistry.live`) is a Qatar-focused social platform with:

- **Video chat** — random stranger video chat (WebRTC)
- **Friends system** — add friends, DM, presence indicators (online dot + last seen)
- **Qemy** — UNO-style multiplayer card game
- **برا السالفة (Imposter)** — social deduction game (like Spyfall)
- **Character quiz** — personality quiz on first signup, assigns one of 10 characters; unlocks `quiz_taker` badge + team badge
- **Points / XP system** — 6 actions award points, daily login dedup
- **Weekly tasks** — 5 tasks per week, progress tracked in DB, bonus points on completion
- **Notifications** — bell dropdown, DB-persisted, polled every 30s
- **Leaderboard** — individual top 50 by points + teams leaderboard grouped by character type
- **Profile frames** — equippable avatar borders (5 frames, unlock by stats)
- **Badges** — 15 badges total: 5 achievement badges + 10 team badges (one per character)
- **Full i18n** — Arabic + English on every page via `translations.js`

---

## Tech Stack

| Layer | Tech |
|---|---|
| Server | Node.js + Express + Socket.io |
| Database | Supabase (Postgres) |
| File storage | Supabase Storage (avatars) |
| Auth | JWT (`JWT_SECRET` env var) stored as `qc_token` in localStorage |
| WebRTC TURN | Hetzner `49.12.207.118:3478`, HMAC-SHA1 creds via `/api/ice-config` |
| Hosting | Railway (Nixpacks build via `nixpacks.toml`) |
| Email | Brevo (transactional — verification + reset) |

---

## File Map

```
server.js           — Express + all REST routes + Socket.io default namespace
                      + Imposter game IIFE at bottom of file
game-logic.js       — Qemy card game, /game Socket.io namespace
qatar-chat.html     — Main SPA (video chat + friends + auth + dashboard + verify page)
app.js              — Client JS for qatar-chat.html
chat.js             — Video chat WebRTC logic
style.css           — Global styles (loaded by all pages except public/index.html)
translations.js     — i18n (Arabic + English), applyTranslations(), setLang(), togglePageLang()

qemy.html           — Qemy lobby (create/join room)
qemy-board.html     — Qemy game board HTML
qemy-client.js      — Qemy game client JS
qemy-game.css       — Qemy-specific styles

public/index.html   — Imposter game (self-contained, loads translations.js + socket.io)

profile.html        — Public user profile page (standalone, loads translations.js)
leaderboard.html    — Leaderboard page (standalone, loads translations.js)
discover.html       — Discover users page (standalone, loads translations.js, /api/discover)
quiz.html           — Character personality quiz (standalone, taken once at registration)
verify-email.html   — Email verification landing page (token in URL query param)
notif.js            — Notification bell module (loaded on all nav pages, injects own CSS)

admin.html          — Admin panel
tasks.html          — Internal tasks board
nixpacks.toml       — Railway build config
.dockerignore       — Reduces Railway build context
readmeforclaude.md  — This file
```

---

## Key Architecture

### Socket.io Namespaces
- **`/` (default)** — video chat matching, presence, DMs, Imposter signaling, game invites
- **`/game`** — Qemy card game (JWT auth required, `socket.userId` set from token)

### Auth Pattern
- `localStorage.qc_token` → JWT for API calls (`Authorization: Bearer <token>`)
- `localStorage.qc_currentUser` → parsed user object cached locally
- `sessionStorage.admin_token` → admin JWT
- `authMiddleware` on server validates Bearer token, sets `req.userId`

### In-Memory Socket State (`server.js`)
```js
userMeta    // Map: socketId → { username, interests, qatarOnly, userId }
lastSeen    // Map: userId → timestamp (ms), set on disconnect
rooms       // Map: roomId → [socketId, socketId]  (video chat pairs)
iRooms      // Object: roomId → imposter room state
waiting     // Array of sockets waiting for video chat match
onlineNotifSent // Set: "fromId-friendId" — prevents repeat online notifs per server session
```

### Key Server Helpers
```js
awardPoints(userId, action)         // increments users.points
updateTaskProgress(userId, taskId)  // weekly task progress + bonus on completion
createNotif(userId, type, fromUserId, fromUsername, fromAvatar, message, link)
checkAndAwardBadges(userId)         // auto-awards all 15 badges based on stats
getFriendCount(userId)              // queries friendships table
notifyDefault(userId, event, data)  // emit socket event to a userId's connected socket
notifyFriendsOnline(userId, username) // notifies all friends when user first connects
```

### game-logic.js Call Signature
```js
module.exports = function setupGame(io, supabase, JWT_SECRET, notifyDefault, updateTaskProgress, checkAndAwardBadges)
```
Called from bottom of server.js — all 6 params must be passed.

### XSS Safety
- `_esc(str)` — escapes HTML for safe innerHTML (app.js)
- Always use this when injecting user content into innerHTML

---

## i18n System (`translations.js`)

All pages use a shared i18n system. **Every page must load `translations.js` before its own scripts.**

```js
t(key)                // returns AR or EN string based on localStorage.qc_lang
applyTranslations()   // updates all [data-t] elements + [data-badge-id] spans in DOM
setLang(lang)         // main app lang switch (qatar-chat.html) — calls applyTranslations + updateLandingState
togglePageLang()      // standalone page lang switch — defined locally in each page's script
```

**Markup patterns:**
```html
<!-- Static text element -->
<span data-t="nav-home">الرئيسية</span>

<!-- Input placeholder -->
<input data-t="imp-code-placeholder" placeholder="مثال: A1B2C3">

<!-- Badge span (JS-rendered) -->
<span class="earned-badge" data-badge-id="chat_king">ملك الدردشة 👑</span>
```

**Key groups in translations.js:**
- `nav-*` — nav link labels (home, imposter, leaderboard, discover, profile)
- `badge-*` — all 15 badge names in AR + EN
- `hobby-*` — 9 hobby/interest labels
- `imp-*` — ~32 imposter game strings
- `lb-*` — leaderboard strings
- `disc-*` — discover page strings

**Boot pattern on standalone pages:**
```js
(function() {
  const lang = localStorage.getItem('qc_lang') || 'ar';
  document.documentElement.lang = lang;
  document.documentElement.dir  = lang === 'ar' ? 'rtl' : 'ltr';
  const btn = document.getElementById('g-nav-lang-btn');
  if (btn) btn.textContent = lang === 'ar' ? 'EN' : 'ع';
  if (typeof applyTranslations === 'function') applyTranslations();
})();
```

---

## Global Nav

Present on every page. HTML is copy-pasted per page (no server-side include).

```html
<nav class="g-nav">
  <a class="g-nav-logo" href="/">Qemistry 🇶🇦</a>
  <div class="g-nav-links">
    <a href="/" class="g-nav-link">🏠 <span class="g-nav-text" data-t="nav-home">الرئيسية</span></a>
    <a href="/qemy" class="g-nav-link">🃏 <span class="g-nav-text">Qemy</span></a>
    <a href="/imposter" class="g-nav-link">🕵️ <span class="g-nav-text" data-t="nav-imposter">برا السالفة</span></a>
    <a href="/leaderboard" class="g-nav-link">🏆 <span class="g-nav-text" data-t="nav-leaderboard">الترتيب</span></a>
    <a href="/discover" class="g-nav-link">🔍 <span class="g-nav-text" data-t="nav-discover">اكتشف</span></a>
    <button class="g-nav-bell" id="g-nav-bell">🔔<span class="g-nav-bell-badge" id="g-nav-bell-badge" style="display:none"></span></button>
    <a href="/#dashboard" class="g-nav-link" id="g-nav-profile">👤 <span class="g-nav-text" data-t="nav-profile">حسابي</span></a>
    <button class="g-nav-lang" id="g-nav-lang-btn" onclick="togglePageLang()">EN</button>
  </div>
</nav>
```

CSS for `.g-nav`, `.g-nav-bell`, `.g-nav-lang` is in `style.css`.
`public/index.html` (Imposter) has its own inline copy of these styles since it doesn't load `style.css`.
`notif.js` handles the bell on all pages.
Hidden on landing/auth/verify in qatar-chat.html via `showPage()`.

---

## Database Tables

### `users` (key columns)
```
id, username, email, avatar_url, bio, hobbies, birthdate
points              -- total XP
total_chats         -- permanent counter (not reset); max 200 increments/day via /save-chat rate limit
total_seconds       -- video chat time
game_wins           -- Qemy wins
imposter_rounds     -- total Imposter rounds played (for Ghost badge + Gamer frame)
streak_count, streak_last_date
last_login_date     -- for daily_login dedup
equipped_frame      -- 'default' | 'chatter' | 'social' | 'gamer' | 'elite'
earned_badges       -- text[] e.g. ['early_bird', 'chat_king', 'quiz_taker', 'team_robot']
character_type      -- one of 10 character IDs (see Characters section), null until quiz taken
character_is_temp   -- true if quiz was skipped (guest result)
email_verified, is_banned, terms_accepted, created_at
```

### `weekly_tasks`
```
id, user_id, week_start (date, Monday-based), task_id, progress, completed
unique(user_id, week_start, task_id)
```

### `notifications`
```
id, user_id, type, from_user_id, from_username, from_avatar, message, read (bool), link, created_at
```

### `chat_history`
```
id, user_id, peer_id, peer_name, chatted_at
-- deleted after 30 days via setInterval job
```

### `friendships`
```
id, user_id, friend_id, status ('pending'|'accepted'), created_at
```

### `game_invites`
```
id, room_code, from_user_id, to_user_id, status ('pending'|'accepted'|'declined')
```

### `email_tokens`
```
id, user_id, token (hex), type ('verify'|'reset'), expires_at, used (bool)
-- verify: 24h TTL, reset: 1h TTL
```

### `game_history`, `game_rooms` — Qemy game records

---

## Points System

```js
const POINT_VALUES = {
  chat_complete:   10,  // after 60s video chat (in /save-chat)
  friend_accepted: 15,  // sender gets this when request is accepted
  qemy_win:        25,  // handled inside game-logic.js directly (not via awardPoints)
  imposter_win:    20,
  daily_login:      5,  // deduplicated by last_login_date
  quiz_complete:   50,  // awarded once on POST /api/quiz/result when is_temp=false
};
```

---

## Weekly Tasks

```js
const WEEKLY_TASKS = [
  { id: 'chats_3',      target: 3,  reward: 30 },
  { id: 'qemy_wins_2',  target: 2,  reward: 40 },
  { id: 'imposter_1',   target: 1,  reward: 20 },
  { id: 'new_friend_1', target: 1,  reward: 25 },
  { id: 'login_days_3', target: 3,  reward: 35 },
];
```

Week starts on Monday. `getWeekStart()` returns Monday date string.
`ensureWeeklyTasks(userId)` upserts all 5 rows with `ignoreDuplicates:true`.

Trigger points:
- `chats_3` → in `/save-chat` after 60s chat
- `qemy_wins_2` → in `game-logic.js _handleWin`
- `imposter_1` → in `finalizeVotes`
- `new_friend_1` → in `/friend-respond` (accept branch)
- `login_days_3` → in `/api/points/add` (daily_login branch)

---

## Characters (Quiz)

10 character types, assigned by personality quiz at `/quiz`:

```
robot, ninja, wizard, alien, fox, ghost, knight, scientist, hacker, vampire
```

- Stored as `character_type` on the user
- `character_is_temp: true` means the user skipped the quiz
- Completing the quiz (not temp) unlocks `quiz_taker` badge + `team_<character>` badge
- Teams leaderboard groups users by `character_type` and sums their points

---

## Frames

```
default  — no special border (everyone)
chatter  — 50 total_chats
social   — 10 accepted friends (queried live via getFriendCount)
gamer    — game_wins + imposter_rounds >= 10
elite    — 500 points
```

CSS: `[data-frame="elite"]` box-shadow selectors in `style.css`.
Applied via `data-frame` attribute on avatar elements.
`PATCH /api/profile/frame` validates unlock server-side before saving.

---

## Badges (15 total)

### Achievement badges (5)
```
early_bird   — created_at < 2026-07-15
chat_king    — in top 10 by points (checked against leaderboard)
qemy_master  — game_wins >= 20
ghost        — imposter_rounds >= 20
quiz_taker   — completed quiz (character_type set + character_is_temp = false)
```

### Team badges (10, one per character)
```
team_robot, team_ninja, team_wizard, team_alien, team_fox,
team_ghost, team_knight, team_scientist, team_hacker, team_vampire
```
Awarded when quiz is completed with that character.

Auto-awarded by `checkAndAwardBadges(userId)`, called:
- On `GET /api/profile/:id` (self view)
- After every Imposter round (`finalizeVotes`)
- After every Qemy win (`game-logic.js _handleWin`)

Badge names are translated via `translations.js` keys `badge-*` in both AR + EN.
Badge spans use `data-badge-id` attribute so `applyTranslations()` updates them on lang toggle.

---

## Discover Page (`/discover`)

- Fetches top 20 users excluding self + accepted friends via `GET /api/discover?interests=...`
- Filter chips use Arabic DB values (`رياضة`, `ألعاب`, etc.) as the filter key
- `HOBBY_KEYS` map in `discover.html` translates stored Arabic values to the current language
- Filter chip text uses `<span data-t="hobby-*">` so `applyTranslations()` updates them

---

## Notifications

`createNotif(userId, type, fromUserId, fromUsername, fromAvatar, message, link)`

Triggered:
- `friend_request` → on `POST /friend-request`
- `friend_accept` → on `POST /friend-respond` (accept)
- `game_invite` → on `send-game-invite` socket event
- `friend_online` → on `join` socket (first connect only, using `onlineNotifSent` Set)

Frontend: `notif.js` (loaded on all nav pages, injects its own CSS, polls every 30s).

---

## Email Verification Flow

1. User registers → server creates JWT, returns `email_verified: false`
2. `app.js` calls `sendVerification()` → POST `/send-verification` (auth required, rate limited 3/hr)
3. Server inserts token into `email_tokens`, sends Brevo email with link to `/verify-email?token=...`
4. `startVerifyCheck()` polls `GET /api/profile/:userId` **with auth token** every 3s
   - Auth token required so server returns private fields including `email_verified`
5. User clicks email link → `verify-email.html` fetches `GET /api/verify-email?token=...`
6. Server marks user `email_verified=true`, marks token `used=true`
7. Polling detects `email_verified: true` → redirects to `/quiz` (new users) or interests page

---

## API Routes Summary

```
POST /register                   public — create account
POST /login                      public — returns JWT + user object
POST /send-verification          auth   — send/resend verification email (rate: 3/hr)
GET  /api/verify-email?token=... public — verify email token
POST /forgot-password            public — send reset email (rate: 3/hr)
POST /reset-password             public — consume reset token

GET  /api/profile/:userId        public — returns user + friend_count (private fields if self)
GET  /api/profile/:username      public — same via username lookup
PATCH /api/profile/frame         auth   — equip a frame (validates unlock)
POST /update-profile             auth   — update username/bio/hobbies/birthdate/avatar

POST /api/quiz/result            auth   — save character type, award quiz badges + points
GET  /api/quiz/characters        public — list of all 10 characters

GET  /api/notifications          auth   — last 20 notifications
PATCH /api/notifications/read-all auth  — mark all read
PATCH /api/notifications/:id/read auth  — mark one read

GET  /api/leaderboard            public — top 50 individual by points
GET  /api/leaderboard/teams      public — teams leaderboard grouped by character_type
GET  /api/discover               auth   — top 20 users excl. self+friends, optional ?interests=
GET  /api/weekly-tasks           auth   — this week's task progress
POST /api/points/add             auth   — award points for an action
GET  /api/online-status?ids=...  auth   — online/lastSeen for list of userIds
GET  /api/ice-config             PUBLIC — TURN server credentials (no auth — needed before login for WebRTC, rate-limited 30/min)
GET  /stats/:userId              auth   — total_seconds + total_chats (self only)

POST /save-chat                  auth   — log chat, +1 total_chats, streak, points (rate: 200/day)
POST /update-stats               auth   — bulk sync seconds+chats (rate: 10/hr)
POST /friend-request             auth   — send request, create notification
POST /friend-respond             auth   — accept/decline, notify on accept
```

---

## Pages & Routes

```
GET /              → qatar-chat.html  (main SPA)
GET /qemy          → qemy.html
GET /qemy-board    → qemy-board.html
GET /imposter      → public/index.html
GET /profile       → profile.html
GET /leaderboard   → leaderboard.html
GET /discover      → discover.html
GET /quiz          → quiz.html
GET /verify-email  → verify-email.html
GET /reset-password→ reset-password.html
GET /admin         → admin.html
GET /tasks         → tasks.html
```

---

## Security Notes

- `/save-chat` is rate-limited 200/day — `chatSeconds` from body is capped server-side at 8h max before being trusted
- `/update-stats` is rate-limited 10/hr — `chats` from body is capped at 100 per call
- `req.userId` from JWT is always used for writes — never trust `userId` from request body
- `peerId` guard in `chat.js` (`lastSavedPeerId`) prevents double-counting the same peer

---

## Deployment (Railway)

- `nixpacks.toml` — `npm install --omit=dev` in install phase, empty build phase
- `.dockerignore` — excludes node_modules, .git, .claude, .obsidian, python scripts, markdown, logs
- Env vars needed: `JWT_SECRET`, `SUPABASE_URL`, `SUPABASE_KEY`, `QATAR_ONLY`, `SITE_URL`, `BREVO_API_KEY`, `TURN_SECRET`

---

## SQL Migrations (apply in Supabase if not done)

```sql
-- Weekly tasks
create table if not exists weekly_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  week_start date not null,
  task_id text not null,
  progress int not null default 0,
  completed bool not null default false,
  unique (user_id, week_start, task_id)
);
create index if not exists weekly_tasks_user_week on weekly_tasks(user_id, week_start);

-- Notifications
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  type text not null,
  from_user_id uuid references users(id) on delete set null,
  from_username text,
  from_avatar text,
  message text not null,
  read boolean not null default false,
  link text,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_time on notifications(user_id, created_at desc);

-- Email tokens (verification + password reset)
create table if not exists email_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token text not null unique,
  type text not null,  -- 'verify' | 'reset'
  expires_at timestamptz not null,
  used boolean not null default false,
  created_at timestamptz not null default now()
);

-- User columns added over time
alter table users add column if not exists equipped_frame   text     not null default 'default';
alter table users add column if not exists earned_badges    text[]   not null default '{}';
alter table users add column if not exists imposter_rounds  int      not null default 0;
alter table users add column if not exists character_type   varchar(20) default null;
alter table users add column if not exists character_is_temp boolean default false;
```

---

## WebRTC & Voice Chat Architecture

### Stranger Video Chat (`chat.js` + `server.js`)
- Socket uses default transports (polling → websocket upgrade). **Never force `transports:['websocket']`** — breaks mobile.
- ICE config fetched from `/api/ice-config` (public, no auth). Includes Google STUN + Hetzner STUN + TURN + TURN/TCP.
- Camera init runs in parallel with socket connect (`window._cameraPromise`). `setupPeerConnection` awaits it with no timeout.
- `startCamera` fallback chain: `{video,audio}` → `{audio only}` → `{video only}`
- Mic/cam enabled state resets to `true` on each new stranger connection.
- iOS Safari: remote video uses `<video>` element (not `<audio>`) — `<audio>` routes to earpiece, `<video>` routes to speaker.
- P2P matching guards: same-userId blocked in matchmaking and waiting queue. `already-in-chat` event sent if user already in a room.

### Qemy Voice Chat (`qemy-client.js` + `game-logic.js`)
Mesh WebRTC in the `/game` namespace. Key details:

**Signaling events:**
- `qemy:signal` — relayed via `game-logic.js` using userId→socketId lookup in `gameRooms`
- `qemy:voice-ready` — emitted when a player enables their mic. Server broadcasts to all room members. Receiver (if they're the initiator = smaller userId) re-sends a fresh offer if `!remoteDescription || ICE failed/closed/disconnected`. This fixes the deadlock where A sends offer, B drops it (wasn't ready), then B enables mic later — without this, no one re-initiates.

**Initiator rule:** `myUserId < peerUserId` (string comparison of UUIDs) — smaller userId always initiates.

**iOS audio fix:** Remote audio elements are `<video>` (1px, opacity:0, playsinline, autoplay). `el.play().catch()` falls back to `AudioContext.createMediaStreamSource(stream).connect(destination)`. AudioContext unlocked on mic button press (user gesture) via `_unlockAudio()`.

**ICE config:** Fetched at module load as a promise (`_iceReady`). `await _iceReady` before `getUserMedia` in `toggleVoiceChat`.

### Imposter Voice Chat (`public/index.html`)
Same patterns as Qemy but uses socket IDs (not userIds) as peer identifiers. Server relay uses `io.to(targetId)` in main namespace. No `voiceEnabled` guard on signal handler.

---

## Known Mobile Gotchas

| Issue | Fix applied |
|---|---|
| `window.open` blocked in async context | Use `window.location.href` instead |
| iOS `100vh` > visible area (address bar) | Use `100dvh` for game/full-screen elements |
| `<audio>` plays through earpiece on iOS | Use `<video playsinline autoplay>` for remote audio |
| AudioContext suspended on iOS | Call `audioCtx.resume()` inside a user-gesture handler |
| WebSocket-only transport fails on some mobile networks | Never set `transports:['websocket']` |
| Socket emit lost on page unload (navigation) | Add 300ms delay before `window.location.href` after socket emits |
| Fixed buttons covering card hand area | Add `padding-bottom` to bottom zone matching button height |

---

## How to Start a Session

1. Read this file first
2. `git log --oneline -5` to see latest commits
3. Read the relevant source files before touching them — never edit blind
4. Ask what the user wants to work on if unclear

## User Preferences

- Push to GitHub after each feature (user expects it)
- Fix bugs: read → root cause → fix (no blind guessing)
- Don't add unrequested features, comments, or refactoring
- Keep responses short and direct
- Update this file at the end of every session
