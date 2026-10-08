import { useEffect, useState, type CSSProperties } from "react";
import { Link, useNavigate } from "react-router";
import { api, providerName, type Config, type Extracted } from "./api";
import { Busy, ErrorNote, IconArrow, Legend, SkillInput, StripMap, YourLine, usePrediction } from "./components";
import { bandLabel, label, lineColour, progressText, stations } from "./lines";
import { store, useProfile, useResume } from "./store";

export function useConfig() {
  const [config, setConfig] = useState<Config | null>(null);
  useEffect(() => {
    api.config().then(setConfig).catch(() => setConfig({ copilot_enabled: false, copilot_provider: null }));
  }, []);
  return config;
}

export default function Plan() {
  const profile = useProfile();
  const config = useConfig();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"type" | "resume">("type");
  const { data, error, loading } = usePrediction(profile);
  const unrecognised = data?.unrecognised ?? [];
  const top = data?.recommendations.slice(0, 3) ?? [];
  const aiOn = !!config?.copilot_enabled;

  const addSkills = (skills: string[]) => skills.forEach(store.addSkill);
  const go = () => navigate("/map");

  return (
    <>
      <div className="page-head">
        <h1>Which internships does your skill set already reach?</h1>
        <p className="lede">
          Build your line one skill at a time. Every company is a line too, and its stations are the
          skills it asks for. You'll see where you already connect and which stops are still ahead.
        </p>
      </div>

      <div className="plan">
        <section className="panel" aria-labelledby="your-line">
          <div className="panel-head">
            <h2 id="your-line">Your line</h2>
            <div className="switch" role="group" aria-label="How to add skills">
              <button type="button" aria-pressed={mode === "type"} onClick={() => setMode("type")}>Type skills</button>
              <button type="button" aria-pressed={mode === "resume"} onClick={() => setMode("resume")}>Paste a resume</button>
            </div>
          </div>

          <div className="stack">
            <YourLine skills={profile.skills} unrecognised={unrecognised} onRemove={store.removeSkill} />
            {mode === "type"
              ? <SkillInput onAdd={addSkills} autoFocus={!profile.skills.length} />
              : <ResumeReader enabled={aiOn} provider={config?.copilot_provider ?? null} loaded={!!config} />}

            {top[0] && (
              <div className="mobile-only" aria-hidden="true" style={{ "--c": lineColour(top[0].company) } as CSSProperties}>
                <p className="fit-line"><b>{top[0].company}</b> · {bandLabel[top[0].band]}, your closest line</p>
                <StripMap {...top[0]} compact />
              </div>
            )}
            <div className="row-actions">
              <button className="btn" type="button" onClick={go} disabled={!data?.recommendations.length}>
                See all {data?.recommendations.length || 11} lines <IconArrow />
              </button>
              {profile.skills.length > 0 && (
                <button className="btn quiet" type="button" onClick={() => store.setProfile({ ...profile, skills: [] })}>
                  Clear skills
                </button>
              )}
            </div>
            <details className="optional" open={profile.cgpa !== null || !!profile.name}>
              <summary>CGPA and name <span className="hint">(optional)</span></summary>
            <div className="two">
              <div className="field">
                <label htmlFor="cgpa">CGPA <span className="hint">(optional, out of 10)</span></label>
                <input
                  id="cgpa" type="number" inputMode="decimal" min={0} max={10} step={0.1} placeholder="e.g. 8.2"
                  value={profile.cgpa ?? ""}
                  onChange={(e) => {
                    const v = e.target.value === "" ? null : Number(e.target.value);
                    store.setProfile({ ...profile, cgpa: v !== null && v >= 0 && v <= 10 ? v : null });
                  }}
                />
              </div>
              <div className="field">
                <label htmlFor="name">Name <span className="hint">(optional)</span></label>
                <input id="name" type="text" autoComplete="given-name" value={profile.name}
                  onChange={(e) => store.setProfile({ ...profile, name: e.target.value })} />
              </div>
            </div>
            <p className="hint">CGPA only nudges the order a little (15%); skills decide the match. Everything stays in this browser.</p>
            </details>
          </div>
        </section>

        <section aria-labelledby="preview" className="stack">
          <div className="stack" style={{ gap: 8 }}>
            <h2 id="preview">{top.length ? "Lines you connect to" : "Your connections appear here"}</h2>
            <Legend />
          </div>

          <div aria-live="polite" className="stack">
            {!profile.skills.length && <PreviewExample />}
            {loading && !data && <Busy>Drawing your lines…</Busy>}
            {error && <ErrorNote>{error}</ErrorNote>}
            {data && !data.recognised.length && (
              <p className="notice warn">
                None of those skills are on our map yet, so there's nothing honest to rank. Try common names like
                Python, Java, React, SQL or Machine learning.
              </p>
            )}
            {top.length > 0 && (
              <ol className="board">
                {top.map((m) => (
                  <li key={m.company} className="line-row preview" style={{ "--c": lineColour(m.company) } as CSSProperties}>
                    <div className="co">
                      <span className="co-name"><span className="bullet" aria-hidden="true" />{m.company}</span>
                      <span className="co-meta">{bandLabel[m.band]} · {progressText(stations(m))}</span>
                    </div>
                    <StripMap {...m} compact />
                  </li>
                ))}
              </ol>
            )}
            {top.length > 0 && (
              <p className="hint">
                {data!.recommendations.length - 3} more lines on <Link to="/map" onClick={(e) => { e.preventDefault(); go(); }}>your full map</Link>.
                {unrecognised.length > 0 && <> Not on our map: {unrecognised.map((s) => label(s, false)).join(", ")}.</>}
              </p>
            )}
          </div>
        </section>
      </div>
    </>
  );
}

function PreviewExample() {
  // A worked example, so the first screen already shows how a line reads.
  return (
    <div className="stack example">
      <p className="hint">Example: a student with Python and Machine learning, read against Google's line.</p>
      <StripMap
        company="Google"
        matched_skills={["python", "machine learning"]}
        related_skills={[{ skill: "deep learning", via: "machine learning" }]}
        gap_skills={["natural language processing", "artificial intelligence"]}
      />
    </div>
  );
}

function ResumeReader({ enabled, provider, loaded }: { enabled: boolean; provider: string | null; loaded: boolean }) {
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
            anything that isn't really yours, then add them to your line.
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
            <p className="hint">Also mentioned, but not on our map: {found.unrecognised.map((s) => label(s, false)).join(", ")}.</p>
          )}
          {found.cgpa !== null && <p className="hint">CGPA found: {found.cgpa}. You can change it below.</p>}
          <div className="row-actions">
            <button className="btn" type="button" disabled={!keep.size} onClick={confirm}>Add to my line</button>
            <button className="btn quiet" type="button" onClick={() => setFound(null)}>Discard</button>
          </div>
        </div>
      )}
    </div>
  );
}
