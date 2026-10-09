import "@fontsource/biz-udpgothic/latin-400.css";
import "@fontsource/biz-udpgothic/latin-700.css";
import "@fontsource/shippori-mincho/latin-600.css";
import "@fontsource/shippori-mincho/latin-800.css";
import "./styles.css";

import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, NavLink, Route, Routes, useLocation } from "react-router";
import { BrandMark, IconClose, IconMenu, IconMoon, IconSun } from "./components";
import { About, History, Insights, NotFound } from "./Info";
import Board from "./Board";

const LINKS = [
  { to: "/", label: "Board", end: true },
  { to: "/insights", label: "Insights" },
  { to: "/history", label: "History" },
  { to: "/about", label: "About" },
];

type Theme = "light" | "dark";
const systemTheme = (): Theme => (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");

/** Light or dark; follows the system until the visitor picks one (the head script applies it before paint). */
function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => (document.documentElement.dataset.theme as Theme) || systemTheme());
  const next: Theme = theme === "dark" ? "light" : "dark";
  return (
    <button className="theme-toggle" type="button" aria-label={`Switch to ${next} theme`} title={`Switch to ${next} theme`}
      onClick={() => {
        document.documentElement.dataset.theme = next;
        try { localStorage.setItem("nextern.theme", next); } catch { /* private mode: applies for this visit */ }
        document.querySelector('meta[name="theme-color"]')?.setAttribute("content", next === "dark" ? "#0f1215" : "#eef0f2");
        setTheme(next);
      }}>
      {theme === "dark" ? <IconSun /> : <IconMoon />}
    </button>
  );
}

const TITLES: Record<string, string> = {
  "/": "Nextern — internships that match your skills",
  "/insights": "Insights · Nextern",
  "/history": "History · Nextern",
  "/about": "How matching works · Nextern",
};

function Layout() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => { document.title = TITLES[pathname] ?? "Page not found · Nextern"; }, [pathname]);
  useEffect(() => {
    setOpen(false);
    window.scrollTo(0, 0);
    document.getElementById("main")?.focus({ preventScroll: true });
  }, [pathname]);

  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <header className="topbar">
        <div className="topbar-in">
          <NavLink to="/" className="brand" aria-label="Nextern home"><BrandMark />Nextern</NavLink>
          <div className="top-right">
            <nav id="nav" className="nav" data-open={open} aria-label="Main">
              {LINKS.map((l) => <NavLink key={l.to} to={l.to} end={l.end}>{l.label}</NavLink>)}
            </nav>
            <ThemeToggle />
            <button className="menu-btn" type="button" aria-expanded={open} aria-controls="nav" onClick={() => setOpen(!open)}>
              {open ? <IconClose /> : <IconMenu />}Menu
            </button>
          </div>
        </div>
      </header>
      <main id="main" tabIndex={-1}>
        <Routes>
          <Route path="/" element={<Board />} />
          <Route path="/map" element={<Board />} />
          <Route path="/insights" element={<Insights />} />
          <Route path="/history" element={<History />} />
          <Route path="/about" element={<About />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <footer className="footer">
        <span>Nextern — an explainable internship recommender on a small synthetic dataset.</span>
        <a href="https://github.com/SamGabriel-Here/Internship-Allocator">Source on GitHub</a>
      </footer>
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Layout />
    </BrowserRouter>
  </StrictMode>,
);
