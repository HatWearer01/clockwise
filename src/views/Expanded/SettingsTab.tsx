import { FolderOpen } from "lucide-react";
import { apiOpenDataFolder } from "../../lib/tauri";
import { useSettingsStore } from "../../store/settings";

export default function SettingsTab() {
  const { theme, setTheme, appSettings, setAppSettings, settingsSaving } = useSettingsStore();

  return (
    <section className="tab-panel">
      <h2>Settings</h2>
      <p className="muted" style={{ margin: "0 0 4px", fontSize: "0.85rem" }}>
        Customize how Clockwise works for you.
      </p>
      <div className="settings-list">
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

        <article className="setting-row">
          <div>
            <span>Quiet hours</span>
            <p className="muted setting-desc">Suppress notifications between 10 PM and 8 AM.</p>
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

        <article className="setting-row">
          <div>
            <span>Idle nudge</span>
            <p className="muted setting-desc">Remind you if you're clocked in but seem idle.</p>
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
