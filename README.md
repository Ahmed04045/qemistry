# Qemistry

Qemistry is a Qatar-focused social platform with live video chat, messaging and
friends, multiplayer games, profiles, and community features. The interface
supports Arabic and English.

## Features

- Random video chat using WebRTC
- Accounts, profiles, friends, direct messages, and online presence
- Qemy multiplayer card game and the Arabic-language Imposter game
- Character quiz, points, weekly tasks, badges, and leaderboards
- Notifications, email verification, and password reset
- Arabic and English translations

## Tech stack

- Node.js 20+
- Express and Socket.IO
- Supabase (Postgres and Storage)
- Brevo for transactional email
- Google Identity Services for Google sign-in

## Run locally

1. Install Node.js 20 or later.
2. Install the project dependencies:

   ```sh
   npm install
   ```

3. Copy `.env.example` to `.env` and replace the example values with your
   development credentials.

   PowerShell:

   ```powershell
   Copy-Item .env.example .env
   ```

   macOS/Linux:

   ```sh
   cp .env.example .env
   ```

4. Start the server:

   ```sh
   npm start
   ```

5. Open <http://localhost:3000>.

The server exits at startup if any required environment variable is missing.

## Environment variables

The `.env.example` file lists all supported settings.

| Variable | Required | Description |
| --- | --- | --- |
| `JWT_SECRET` | Yes | Secret used to sign authentication tokens. Use a long, random value. |
| `ADMIN_PASSWORD` | Yes | Admin login password. |
| `TURN_SECRET` | Yes | Secret used to create TURN server credentials for WebRTC. |
| `SUPABASE_URL` | Yes | URL of the Supabase project. |
| `SUPABASE_KEY` | Yes | Server-side Supabase key. Keep it private; never expose it in browser code. |
| `BREVO_API_KEY` | Yes | Brevo API key for verification and password-reset emails. |
| `GOOGLE_CLIENT_ID` | Yes | Google OAuth client ID for sign-in. |
| `SITE_URL` | No | Public site origin used for Socket.IO CORS. Defaults to `http://localhost:PORT`. |
| `QATAR_ONLY` | No | Set to `true` to restrict the service by visitor location. Defaults to `false`. |
| `PORT` | No | HTTP port. Defaults to `3000`. |

## External services

Before running a complete instance, configure the external services and
credentials above:

- Create a Supabase project with the database tables and Storage configuration
  expected by the application. This repository does not include database
  migrations.
- Configure a TURN service and set its shared secret in `TURN_SECRET`.
- Configure Brevo transactional email and Google OAuth credentials.
- For deployment, set `SITE_URL` to the public HTTPS origin and configure all
  required variables in the hosting provider's environment settings.

The repository includes a Nixpacks configuration for deployment with Node.js
20. Do not commit `.env` or real credentials.

## Project structure

| File | Purpose |
| --- | --- |
| `server.js` | Express API, Socket.IO server, authentication, and application routes |
| `game-logic.js` | Qemy multiplayer game logic |
| `qatar-chat.html`, `app.js`, `chat.js`, `style.css` | Main social and video-chat experience |
| `translations.js` | Arabic and English translations |
| `qemy.html`, `qemy-board.html`, `qemy-client.js`, `qemy-game.css` | Qemy game UI |
| `public/index.html` | Imposter game |
| `nixpacks.toml` | Nixpacks deployment configuration |

## Available command

- `npm start` — start the application server.
