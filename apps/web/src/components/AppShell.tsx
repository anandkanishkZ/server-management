import type { ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import Logo from "./Logo";
import { apiFetch } from "../lib/api";
import { setSession, useAuthStore } from "../lib/authStore";
import "./AppShell.css";

function icon(path: ReactNode) {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {path}
    </svg>
  );
}

const NAV_ITEMS: { label: string; icon: ReactNode; path?: string }[] = [
  { label: "Overview", path: "/", icon: icon(<><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></>) },
  { label: "Sites", path: "/sites", icon: icon(<><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>) },
  { label: "Apps", path: "/apps", icon: icon(<><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M9 9h6v6H9z" /></>) },
  { label: "Databases", path: "/databases", icon: icon(<><ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6" /><path d="M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" /></>) },
  { label: "File Manager", path: "/files", icon: icon(<path d="M3 6a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6Z" />) },
  { label: "Domains & SSL", path: "/domains", icon: icon(<><path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1" /><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1" /></>) },
  { label: "Logs", path: "/logs", icon: icon(<><path d="M6 3h9l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" /><path d="M9 12h6M9 16h6M9 8h3" /></>) },
  { label: "Audit Log", path: "/audit", icon: icon(<><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" /><rect x="9" y="3" width="6" height="4" rx="1" /><path d="M9 13h6M9 17h4" /></>) },
  { label: "Security", path: "/security", icon: icon(<path d="M12 3 4 6v6c0 4.5 3.2 7.7 8 9 4.8-1.3 8-4.5 8-9V6l-8-3Z" />) },
  { label: "Terminal", path: "/terminal", icon: icon(<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m7 9 3 3-3 3M13 15h4" /></>) },
  { label: "Backups", icon: icon(<><rect x="3" y="4" width="18" height="5" rx="1.5" /><path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9" /><path d="M10 13h4" /></>) },
];

interface AppShellProps {
  title: string;
  headerRight?: ReactNode;
  children: ReactNode;
}

export default function AppShell({ title, headerRight, children }: AppShellProps) {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();

  async function handleLogout() {
    try {
      await apiFetch("/auth/logout", { method: "POST" });
    } catch {
      // best-effort; clear local session regardless
    }
    setSession(null, null);
    navigate("/login");
  }

  const initial = user?.email?.[0]?.toUpperCase() ?? "?";

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <Logo size={30} />
          <span className="sidebar-brand-name">Server Panel</span>
        </div>

        <nav className="sidebar-nav">
          {NAV_ITEMS.map((item) =>
            item.path ? (
              <NavLink
                key={item.label}
                to={item.path}
                end={item.path === "/"}
                className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
              >
                {item.icon}
                {item.label}
              </NavLink>
            ) : (
              <button key={item.label} className="nav-item disabled" disabled>
                {item.icon}
                {item.label}
                <span className="nav-item-badge">Soon</span>
              </button>
            )
          )}
        </nav>

        <div className="sidebar-footer">
          <div className="user-avatar">{initial}</div>
          <div className="user-meta">
            <span className="user-email">{user?.email ?? "Unknown"}</span>
            <span className="user-role">{user?.role ?? ""}</span>
          </div>
          <button className="logout-button" onClick={handleLogout} aria-label="Sign out" title="Sign out">
            {icon(<><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" /></>)}
          </button>
        </div>
      </aside>

      <div className="main-area">
        <header className="topbar">
          <h1 className="topbar-title">{title}</h1>
          {headerRight}
        </header>
        <div className="content">{children}</div>
      </div>
    </div>
  );
}
