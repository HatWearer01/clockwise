import { useCallback, useEffect, useState } from "react";
import { FolderOpen, Wifi, WifiOff, Copy } from "lucide-react";
import { apiOpenDataFolder, apiGeneratePairingCode, apiGetSyncStatus, type SyncStatus } from "../../lib/tauri";
import { formatMinuteAsTime, timeInputValue, parseTimeInput } from "../../lib/time";
import { useSettingsStore } from "../../store/settings";

export default function SettingsTab() {
  const { theme, setTheme, appSettings, setAppSettings, settingsSaving } = useSettingsStore();
  const tf = appSettings.time_format;

  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [codeCopied, setCodeCopied] = useState(false);

  const refreshSync = useCallback(async () => {
    try {
      const s = await apiGetSyncStatus();
      setSyncStatus(s);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    refreshSync();
    const interval = setInterval(refreshSync, 5000);
    return () => clearInterval(interval);
  }, [refreshSync]);

  const handleGenerateCode = async () => {
    const code = await apiGeneratePairingCode();
    setPairingCode(code);
    setCodeCopied(false);
  };

  const handleCopyCode = () => {
    if (pairingCode) {
      navigator.clipboard.writeText(pairingCode);
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    }
  };

  return (
    <section className="tab-panel">
      <h2>Settings</h2>
      <p className="muted" style={{ margin: "0 0 4px", fontSize: "0.85rem" }}>
        Customize how Clockwise works for you.
      </p>
      <div className="settings-list">
        {/* 1. Theme */}
        <article className="setting-row">
          <div>
            <span>Theme</span>
            <p className="muted setting-desc">Choose your preferred appearance.</p>
          </div>
          <div className="button-group">
            <button className={theme === "dark" ? "chip chip-active" : "chip"} onClick={() => setTheme("dark")}>
              Dark
            </button>
            <button className={theme === "light" ? "chip chip-active" : "chip"} onClick={() => setTheme("light")}>
              Light
            </button>
            <button className={theme === "system" ? "chip chip-active" : "chip"} onClick={() => setTheme("system")}>
              System
            </button>
          </div>
        </article>

        {/* 2. Always on top */}
        <article className="setting-row">
          <div>
            <span>Always on top</span>
            <p className="muted setting-desc">Keep the Clockwise window above all other windows.</p>
          </div>
          <div className="button-group">
            <button
              className={appSettings.always_on_top ? "chip chip-active" : "chip"}
              onClick={() => void setAppSettings({ always_on_top: true })}
            >
              On
            </button>
            <button
              className={!appSettings.always_on_top ? "chip chip-active" : "chip"}
              onClick={() => void setAppSettings({ always_on_top: false })}
            >
              Off
            </button>
          </div>
        </article>

        {/* 3. Window opacity */}
        <article className="setting-row">
          <div>
            <span>Window opacity</span>
            <p className="muted setting-desc">
              Adjust transparency. Currently {Math.round(appSettings.window_opacity * 100)}%.
            </p>
          </div>
          <input
            type="range"
            className="setting-range"
            min={0.45}
            max={1}
            step={0.05}
            value={appSettings.window_opacity}
            onInput={(e) => {
              const val = parseFloat((e.target as HTMLInputElement).value);
              document.documentElement.style.setProperty("--window-opacity", String(val));
            }}
            onChange={(e) => {
              const val = parseFloat((e.target as HTMLInputElement).value);
              void setAppSettings({ window_opacity: val });
            }}
          />
        </article>

        {/* 4. Week start day */}
        <article className="setting-row">
          <div>
            <span>Week starts on</span>
            <p className="muted setting-desc">Choose which day your work week begins.</p>
          </div>
          <div className="button-group">
            <button
              className={appSettings.week_start_day === 1 ? "chip chip-active" : "chip"}
              onClick={() => void setAppSettings({ week_start_day: 1 })}
            >
              Monday
            </button>
            <button
              className={appSettings.week_start_day === 0 ? "chip chip-active" : "chip"}
              onClick={() => void setAppSettings({ week_start_day: 0 })}
            >
              Sunday
            </button>
          </div>
        </article>

        {/* 5. Time format */}
        <article className="setting-row">
          <div>
            <span>Time format</span>
            <p className="muted setting-desc">Display times in 12-hour or 24-hour format.</p>
          </div>
          <div className="button-group">
            <button
              className={appSettings.time_format === "12h" ? "chip chip-active" : "chip"}
              onClick={() => void setAppSettings({ time_format: "12h" })}
            >
              12h
            </button>
            <button
              className={appSettings.time_format === "24h" ? "chip chip-active" : "chip"}
              onClick={() => void setAppSettings({ time_format: "24h" })}
            >
              24h
            </button>
          </div>
        </article>

        {/* 6. Autostart */}
        <article className="setting-row">
          <div>
            <span>Autostart with Windows</span>
            <p className="muted setting-desc">Launch Clockwise when your PC boots up.</p>
          </div>
          <div className="button-group">
            <button
              className={appSettings.autostart_enabled ? "chip chip-active" : "chip"}
              onClick={() => void setAppSettings({ autostart_enabled: true })}
            >
              On
            </button>
            <button
              className={!appSettings.autostart_enabled ? "chip chip-active" : "chip"}
              onClick={() => void setAppSettings({ autostart_enabled: false })}
            >
              Off
            </button>
          </div>
        </article>

        {/* 7. Notifications */}
        <article className="setting-row">
          <div>
            <span>Notifications</span>
            <p className="muted setting-desc">Get reminders to clock in/out at shift boundaries.</p>
          </div>
          <div className="button-group">
            <button
              className={appSettings.notifications_enabled ? "chip chip-active" : "chip"}
              onClick={() => void setAppSettings({ notifications_enabled: true })}
            >
              On
            </button>
            <button
              className={!appSettings.notifications_enabled ? "chip chip-active" : "chip"}
              onClick={() => void setAppSettings({ notifications_enabled: false })}
            >
              Off
            </button>
          </div>
        </article>

        {/* 8. Accountability mode */}
        <article className="setting-row">
          <div>
            <span>Accountability mode</span>
            <p className="muted setting-desc">
              {appSettings.accountability_mode === "target"
                ? "Tracks daily hour targets and nudges you if you fall behind."
                : "Only reminds you to clock in/out during scheduled shifts."}
            </p>
          </div>
          <div className="button-group">
            <button
              className={appSettings.accountability_mode === "shift" ? "chip chip-active" : "chip"}
              onClick={() => void setAppSettings({ accountability_mode: "shift" })}
            >
              Shift
            </button>
            <button
              className={appSettings.accountability_mode === "target" ? "chip chip-active" : "chip"}
              onClick={() => void setAppSettings({ accountability_mode: "target" })}
            >
              Target
            </button>
          </div>
        </article>

        {/* 9. Reminder interval */}
        <article className="setting-row">
          <div>
            <span>Reminder interval</span>
            <p className="muted setting-desc">How often to repeat clock-in/out reminders.</p>
          </div>
          <div className="button-group">
            {[1, 2, 5, 10, 15, 30].map((m) => (
              <button
                key={m}
                className={appSettings.reminder_interval_min === m ? "chip chip-active" : "chip"}
                onClick={() => void setAppSettings({ reminder_interval_min: m })}
              >
                {m}m
              </button>
            ))}
          </div>
        </article>

        {/* 9. Quiet hours (upgraded) */}
        <article className="setting-row">
          <div>
            <span>Quiet hours</span>
            <p className="muted setting-desc">
              {appSettings.quiet_hours_enabled
                ? `Notifications silenced ${formatMinuteAsTime(appSettings.quiet_hours_start_min, tf)} – ${formatMinuteAsTime(appSettings.quiet_hours_end_min, tf)}.`
                : "Suppress notifications during set hours."}
            </p>
          </div>
          <div className="button-group">
            <button
              className={appSettings.quiet_hours_enabled ? "chip chip-active" : "chip"}
              onClick={() => void setAppSettings({ quiet_hours_enabled: true })}
            >
              On
            </button>
            <button
              className={!appSettings.quiet_hours_enabled ? "chip chip-active" : "chip"}
              onClick={() => void setAppSettings({ quiet_hours_enabled: false })}
            >
              Off
            </button>
          </div>
        </article>
        {appSettings.quiet_hours_enabled && (
          <div className="setting-sub-controls">
            <label className="setting-sub-label">
              From
              <input
                type="time"
                className="setting-time-input"
                value={timeInputValue(appSettings.quiet_hours_start_min)}
                onChange={(e) => void setAppSettings({ quiet_hours_start_min: parseTimeInput(e.target.value) })}
              />
            </label>
            <label className="setting-sub-label">
              To
              <input
                type="time"
                className="setting-time-input"
                value={timeInputValue(appSettings.quiet_hours_end_min)}
                onChange={(e) => void setAppSettings({ quiet_hours_end_min: parseTimeInput(e.target.value) })}
              />
            </label>
          </div>
        )}

        {/* 10. Idle nudge (upgraded) */}
        <article className="setting-row">
          <div>
            <span>Idle nudge</span>
            <p className="muted setting-desc">
              {appSettings.idle_nudge_enabled
                ? `Break reminder after ${appSettings.idle_nudge_work_min} min, inactivity alert after ${appSettings.idle_nudge_idle_min} min.`
                : "Nudge after long continuous work or keyboard/mouse inactivity."}
            </p>
          </div>
          <div className="button-group">
            <button
              className={appSettings.idle_nudge_enabled ? "chip chip-active" : "chip"}
              onClick={() => void setAppSettings({ idle_nudge_enabled: true })}
            >
              On
            </button>
            <button
              className={!appSettings.idle_nudge_enabled ? "chip chip-active" : "chip"}
              onClick={() => void setAppSettings({ idle_nudge_enabled: false })}
            >
              Off
            </button>
          </div>
        </article>
        {appSettings.idle_nudge_enabled && (
          <div className="setting-sub-controls">
            <div className="setting-sub-row">
              <span className="setting-sub-text">Break reminder after</span>
              <div className="button-group">
                {[30, 60, 90, 120].map((m) => (
                  <button
                    key={m}
                    className={appSettings.idle_nudge_work_min === m ? "chip chip-active" : "chip"}
                    onClick={() => void setAppSettings({ idle_nudge_work_min: m })}
                  >
                    {m >= 60 ? `${m / 60}h` : `${m}m`}
                  </button>
                ))}
              </div>
            </div>
            <div className="setting-sub-row">
              <span className="setting-sub-text">Inactivity alert after</span>
              <div className="button-group">
                {[5, 10, 15, 30].map((m) => (
                  <button
                    key={m}
                    className={appSettings.idle_nudge_idle_min === m ? "chip chip-active" : "chip"}
                    onClick={() => void setAppSettings({ idle_nudge_idle_min: m })}
                  >
                    {m}m
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* 11. Sync */}
        <article className="setting-row">
          <div>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {syncStatus?.connected ? <Wifi size={14} /> : <WifiOff size={14} />}
              Mobile Sync
            </span>
            <p className="muted setting-desc">
              {syncStatus?.connected
                ? `Connected to ${syncStatus.paired_device ?? "mobile"}`
                : syncStatus?.paired_device
                  ? `Paired with ${syncStatus.paired_device} (offline)`
                  : "Pair your mobile app over LAN to sync data in real-time."}
            </p>
            {syncStatus?.local_ip && (
              <p className="muted setting-desc" style={{ fontSize: "0.75rem" }}>
                LAN: {syncStatus.local_ip}:{syncStatus.port}
              </p>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
            {pairingCode ? (
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <code style={{ fontSize: "1.1rem", letterSpacing: 2, fontWeight: 700 }}>{pairingCode}</code>
                <button className="chip" onClick={handleCopyCode} title="Copy code">
                  <Copy size={12} /> {codeCopied ? "Copied" : "Copy"}
                </button>
              </div>
            ) : (
              <button className="chip" onClick={() => void handleGenerateCode()}>
                Generate pairing code
              </button>
            )}
          </div>
        </article>

        {/* 12. Data folder */}
        <article className="setting-row">
          <div>
            <span>Data folder</span>
            <p className="muted setting-desc">Open the folder where your database and settings are stored.</p>
          </div>
          <button className="chip" onClick={() => void apiOpenDataFolder()}>
            <FolderOpen size={14} /> Open
          </button>
        </article>

        {settingsSaving ? <p className="muted">Saving...</p> : null}
      </div>
    </section>
  );
}
