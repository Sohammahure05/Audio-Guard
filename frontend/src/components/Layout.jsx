import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../auth.jsx";

const links = [
  ["/", "Dashboard"],
  ["/machines", "Machines"],
  ["/analyse", "Analyse"],
  ["/batch", "Batch"],
  ["/ideal", "Ideal"],
  ["/history", "History"],
  ["/reports", "Reports"],
  ["/model", "Model info"],
];

export default function Layout() {
  const { auth, signOut } = useAuth();
  const navigate = useNavigate();
  const [theme, setTheme] = useState(localStorage.getItem("mh-theme") || "light");

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("mh-theme", theme);
  }, [theme]);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" />
          <span>Machine Health</span>
        </div>
        <nav>
          {links.map(([to, label]) => (
            <NavLink key={to} to={to} end={to === "/"} className="nav-link">
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="user">
            <div className="avatar">{auth.user.username[0].toUpperCase()}</div>
            <div>
              <div className="user-name">{auth.user.username}</div>
              <div className="muted small">{auth.user.company}</div>
            </div>
          </div>
          <div className="row">
            <button className="btn ghost" onClick={() => setTheme(theme === "light" ? "dark" : "light")}>
              {theme === "light" ? "Dark mode" : "Light mode"}
            </button>
            <button className="btn ghost" onClick={() => { signOut(); navigate("/login"); }}>
              Sign out
            </button>
          </div>
        </div>
      </aside>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
