import { useEffect, useState, type CSSProperties } from "react";
import { Link, useSearchParams } from "react-router";
import { api, providerName, type JdMatch, type Match, type Plan, type Tailored, type Turn } from "./api";
import { Busy, ErrorNote, Legend, StripMap, usePrediction } from "./components";
import { bandLabel, label, lineColour, stations, progressText } from "./lines";
import { useConfig } from "./Plan";
import { store, useProfile, useResume } from "./store";

export default function MapPage() {
  const [params, setParams] = useSearchParams();
  // A shared link (/map?skills=python,sql&cgpa=8.2) opens that profile.
  useEffect(() => {
    const skills = params.get("skills");
    if (!skills) return;
    const cgpa = params.get("cgpa");
    store.setProfile({ name: "", skills: skills.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean), cgpa: cgpa ? Number(cgpa) : null });
    setParams({}, { replace: true });
  }, [params, setParams]);
  const profile = useProfile();
  const config = useConfig();
  const { data, error, loading } = usePrediction(profile, 0);
  const p = { skills: profile.skills, cgpa: profile.cgpa };

  // Opening a map saves it to History (the store skips an identical repeat).
  useEffect(() => {
    if (!data?.recommendations.length) return;
    store.record({
      skills: data.recognised, cgpa: data.cgpa,
      top: data.recommendations.slice(0, 3).map((r) => ({ company: r.company, coverage: r.coverage, band: r.band })),
    });
  }, [data]);

  if (!profile.skills.length) {
    return (
      <div className="empty-state">
        <h1>Your map is empty</h1>
        <p className="lede">Add a few skills to your line first; every company's line is then drawn against them.</p>
        <Link className="btn" to="/">Build your line</Link>
      </div>
    );
  }

  return (
    <>
      <div className="page-head">
        <h1>{profile.name ? `${profile.name}'s matches` : "Your matches"}</h1>
        <div className="read-out">
          <p className="lede">
            We read {data ? data.recognised.length : "your"} skill{data?.recognised.length === 1 ? "" : "s"}
            {profile.cgpa !== null ? ` and a CGPA of ${profile.cgpa}` : ""}. <Link to="/">Edit your line</Link> · <ShareLink skills={profile.skills} cgpa={profile.cgpa} />
          </p>
          {data && (
            <ul className="chips" aria-label="Skills read">
              {data.recognised.map((s) => <li key={s} className="chip">{label(s, false)}</li>)}
              {data.unrecognised.map((s) => <li key={s} className="chip off">{label(s, false)} · not on our map</li>)}
            </ul>
          )}
        </div>
      </div>

      {loading && !data && <Busy>Drawing every line…</Busy>}
      {error && <ErrorNote>{error}</ErrorNote>}
      {data && !data.recognised.length && (
        <div className="empty-state">
          <h2>None of these skills are on our map</h2>
          <p>
            Nextern only matches skills its ontology knows, so ranking companies now would be guesswork. Remove the
            ones marked above and add common names like Python, Java, React, SQL or Machine learning.
          </p>
          <Link className="btn" to="/">Edit your line</Link>
        </div>
      )}

      {data && data.recommendations.length > 0 && (
        <div className="map">
          <section aria-labelledby="board-title">
            <div className="board-head">
              <div className="stack" style={{ gap: 8 }}>
                <h2 id="board-title">All {data.recommendations.length} lines, closest first</h2>
                <Legend />
              </div>
              <p className="margin-note">
                Fit is how many of a company's skills you cover, from 51 synthetic placements. A sanity signal, not a
                hiring prediction.
              </p>
            </div>
            <ol className="board">
              {data.recommendations.map((m, i) => <LineRow key={m.company} m={m} top={i < 3} />)}
            </ol>
          </section>

          <aside className="side" aria-label="Next steps">
            <PostingCheck profile={p} />
            <Copilot profile={p} matches={data.recommendations} enabled={!!config?.copilot_enabled} provider={config?.copilot_provider ?? null} loaded={!!config} />
          </aside>
        </div>
      )}
    </>
  );
}

function ShareLink({ skills, cgpa }: { skills: string[]; cgpa: number | null }) {
  const [copied, setCopied] = useState(false);
  const url = `${location.origin}/map?skills=${encodeURIComponent(skills.join(","))}${cgpa !== null ? `&cgpa=${cgpa}` : ""}`;
  return (
    <button type="button" className="btn quiet" style={{ minHeight: 0, padding: 0, fontSize: "inherit", fontWeight: 400 }}
      onClick={() => navigator.clipboard?.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })}>
      {copied ? "Link copied" : "Copy a link to this map"}
    </button>
  );
}

function LineRow({ m, top }: { m: Match; top: boolean }) {
  const list = stations(m);
  const nextStop = m.gap_skills[0];
  return (
    <li className={`line-row${top ? " top" : ""}`} style={{ "--c": lineColour(m.company) } as CSSProperties}>
      <div className="co">
        <h3 className="co-name"><span className="bullet" aria-hidden="true" />{m.company}</h3>
        <span className="fit-line"><b>{bandLabel[m.band]}</b> · {progressText(list)}</span>
        <span className="co-meta">{m.location} · {m.interns} past intern{m.interns === 1 ? "" : "s"}</span>
      </div>
      <StripMap {...m} compact={!top} />
      {top && (
        <p className="next">
          {nextStop
            ? <span>Next stop: <strong>learn {label(nextStop, false)}</strong>{m.gap_skills.length > 1 ? `, then ${m.gap_skills.length - 1} more` : ""}.</span>
            : m.related_skills.length
              ? <span><strong>Nothing missing.</strong> {m.related_skills.map((r) => label(r.skill, false)).join(", ")} only count{m.related_skills.length === 1 ? "s" : ""} half; learning {m.related_skills.length === 1 ? "it" : "them"} directly completes the line.</span>
              : <span><strong>You cover every skill on this line.</strong> Worth applying.</span>}
          <span>Avg intern rating {m.avg_rating}/4 (synthetic)</span>
        </p>
      )}
    </li>
  );
}

type P = { skills: string[]; cgpa: number | null };

function PostingCheck({ profile }: { profile: P }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<JdMatch | null>(null);
  const run = async () => {
    setBusy(true); setError(""); setResult(null);
    try { setResult(await api.matchJd(profile, text)); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <section className="panel" aria-labelledby="posting">
      <h2 id="posting">Check a real posting</h2>
      <p className="hint">Paste any internship or job post. We pull out the skills it asks for and draw it as a line against your profile.</p>
      <div className="field">
        <label htmlFor="jd" className="sr-only">Job posting</label>
        <textarea id="jd" rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste the requirements section here" />
      </div>
      <div className="row-actions">
        <button className="btn secondary" type="button" onClick={run} disabled={busy || !text.trim()}>Check my fit</button>
      </div>
      <div aria-live="polite" className="stack" style={{ gap: 10 }}>
        {busy && <Busy>Reading the posting…</Busy>}
        {error && <ErrorNote>{error}</ErrorNote>}
        {result && (
          <>
            <p><strong>{bandLabel[result.band]}</strong> · {progressText(stations(result))}</p>
            <StripMap company="This posting" colour="#13202f" {...result} />
          </>
        )}
      </div>
    </section>
  );
}

function Copilot({ profile, matches, enabled, provider, loaded }: {
  profile: P; matches: Match[]; enabled: boolean; provider: string | null; loaded: boolean;
}) {
  if (!loaded) return null;
  if (!enabled) {
    return (
      <section className="panel" aria-labelledby="ai-off">
        <h2 id="ai-off">AI copilot is off</h2>
        <p className="hint">
          This server has no AI key, so the coaching features are switched off: a learning plan for your gaps,
          answers to follow-up questions, and resume bullets tailored to a company. The map works fully without it.
        </p>
      </section>
    );
  }
  const who = providerName(provider);
  return (
    <>
      <LearningPlan profile={profile} who={who} />
      <Ask profile={profile} who={who} />
      <Tailor profile={profile} matches={matches} who={who} />
    </>
  );
}

function LearningPlan({ profile, who }: { profile: P; who: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const run = async () => {
    setBusy(true); setError("");
    try { setPlan(await api.plan(profile)); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <section className="panel" aria-labelledby="plan-title">
      <h2 id="plan-title">Plan the stops ahead</h2>
      <p className="hint">{who} turns the skills missing from your top three lines into a short, ordered plan.</p>
      <div className="row-actions">
        <button className="btn secondary" type="button" onClick={run} disabled={busy}>{plan ? "Redo the plan" : "Make my plan"}</button>
        <span className="ai-tag">Written by {who}</span>
      </div>
      <div aria-live="polite" className="stack" style={{ gap: 12 }}>
        {busy && <Busy>{who} is planning…</Busy>}
        {error && <ErrorNote>{error}</ErrorNote>}
        {plan && (
          <>
            <p>{plan.summary}</p>
            <ol className="plan-steps">
              {plan.steps.map((s, i) => (
                <li key={i} style={{ "--c": lineColour(s.company) } as CSSProperties}>
                  <strong>{label(s.skill, false)} <span className="hint">for {s.company}</span></strong>
                  <span>{s.why}</span>
                  <span><b>This week:</b> {s.first_step}</span>
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
    </section>
  );
}

function Ask({ profile, who }: { profile: P; who: string }) {
  const [q, setQ] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ask = async (question: string) => {
    if (!question.trim()) return;
    setBusy(true); setError("");
    try {
      const { answer } = await api.ask(profile, question, turns);
      setTurns([...turns, { role: "user", content: question }, { role: "assistant", content: answer }]);
      setQ("");
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const suggestions = ["Why is my top match first?", "What should I learn first?", "Which line is the biggest reach?"];
  return (
    <section className="panel" aria-labelledby="ask-title">
      <h2 id="ask-title">Ask about your matches</h2>
      {turns.length > 0 && (
        <div className="qa" aria-live="polite">
          {turns.map((t, i) => <p key={i} className={t.role === "user" ? "q" : "a"}>{t.content}</p>)}
        </div>
      )}
      {!turns.length && (
        <div className="row-actions">
          {suggestions.map((s) => <button key={s} type="button" className="chip pick" onClick={() => ask(s)} disabled={busy}>{s}</button>)}
        </div>
      )}
      <form className="add-row" onSubmit={(e) => { e.preventDefault(); ask(q); }}>
        <label htmlFor="ask" className="sr-only">Your question</label>
        <input id="ask" type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask a question" maxLength={500} />
        <button className="btn secondary" type="submit" disabled={busy || !q.trim()}>Ask</button>
      </form>
      {busy && <Busy>{who} is answering…</Busy>}
      {error && <ErrorNote>{error}</ErrorNote>}
      <span className="ai-tag">Answers by {who}, from your map only</span>
    </section>
  );
}

function Tailor({ profile, matches, who }: { profile: P; matches: Match[]; who: string }) {
  const resume = useResume();
  const [company, setCompany] = useState(matches[0]?.company ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Tailored | null>(null);
  const run = async () => {
    setBusy(true); setError(""); setResult(null);
    try { setResult(await api.tailor(profile, resume, { company })); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <section className="panel" aria-labelledby="tailor-title">
      <h2 id="tailor-title">Tailor your resume</h2>
      <p className="hint">{who} rewords your bullets so a company's skills that you really have are stated plainly. It won't invent experience.</p>
      <div className="field">
        <label htmlFor="tailor-co">For</label>
        <select id="tailor-co" value={company} onChange={(e) => setCompany(e.target.value)}>
          {matches.map((m) => <option key={m.company} value={m.company}>{m.company}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="tailor-text">Resume text</label>
        <textarea id="tailor-text" rows={5} value={resume} onChange={(e) => store.setResume(e.target.value)}
          placeholder="Paste your resume; it stays in this tab only" />
      </div>
      <div className="row-actions">
        <button className="btn secondary" type="button" onClick={run} disabled={busy || resume.trim().length < 40}>Tailor for {company}</button>
      </div>
      <div aria-live="polite" className="stack" style={{ gap: 10 }}>
        {busy && <Busy>{who} is rewording…</Busy>}
        {error && <ErrorNote>{error}</ErrorNote>}
        {result && (
          <>
            <ul className="bullets">
              {result.bullets.map((b, i) => (
                <li key={i}>{b.text}{b.shows.length > 0 && <span className="hint"> · shows {b.shows.map((s) => label(s, false)).join(", ")}</span>}</li>
              ))}
            </ul>
            {result.note && <p className="notice plain">{result.note}</p>}
          </>
        )}
      </div>
    </section>
  );
}
