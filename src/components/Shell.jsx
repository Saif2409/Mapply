import { NavLink, Outlet } from "react-router-dom";
import Wordmark from "../brand/Wordmark.jsx";

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: "◆" },
  { to: "/jobs", label: "Jobs", icon: "▤" },
  { to: "/tracker", label: "Tracker", icon: "▦" },
  { to: "/profile", label: "Profile", icon: "◉" },
  { to: "/connectors", label: "Connectors", icon: "⚯" },
  { to: "/settings", label: "Settings", icon: "⚙" },
];

export default function Shell({ profile, theme, onSwitchProfile }) {
  return (
    <div className="h-screen flex">
      {/* Sidebar */}
      <aside className="w-60 shrink-0 border-r border-ink-800 bg-ink-900/60 flex flex-col">
        <div className="px-6 pt-6 pb-5">
          <Wordmark theme={theme} size="text-2xl" />
        </div>

        <nav className="flex-1 px-3 space-y-1">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-royal/15 text-royal-light border border-royal/25"
                    : "text-mist-dim hover:text-mist-bright hover:bg-ink-800/70 border border-transparent"
                }`
              }
            >
              <span className="text-base leading-none">{n.icon}</span>
              {n.label}
            </NavLink>
          ))}
        </nav>

        <button
          onClick={onSwitchProfile}
          className="m-3 card !rounded-xl px-4 py-3 flex items-center gap-3 text-left
            hover:border-royal/50 transition-colors cursor-pointer"
          title="Switch profile"
        >
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center font-bold text-white"
            style={{ backgroundColor: "var(--accent)" }}
          >
            {profile.name?.[0]?.toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate">{profile.name}</div>
            <div className="text-[11px] text-mist-dim">Switch profile</div>
          </div>
        </button>
      </aside>

      {/* Content */}
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
