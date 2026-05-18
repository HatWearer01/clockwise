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
│       ├── index.tsx       # Today — compact full-screen / expanded detail + insights
│       ├── tasks.tsx       # Tasks — week nav, day grid picker, CRUD, recurring manager
│       ├── schedule.tsx    # Schedule — templates, blocks, day targets, checklist
│       ├── week.tsx        # Week — summary, 8-week chart, weekly review, insights
│       └── settings.tsx    # Settings — theme, notifications, sync, data import/export
├── src/
│   ├── db/                 # SQLite schema, migrations, connection (expo-sqlite)
│   ├── services/           # Business logic ported from Rust commands
│   │   ├── session.ts      # Clock in/out, breaks, status, week/day done, recovery
│   │   ├── task.ts         # Daily + recurring tasks, subtasks, week queries
│   │   ├── schedule.ts     # Templates, blocks, day targets, checklist
│   │   ├── notification.ts # Scheduled alarms, smart nudges, DND, dedup, history
│   │   ├── insight.ts      # Pattern detection (late starts, streaks, etc.)
│   │   ├── settings.ts     # App settings CRUD
│   │   ├── foreground.ts   # Persistent live notification, channels, background task
│   │   ├── lifecycle.ts    # Heartbeat, crash recovery, app state transitions
│   │   ├── sync.ts         # LAN sync client (discover, pair, push/pull, WebSocket)
│   │   └── backup.ts       # Database export/import
│   ├── store/              # Zustand stores (timer, schedule, settings, sync)
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
- **Expandable detail view**: Tap expand for progress bar, session stats, schedule info, task list, and insights
- **Schedule**: Multi-template support, blocks per day, day targets, checklist items
- **Tasks**: Daily tasks with subtasks, recurring task engine (daily/weekdays/specific days/weekly/every N days); day picker shows all 7 days as a grid (no scrolling needed for Sat/Sun)
- **Insights**: Late start detection, weekend creep, overtime, cramming, streaks (shown on both Today expanded view and Week tab)
- **Weekly review**: Day-by-day breakdown with targets vs actuals
- **Week tab off-day support**: Hours worked on scheduled off-days are displayed with actual time and progress bar instead of just "Off"
- **LAN Sync**: Real-time bidirectional sync with the desktop app over your local network. Pair via a 6-digit code, sync changes automatically over WebSocket, or trigger a manual sync. Works offline with catch-up on reconnect.
- **Smart notifications**: Scheduled shift alarms (start warning, clock-in, shift end), smart contextual nudges (forgot to clock in, idle too long, tasks due, approaching overtime), persistent live notification with elapsed/remaining time (shows on lock screen, updates every 30s)
- **Do Not Disturb**: Pause all notifications with duration options (until tomorrow, next week, or indefinitely) from Settings
- **Notification channels**: Separate Android channels for session tracking (DEFAULT importance, visible on lock screen), alerts (sound), and task reminders
- **Off-day task support**: Freely add tasks on any day; clocking in on an off day clears the auto day-done flag and treats it as a working day
- **Crash recovery**: Heartbeat-based stale session detection on app relaunch
- **Theme**: Dark and light modes with system preference support
- **Haptic feedback**: Tactile responses on clock in/out, break, task toggle, and day done
- **Database import/export**: Transfer your database between desktop and mobile via the Settings tab (export shares a .db file, import replaces the local database with a picked file)

## Expo Go Limitations

Some features are limited when previewing via Expo Go (use a development build for full support):
- Push notifications (removed from Expo Go in SDK 53)
- Background fetch (deprecated; use `expo-background-task` in dev builds)
- Navigation bar color control (edge-to-edge mode overrides `setBackgroundColorAsync`)

These are wrapped in try/catch blocks and degrade gracefully.

## Data & Sync

Database is stored locally on device via expo-sqlite (`clockwise.db`). Same schema as the desktop app.

### LAN Sync (Recommended)

The desktop and mobile apps sync automatically when connected to the same local network:

1. Open the desktop app — Settings > Mobile Sync — click "Generate pairing code"
2. Note the displayed IP address and 6-digit code
3. Open mobile app — Settings > Sync — enter the IP and pairing code, tap "Pair & Connect"
4. Done! Changes flow bidirectionally in real-time over WebSocket (port 19847)

Sync tracks all changes via a `sync_log` table with database triggers. On reconnect, any offline changes are reconciled automatically (last-write-wins by timestamp).

### Manual Database Transfer

For one-time imports without LAN sync:

**Desktop to Mobile:**
1. Copy `Documents/Clockwise/clockwise.db` from your PC to your phone (USB, cloud drive, etc.)
2. Open Clockwise mobile, go to Settings > Data > Import Database
3. Pick the `.db` file — it replaces local data and reloads everything

**Mobile to Desktop:**
1. Open Clockwise mobile, go to Settings > Data > Export Database
2. Share/save the exported `.db` file to your PC
3. Replace `Documents/Clockwise/clockwise.db` on your PC with the exported file
4. Restart the desktop app

Desktop-only settings (window opacity, always-on-top, autostart, idle nudge) are preserved in the DB but ignored on mobile. Mobile-only keys (heartbeat) are ignored on desktop.
