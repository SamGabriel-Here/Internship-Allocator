import { useState } from "react";
import { api, providerName, type JdMatch, type Match, type Plan, type Tailored, type Turn } from "./api";
import { Breakdown, Busy, Coverage, ErrorNote } from "./components";
import { bandLabel, label, stations, progressText } from "./lines";
import { store, useResume } from "./store";

export function ShareLink({ skills, cgpa }: { skills: string[]; cgpa: number | null }) {
  const [state, setState] = useState<"idle" | "copied" | "manual">("idle");
  const url = `${location.origin}/?skills=${encodeURIComponent(skills.join(","))}${cgpa !== null ? `&cgpa=${cgpa}` : ""}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setState("copied");
      setTimeout(() => setState("idle"), 2000);
    } catch {
      setState("manual"); // clipboard blocked (permissions, insecure origin): show the link to copy by hand
    }
  };
  if (state === "manual") {
    return (
      <span className="share-manual">
        <label htmlFor="share-url" className="sr-only">Link to this board</label>
        <input id="share-url" type="text" readOnly value={url} autoFocus onFocus={(e) => e.currentTarget.select()} />
        <span role="status">Copying was blocked; the link is selected, press Ctrl or Cmd + C.</span>
      </span>
    );
  }
  return (
    <button type="button" className="btn quiet share" onClick={copy}>
      <span role="status">{state === "copied" ? "Link copied" : "Copy link"}</span>
    </button>
  );
}

type P = { skills: string[]; cgpa: number | null };

export function PostingCheck({ profile }: { profile: P }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<JdMatch | null>(null);
  const run = async () => {
    setBusy(true); setError(""); setResult(null);
    try { setResult(await api.matchJd(profile, text)); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <section className="mod mod-side" aria-labelledby="posting">
      <header className="mod-h"><h2 className="tab" id="posting">Check a real posting</h2></header>
      <p className="hint">Paste any internship or job post. We pull out the skills it asks for and compare them with your profile.</p>
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
            <p className="fit"><b>{bandLabel[result.band]}</b> <span>{progressText(stations(result))}</span> <Coverage list={stations(result)} /></p>
            <Breakdown m={result} />
          </>
        )}
      </div>
    </section>
  );
}

export function Copilot({ profile, matches, enabled, provider, loaded }: {
  profile: P; matches: Match[]; enabled: boolean; provider: string | null; loaded: boolean;
}) {
  if (!loaded) return null;
  if (!enabled) {
    return (
      <section className="mod mod-side" aria-labelledby="ai-off">
        <header className="mod-h"><h2 className="tab neutral" id="ai-off">AI copilot is off</h2></header>
        <p className="hint">
          This server has no AI key, so the coaching features are switched off: a learning plan for your gaps,
          answers to follow-up questions, and resume bullets tailored to a company. Everything else on the board works without it.
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
    <section className="mod mod-side" aria-labelledby="plan-title">
      <header className="mod-h"><h2 className="tab" id="plan-title">Plan your next skills</h2></header>
      <p className="hint">{who} turns the skills missing from your top three matches into a short, ordered plan.</p>
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
                <li key={i}>
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
  const suggestions = ["Why is my top match first?", "What should I learn first?", "Which company is the biggest reach?"];
  return (
    <section className="mod mod-side" aria-labelledby="ask-title">
      <header className="mod-h"><h2 className="tab" id="ask-title">Ask about your matches</h2></header>
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
      <span className="ai-tag">Answers by {who}, based on your results</span>
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
    <section className="mod mod-side" aria-labelledby="tailor-title">
      <header className="mod-h"><h2 className="tab" id="tailor-title">Tailor your resume</h2></header>
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
