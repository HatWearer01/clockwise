# Clockwise

A personal time-tracking desktop app for self-regulating your work hours. Clock in and out on your own terms, track breaks, and see exactly how much you've worked — no employer surveillance, no timesheets to submit. Just you keeping yourself honest.

Built for the modern work-from-home employee or business owner who wants structure without micromanagement. Set your own weekly schedule, get gentle nudges when you drift, and review your patterns over time.

Built with Tauri 2, React 19, and TypeScript. Windows native.

## Features

- **Clock in/out and break tracking** — one-click clock in, take breaks, see worked vs break time separately
- **Weekly schedule** — set your planned hours per day, including overnight shifts (e.g. 11 PM to 7 AM)
- **"Done for the week" toggle** — mark your week as complete early; the entire app reflects this (no more "in shift" reminders)
- **Smart notifications** — configurable reminder interval (1–30 min), repeating clock-in/out nudges via Windows toast + in-app banner, with optional quiet hours
- **Close to tray** — X button hides to system tray; left-click tray icon toggles visibility, right-click for menu
- **Compact and expanded modes** — compact floating widget or full dashboard with Today, Schedule, Week, and Settings tabs
- **Weekly stats and history** — progress bars, hours logged vs planned, 8-week history chart
- **Crash recovery** — heartbeat file detects unclean shutdowns and recovers open sessions on next launch
- **Lock/sleep detection** — pauses tracking context when you lock your PC or it sleeps

## Tech Stack

- **Frontend:** React 19, TypeScript, Vite 7, Tailwind CSS 4, Zustand, Framer Motion
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
# Run all frontend tests
npm test

# Run frontend tests in watch mode (re-runs on file changes)
npm run test:watch

# Run frontend tests with coverage report
npm run test:coverage

# Run all Rust backend tests
cd src-tauri && cargo test
```

### Test Architecture

The suite is split into two layers that together cover every feature of the app:

#### Rust Backend Tests (51 tests)

Located inline in each module as `#[cfg(test)] mod tests { ... }`. These test the data layer and business logic directly against an in-memory SQLite database, so they run fast and in isolation.

| Module | What's tested |
|--------|---------------|
| `db.rs` | Schema creation, idempotent init, default schedule seeding, template bootstrapping |
| `commands/session.rs` | Clock in/out, break start/resume, pause subtraction from worked time, active session detection, pending recovery clamping, checklist toggle |
| `commands/schedule.rs` | Block CRUD, validation (day range, time range), template activation, legacy schedule sync, cascade deletes |
| `commands/settings.rs` | Setting defaults, round-trip persistence, opacity clamping, boolean parsing, corner snap positioning |
| `notifications.rs` | Interval-based reminder dedup, quiet hours (normal and wrap-around), overtime nudge, idle nudge, week-done suppression |
| `startup.rs` | Stale session reconciliation, pending recovery creation, startup notice lifecycle, heartbeat file handling |
| `tray.rs` | System tray setup, left-click toggle, right-click menu (show/clock in/clock out/quit) |
| `lock_detect.rs` | Windows session lock/unlock and sleep/wake detection via message-only window |

**Test helper:** `src/test_helpers.rs` provides `test_state()` which builds an in-memory SQLite pool, runs all migrations, and returns a ready-to-use `AppState`.

#### Frontend Tests (143 tests)

Powered by **Vitest** + **React Testing Library** + **jsdom**. The Tauri IPC layer (`@tauri-apps/api`) is mocked globally in `src/test-setup.ts`, allowing all frontend logic to be tested without a running Tauri backend.

| File | What's tested |
|------|---------------|
| `src/lib/time.test.ts` | All formatting/parsing utilities, state labels and messages, edge cases |
| `src/store/timer.test.ts` | Clock in/out flows, break management, `liveWorkedMs` interpolation, error propagation, recovery |
| `src/store/schedule.test.ts` | Block add/update/delete with temp IDs, getDayBlocks sorting, checklist items, save validation |
| `src/store/settings.test.ts` | Init from localStorage, mode/theme persistence, DOM attribute application, optimistic save |
| `src/components/*.test.tsx` | ClockButton, ProgressRing, StatusChip — all visual states and props |
| `src/views/Compact.test.tsx` | Loading state, status display, button visibility per session state |
| `src/views/Expanded/*.test.tsx` | TodayTab, ScheduleTab, WeekTab, SettingsTab — rendering, interactions, API calls |
| `src/App.test.tsx` | Full app lifecycle: banners (notice, recovery, resume, action prompt, error), event listeners, mode switching |

### Smoke Tests (E2E)

Automated end-to-end smoke tests launch the actual compiled Clockwise binary, drive the real UI through WebdriverIO + tauri-driver, and exercise the full stack (React UI → Tauri IPC → Rust → SQLite). These catch integration bugs that unit tests miss.

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

**What's covered (16 tests):**

| Flow | What's verified |
|------|-----------------|
| App launch | Window opens, Clockwise title renders, Today tab active by default |
| Clock in | Button switches to "Clock out", break button appears |
| Take a break | "Resume work" button appears |
| Resume from break | Returns to "Take a break" state |
| Clock out | Returns to "Clock in" idle state |
| Schedule tab | 7 day rows render, toggling a day off/on works |
| Week tab | "This Week" heading and 7 week-rows render |
| Settings tab | Theme toggle updates active chip |
| Mode switch | Compact view renders, then switches back to Expanded |

**How it works:** The `wdio.conf.js` config:
1. Builds a debug binary via `npx tauri build --debug --no-bundle`
2. Cleans the data directory for a fresh SQLite database
3. Spawns `tauri-driver` (pointed to `msedgedriver`) on port 4444
4. WebdriverIO drives the app through WebDriver protocol via tauri-driver → WebView2

### How to Use These Tests Going Forward

1. **Before every feature:** Run `npm test` and `cargo test` to confirm a green baseline.

2. **While building a feature:** Write tests alongside your code. Follow the existing patterns:
   - Rust: add test functions inside the `#[cfg(test)] mod tests` block of the module you're changing.
   - Frontend stores/utilities: create or extend the colocated `.test.ts` file.
   - Frontend components/views: create or extend the colocated `.test.tsx` file using RTL.

3. **After finishing a feature:** Run the full suite again. Any red tests indicate a regression you introduced.

4. **Adding a new module:** Create a `test_helpers::test_state()` instance for backend tests; for frontend, mock any new IPC commands in `src/test-setup.ts` or locally with `vi.mocked(invoke)`.

5. **CI integration:** Both test commands exit non-zero on failure, making them suitable for any CI pipeline:
   ```yaml
   - run: npm test
     working-directory: clockwise
   - run: cargo test
     working-directory: clockwise/src-tauri
   ```

### Test Design Principles

- **Isolation:** Each test creates its own in-memory database (Rust) or resets store state (frontend). Tests never depend on execution order.
- **Speed:** The full suite (194 tests) runs in under 10 seconds total.
- **No network/OS dependencies:** All external APIs (Tauri IPC, notifications, window management, filesystem heartbeat) are mocked or use temp files.
- **Feature-aligned:** Tests are organized by feature, not by test type. This makes it easy to find and extend coverage when modifying a specific feature.

## Project Structure

```
clockwise/
├── src/                    # React frontend
│   ├── components/         # Reusable UI components
│   ├── views/              # Page-level views (Compact, Expanded tabs)
│   ├── store/              # Zustand state stores
│   ├── lib/                # Utilities (time formatting, Tauri IPC wrappers)
│   └── test-setup.ts       # Global test mocks
├── src-tauri/              # Rust backend
│   └── src/
│       ├── commands/       # Tauri command handlers (session, schedule, settings)
│       ├── db.rs           # SQLite schema and migrations
│       ├── notifications.rs # Reminder system with interval dedup
│       ├── tray.rs         # System tray icon and menu
│       ├── window.rs       # Window mode switching, vibrancy
│       ├── lock_detect.rs  # Windows lock/sleep detection
│       ├── startup.rs      # Session recovery on app restart
│       ├── heartbeat.rs    # Liveness file for crash recovery
│       └── test_helpers.rs # Shared test utilities
├── e2e/                    # Smoke tests (WebdriverIO + tauri-driver)
│   ├── specs/smoke.e2e.js  # Full smoke test suite
│   ├── wdio.conf.js        # WDIO config with tauri-driver lifecycle
│   └── package.json        # E2E-specific dependencies
├── vitest.config.ts        # Frontend test configuration
└── package.json            # Scripts: dev, build, test, test:watch, test:coverage, smoke
```
