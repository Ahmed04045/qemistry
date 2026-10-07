# Qemy Game — Upgrade Specification v2
**Platform:** Qemistry
**Document type:** Product & UX Spec
**Date:** 2026-04-06
**Author:** Retention Lead, Qemistry Platform

---

## How to Read This Document

Each item carries two labels:

- **Priority:** `Quick Win` (days) / `Strategic` (weeks) / `Long-term` (months)
- **Impact:** `High` / `Medium` / `Low` — estimated effect on session length and return rate

Code references use the format `file:identifier` (e.g., `qemy-client.js:_renderMyHand`).

---

## Section 1 — Known Bug Reports (Fix Backlog)

These are user-reported issues. They are documented here as a handoff to the engineering backlog. Each will be fixed in a separate debug pass — not in this spec.

---

### BUG-01: Floating / Orbiting Circles Appearing During Gameplay

**Reported behavior:** Players see decorative animated circles or blobs appearing over the game board during an active match, overlapping cards and UI elements.

**Likely root cause:** The lobby background blobs (`.qblob`, `.qblob-1`, `.qblob-2` in `qemy-game.css` lines 43-53) are defined with `position: fixed` and are children of `#qlobbyScreen`. When `#qlobbyScreen` transitions to `qhidden` via `lobbyScreen.classList.add('qhidden')` (`qemy-client.js` line 220), the `display:none` rule should suppress them. However, if the CSS specificity of `.qhidden` is overridden or the class application races against a CSS animation frame, the fixed-position blobs can persist visually and float over `#qgameScreen`.

**Fix direction:** Explicitly set `display:none` on `.qblob` elements when `gameStart` fires, independent of the parent screen class. Alternatively, move `.qblob` elements so they are not `position:fixed` and scope them strictly inside `.qlobbyScreen` with `overflow:hidden` on the parent and `position:absolute` on the children.

**Priority:** Quick Win | **Severity:** High (directly disrupts gameplay readability)

---

### BUG-02: Broken "Special" (Reaction) Button Behavior

**Reported behavior:** The Chemical Reaction button (`#qreactionBtn`) sometimes fires incorrectly, appears when it should not, or fails to disappear after use.

**Likely root causes (three candidates):**

1. **Race between `reactionButton` and `gameStart` events.** On reconnect (`qemy-client.js` line 213), `hasReactionBtn` is set from `reactionHolderUserId`. If `reactionButton` then arrives before layout is fully rendered, the button visibility toggle (`reactionBtn.classList.remove('qhidden')`) fires before `#qreactionBtn` exists in the layout, silently no-oping.

2. **`fireReaction` guard is client-only.** `window.fireReaction` checks `hasReactionBtn` locally (`qemy-client.js` line 358) but does not prevent double-emit if the user taps rapidly before the server responds. A debounce or immediate disabling of the button element itself on first click is missing.

3. **`qhidden` class not reapplied after game-over.** When the game ends and the overlay appears, `#qreactionBtn` is not explicitly hidden as part of the game-over cleanup. A lingering visible button confuses players in the post-game state.

**Fix direction:** On `gameOver` event, add `reactionBtn.classList.add('qhidden')` and `hasReactionBtn = false`. Add `reactionBtn.disabled = true` immediately inside `fireReaction()` before emitting to prevent double-fire. Wrap the reconnect button-show logic in a `setTimeout(() => ..., 0)` to ensure it runs after layout paint.

**Priority:** Quick Win | **Severity:** High (core power card broken)

---

## Section 2 — Special Cards

The card deck is currently 112 cards encoded as integers 0-111, with four colors (Red, Yellow, Green, Blue) and four special types (Skip, Reverse, Draw2, Wild, Draw4). The encoding lives in `qemy-client.js:_cardType` and `qemy-client.js:_cardColor`. All new card types below require server-side additions to the deck builder and play-validation logic — the client changes are cosmetic labels and animations only.

These cards are themed around the Qemistry mascot (the orb) and the platform's Gen Z internet-native identity. Qatar/Gulf culture is woven in where it fits naturally — not forced as a theme.

---

### CARD-01: "Qem Nuke" — Full Hand Wipe

**Concept:** The most devastating card in the deck. Named after the mascot. When played, the target opponent must discard their entire hand and draw 5 fresh cards. It does not end their turn — they still have to play from the 5 new cards. The nuclear option.

**Card label:** `QN` with a small orb icon
**Color:** Black (wild tier)
**Playability rule:** Always playable. After playing, a target-picker UI appears (same pattern as the color chooser `#qcolorChooser`) listing opponent names. Cannot be stacked or countered. Only 1 copy exists in the deck.
**Encoding:** Add as a third wild tier at `Math.floor(n/14) >= 8`. One entry total.
**Client change:** Add case to `qemy-client.js:_cardType` returning `'QemNuke'`. Add `.qcard-qemnuke` in `qemy-game.css` — deep purple-to-black gradient with a pulsing orbit ring CSS animation matching the mascot's ring aesthetic.
**UX moment:** When played, the target player's hand zone gets a full white flash (`opacity: 1` overlay, 200ms), then all their cards visually implode to center using `transform: scale(0)` staggered across the cards, then 5 new cards deal in from the deck with the standard `qdealing` animation. Toast (Critical tier): `[Player] dropped the Qem Nuke! [Opponent]'s hand is GONE.`

**The orb connection:** The card face features the mascot orb rendered in CSS — the same animated rings that appear in the lobby logo. Players will see the mascot and immediately know this is not a normal card.

**Priority:** Strategic | **Impact:** Very High (legendary rarity creates stories; the mascot on the card is a brand moment every time it hits the board)

---

### CARD-02: "Orbit" — Reverse + Skip

**Concept:** Named after the mascot's orbiting rings. Does two things at once: reverses the direction of play AND skips the next player in the new direction. In a 2-player game, this means you play again immediately.

**Card label:** `O` with a circular arrow icon
**Color:** Colored (one per color, like Reverse)
**Playability rule:** Plays on a Reverse or matching color. In 2-player mode, functions as a double-play (you go twice in a row).
**Encoding:** Extend the per-color block — add as index `%14 === 12` if a slot is available, or expand the block.
**Client change:** Add case returning `'Orbit'`. Add `.qcard-orbit` — a dark card with a thin animated ring around the card face edge (CSS `border-radius: 8px; box-shadow: 0 0 0 2px var(--qcolor), 0 0 12px var(--qcolor)`).
**UX moment:** When played, the turn direction indicator (the arrow that currently lives near the board) does a full 360-degree spin animation before reversing. Brief toast: `Orbit! Direction reversed + skip.`

**Priority:** Strategic | **Impact:** High (elegant combo card; the name ties back to the mascot without being heavy-handed)

---

### CARD-03: "Glitch" — Color Randomizer

**Concept:** A Wild card that randomizes the active color to a random one chosen by the server, not the player. You play it hoping for red, you might get yellow. High risk. Also randomizes the color for the *next* player's turn if they don't play a matching card — they have to draw until they hit the random color.

**Card label:** `?!` in a glitched font style (use `font-family: monospace; letter-spacing: -1px`)
**Color:** Black (wild tier)
**Playability rule:** Always playable. No target-picker UI — the server resolves the random color and broadcasts it.
**Encoding:** Add as a second wild tier entry in the wild block.
**Client change:** On `glitch-resolved` server event, show the resulting color with a distortion animation: the board card briefly renders all four colors stacked (`::before`/`::after` pseudo-elements offset by 3px in red/blue — CSS glitch effect) before settling on the resolved color.
**UX moment:** The color chooser does NOT open. Instead, the board card glitches for 600ms, then snaps to the resolved color with a flash. Toast: `Glitch! Color scrambled to [Color].` Both players react to the chaos — that tension is the point.

**Priority:** Strategic | **Impact:** High (unpredictability creates memorable moments; name is native to the platform's internet aesthetic)

---

### CARD-04: "No Cap" — Draw 4 Block

**Concept:** A reaction card. If your opponent plays a Draw 4 on you, you can immediately play No Cap from your hand to block it. The draw is cancelled, the color declaration is voided, and play passes back to the Draw 4 player with no penalty. They wasted their card.

**Card label:** `NC` (or "No Cap" in small text)
**Color:** Colored (one per color, like Skip — it must match the color active before the Draw 4 was played to be valid)
**Playability rule:** ONLY playable in direct response to a Draw 4 targeting you. Not playable otherwise. The server checks this with a `canPlayNoCap` flag set when a Draw 4 is the last event.
**Encoding:** Add per-color — one per color block.
**Client change:** When a Draw 4 targets you, if you hold a No Cap card, it gains `.qplayable` highlighting AND a new `.qnc-ready` class that adds a flashing white border and a small text overlay: `Play to block!` — so the player knows they have the option.
**UX moment:** When No Cap hits the board, the Draw 4 card on the board briefly flickers (CSS `opacity: 0.3 -> 1` strobe, 3 cycles) then dims out. Toast (Critical tier): `[Player] said No Cap! Draw 4 blocked!`

**Gulf/Gen Z crossover note:** "No Cap" is internet-native. It also translates naturally — the concept of calling someone's bluff is culturally familiar. Doesn't need translation.

**Priority:** Strategic | **Impact:** High (comeback mechanic baked into a card; players who get Draw 4'd feel helpless — this card gives them agency and creates dramatic reversals)

---

### CARD-05: "Wasta" — Skip to Your Turn

**Concept:** The one Arab cultural reference in the special card set — and it earns its place. Wasta (Arabic: واسطة) is the real-world concept of using connections to jump the queue. This card lets you skip everyone else's turns and go again immediately, no matter how many players are in the game.

**Card label:** `W` (or Arabic: `واسطة`)
**Color:** Black (wild tier)
**Playability rule:** Always playable. Skips all other players for one complete cycle and gives the player who played it an immediate second turn.
**Encoding:** Add as a wild tier entry. Two copies in the deck.
**Client change:** On play, the turn banner displays each other player's name in sequence with a fast strikethrough animation (150ms per player), then snaps back to the Wasta player. It looks like turn order is literally being skipped for each person.
**UX moment:** Toast: `[Player] used Wasta — everyone else waits.` The other players see their own name get crossed out. It's intentionally a little disrespectful. That's what makes it funny.

**Priority:** Long-term | **Impact:** High (cultural specificity done right — funny because it's true, not because it's exotic)

---

### CARD-06: "Chain React" — Combo Bonus Action

**Concept:** Not a card in the deck — a mechanic triggered by card matching. If you play a card of the same number as the card just played (e.g., Blue 7 on Red 7), you may immediately play a second card from your hand as a bonus action without waiting for the turn cycle. This is called a Chain React.

**Implementation note:** The server's play-validation logic needs a `lastPlayedCard` state and a `chainReactEligible` flag. The client does not change significantly — the hand stays interactive for one extra action after a successful chain.
**Client signal:** When `chainReactEligible` is true (new server event), highlight all matching-face-value cards with `.qchain-eligible` (gold glow, distinct from `.qplayable`'s orange).
**UX moment:** Toast (Standard tier): `Chain React!` in gold. The board card flashes twice instead of once.

**Priority:** Strategic | **Impact:** High (rewards skilled play, creates "did you see that?" moments)

---

### Room Option: "Qemistry Mode" — House Rules Toggle

**Concept:** When the host creates a room on `qemy.html`, offer a toggle: "Qemistry Mode." In this mode, locally-beloved house rules activate. This is the platform's way of saying: we know how you actually play.

**Three active rules in Qemistry Mode:**

1. **Stack rule:** Draw 2 can be countered by playing another Draw 2, passing the accumulated penalty to the next player. Chain as far as it goes.
2. **Jump-in rule:** If any player holds the exact same card (color + number) as the card just played, they may slam it in out of turn, stealing turn order from that point.
3. **Qemy call rule:** Playing your second-to-last card requires calling "Qemy!" before the next player acts. Failing earns a 2-card penalty. Already adjacent to existing UNO-call logic in the codebase.

**Client changes:** Add a room-options panel to `qemy.html` create-room section. Add `qemistryMode: boolean` to the `create-room` POST body. The server applies modified validation when the flag is set. Show a small `QM` badge in the top corner of the game board when the mode is active.

**Priority:** Long-term | **Impact:** High (social differentiation, replay variance, and the name is pure brand)

---

## Section 3 — Mascot Integration

The orb mascot is currently a logo. It should be a character — one that shows up at the highest-stakes moments in the game experience and makes those moments feel like they belong specifically to Qemistry and nowhere else.

---

### MASCOT-01: Game Start Countdown

**When:** The 3-second countdown before cards are dealt.

**What happens:** The orb mascot (rendered in CSS — a purple circle with two concentric orbit rings and animated eyes) scales in from 0 at the center of the board, holds for 1 second, then its eyes animate wide open as the countdown ticks: 3... 2... 1. On "Go," the orb explodes outward (`transform: scale(3); opacity: 0` over 400ms) and the cards deal from where it was.

**Why:** This creates a shared ritual. Every game starts with the mascot. Players internalize it as the "Qemistry thing." It takes 3 seconds and adds zero gameplay friction.

**Implementation:** Add a `#qorbCountdown` div to `qemy-board.html` with `position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%)`. The orb is pure CSS — a `div.qorb` with two `div.qorb-ring` children using `border-radius: 50%` and `animation: qorbit` rotation. Eye positions are `::before` / `::after` pseudo-elements. Trigger the sequence on `gameStart` before `_renderMyHand`.

**Priority:** Strategic | **Impact:** High (ritual moment; every returning player sees this and feels at home)

---

### MASCOT-02: Win Screen Appearance

**When:** The game-over overlay fires when `iWon === true`.

**What happens:** After the confetti burst (see LOOP-04), the orb mascot appears in the top third of the overlay. Its eyes do a "happy" animation — the eye pseudo-elements shrink to curved lines (CSS `border-radius` transition on a non-square div). The orbit rings spin faster than their default speed for 1.5 seconds, then settle. The orb stays present behind the win text as a subtle background element.

**On loss:** The orb appears smaller, in the corner, with drooping eyes (the eye pseudo-elements rotate downward slightly). It does not dominate the screen — it is present but subdued. This is important: the mascot is not rubbing it in. It is just... there, like a friend who lost alongside you.

**Why:** The mascot on both win and loss screens creates emotional association. Players project onto it. "The orb is sad too" is the vibe on a loss. That's empathy design — it softens the negative emotion and makes the player more likely to try again.

**Implementation:** Add `div.qorb` inside `#qgameOverlay` with conditional class `.qorb-win` or `.qorb-loss`. CSS class switches the eye animation and ring spin speed via `animation-duration` override.

**Priority:** Strategic | **Impact:** High (mascot identity crystallization at the peak emotional moment)

---

### MASCOT-03: Streak Milestone Appearance

**When:** A player achieves their 3rd consecutive win (Win Streak W3+) or a daily platform streak milestone.

**What happens:** The orb slides in from the left side of the screen at the streak-counter position (top-right, where `#qstreakCounter` lives), hovers beside the counter for 2 seconds with excited-fast-spinning rings, then slides back out. The streak counter number ticks up while the orb is present.

**Why:** Streak milestones are the hook that pulls players into "one more game" territory. The mascot appearing specifically at streak moments trains players to associate the mascot with their own achievement — not just a brand logo. It becomes aspirational.

**Implementation:** On `sessionWins` incrementing to 3 (and every 2 wins after), add a `div.qorb-mini` (scaled-down version) to the DOM at the streak counter position, run the slide + spin animation, then remove after 2.2 seconds.

**Priority:** Strategic | **Impact:** Medium (mascot brand reinforcement at the retention-critical streak moment)

---

### MASCOT-04: The "Qem Event" — Wild Card Mechanic

**Concept:** Once per game, at a random interval (chosen server-side, between turn 8 and turn 20), the server broadcasts a `qem-event` socket event. The orb mascot appears in the center of the board, its rings spinning wildly, and announces one of three random effects:

| Event Name | Effect |
|---|---|
| Qem Flip | All players swap hands with the player to their left simultaneously |
| Qem Shield | The next Draw 2 or Draw 4 played is automatically blocked for everyone |
| Qem Chaos | All players draw 1 card AND the active color randomizes |

**How it works:** The orb appears for 3 seconds with the event name displayed below it. All players see it simultaneously. Then the effect resolves. There is no player input — it is a force of nature. The orb did it.

**Why this is the right mechanic:** The mascot needs to DO something, not just decorate. A mascot that intervenes in gameplay becomes part of the game's story. Players will say "the orb hit us with Qem Flip right when I was about to win" — and that is a story about Qemistry, not just Qemy. The mascot is now the chaos agent of the game world.

**Implementation:**
- Server: after `n` turns (random between 8 and 20), emit `qem-event` to all players in the room with a `{ type: 'QemFlip' | 'QemShield' | 'QemChaos' }` payload.
- Client: on `qem-event`, pause card interaction (`playable` states disabled for 3 seconds), render `#qorbEvent` div center-board with the orb CSS and the event name text, then resolve the effect.
- `QemFlip`: each player's hand count updates as the server redistributes hands in the round-robin direction. Client re-renders `#qmyHand` with new cards.
- `QemShield`: add a `qem-shield-active` banner under the board card. The next Draw 2 or Draw 4 that fires dismisses the banner instead of applying the draw penalty.
- `QemChaos`: board card flashes all four colors (same glitch animation as CARD-03), active color randomizes, all players draw 1 card simultaneously (animate from deck to each hand zone).

**Priority:** Long-term | **Impact:** Very High (this is the single feature that makes Qemy feel like a Qemistry game and not just an UNO clone)

---

## Section 4 — Addiction Loops

These are surrounding-experience changes only. No card rules are modified beyond what is already specified in Section 2.

---

### LOOP-01: Win Streak Counter (In-Game Display)

**The Hook:** Players win but have no visible accumulation of wins during a session. Dopamine from a win is isolated — it does not connect to the next game.

**The Trigger:** Display a persistent in-game win streak counter in the top-right corner of `#qgameScreen`. Format: `W2` (two consecutive wins this session). Color escalates: white at W1 → orange at W3 → red pulsing at W5. At W5, the counter briefly shakes (reuse `qshakehand` keyframe) and a small orb icon appears next to it.

**The Action:** Player starts a rematch specifically to protect and extend their win streak number.

**Investment Layer:** Losing resets the streak to W0. Loss Aversion (Kahneman) — the fear of seeing W5 reset is more motivating than the prospect of reaching W6. The player is not chasing the next win. They are protecting what they have already built.

**Implementation:** Add `sessionWins` counter in `qemy-client.js` scope, persisted in `sessionStorage` so it survives page reload. Increment on `gameOver` when `iWon`. Add `#qstreakCounter` div in `qemy-board.html` positioned `fixed; top: 16px; right: 20px`.

**Priority:** Quick Win | **Impact:** High

---

### LOOP-02: Comeback Tension System

**The Hook:** When a player is losing badly (many cards, opponent near one card), there is no psychological hook. They feel defeated and disconnect.

**The Trigger:** When `myHand.length >= 8` AND any opponent's hand size reaches 1 (Qemy state), trigger "Comeback" mode: `#qmyHand` container takes on a pulsing red border. The turn banner is replaced with: `احذر — صاحبك على وشك الفوز!` / `Watch out — they're about to win!` in bold. The board card glows red.

**The Action:** The endangered player is jolted into high alert. Urgency replaces resignation. They are more likely to use their reaction button or play aggressively.

**Investment Layer:** "I was down 8-1 and still came back" is a story. Stories create identity investment. Players who have a comeback story tell it to friends — that is organic acquisition.

**Implementation:** Add `_checkComebackMode()` inside `_renderOppHand` when `count === 1`. Add `.qcomeback-mode` CSS class to `#qmyHand` with `animation: qshakehand 2s ease infinite` and a red `box-shadow` pulse.

**Priority:** Quick Win | **Impact:** High (directly reduces disconnect-on-losing behavior)

---

### LOOP-03: One-Card Tension Beat (Qemy Alert)

**The Hook:** The `quno-badge` class already exists and pulses red when an opponent has 1 card. The moment is visually present but small and quiet.

**The Trigger:** When `unoAlert` fires (`qemy-client.js` line 284), add a full-width banner that slides down from the top over the turn banner for 2.5 seconds: `[Name] has ONE CARD LEFT!` in both Arabic and English. Flash the opponent's card zone with a bright white outline. The orb mascot miniature (`.qorb-mini`) briefly appears next to the opponent's label, eyes wide.

**The Action:** Every other player focuses on blocking. Inter-player tension peaks. Nobody disconnects during high-tension moments.

**Investment Layer:** The "almost" moment is the most memorable beat in any card game. Players recount these moments. Word-of-mouth is earned at this beat.

**Priority:** Quick Win | **Impact:** Very High

---

### LOOP-04: Win Celebration Redesign

**The Hook:** The current win screen (`#qgameOverlay`) is static text with a trophy emoji. Emotional Moment EM-03 scores 2/10 on the Dopamine Scale. This is the single highest-waste moment in the product.

**Winner flow (3-second sequence):**

```
0ms    — Confetti burst (30 divs, card-color palette: red/yellow/green/blue, CSS only)
300ms  — #qgameOverlay fades in (backdrop-filter: blur already present)
500ms  — .qgame-over-card scales in (qcardreveal keyframe already exists)
600ms  — Orb mascot appears, happy eyes, fast-spinning rings (see MASCOT-02)
800ms  — Win counter ticks up: "Wins: 4 -> 5" with a CSS counter-tick animation
1000ms — XP bar fills from left: "+100 XP" badge slides in from right
1200ms — Rematch button fades in (see SOCIAL-01)
1500ms — Share button fades in (see SOCIAL-04)
```

**Loser flow:**

```
0ms    — Overlay fades in, no confetti
300ms  — Card scales in with qcardreveal keyframe
500ms  — Orb appears small, corner position, drooping eyes
600ms  — Line: "كنت قريب — فاصلة بسيطة!" / "So close — one card away!"
800ms  — Stat reveal: "You had [X] cards when [winner] won"
1000ms — Try Again button (same as rematch, distinct label for psychological framing)
1200ms — "+25 XP for playing" — small but present
```

**Key principle:** The loser must leave wanting to try again, not wanting to quit. Showing "+25 XP" to a loser converts a negative emotion into a small positive one. The orb being sad alongside you softens the blow. These are not decorations — they are retention mechanisms.

**Priority:** Quick Win | **Impact:** Very High (highest single-change ROI in the entire game experience)

---

### LOOP-05: Turn Timer with Pressure Ramp

**The Hook:** Players can sit idle on their turn indefinitely. Long idle turns kill session rhythm and frustrate opponents to the point of leaving.

**The Trigger:** On `turnChanged` when `myTurn === true`, start a visible countdown ring around the player avatar in `#qmyLabel`. Timer: 30 seconds. At 10 seconds remaining, the ring turns red and pulses. At 0, emit `draw-card` automatically.

**The Action:** Time pressure forces decisive play. The game moves faster and feels alive.

**Investment Layer:** Players who master quick decisions feel superior to those who hesitate. This creates a skill identity that players want to demonstrate by playing more.

**Implementation:** Add `#qturnTimer` SVG circle overlay on `.qmy-avatar` using `stroke-dashoffset` animation driven by a JS `setInterval`. Clear on `turnChanged` when `myTurn === false`.

**Priority:** Strategic | **Impact:** High

---

## Section 5 — Social Hooks

Qemy is a 2-player card game played between friends on a social platform. The social hooks here are designed for that context — tight, friend-native, not broadcast-scale.

---

### SOCIAL-01: Rematch Button on Game Over

**The Hook:** Currently `goBack()` redirects to `/qemy`. Players who want a rematch must navigate back, find the friend, create a room, and invite again. That is 5 steps. Most players abandon at step 2.

**The Trigger:** Add `#qrematchBtn` below `#qgoBtn` in the game-over overlay. Text: `عود وانتقم!` / `Rematch!` On click, emit `socket.emit('request-rematch', { roomCode })`. Server resets room state and re-deals. All players in the room see a toast: `[Winner] wants a rematch!` with Accept / Decline.

**Investment Layer:** The post-game emotional peak — win or loss — is the highest-intent moment for another session. A one-tap rematch exploits this peak before the emotion fades. Missing this is the single most expensive UX gap in the product (MISS-05 from audit).

**Priority:** Quick Win | **Impact:** Very High

---

### SOCIAL-02: In-Game Emote System

**The Hook:** Chat requires typing. In a turn-based game, players want faster, lower-effort social expression. Typing "lol" takes 5 seconds. An emote takes 0.5 seconds.

**The Trigger:** Add an emote button next to the chat toggle in `qemy-board.html`. Tapping it opens a 2x4 grid. Emotes send `emote-fired` socket event — a large floating emote appears above the sender's avatar zone for 2 seconds.

**Emote set:**

| Emote | Label |
|---|---|
| ما شاء الله | Mashalah |
| يلا | Yalla |
| GG | Good game |
| Rip | Too easy |
| W | W (slang for win) |
| L | L (slang for loss) |
| Fr | No cap / fr |
| Orb | The mascot (just the orb icon — platform-native flex) |

**Implementation:** `socket.on('emote-received', ({ playerIndex, emote }))` in `qemy-client.js`. Append `.qemote-popup` div at the correct player zone with CSS `@keyframes qfloatup` (`translateY(0) -> translateY(-60px), opacity 1 -> 0`, 1.8s).

**Priority:** Quick Win | **Impact:** High (social texture without typing friction)

---

### SOCIAL-03: Spectator Mode

**The Hook:** When a room is full, friends who want to watch cannot join. They leave and the social loop breaks.

**The Trigger:** Allow additional users to join a room as spectators. Spectators see the board card and opponent card-back counts but not any hand. They can use chat and emotes. A spectator count badge (`eye icon + count`) appears in the top corner of the board for active players.

**Viral Coefficient:** A spectator watching friends play is the warmest possible moment to convert a new player. On game end, spectators see a "Start your own room" CTA inside the overlay. This is how the platform grows person to person.

**Implementation:** Server needs a `spectators[]` array per room and a `spectate-game` socket event alongside `join-game`. Client needs `isSpectator` flag suppressing hand render and card-click events.

**Priority:** Strategic | **Impact:** High

---

### SOCIAL-04: Post-Game Shareable Result Card

**The Hook:** There are zero pathways for a Qemy win to leave the platform and bring new people back in (MISS-08 from audit).

**The Trigger:** On the win overlay, add a Share button. This generates a canvas-rendered image showing:
- The orb mascot (CSS-rendered, `html2canvas` or a server-side template)
- `[Username] just won on Qemistry`
- Win count + session streak
- Room code (so the friend can join the next game)
- Dark purple background matching the platform aesthetic — it looks like something worth posting

Offer download or direct share via Web Share API (`navigator.share`).

**Investment Layer:** A shared win card is simultaneously a trophy and an invitation. Every share carries the orb mascot, the Qemistry brand name, and a room code. This is the only organic growth loop the platform currently has zero implementation of.

**Priority:** Strategic | **Impact:** Very High

---

### SOCIAL-05: Friend Challenge from Lobby

**The Hook:** The `qemy.html` lobby shows online friends. The only action is "Invite to room." There is no direct "call out" flow.

**The Trigger:** Add a "تحدّى" / "Challenge" button next to each online friend. Pressing it creates a toast on the friend's screen: `[Username] is calling you out! دخيلك يلعب!` — pulsing red, 60-second timer before auto-dismissal. The challenge auto-creates a room and opens it for the challenger, waiting for the friend to accept.

**Implementation:** Extend `send-game-invite` socket event with an `isChallenge: true` flag. Server sends a differentiated toast with higher visual weight. The challenger's screen shows "Waiting for [Friend] to accept your challenge..." with the room code pre-populated.

**Priority:** Strategic | **Impact:** High

---

## Section 6 — Progression System

---

### PROG-01: XP System

**The Hook:** All player actions are currently rewarded with nothing visible. No number increases. No feedback that anything happened beyond the game event itself (MISS-03 from audit).

**XP Award Table:**

| Action | XP |
|---|---|
| Win a game | 100 XP |
| Lose a game (completion bonus) | 25 XP |
| Play a special card (Skip, Reverse, Draw2) | 3 XP |
| Play a Wild card | 5 XP |
| Successfully Chain React | 10 XP |
| Trigger the Chemical Reaction | 15 XP |
| Qemy call (reach 1 card) | 10 XP |
| Win from a comeback (held 5+ cards at some point) | 50 bonus XP |
| Win with Qem Nuke (rare card played and won) | 20 bonus XP |
| Daily first game | 20 XP bonus |

**Display:** XP shown in the win/loss overlay as a rising counter. Add `xp_total` and `xp_level` columns to the user table in Supabase. Client reads `xp_level` on page load and displays it as a rank badge in `#qmyLabel` during the game.

**Priority:** Strategic | **Impact:** Very High (every action becomes meaningful; the number going up is the simplest addiction loop available)

---

### PROG-02: Rank Titles

**The Hook:** No player identity beyond a username exists (MISS-11 from audit). Players have no way to signal depth of investment.

**Rank Ladder (total XP):**

| XP Range | Title | Notes |
|---|---|---|
| 0 - 499 | Static | Just starting — no badge yet |
| 500 - 1,499 | In Orbit | Tied to the mascot; you've entered the Qemistry orbit |
| 1,500 - 3,499 | Reactor | Chemical energy — the platform's identity |
| 3,500 - 6,999 | Charged | Building up |
| 7,000 - 12,999 | نخبة (Elite) | Arabic rank — earns its place here, doesn't feel forced |
| 13,000 - 24,999 | Singularity | Physics reference matching the orb's aesthetic |
| 25,000+ | The Orb | You are the mascot. Highest rank name in the game. |

**Display:** Rank title appears below username in `#qmyLabel` and `#qoppLabel{idx}`. Small gradient badge. On rank-up, run the full win celebration animation (confetti + orb appearance) even if in the lobby — the moment deserves its own celebration.

**Design rationale:** "The Orb" as the highest rank name is intentional. It makes the mascot aspirational. Players at Legend rank don't just have a title — they have become the thing the platform is built around. That is identity investment at its deepest.

**Priority:** Strategic | **Impact:** High (identity investment, social comparison, mascot reinforcement at the rank system level)

---

### PROG-03: Card Back Skins

**The Hook:** The card back (`.qcard-back` in `qemy-game.css` lines 173-181) is a single static dark gradient with "QEMY" text. It is never personalized, never earned, never shown off.

**Skin Unlock System:**

| Skin Name | Unlock Condition | Visual |
|---|---|---|
| Default | Always | Dark navy gradient + QEMY text |
| Orbit | Reach rank "Reactor" | Dark purple, animated orbit ring on card back (CSS only) |
| Glitch | Win 10 games | Dark card with CSS glitch color-channel offset effect |
| Maroon | Win 25 games | Deep maroon — a nod to Gulf aesthetic without forcing it |
| Singularity | Reach rank "Singularity" | Black card, white dot at center, thin ring expanding outward (CSS animation) |
| Qem Nuke | Play the Qem Nuke card and win the game | Deep purple to black, pulsing orb ring on back |
| The Orb | Reach rank "The Orb" | Animated holographic gradient (`animation: hue-rotate 4s infinite`) with the orb silhouette |

**Implementation:** Store `card_skin` preference in user profile (Supabase). Client reads it on game load and applies the class to all `.qcard-back` and `.qdeck-back` elements. Skin selection lives in a "Customize" tab on the `qemy.html` lobby page.

**Priority:** Long-term | **Impact:** High (visible personalization is daily-return motivation — players come back to show their skin)

---

### PROG-04: Legacy Profile Display

**The Hook:** Players have no way to signal how long or deeply they have invested in Qemistry (MISS-11 from audit).

**Elements surfaced in the game label and post-game overlay:**

1. **Join date:** `Qemist since [Month Year]` — small line under rank title in `#qmyLabel`.
2. **Total games played:** `142 games` — shown in the post-game overlay.
3. **All-time win rate:** `Win Rate: 64%` — calculated server-side.
4. **Peak rank:** Even if XP drops, display their highest-ever rank as a faded `Peak: Singularity` badge.
5. **Streak history:** "Personal best: W7 session streak" — visible in the lobby profile section.

**Priority:** Long-term | **Impact:** Medium (sunk cost anchoring — players who can see their history feel more invested in protecting it)

---

## Section 7 — UX Micro-Interactions

These are targeted interaction enhancements. Most require only CSS and minor JavaScript.

---

### UX-01: Card Deal Animation (On Game Start)

**Current state:** `_renderMyHand` in `qemy-client.js` lines 441-452 applies `.qdealing` with staggered `animationDelay` of `i * 35ms`. The keyframe slides cards from -120px Y with rotation.

**Enhancement:** Change the keyframe origin to `translateX(-200px) translateY(-80px) rotate(-15deg)` so cards appear to fly from the deck pile position (`#qdeckPile`) to each hand slot. Cards appear to come from somewhere real. After all cards deal (`setTimeout(() => ..., hand.length * 35 + 400)`), briefly glow the deck pile with `qdrawpulse` to signal "dealing complete."

**This runs after the mascot countdown** (MASCOT-01) — the orb explodes outward and cards deal from where it stood. The sequence is: orb appears → countdown → orb explodes → cards fly out.

**Priority:** Quick Win | **Impact:** Medium

---

### UX-02: Board Card Flip Animation

**Current state:** `_renderBoardCard` replaces `#qboardCardInner` content instantly. The `.qplaying` animation on the new card fires but there is no transition.

**Enhancement:** Before replacing board card content, add a CSS 3D flip: set `#qboardCardInner` to `transform: rotateY(90deg)` (half-flip), swap content at the halfway point via `setTimeout(180ms)`, then animate to `rotateY(0deg)`. Add `perspective: 600px` to `.qboard-card` in `qemy-game.css`. Total: 360ms.

**The feel:** Every card play becomes a satisfying slam. The board reacts to every action — it does not just update, it responds.

**Priority:** Quick Win | **Impact:** High (perceived game quality improves significantly with one CSS addition)

---

### UX-03: Playable Card Breathing Animation

**Current state:** Playable cards get `.qplayable` — orange glow. Cards do not move.

**Enhancement:** Add `@keyframes qbreath` to `.qcard.qplayable`: `transform: translateY(0) -> translateY(-6px) -> translateY(0)` over 1.8s, `ease-in-out infinite`. A gentle invitation-to-play motion that draws the eye without being distracting.

**Priority:** Quick Win | **Impact:** Medium (the game feels alive between turns)

---

### UX-04: Opponent Card Flight Animation

**Current state:** When an opponent plays a card, `_updateOppHandSize(playerIndex, -1)` re-renders the opponent's mini-card zone with one fewer card. The count drops silently — it is invisible as an action.

**Enhancement:** Before removing the card, spawn a single `.qopp-card` at the opponent zone's position with `position: fixed` and animate it flying to the center board position over 350ms using `transform: translate(dx, dy)` computed via `getBoundingClientRect()`. Remove the element on `animationend`.

This creates the physical illusion that a card travelled from the opponent's hand to the board. It confirms the action spatially without requiring the player to read a toast.

**Priority:** Strategic | **Impact:** Very High (the single highest perceived-quality upgrade without touching any rules)

---

### UX-05: Draw Card Satisfaction Loop

**Current state:** `onDrawCard()` pulses the deck with `qdrawpulse`. The new card arrives via `haveCard` and `_renderMyHand` re-renders the entire hand with `.qdealing` on all cards.

**Enhancement:** Only animate the new card. Apply `qdealing` only to the last card in the newly rendered hand with `animationDelay: 0ms` and a modified origin from the deck position. Also: the deck pile should have a "card lifts slightly" animation — `transform: translateY(-8px) scale(1.05)` for 100ms before resetting. This is the tactile feel of picking a card off a real deck.

**Priority:** Quick Win | **Impact:** Medium

---

### UX-06: Color Chooser Upgrade

**Current state:** `#qcolorChooser` is a full-screen blur overlay with 4 square color buttons. It snaps in without ceremony.

**Enhancement:**
1. The four options scale in with stagger: `animation-delay: 0ms, 60ms, 120ms, 180ms` using `@keyframes qpopIn` (`scale(0) -> scale(1.1) -> scale(1)`).
2. On hover, each button emits a radial glow matching its card color: `box-shadow: 0 0 20px [color]`.
3. Add Arabic color names in larger text with English sub-labels.

**Priority:** Quick Win | **Impact:** Low (polish — but polish signals care)

---

### UX-07: Reaction Button Strategic Cue

**Current state:** `#qreactionBtn` glows continuously with `qreactionglow`. No indication of when it is strategically most valuable to use.

**Enhancement:** After game start, the button pulses softly with a small text: `استخدمه بذكاء` / `Use wisely`. When 2 or more players have 2 cards or fewer, the button glows intensely (increase `box-shadow` radius via `.qreaction-critical` class toggle) — a visual signal that now is a high-impact moment.

**Priority:** Quick Win | **Impact:** Medium (removes decision paralysis; players who understand when to use the reaction button have more fun)

---

### UX-08: Toast Hierarchy

**Current state:** All toasts from `qemy-client.js:_showToast` are created identically. A force-draw toast and a reconnect toast have the same visual weight.

**Three-tier system:**

| Tier | Events | Visual |
|---|---|---|
| Critical | Qemy alert, Force Draw, Reaction fired, Qem Event | Large text, animated border, 4s duration, replaces lower-tier toasts |
| Standard | Card played, Card drawn, Chain React | Current treatment, 3.2s |
| Whisper | Player reconnected, Player left, XP earned | Smaller, dimmer, 2s, bottom-right corner |

Update `_showToast(msg, cls, tier)` to accept a `tier` parameter. Critical toasts clear any existing Standard/Whisper toast currently displayed.

**Priority:** Strategic | **Impact:** Medium (signal-to-noise ratio; critical moments must feel critical)

---

### UX-09: Lobby Idle Engagement

**The Hook:** Between creating a room and the game starting, players wait in `#qlobbyScreen` with no interaction. After 4 seconds, idle becomes frustration.

**What activates at 4 seconds:**
1. The QEMY logo animates with a hover float (`@keyframes qlogofloat`, 3s ease-in-out).
2. Rotating Qemy tips appear below the waiting message (5-second rotation):
   - `بطاقة الـ +4 تغيّر اللون أيضاً` / `The +4 card also changes the color`
   - `لما صاحبك عنده ورقة واحدة — وقت الضغط` / `When your opponent has one card — that's when you act`
   - `Chain React: العب نفس الرقم على أي لون` / `Chain React: play the same number on any color`
   - `الـ Qem Event يظهر بدون إنذار — استعد` / `The Qem Event appears without warning — stay ready`
3. A one-tap "Share room link" button.

**Priority:** Quick Win | **Impact:** Medium

---

### UX-10: Game Over Overlay — Full Redesign

This item consolidates LOOP-04 and the mascot win/loss behavior into a single engineering-ready spec.

**Winner sequence:**

```
0ms    — Confetti burst (30 divs, card-color palette, CSS only, no JS library)
300ms  — #qgameOverlay fades in
500ms  — .qgame-over-card scales in (qcardreveal keyframe — already exists)
600ms  — Orb mascot: happy eyes, fast rings (div.qorb with .qorb-win class)
800ms  — Win counter ticks: "Wins: 4 -> 5" (CSS counter animation on data attribute)
1000ms — XP bar fills left to right: "+100 XP" badge slides from right
1200ms — Rematch button fades in
1500ms — Share button fades in
```

**Loser sequence:**

```
0ms    — #qgameOverlay fades in (no confetti)
300ms  — .qgame-over-card scales in
500ms  — Orb mascot: small, corner, drooping eyes (.qorb-loss class)
600ms  — "كنت قريب — فاصلة بسيطة!" / "So close — one card away!"
800ms  — "You had [X] cards when [winner] won"
1000ms — Try Again button
1200ms — "+25 XP for playing" (Whisper tier toast or inline text)
```

**Engineering notes:**
- Confetti: 30 `div.qconfetti-piece` elements spawned via JS loop, positioned `absolute` within `#qgameOverlay`, animated with `@keyframes qconfettifall` (random X, random rotation, `top: -10px` -> `top: 110%`, 2-3s random duration).
- Orb: the same `.qorb` CSS component used in MASCOT-01 through MASCOT-03 — build it once, use it everywhere.
- The loser's "+25 XP" display is non-optional. Losing must never feel like nothing happened.

**Priority:** Strategic | **Impact:** Very High

---

## Implementation Order (Suggested)

For a team executing in sprints, the recommended sequencing is:

**Sprint 1 — Emotional Peaks (highest ROI, mostly client-side):**
LOOP-01, LOOP-03, LOOP-04 / UX-10 (combined), SOCIAL-01, UX-02, UX-03

**Sprint 2 — Social Layer:**
SOCIAL-02, SOCIAL-05, UX-07, UX-08, UX-09, LOOP-02

**Sprint 3 — Mascot Integration:**
MASCOT-01, MASCOT-02, MASCOT-03 (build the reusable `.qorb` CSS component first, then drop it in all three locations)

**Sprint 4 — Progression Infrastructure:**
PROG-01 (XP system — requires Supabase schema), PROG-02 (Rank titles), UX-01, UX-04, UX-05

**Sprint 5 — Special Cards + New Mechanics:**
CARD-01 (Qem Nuke), CARD-02 (Orbit), CARD-03 (Glitch), CARD-04 (No Cap), CARD-06 (Chain React)

**Sprint 6 — Long-term / Ambitious:**
MASCOT-04 (Qem Event), CARD-05 (Wasta), Room Option (Qemistry Mode), SOCIAL-03 (Spectator), SOCIAL-04 (Share Card), PROG-03 (Card Skins), PROG-04 (Legacy Display)
