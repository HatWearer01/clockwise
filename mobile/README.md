# Clockwise Mobile (Android)

Android port of the Clockwise time-tracking desktop app, built with **Expo (React Native)**.

Full feature parity with the desktop Tauri app — same SQLite schema, same business logic, native Android UI.

## Quick Start

```bash
cd mobile
npm install
npx expo start          # Expo dev server (scan QR with Expo Go)
npx expo start --clear  # clear Metro cache and start fresh
npx expo run:android    # build + run on device/emulator
```

Requires Node 18+, and either Expo Go on a physical device or an Android emulator.

## UI Design

The mobile app mirrors the desktop's **Compact / Expanded** dual-mode design, adapted for a phone screen:

**Today tab (Compact mode — default):**
The entire screen is the compact view. A giant progress ring dominates the center of the screen with percentage and worked time inside. Below it: a bold headline (elapsed timer, "Ready when you are", "Done for today"), a status message, and worked/left stats. The top bar shows the Clockwise brand, today's date, and an expand button. The bottom bar has a status chip and action buttons (Clock in/out, Break, Day done).

**Today tab (Expanded mode):**
Tap the expand button to reveal the full dashboard: summary card with ring and buttons, a linear progress bar, current session and schedule stats, and a full task list with add/toggle/recurring support.

**Other tabs** (Tasks, Schedule, Week, Settings) match the desktop's Expanded tab features with Android-native styling.

## Architecture

```
mobile/
├── app/                    # Expo Router screens
│   ├── _layout.tsx         # Root layout (DB init, lifecycle, crash recovery)
│   └── (tabs)/
│       ├── _layout.tsx     # Tab navigator (Today, Tasks, Schedule, Week, Settings)
│       ├── index.tsx       # Today — compact full-screen / expanded detail
│       ├── tasks.tsx       # Tasks — week nav, day picker, CRUD, recurring manager
│       ├── schedule.tsx    # Schedule — templates, blocks, day targets, checklist
│       ├── week.tsx        # Week — summary, 8-week chart, weekly review, insights
│       └── settings.tsx    # Settings — theme, notifications, accountability mode
├── src/
│   ├── db/                 # SQLite schema, migrations, connection (expo-sqlite)
│   ├── services/           # Business logic ported from Rust commands
│   │   ├── session.ts      # Clock in/out, breaks, status, week/day done, recovery
│   │   ├── task.ts         # Daily + recurring tasks, subtasks, week queries
│   │   ├── schedule.ts     # Templates, blocks, day targets, checklist
│   │   ├── notification.ts # Check-and-notify, quiet hours, dedup, history
│   │   ├── insight.ts      # Pattern detection (late starts, streaks, etc.)
│   │   ├── settings.ts     # App settings CRUD
│   │   ├── foreground.ts   # Persistent notification, background task
│   │   └── lifecycle.ts    # Heartbeat, crash recovery, app state transitions
│   ├── store/              # Zustand stores (timer, schedule, settings)
│   ├── lib/                # Utilities (time.ts, theme.ts)
│   └── types.ts            # Shared TypeScript types
├── app.json                # Expo config (SDK 54, dark nav bar, system UI)
├── package.json
└── tsconfig.json
```

## Desktop-to-Mobile Mapping

| Desktop (Tauri)           | Mobile (Expo)                              |
|---------------------------|--------------------------------------------|
| Compact floating widget   | Full-screen compact view (Today tab default) |
| Expanded dashboard        | Expanded view (Today tab expand button)    |
| System tray               | Persistent Android notification            |
| Always-on window          | Foreground service + background fetch       |
| Lock/sleep detection      | AppState change listener                   |
| Window vibrancy           | Dark/light theme with platform colors      |
| Close-to-tray             | App backgrounds naturally                  |
| Crash recovery            | Heartbeat + reconcileStaleSession on launch |
| OS notifications          | expo-notifications                         |
| Rust SQLite (sqlx)        | expo-sqlite                                |
| Tauri IPC (invoke)        | Direct TypeScript service calls             |

## Features

- **Session tracking**: Clock in/out with second-precision timing, break management
- **Compact-first Today screen**: Giant progress ring, live timer, worked/left stats — full screen, no card
- **Expandable detail view**: Tap expand for progress bar, session stats, schedule info, and task list
- **Schedule**: Multi-template support, blocks per day, day targets, checklist items
- **Tasks**: Daily tasks with subtasks, recurring task engine (daily/weekdays/specific days/weekly/every N days)
- **Insights**: Late start detection, weekend creep, overtime, cramming, streaks
- **Weekly review**: Day-by-day breakdown with targets vs actuals
- **Notifications**: Shift reminders, idle nudges, overtime warnings, quiet hours
- **Crash recovery**: Heartbeat-based stale session detection on app relaunch
- **Theme**: Dark and light modes with system preference support
- **Haptic feedback**: Tactile responses on clock in/out, break, task toggle, and day done

## Expo Go Limitations

Some features are limited when previewing via Expo Go (use a development build for full support):
- Push notifications (removed from Expo Go in SDK 53)
- Background fetch (deprecated; use `expo-background-task` in dev builds)
- Navigation bar color control (edge-to-edge mode overrides `setBackgroundColorAsync`)

These are wrapped in try/catch blocks and degrade gracefully.

## Data

Database is stored locally on device via expo-sqlite (`clockwise.db`). Same schema as the desktop app — data is not shared between desktop and mobile.
