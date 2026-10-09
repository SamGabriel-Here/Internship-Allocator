import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { api, type Insights as InsightsData } from "./api";
import { Busy, ErrorNote, StripMap } from "./components";
import { bandLabel, label } from "./lines";
import { COMPANY_PHOTOS, HERO_PHOTO } from "./photos";
import { store, useHistory } from "./store";

// ---------------------------------------------------------------- insights
export function Insights() {
  const [data, setData] = useState<InsightsData | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { api.insights().then(setData).catch((e: Error) => setError(e.message)); }, []);

  return (
    <>
      <div className="page-head">
        <h1>Dataset overview</h1>
        <p className="lede">
          The skills each company in the dataset asks for. A skill shared by several companies is marked
          where their rows meet.
        </p>
      </div>
      {!data && !error && <Busy>Loading the dataset…</Busy>}
      {error && <ErrorNote>{error}</ErrorNote>}
      {data && (
        <>
          <div className="facts">
            <p className="fact"><b className="num">{Math.round(data.metrics.top1_accuracy * 100)}%</b>of students' real company ranked first</p>
            <p className="fact"><b className="num">{Math.round(data.metrics.top3_accuracy * 100)}%</b>ranked in the top three</p>
            <p className="margin-note">
              Leave-one-out check on {data.metrics.n_samples} synthetic placements across {data.metrics.n_companies} companies:
              each student is removed before scoring. A sanity signal, not a benchmark.
            </p>
          </div>
          <Network companies={data.companies} />
          <section className="section" aria-labelledby="busiest">
            <h2 id="busiest">Most common skills</h2>
            <p className="hint">The skills students in the dataset list most often.</p>
            <ol className="chips">
              {data.top_skills.map((s) => <li key={s.skill} className="chip">{label(s.skill, false)} <span className="hint num">{s.count}</span></li>)}
            </ol>
          </section>
          <section className="section" aria-labelledby="companies">
            <h2 id="companies">Companies in the dataset</h2>
            <div className="table-wrap">
              <table className="stackable">
                <thead><tr><th>Company</th><th>Interns</th><th>Avg CGPA</th><th>Avg rating /4</th><th>Location</th><th>Skills asked for</th></tr></thead>
                <tbody>
                  {data.companies.map((c) => (
                    <tr key={c.name}>
                      <td className="wide">
                        <span className="co-name" style={{ fontSize: "1rem" }}>
                          {c.name}
                        </span>
                      </td>
                      <td data-label="Interns">{c.interns}</td>
                      <td data-label="Avg CGPA">{c.avg_cgpa}</td>
                      <td data-label="Avg rating">{c.avg_rating}</td>
                      <td data-label="Location">{c.location}</td>
                      <td data-label="Skills" className="wide">{c.top_skills.map((s) => label(s, false)).join(", ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </>
  );
}

function Network({ companies }: { companies: InsightsData["companies"] }) {
  const rows = chainBySharedSkills(companies);
  // Columns: each row's skills in turn, so every line stays short and readable.
  const cols: string[] = [];
  rows.forEach((c) => c.top_skills.forEach((s) => { if (!cols.includes(s)) cols.push(s); }));
  const users = (s: string) => companies.filter((c) => c.top_skills.includes(s)).length;
  const L = 112, T = 118, CW = 34, RH = 40;
  const W = L + cols.length * CW + 16, H = T + companies.length * RH + 8;
  const x = (s: string) => L + cols.indexOf(s) * CW + CW / 2;
  const y = (i: number) => T + i * RH + RH / 2;

  return (
    <>
    <figure className="network-wrap" style={{ margin: 0 }}>
      <svg className="network" viewBox={`0 0 ${W} ${H}`} width={W} role="img"
        aria-label={`Diagram of ${companies.length} companies and the ${cols.length} skills they ask for. The table below lists the same data.`}>
        {cols.map((s) => (
          <g key={s}>
            <text x={x(s)} y={T - 10} fontSize="12.5" className={users(s) > 1 ? "col-label shared" : "col-label"}
              transform={`rotate(-45 ${x(s)} ${T - 10})`}>{label(s)}</text>
          </g>
        ))}
        {rows.map((c, i) => {
          const xs = c.top_skills.map(x);
          return (
            <g key={c.name} className="net-row">
              <text x={L - 14} y={y(i) + 4.5} textAnchor="end" fontSize="13.5" className="row-label">{c.name}</text>
              <line x1={Math.min(...xs) - 10} x2={Math.max(...xs) + 10} y1={y(i)} y2={y(i)} className="net-line" strokeWidth="3" strokeLinecap="round" />
              {c.top_skills.filter((s) => users(s) === 1).map((s) =>
                <circle key={s} cx={x(s)} cy={y(i)} r="4.5" className="net-dot" strokeWidth="2" />)}
            </g>
          );
        })}
        {cols.filter((s) => users(s) > 1).map((s) => {
          // An interchange: one white capsule joining every line that stops at this skill.
          const at = rows.flatMap((c, i) => (c.top_skills.includes(s) ? [y(i)] : []));
          const top = Math.min(...at) - 9, bottom = Math.max(...at) + 9;
          return <rect key={s} x={x(s) - 5} y={top + 4} width="10" height={bottom - top - 8} rx="5" className="net-bar" />;
        })}
      </svg>
      <figcaption className="hint">Filled bars join the companies that ask for the same skill. Open dots are skills only one company asks for.</figcaption>
    </figure>
    <ul className="legend corridor-legend">
      <li><i className="k-reached" />Several companies ask for it</li>
      <li><i className="k-ahead" />Only this company asks for it</li>
    </ul>
    <ul className="corridors" aria-label="Companies and the skills they ask for">
      {rows.map((c) => (
        <li key={c.name}>
          <span className="co-name">{c.name}</span>
          <StripMap network compact company={c.name}
            matched_skills={c.top_skills.filter((s) => users(s) > 1)} related_skills={[]}
            gap_skills={c.top_skills.filter((s) => users(s) === 1)} />
        </li>
      ))}
    </ul>
    </>
  );
}

/** Row order that keeps companies sharing skills next to each other (greedy chain). */
export function chainBySharedSkills<T extends { top_skills: string[] }>(companies: T[]): T[] {
  const left = [...companies];
  const out: T[] = left.length ? [left.shift()!] : [];
  while (left.length) {
    const placed = new Set(out.flatMap((c) => c.top_skills));
    const last = new Set(out[out.length - 1].top_skills);
    const score = (c: T) => c.top_skills.filter((s) => last.has(s)).length * 10 + c.top_skills.filter((s) => placed.has(s)).length;
    let best = 0;
    left.forEach((c, i) => { if (score(c) > score(left[best])) best = i; });
    out.push(left.splice(best, 1)[0]);
  }
  return out;
}

// ---------------------------------------------------------------- history
export function History() {
  const history = useHistory();
  const navigate = useNavigate();
  const dialog = useRef<HTMLDialogElement>(null);
  const fmt = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

  return (
    <>
      <div className="page-head">
        <h1>History</h1>
        <p className="lede">Each time you open your matches, the profile is saved here. Stored only in this browser; nothing is sent anywhere.</p>
      </div>
      {!history.length ? (
        <div className="empty-state">
          <p>Nothing saved yet. Your searches appear here after you open your matches.</p>
          <Link className="btn" to="/">Add your skills</Link>
        </div>
      ) : (
        <>
          <ol className="journeys">
            {history.map((h) => (
              <li key={h.id} className="journey">
                <div className="stack" style={{ gap: 6 }}>
                  <time dateTime={new Date(h.ts).toISOString()}>{fmt.format(h.ts)}</time>
                  <p><strong>{h.skills.map((s) => label(s, false)).join(", ")}</strong>{h.cgpa !== null && <span className="hint"> · CGPA {h.cgpa}</span>}</p>
                  <p className="tops">
                    {h.top.map((t) => (
                      <span key={t.company}>
                        {t.company} <span className="hint">{bandLabel[t.band]}</span>
                      </span>
                    ))}
                  </p>
                </div>
                <button className="btn secondary" type="button" onClick={() => {
                  store.setProfile({ name: "", skills: h.skills, cgpa: h.cgpa });
                  navigate("/map");
                }}>Open again</button>
              </li>
            ))}
          </ol>
          <div className="row-actions" style={{ marginTop: 24 }}>
            <button className="btn quiet" type="button" onClick={() => dialog.current?.showModal()}>Clear history</button>
          </div>
          <dialog ref={dialog} aria-labelledby="clear-title">
            <form method="dialog" className="stack">
              <h2 id="clear-title">Clear all {history.length} saved searches?</h2>
              <p className="hint">This removes them from this browser. Your current profile stays.</p>
              <div className="row-actions">
                <button className="btn" value="clear" onClick={() => store.clearHistory()}>Clear history</button>
                <button className="btn secondary" value="cancel" autoFocus>Keep them</button>
              </div>
            </form>
          </dialog>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------- about
const ENDPOINTS: [string, string, string, string][] = [
  ["/api/predict", "POST", '{"skills", "cgpa"}', "Recognised and unrecognised skills, and every company ranked with matched / related / gap skills and a fit band"],
  ["/api/match_jd", "POST", '{"skills", "jd_text"}', "Coverage of a pasted posting, with the same skill breakdown"],
  ["/api/skills", "GET", "—", "Every skill the ontology and dataset know, most common first"],
  ["/api/copilot/extract", "POST", '{"text"}', "A profile read from resume text, for the student to review (AI)"],
  ["/api/copilot/plan", "POST", '{"skills", "cgpa"}', "A learning plan for the gaps in the top three matches (AI)"],
  ["/api/copilot/ask", "POST", '{"skills", "question", "history"}', "An answer grounded in the student's matches (AI)"],
  ["/api/copilot/tailor", "POST", '{"skills", "resume_text", "company" | "jd_text"}', "Resume bullets reworded for one target (AI)"],
  ["/api/insights", "GET", "—", "Dataset stats, company profiles, evaluation metrics"],
  ["/api/config", "GET", "—", "Whether the AI copilot is on, and which provider"],
  ["/health", "GET", "—", "Liveness check"],
];

export function About() {
  return (
    <>
      <div className="page-head">
        <h1>How matching works</h1>
        <p className="lede">
          Nextern is an explainable, content-based recommender. No black box: every match shows the skills behind it.
        </p>
      </div>
      <dl className="card-dl">
        <dt>Approach</dt>
        <dd>A curated skill ontology. Aliases resolve (JS → JavaScript), skills in one family give half credit (React ↔ Vue), and each company is scored by how much of its required skill set you cover, plus a small CGPA-proximity nudge (15%).</dd>
        <dt>Fit bands</dt>
        <dd>Strong fit covers 70% or more of a company's skills, partial fit 40% or more, anything lower is a reach. Bands, not decimals, because the dataset can't support finer claims.</dd>
        <dt>Training data</dt>
        <dd>51 synthetic student–company placements across 11 companies. Small and synthetic by design: this is a portfolio project, not a production system.</dd>
        <dt>Evaluation</dt>
        <dd>Leave-one-out: each student is removed from the company profiles before being scored. About 82% top-1 and 100% top-3. Treat it as a sanity signal, not a benchmark.</dd>
        <dt>AI copilot</dt>
        <dd>Optional. With an Anthropic or Google AI key on the server, an LLM reads resume text into a profile you confirm, writes a learning plan, answers follow-ups and rewords resume bullets. It only explains results the ontology computed; it never ranks companies. Resume text is sent to that provider when you use it and is not stored by Nextern.</dd>
        <dt>Your data</dt>
        <dd>Your profile and history live in this browser's storage. Pasted resume text is kept for the current tab only.</dd>
        <dt>Limitations</dt>
        <dd>Tiny synthetic dataset; the ontology covers common tech skills only; CGPA is a heuristic. Never use these results as the only basis for a career decision.</dd>
      </dl>

      <section className="section" aria-labelledby="api">
        <h2 id="api">API</h2>
        <p className="hint">Every endpoint returns JSON with an <code>ok</code> flag. Prediction and AI endpoints are rate-limited per IP.</p>
        <div className="table-wrap">
          <table className="stackable">
            <thead><tr><th>Endpoint</th><th>Method</th><th>Body</th><th>Returns</th></tr></thead>
            <tbody>
              {ENDPOINTS.map(([path, method, body, returns]) => (
                <tr key={path}>
                  <td className="wide"><code>{path}</code></td>
                  <td data-label="Method">{method}</td>
                  <td data-label="Body"><code>{body}</code></td>
                  <td data-label="Returns" className="wide">{returns}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <pre><code>{`curl -X POST https://getnextern.onrender.com/api/predict \\
  -H "Content-Type: application/json" \\
  -d '{"skills": "python, machine learning", "cgpa": 8.5}'`}</code></pre>
      </section>
      <PhotoCredits />
    </>
  );
}

function PhotoCredits() {
  const photos = [HERO_PHOTO, ...Object.values(COMPANY_PHOTOS)];
  return (
    <section className="section" aria-labelledby="credits">
      <h2 id="credits">Photo credits</h2>
      <p className="hint">City photographs from Wikimedia Commons, shown at reduced size. They illustrate where each company's past interns were placed; they are not company imagery.</p>
      <ul className="credits">
        {photos.map((p) => (
          <li key={p.src}>
            <a href={p.page}>{p.title}</a> by {p.artist}, <a href={p.licenseUrl || p.page}>{p.license}</a>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function NotFound() {
  return (
    <div className="empty-state">
      <h1>Page not found</h1>
      <p className="lede">That page doesn't exist.</p>
      <Link className="btn" to="/">Back to your skills</Link>
    </div>
  );
}
