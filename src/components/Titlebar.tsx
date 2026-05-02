import { Maximize2, Minimize2, Minus, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useSettingsStore } from "../store/settings";

export default function Titlebar() {
  const win = getCurrentWindow();
  const { mode, setMode } = useSettingsStore();

  return (
    <div
      className="titlebar"
      onMouseDown={(e) => {
        if ((e.target as HTMLElement).closest(".titlebar-btn")) return;
        e.preventDefault();
        void win.startDragging();
      }}
    >
      <div className="titlebar-controls">
        <button
          className="titlebar-btn"
          onClick={() => void setMode(mode === "fullscreen" ? "expanded" : "fullscreen")}
          aria-label={mode === "fullscreen" ? "Exit fullscreen" : "Fullscreen"}
          title={mode === "fullscreen" ? "Exit fullscreen" : "Fullscreen"}
        >
          {mode === "fullscreen" ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
        </button>
        <button
          className="titlebar-btn titlebar-minimize"
          onClick={() => void win.minimize()}
          aria-label="Minimize"
        >
          <Minus size={12} />
        </button>
        <button
          className="titlebar-btn titlebar-close"
          onClick={() => void win.hide()}
          aria-label="Close"
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
}
