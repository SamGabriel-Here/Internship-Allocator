import "@fontsource/mukta/latin-400.css";
import "@fontsource/mukta/latin-500.css";
import "@fontsource/mukta/latin-600.css";
import "@fontsource/mukta/latin-700.css";
import "@fontsource/mukta/latin-800.css";
import "./styles.css";

import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, NavLink, Route, Routes, useLocation } from "react-router";
import { BrandMark, IconClose, IconMenu } from "./components";
import { About, History, Insights, NotFound } from "./Info";
import MapPage from "./MapPage";
import Plan from "./Plan";

const LINKS = [
  { to: "/", label: "Profile", end: true },
  { to: "/map", label: "Matches" },
  { to: "/insights", label: "Insights" },
  { to: "/history", label: "History" },
  { to: "/about", label: "About" },
];

function Layout() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
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
          <button className="menu-btn" type="button" aria-expanded={open} aria-controls="nav" onClick={() => setOpen(!open)}>
            {open ? <IconClose /> : <IconMenu />}Menu
          </button>
          <nav id="nav" className="nav" data-open={open} aria-label="Main">
            {LINKS.map((l) => <NavLink key={l.to} to={l.to} end={l.end}>{l.label}</NavLink>)}
          </nav>
        </div>
      </header>
      <main id="main" tabIndex={-1}>
        <Routes>
          <Route path="/" element={<Plan />} />
          <Route path="/map" element={<MapPage />} />
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
