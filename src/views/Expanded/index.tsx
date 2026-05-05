import { Shrink } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import Logo from "../../components/Logo";
import { useSettingsStore, type ExpandedTab } from "../../store/settings";
import ScheduleTab from "./ScheduleTab";
import SettingsTab from "./SettingsTab";
import TasksTab from "./TasksTab";
import TodayTab from "./TodayTab";
import WeekTab from "./WeekTab";

const TABS: Array<{ id: ExpandedTab; label: string }> = [
  { id: "today", label: "Today" },
  { id: "tasks", label: "Tasks" },
  { id: "schedule", label: "Schedule" },
  { id: "week", label: "Week" },
  { id: "settings", label: "Settings" },
];

function renderTab(tab: ExpandedTab) {
  if (tab === "today") return <TodayTab key="today" />;
  if (tab === "tasks") return <TasksTab key="tasks" />;
  if (tab === "schedule") return <ScheduleTab key="schedule" />;
  if (tab === "week") return <WeekTab key="week" />;
  return <SettingsTab key="settings" />;
}

export default function Expanded() {
  const { activeTab, setActiveTab, setMode } = useSettingsStore();

  return (
    <motion.section
      className="card expanded-view"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 260, damping: 24 }}
    >
      <header className="expanded-header">
        <h1 style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Logo size={22} />
          Clockwise
        </h1>
        <div className="row">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              className={activeTab === tab.id ? "tab tab-active" : "tab"}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <button className="ghost" onClick={() => void setMode("compact")}>
          Compact
          <Shrink size={14} />
        </button>
      </header>
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ type: "spring", stiffness: 260, damping: 24 }}
        >
          {renderTab(activeTab)}
        </motion.div>
      </AnimatePresence>
    </motion.section>
  );
}
