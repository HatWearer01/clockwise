# Clockwise

A personal time-tracking desktop app for managing your own work hours. Clock in and out, track breaks, and see exactly how much you've worked — all local, all private, just for you.

Built for anyone who wants more structure in their workday — especially remote workers who need help establishing boundaries. Set flexible daily hour targets, get nudged when you drift from your schedule, see pattern insights (late nights, weekend creep, cramming), and review your week with an automatic summary.

Built with Tauri 2, React 19, and TypeScript. Windows native. Also available as an **Android app** — see [`mobile/README.md`](mobile/README.md) for the Expo (React Native) port with full feature parity, plus smart scheduled notifications, Do Not Disturb mode, and off-day task support.

## Features

- **Clock in/out and break tracking** — one-click clock in, take breaks, see worked vs break time separately
- **Weekly schedule** — set your planned hours per day with optional per-day hour targets, including overnight shifts (e.g. 11 PM to 7 AM); supports fixed, flex (target-only), and hybrid (preferred window + target) modes; overnight sessions are attributed to the day they started and clearly labeled in the UI
- **"Done for the day / week" toggles** — mark your day or week as complete early; the entire app reflects this (no more "in shift" reminders or clock-in nudges). **Done for the day** turns on automatically on off-days (no blocks, no target); **Done for the week** turns on automatically when every remaining calendar day in the week has no planned blocks or targets. Turn either off if you still plan to log time (the app remembers your choice and won't auto-enable again that day/week). The system tray also offers a **Done for the week** toggle for quick access
- **Smart notifications** — configurable reminder interval (1–30 min), repeating clock-in/out nudges via Windows toast + in-app banner, with configurable quiet hours (custom start/end times) and customizable idle nudge thresholds (break reminder after N min, inactivity alert after N min); if you clock in **after** your scheduled shift has already ended (makeup work), the app does not repeat “shift ended — clock out” nudges; **full notification history** — every notification is logged to the database and browsable via the bell icon's History tab with date-grouped scrollable list, lazy-loading pagination, and all-time retention
- **Pattern insights** — inline banner on the Today tab shows the highest-priority insight (late starts, weekend creep, cramming, missed days, streaks) with expand/dismiss controls; insights also appear in the bell panel's Active tab alongside live notifications
- **Close to tray** — X button hides to system tray; left-click tray icon toggles visibility, right-click for menu
- **Daily task checklist** — create tasks for any day, check them off, roll over incomplete tasks to other days; optional subtasks for granular tracking; standalone Tasks tab plus inline tasks on Today and Week views
- **Recurring tasks** — set tasks to repeat daily, on weekdays, specific days of the week, weekly, or every N days; instances are auto-created and track weekly completion stats (e.g. "3/5 done this week"); indefinite by default (no end date required), with optional end date that auto-deactivates the task when it passes; expired tasks show a visual badge and can be reactivated by clearing the end date
- **Task history navigation** — browse tasks from any past or future week with prev/next navigation; past weeks are read-only for historical reference
- **Compact and expanded modes** — compact floating widget with live date/time and key stats (shift progress + tasks in shift mode, worked/left in target mode), or full dashboard with Today, Tasks, Schedule, Week, and Settings tabs
- **Weekly stats and history** — progress bars, hours logged vs planned, 8-week history chart with clickable bars; navigate to any past week's full day-by-day breakdown with tasks; **shift** mode still emphasizes scheduled-window presence but progress bars and totals use **hours logged** vs planned, with optional “in shift” breakdown when some time was outside the window
- **Daily hour targets** — set explicit target hours per day alongside or instead of fixed time blocks; supports three modes: fixed (target derived from blocks), flex (target only, no time window), and hybrid (preferred window + explicit target); "behind target" status and post-window nudges when you haven't hit your hours
- **Off-schedule boundary warnings** — clocking in outside scheduled hours triggers a confirmation prompt (shared across compact and expanded views); compact mode shows an amber dot while working off-schedule; clock-in button turns indigo when outside shift hours (shift mode only); keeps you aware without blocking
- **Notification bell** — unified bell icon on the Today tab aggregates pattern insights and live notifications (behind-target, off-schedule, action prompts) in one place; badge shows count of undismissed items only; panel separates active notifications from dismissed history; dismiss individual items without losing them
- **Pattern insights** — automatic detection of work patterns: per-day start-time drift (compared against each day's scheduled block, not a global average), weekend creep, late-night sessions, cramming (one day > 50% of weekly hours), missed scheduled days, and on-schedule streaks; fed into the notification bell alongside live alerts
- **Weekly review** — auto-shows a summary modal on the first app open of each new week; grades the previous week with days worked, target completion %, on-time starts, off-schedule sessions, average start/end times, and pattern insights; also accessible manually via "Review" button on the Week tab; adapts wording in shift mode (shift coverage % instead of target completion)
- **Crash recovery** — heartbeat file (every 30s) detects unclean shutdowns; on next launch, proposes an end time for the orphaned session, closes any dangling breaks, and caps recovery to prevent future timestamps
- **Portable data** — database and heartbeat file live in `Documents/Clockwise/`, always writable and independent of the install location; on first launch, automatically migrates data from the legacy `Program Files` location if present; **cross-platform compatible** — the same `clockwise.db` file can be imported into the Android mobile app (Settings > Import Database) for seamless data transfer between desktop and mobile
- **Accountability modes** — choose between "shift" (focus on being present during scheduled blocks) and "target" (focus on hitting X hours regardless of when); shift mode weights the progress ring (and related bars) toward **both** in-window coverage and total hours vs your planned shift length so late or off-window work still moves the dial; task progress and stats stay shift-oriented; target mode shows traditional worked/remaining/overtime stats; affects clock-in button color, progress ring, stats, and notification behavior
- **Settings** — always-on-top toggle, window opacity slider, week start day (Monday/Sunday), 12h/24h time format, autostart, notification and idle nudge controls with sub-options, accountability mode (shift/target)
- **Lock/sleep detection** — detects Windows session lock/unlock and sleep/wake events; pauses tracking context so idle time isn't counted
- **Always-on architecture** — designed to stay open indefinitely without restarting; automatically detects midnight crossings (reloads status, schedule, tasks, and triggers weekly review at week boundaries), handles sleep/wake and clock jumps (force-refreshes if tick gap > 5s), guards against stale state (force-refreshes if last poll > 60s old), runs daily DB maintenance (prunes old notification logs, WAL checkpoint, query planner optimize), and suppresses notification bursts for 5 minutes after midnight

## Behavior Notes

A few cross-cutting behaviors to be aware of when using or contributing to Clockwise:

- **"Done for the day" — auto on off-days.** If today has no schedule blocks and no explicit day target, the app automatically marks the day as done (stored as `'auto'`). This silences all notifications on rest days without any manual action. If you toggle **Done for the day** off, a declined flag prevents re-auto-marking for the rest of that day. Clocking in always clears the day-done flag so tracking resumes normally.
- **"Done for the week" — auto vs manual.** If every remaining calendar day in the current week (from today through the last day, based on your **Week starts on** setting) has no scheduled blocks or day targets, the app automatically marks the week as done. If you manually turn **Done for the week** off after it was auto-applied, the app records a "declined" flag and will not auto-enable again until the following week. If you later add schedule blocks to a future day in the same week and the week was auto-marked done, the flag is automatically cleared so you are no longer shown "Week complete." Manually marking the week done is never auto-cleared — the app respects that you chose to stop early.
- **System tray includes "Done for the week."** The right-click tray menu now offers a **Done for the week** toggle alongside Clock In / Clock Out, so you can mark the week complete without opening the app window.
- **Clocking in clears "day done" but not "week done."** Clocking in removes the day-done flag for today (so you start tracking again), but does not touch the week-done flag. If the week is marked done and you still want to work, turn off **Done for the week** yourself.
- **Changing "Week starts on" in Settings** takes effect immediately for the Week tab, weekly review, and auto week-done logic. However, old `done_week_*` meta keys stored under the previous anchor are not migrated. If you switch from Monday to Sunday (or vice versa) mid-week, toggle **Done for the week** once to clear any stale state.
- **Weekly review modal** is shown once per new week on first app open. If you change **Week starts on**, the review may re-trigger because the stored "last reviewed" anchor no longer matches the new week boundary. This is by design — you get a fresh review under the new cadence.
- **Settings changes propagate immediately.** Switching **accountability mode** or **week start day** triggers an instant status refresh and notification re-check so the Today tab, Compact view, and notification behavior update without waiting for the 30-second poll.
- **Always-on: day change.** When midnight crosses while the app is open, both the frontend (1s tick detects date mismatch) and backend (30s loop emits `day-changed` event) trigger a coordinated reload — status, schedule, notifications, and weekly review check all refresh automatically. No restart needed.
- **Always-on: sleep/wake recovery.** If the system sleeps or the clock jumps (tick gap > 5 seconds), the app force-refreshes all state immediately on wake. This supplements the Windows lock/sleep listener for cases like hibernate or NTP adjustments.
- **Always-on: staleness guard.** If the periodic 30s status poll fails or stalls, the 1s tick forces a refresh once the last successful poll exceeds 60 seconds — the live timer display never drifts indefinitely.
- **Always-on: midnight notification grace.** After a day transition, notifications are suppressed for 5 minutes to prevent a burst of stale reminders (e.g. "clock in" at 00:01).
- **Always-on: daily DB maintenance.** Once per day on the first detected day change, old notification logs (> 30 days) are pruned, the WAL file is checkpointed, and `PRAGMA optimize` refreshes query planner statistics.
- **Recurring task lifecycle.** Recurring tasks repeat indefinitely by default — no end date is required. If an end date is set and passes, the backend automatically deactivates the task the next time instances are evaluated. Expired tasks are hidden from the Recurring Tasks panel. To reactivate an expired task, edit it and clear the end date (the app reactivates it automatically). Deleting a recurring task prompts whether to also remove its generated daily instances or keep them as standalone tasks.

## Tech Stack

- **Frontend:** React 19, TypeScript, Vite 7, Tailwind CSS 4, Zustand, Framer Motion, ESLint
- **Backend:** Rust (Edition 2021), Tauri 2, SQLite via sqlx
- **Desktop:** System tray, notifications, autostart, lock/sleep detection (Windows)
- **Mobile:** Expo (React Native), expo-sqlite, expo-notifications, Zustand (Android)

## Getting Started

```bash
# Install frontend dependencies
npm install

# Run in development (frontend + Tauri backend)
npm run tauri dev

# Build production installer (MSI/NSIS)
npm run tauri build
```

## Testing

Clockwise has a comprehensive regression test suite covering both the Rust backend and the React frontend. These tests are designed to catch regressions as new features are added.

### Running Tests

```bash
# Lint frontend code (catches hooks violations, etc.)
npm run lint

# Run all frontend tests
npm test

# Run frontend tests in watch mode (re-runs on file changes)
npm run test:watch

# Run frontend tests with coverage report
npm run test:coverage

# Run all Rust backend tests
cd src-tauri && cargo test
```

### Test Architecture — 299 tests across 3 layers

Every feature is covered by **three test layers**: Rust backend unit tests, frontend component/store tests, and full-stack E2E smoke tests. All three must pass before shipping.

---

#### Layer 1 · Rust Backend Tests (88 tests)

Located inline in each module as `#[cfg(test)] mod tests { ... }`. These test the data layer and business logic directly against an in-memory SQLite database, so they run fast and in isolation.

| Module | What's tested |
|--------|---------------|
| `db.rs` | Schema creation, idempotent init, default schedule seeding, template bootstrapping |
| `commands/session.rs` | Clock in/out, break start/resume, pause subtraction, active session detection, pending recovery, checklist toggle, day/week done, auto week-done (store `'auto'`, reconciliation when schedule revives, declined flag), overnight session, daily hour targets, behind-target status, off-schedule detection, pattern insights (6 heuristics), weekly review summary |
| `commands/tasks.rs` | Daily task CRUD, toggle done/undone, rollover, sort ordering, delete; recurring task recurrence patterns (daily, weekdays, specific days, weekly, every N days), auto-instantiation, end-date boundaries, week query aggregation, recurring stats |
| `commands/schedule.rs` | Block CRUD, validation (day range, time range), template activation, legacy schedule sync, cascade deletes, day target persistence |
| `commands/settings.rs` | Setting defaults, round-trip persistence, opacity clamping, boolean parsing, new keys (always_on_top, week_start_day, time_format, idle nudge thresholds), clamping validation |
| `notifications.rs` | Interval-based reminder dedup, quiet hours (normal and wrap-around), overtime nudge, idle nudge, DB-backed threshold validation, day/week-done suppression, behind-target nudges, shift-end timestamp helpers, notification log insert/query, history pagination |
| `startup.rs` | Stale session reconciliation, pending recovery creation, startup notice lifecycle, heartbeat file handling |
| `tray.rs` | System tray setup, left-click toggle, right-click menu (show/clock in/clock out/week done/quit) |
| `lock_detect.rs` | Windows session lock/unlock and sleep/wake detection via message-only window |

**Test helper:** `src/test_helpers.rs` provides `test_state()` which builds an in-memory SQLite pool, runs all migrations, and returns a ready-to-use `AppState`.

---

#### Layer 2 · Frontend Tests (189 tests)

Powered by **Vitest** + **React Testing Library** + **jsdom**. The Tauri IPC layer (`@tauri-apps/api`) is mocked globally in `src/test-setup.ts`, allowing all frontend logic to be tested without a running Tauri backend.

| File | What's tested |
|------|---------------|
| `src/lib/time.test.ts` | All formatting/parsing utilities, state labels and messages, edge cases |
| `src/store/timer.test.ts` | Clock in/out flows, break management, `liveWorkedMs` interpolation, error propagation, recovery |
| `src/store/schedule.test.ts` | Block add/update/delete with temp IDs, getDayBlocks sorting, checklist items, save validation |
| `src/store/settings.test.ts` | Init from localStorage, mode/theme persistence, DOM attribute application, optimistic save |
| `src/components/*.test.tsx` | ClockButton, ProgressRing, StatusChip — all visual states and props |
| `src/views/Compact.test.tsx` | Loading state, status display, button visibility per session state |
| `src/views/Expanded/*.test.tsx` | TodayTab, TasksTab, ScheduleTab, WeekTab, SettingsTab — rendering, interactions, API calls |
| `src/App.test.tsx` | Full app lifecycle: banners (notice, recovery, resume, action prompt, error), off-schedule banner removal verification, event listeners (incl. tray week-done toggle), weekly review auto-show, mode switching |

---

#### Layer 3 · Smoke Tests / E2E (22 tests)

Automated end-to-end smoke tests launch the actual compiled Clockwise binary, drive the real UI through **WebdriverIO + tauri-driver**, and exercise the full stack (React UI → Tauri IPC → Rust → SQLite). These catch integration bugs that unit tests miss.

```bash
# Run smoke tests (builds debug binary, then clicks through every user flow)
cd e2e
npm install
npm test

# Or from the root
npm run smoke
```

**Prerequisites:**
- `tauri-driver` — install once with `cargo install tauri-driver --locked`
- `msedgedriver` — handled automatically by the `edgedriver` npm package (no manual setup needed)

**What's covered:**

| Flow | What's verified |
|------|-----------------|
| App launch | Window opens, Clockwise title renders, Today tab active by default |
| Clock in | Button switches to "Clock out", break button appears |
| Take a break | "Resume work" button appears |
| Resume from break | Returns to "Take a break" state |
| Clock out | Returns to "Clock in" idle state |
| Tasks tab | Tab opens, add a task, toggle done/undone, delete a task |
| Schedule tab | 7 day rows render, toggling a day off/on works |
| Week tab | "This Week" heading and 7 week-rows render |
| Settings tab | Theme toggle updates active chip |
| Done for the day | Toggle on (button shows active state), toggle off again |
| Mode switch | Compact view renders, then switches back to Expanded |

**How it works:** The `wdio.conf.js` config:
1. Builds a debug binary via `npx tauri build --debug --no-bundle`
2. Cleans the data directory for a fresh SQLite database
3. Spawns `tauri-driver` (pointed to `msedgedriver`) on port 4444
4. WebdriverIO drives the app through WebDriver protocol via tauri-driver → WebView2

---

### How to Use These Tests Going Forward

1. **Before every feature:** Run `npm test`, `cargo test`, and `npm run smoke` to confirm a green baseline across all three layers.

2. **While building a feature:** Write tests alongside your code. Follow the existing patterns:
   - Rust: add test functions inside the `#[cfg(test)] mod tests` block of the module you're changing.
   - Frontend stores/utilities: create or extend the colocated `.test.ts` file.
   - Frontend components/views: create or extend the colocated `.test.tsx` file using RTL.
   - E2E: add `it(...)` blocks in `e2e/specs/smoke.e2e.js` for any new user-facing flows.

3. **After finishing a feature:** Run the full suite again. Any red tests indicate a regression you introduced.

4. **Adding a new module:** Create a `test_helpers::test_state()` instance for backend tests; for frontend, mock any new IPC commands in `src/test-setup.ts` or locally with `vi.mocked(invoke)`.

5. **CI integration:** All test commands exit non-zero on failure, making them suitable for any CI pipeline:
   ```yaml
   - run: npm test
     working-directory: clockwise
   - run: cargo test
     working-directory: clockwise/src-tauri
   - run: npm run smoke
     working-directory: clockwise
   ```

### Test Design Principles

- **Three layers, one goal:** Backend unit tests catch logic bugs, frontend tests catch UI/state bugs, E2E tests catch integration bugs across the full stack. Every new feature should be covered by at least two of these layers.
- **Isolation:** Each test creates its own in-memory database (Rust) or resets store state (frontend). Tests never depend on execution order.
- **Speed:** The unit/component suite (277 tests) runs in under 10 seconds. E2E tests take longer (build + launch + drive) but cover the real binary.
- **No network/OS dependencies:** All external APIs (Tauri IPC, notifications, window management, filesystem heartbeat) are mocked or use temp files in unit tests. E2E tests run the actual app against a fresh SQLite database.
- **Static analysis:** ESLint with `eslint-plugin-react-hooks` catches hooks-order violations (conditional hooks, hooks after early returns) at lint time, before they become runtime crashes.
- **Feature-aligned:** Tests are organized by feature, not by test type. This makes it easy to find and extend coverage when modifying a specific feature.

## Project Structure

```
clockwise/
├── src/                    # React frontend
│   ├── components/         # Reusable UI components (ClockButton, Logo, OffScheduleConfirm, ProgressRing, StatusChip, SubtaskPanel, Titlebar, WeekNav, WeeklyReview)
│   ├── views/              # Page-level views (Compact, Expanded tabs)
│   ├── store/              # Zustand state stores (timer, schedule, settings)
│   ├── lib/                # Utilities (time formatting, Tauri IPC wrappers)
│   ├── styles/             # Global CSS (dark/light themes, layout, custom scrollbar)
│   ├── assets/             # Static assets
│   ├── types.ts            # Shared TypeScript types
│   └── test-setup.ts       # Global test mocks
├── src-tauri/              # Rust backend
│   └── src/
│       ├── commands/       # Tauri command handlers (session, schedule, settings, tasks)
│       ├── db.rs           # SQLite schema and migrations
│       ├── state.rs        # AppState definition (DB pool, mutexes)
│       ├── notifications.rs # Reminder system with interval dedup
│       ├── tray.rs         # System tray icon and menu
│       ├── window.rs       # Window mode switching, vibrancy, always-on-top
│       ├── lock_detect.rs  # Windows lock/sleep detection
│       ├── startup.rs      # Session recovery on app restart
│       ├── heartbeat.rs    # Liveness file for crash recovery
│       └── test_helpers.rs # Shared test utilities
├── scripts/                # Build utilities (icon generation)
├── e2e/                    # Smoke tests (WebdriverIO + tauri-driver)
│   ├── specs/smoke.e2e.js  # Full smoke test suite (22 tests)
│   ├── wdio.conf.js        # WDIO config with tauri-driver lifecycle
│   └── package.json        # E2E-specific dependencies
├── eslint.config.js        # ESLint config (react-hooks, typescript-eslint)
├── vite.config.ts          # Vite bundler configuration
├── vitest.config.ts        # Frontend test configuration
├── tailwind.config.ts      # Tailwind CSS configuration
├── index.html              # App entry point
└── package.json            # Scripts: dev, build, test, test:watch, test:coverage, lint, smoke
```
