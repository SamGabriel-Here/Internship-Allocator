import { useEffect, useState } from "react";
import { api, providerName, type Config, type Extracted } from "./api";
import { Busy, ErrorNote } from "./components";
import { label } from "./lines";
import { store, useProfile, useResume } from "./store";

export function useConfig() {
  const [config, setConfig] = useState<Config | null>(null);
  useEffect(() => {
    api.config().then(setConfig).catch(() => setConfig({ copilot_enabled: false, copilot_provider: null }));
  }, []);
  return config;
}

export function ResumeReader({ enabled, provider, loaded }: { enabled: boolean; provider: string | null; loaded: boolean }) {
  const resume = useResume();
  const profile = useProfile();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [found, setFound] = useState<Extracted | null>(null);
  const [keep, setKeep] = useState<Set<string>>(new Set());

  if (loaded && !enabled) {
    return (
      <div className="notice plain">
        <strong>Reading a resume needs the AI copilot, which isn't switched on for this server.</strong> Type your
        skills instead; everything else works without it.
      </div>
    );
  }

  const read = async () => {
    setBusy(true); setError(""); setFound(null);
    try {
      const r = await api.extract(resume);
      setFound(r);
      setKeep(new Set(r.recognised));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const confirm = () => {
    if (!found) return;
    store.setProfile({
      skills: [...new Set([...profile.skills, ...keep])],
      cgpa: found.cgpa ?? profile.cgpa,
      name: profile.name || found.name || "",
    });
    setFound(null);
  };

  return (
    <div className="stack">
      <p className="notice plain">
        Your text goes to {providerName(provider)} to find your skills and CGPA. Nextern doesn't store it; it stays
        in this tab until you close it.
      </p>
      <div className="field">
        <label htmlFor="resume">Resume or a paragraph about your experience</label>
        <textarea id="resume" rows={7} value={resume} onChange={(e) => store.setResume(e.target.value)}
          placeholder="Paste the text of your resume here" />
      </div>
      <div className="row-actions">
        <button className="btn secondary" type="button" onClick={read} disabled={busy || resume.trim().length < 40}>
          Read my resume
        </button>
        {resume.trim().length > 0 && resume.trim().length < 40 && <span className="hint">A little more text, please.</span>}
      </div>
      {busy && <Busy>{providerName(provider)} is reading your resume…</Busy>}
      {error && <ErrorNote>{error}</ErrorNote>}
      {found && (
        <div className="stack" style={{ gap: 12 }}>
          <p>
            <strong>Found {found.recognised.length} skill{found.recognised.length === 1 ? "" : "s"}.</strong> Untick
            anything that isn't really yours, then add them.
          </p>
          <ul className="chips" aria-label="Skills found">
            {found.recognised.map((s) => (
              <li key={s}>
                <label className="chip pick">
                  <input type="checkbox" checked={keep.has(s)} onChange={(e) => {
                    const next = new Set(keep);
                    if (e.target.checked) next.add(s); else next.delete(s);
                    setKeep(next);
                  }} />
                  {label(s, false)}
                </label>
              </li>
            ))}
          </ul>
          {found.unrecognised.length > 0 && (
            <p className="hint">Also mentioned, but not recognised: {found.unrecognised.map((s) => label(s, false)).join(", ")}.</p>
          )}
          {found.cgpa !== null && <p className="hint">CGPA found: {found.cgpa}. You can change it below.</p>}
          <div className="row-actions">
            <button className="btn" type="button" disabled={!keep.size} onClick={confirm}>Add to my skills</button>
            <button className="btn quiet" type="button" onClick={() => setFound(null)}>Discard</button>
          </div>
        </div>
      )}
    </div>
  );
}
