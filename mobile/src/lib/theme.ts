export const colors = {
  dark: {
    bg: "#090d17",
    surface: "#0f1422",
    surfaceAlt: "#1f2a43",
    border: "rgba(255,255,255,0.10)",
    text: "#eaf2ff",
    textSecondary: "#94a3b8",
    textMuted: "#64748b",
    primary: "#34d399",
    primaryDark: "#059669",
    accent: "#38bdf8",
    warning: "#fbbf24",
    error: "#f87171",
    positive: "#4ade80",
    onPrimary: "#0f1422",
    onClock: "#34d399",
    onBreak: "#fbbf24",
    offDay: "#94a3b8",
  },
  light: {
    bg: "#f8fafc",
    surface: "#ffffff",
    surfaceAlt: "#f1f5f9",
    border: "#e2e8f0",
    text: "#0f172a",
    textSecondary: "#475569",
    textMuted: "#94a3b8",
    primary: "#059669",
    primaryDark: "#047857",
    accent: "#0284c7",
    warning: "#d97706",
    error: "#dc2626",
    positive: "#16a34a",
    onPrimary: "#ffffff",
    onClock: "#059669",
    onBreak: "#d97706",
    offDay: "#94a3b8",
  },
} as const;

export type ColorScheme = {
  bg: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  primary: string;
  primaryDark: string;
  accent: string;
  warning: string;
  error: string;
  positive: string;
  onPrimary: string;
  onClock: string;
  onBreak: string;
  offDay: string;
};

export function getColors(theme: "dark" | "light"): ColorScheme {
  return colors[theme];
}
