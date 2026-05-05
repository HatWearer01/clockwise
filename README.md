# Clockwise

A personal time-tracking desktop app for managing your own work hours. Clock in and out, track breaks, and see exactly how much you've worked — all local, all private, just for you.

Built for anyone who wants more structure in their workday. Set your own weekly schedule, get gentle nudges when you drift, and review your patterns over time.

Built with Tauri 2, React 19, and TypeScript. Windows native.

## Features

- **Clock in/out and break tracking** — one-click clock in, take breaks, see worked vs break time separately
- **Weekly schedule** — set your planned hours per day, including overnight shifts (e.g. 11 PM to 7 AM); overnight sessions are attributed to the day they started and clearly labeled in the UI
- **"Done for the day / week" toggles** — mark your day or week as complete early; the entire app reflects this (no more "in shift" reminders or clock-in nudges)
- **Smart notifications** — configurable reminder interval (1–30 min), repeating clock-in/out nudges via Windows toast + in-app banner, with configurable quiet hours (custom start/end times) and customizable idle nudge thresholds (break reminder after N min, inactivity alert after N min)
- **Close to tray** — X button hides to system tray; left-click tray icon toggles visibility, right-click for menu
- **Daily task checklist** — create tasks for any day, check them off, roll over incomplete tasks to other days; standalone Tasks tab plus inline tasks on Today and Week views
- **Recurring tasks** — set tasks to repeat daily, on weekdays, specific days of the week, weekly, or every N days; instances are auto-created and track weekly completion stats (e.g. "3/5 done this week")
- **Task history navigation** — browse tasks from any past or future week with prev/next navigation; past weeks are read-only for historical reference
- **Compact and expanded modes** — compact floating widget with live date/time and key stats, or full dashboard with Today, Tasks, Schedule, Week, and Settings tabs
- **Weekly stats and history** — progress bars, hours logged vs planned, 8-week history chart with clickable bars; navigate to any past week's full day-by-day breakdown with tasks
- **Crash recovery** — heartbeat file (every 30s) detects unclean shutdowns; on next launch, proposes an end time for the orphaned session, closes any dangling breaks, and caps recovery to prevent future timestamps
- **Settings** — always-on-top toggle, window opacity slider, week start day (Monday/Sunday), 12h/24h time format, autostart, notification and idle nudge controls with sub-options
- **Lock/sleep detection** — detects Windows session lock/unlock and sleep/wake events; pauses tracking context so idle time isn't counted

## Tech Stack

- **Frontend:** React 19, TypeScript, Vite 7, Tailwind CSS 4, Zustand, Framer Motion, ESLint
- **Backend:** Rust (Edition 2021), Tauri 2, SQLite via sqlx
- **Desktop:** System tray, notifications, autostart, lock/sleep detection (Windows)

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

### Test Architecture — 275 tests across 3 layers

Every feature is covered by **three test layers**: Rust backend unit tests, frontend component/store tests, and full-stack E2E smoke tests. All three must pass before shipping.

---

#### Layer 1 · Rust Backend Tests (75 tests)

Located inline in each module as `#[cfg(test)] mod tests { ... }`. These test the data layer and business logic directly against an in-memory SQLite database, so they run fast and in isolation.

| Module | What's tested |
|--------|---------------|
| `db.rs` | Schema creation, idempotent init, default schedule seeding, template bootstrapping |
| `commands/session.rs` | Clock in/out, break start/resume, pause subtraction from worked time, active session detection, pending recovery clamping, recovery pause closure, recovery future-time cap, checklist toggle, day/week done, overnight session detection |
| `commands/tasks.rs` | Daily task CRUD, toggle done/undone, rollover, sort ordering, delete; recurring task recurrence patterns (daily, weekdays, specific days, weekly, every N days), auto-instantiation, end-date boundaries, week query aggregation, recurring stats |
| `commands/schedule.rs` | Block CRUD, validation (day range, time range), template activation, legacy schedule sync, cascade deletes |
| `commands/settings.rs` | Setting defaults, round-trip persistence, opacity clamping, boolean parsing, new keys (always_on_top, week_start_day, time_format, idle nudge thresholds), clamping validation |
| `notifications.rs` | Interval-based reminder dedup, quiet hours (normal and wrap-around), overtime nudge, idle nudge, DB-backed threshold validation, day/week-done suppression |
| `startup.rs` | Stale session reconciliation, pending recovery creation, startup notice lifecycle, heartbeat file handling |
| `tray.rs` | System tray setup, left-click toggle, right-click menu (show/clock in/clock out/quit) |
| `lock_detect.rs` | Windows session lock/unlock and sleep/wake detection via message-only window |

**Test helper:** `src/test_helpers.rs` provides `test_state()` which builds an in-memory SQLite pool, runs all migrations, and returns a ready-to-use `AppState`.

---

#### Layer 2 · Frontend Tests (178 tests)

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
| `src/App.test.tsx` | Full app lifecycle: banners (notice, recovery, resume, action prompt, error), event listeners, mode switching |

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
- **Speed:** The unit/component suite (253 tests) runs in under 10 seconds. E2E tests take longer (build + launch + drive) but cover the real binary.
- **No network/OS dependencies:** All external APIs (Tauri IPC, notifications, window management, filesystem heartbeat) are mocked or use temp files in unit tests. E2E tests run the actual app against a fresh SQLite database.
- **Static analysis:** ESLint with `eslint-plugin-react-hooks` catches hooks-order violations (conditional hooks, hooks after early returns) at lint time, before they become runtime crashes.
- **Feature-aligned:** Tests are organized by feature, not by test type. This makes it easy to find and extend coverage when modifying a specific feature.

## Project Structure

```
clockwise/
├── src/                    # React frontend
│   ├── components/         # Reusable UI components (ClockButton, Logo, ProgressRing, StatusChip, Titlebar)
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
