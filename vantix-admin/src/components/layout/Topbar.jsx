import React, { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { IconLogout } from "./icons";

function routeMeta(pathname) {
  if (pathname === "/") {
    return {
      title: "Security Overview",
      subtitle: "Live posture and recent data-leak prevention activity.",
    };
  }
  if (pathname === "/employees") {
    return {
      title: "Employee Directory",
      subtitle: "Provision users and monitor onboarding status.",
    };
  }
  if (pathname === "/rules") {
    return {
      title: "Detection Rules",
      subtitle: "Configure protected domains and sensitive keywords.",
    };
  }
  if (pathname === "/reports") {
    return {
      title: "Reports",
      subtitle: "Generate and export weekly, monthly, or yearly activity reports.",
    };
  }
  return { title: "Vantix Admin", subtitle: "Secure-by-default operations." };
}

export default function Topbar({ title, subtitle, onLogout }) {
  const { pathname } = useLocation();
  const meta = routeMeta(pathname);
  const finalTitle = title || meta.title;
  const finalSubtitle = subtitle || meta.subtitle;

  const [isDark, setIsDark] = useState(
    () => (localStorage.getItem("theme") || "light") === "dark"
  );

  const handleThemeToggle = () => {
    window.toggleTheme();
    setIsDark(!isDark);
  };

  return (
    <header className="topbar">
      <div className="topbar__row">
        <div className="topbar__title">
          <h1>{finalTitle}</h1>
          <p>{finalSubtitle}</p>
        </div>

        <div style={{ display: "flex", alignItems: "center" }}>
          <div className="theme-toggle" onClick={() => window.toggleTheme()}>
            <div className="toggle-track">
              <div className="toggle-thumb"></div>
            </div>
          </div>
          <button className="btn btn--ghost" onClick={onLogout} type="button">
            <IconLogout style={{ marginRight: 8 }} />
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}

