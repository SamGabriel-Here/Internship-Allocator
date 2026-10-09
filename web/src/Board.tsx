import { useEffect, useState, type CSSProperties } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { api, type Insights, type Match } from "./api";
import { Breakdown, Busy, Coverage, ErrorNote, Key, SkillInput, YourLine, usePrediction } from "./components";
import { bandLabel, label, progressText, stations } from "./lines";
import { Copilot, PostingCheck, ShareLink } from "./Panels";
import { ResumeReader, useConfig } from "./Resume";
import { COMPANY_PHOTOS, HERO_PHOTO } from "./photos";
import { store, useProfile } from "./store";

/** The whole app on one ruled board: your skills first, then every company. */
export default function Board() {
  const [params] = useSearchParams();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  // A shared link (/map?skills=python,sql&cgpa=8.2) opens that profile; the board itself lives at /.
  useEffect(() => {
    const skills = params.get("skills");
    if (skills) {
      const cgpa = params.get("cgpa");
      store.setProfile({ name: "", skills: skills.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean), cgpa: cgpa ? Number(cgpa) : null });
    }
    if (skills || pathname !== "/") navigate("/", { replace: true });
  }, [params, pathname, navigate]);

  const profile = useProfile();
  const config = useConfig();
  const { data, error, loading } = usePrediction(profile);
  const [mode, setMode] = useState<"type" | "resume">("type");
  const [catalog, setCatalog] = useState<Insights["companies"]>([]);
  useEffect(() => { api.insights().then((r) => setCatalog(r.companies)).catch(() => {}); }, []);

  // Each scored profile is saved to History (the store skips an identical repeat).
  useEffect(() => {
    if (!data?.recommendations.length) return;
    store.record({
      skills: data.recognised, cgpa: data.cgpa,
      top: data.recommendations.slice(0, 3).map((r) => ({ company: r.company, coverage: r.coverage, band: r.band })),
    });
  }, [data]);

  const ranked = data?.recommendations ?? [];
  const p = { skills: profile.skills, cgpa: profile.cgpa };

  return (
    <>
      <div className="page-head">
        <h1>Find internships that match your skills</h1>
        <p className="lede">
          Every company in the dataset on one board. Add your skills and each one shows what you already have,
          what counts partially, and what to learn next.
        </p>
      </div>

      <div className="mosaic">
        <section className="mod mod-profile" aria-labelledby="skills-title">
          <header className="mod-h">
            <h2 className="tab" id="skills-title">Your skills</h2>
            {profile.skills.length > 0 && <span className="meta">{profile.skills.length} added · <ShareLink skills={profile.skills} cgpa={profile.cgpa} /></span>}
          </header>
          <div className="stack">
            <div className="switch" role="group" aria-label="How to add skills">
              <button type="button" aria-pressed={mode === "type"} onClick={() => setMode("type")}>Type skills</button>
              <button type="button" aria-pressed={mode === "resume"} onClick={() => setMode("resume")}>Paste a resume</button>
            </div>
            {mode === "type"
              ? <SkillInput onAdd={(s) => s.forEach(store.addSkill)} autoFocus={!profile.skills.length} />
              : <ResumeReader enabled={!!config?.copilot_enabled} provider={config?.copilot_provider ?? null} loaded={!!config} />}
            <YourLine skills={profile.skills} unrecognised={data?.unrecognised ?? []} onRemove={store.removeSkill} />
            {profile.skills.length > 0 && (
              <button className="btn quiet" type="button" onClick={() => store.setProfile({ ...profile, skills: [] })}>Clear all skills</button>
            )}
            <details className="optional" open={profile.cgpa !== null || !!profile.name}>
              <summary>CGPA and name <span className="hint">(optional)</span></summary>
              <div className="two">
                <div className="field">
                  <label htmlFor="cgpa">CGPA <span className="hint">(out of 10)</span></label>
                  <input id="cgpa" type="number" inputMode="decimal" min={0} max={10} step={0.1} placeholder="e.g. 8.2"
                    value={profile.cgpa ?? ""}
                    onChange={(e) => {
                      const v = e.target.value === "" ? null : Number(e.target.value);
                      store.setProfile({ ...profile, cgpa: v !== null && v >= 0 && v <= 10 ? v : null });
                    }} />
                </div>
                <div className="field">
                  <label htmlFor="name">Name</label>
                  <input id="name" type="text" autoComplete="given-name" value={profile.name}
                    onChange={(e) => store.setProfile({ ...profile, name: e.target.value })} />
                </div>
              </div>
              <p className="hint">CGPA only nudges the order a little (15%); skills decide the match. Everything stays in this browser.</p>
            </details>
            <Key />
          </div>
        </section>

        <div className="board-status" aria-live="polite" style={{ "--hero": `url("${HERO_PHOTO.src}")` } as CSSProperties}>
          {catalog.length > 0 && <p className="hero-line">{catalog.length} companies · {new Set(catalog.map((c) => c.location)).size} cities · one board</p>}
          {loading && !data && <Busy>Scoring companies…</Busy>}
          {error && <ErrorNote>{error}</ErrorNote>}
          {data && !data.recognised.length && (
            <p className="notice warn">
              None of those skills are recognised, so nothing is ranked. Try common names like Python, Java, React,
              SQL or Machine learning.
            </p>
          )}
          {ranked.length > 0 && (
            <p className="hint">
              Sorted closest first. Fit is how many of a company's skills you cover, from 51 synthetic
              placements: a sanity signal, not a hiring prediction.
            </p>
          )}
          {!ranked.length && !loading && !error && (!data || !data.recognised.length) && (
            <p className="hint">What each company asks for. Add a skill and they sort by how well you fit.</p>
          )}
        </div>

        {ranked.length > 0
          ? ranked.map((m, i) => <CompanyModule key={m.company} m={m} rank={i + 1} wide={i < 3} />)
          : catalog.map((c) => <UnscoredModule key={c.name} name={c.name} skills={c.top_skills} location={c.location} />)}

        {ranked.length > 0 && <PostingCheck profile={p} />}
        {ranked.length > 0 && (
          <Copilot profile={p} matches={ranked} enabled={!!config?.copilot_enabled} provider={config?.copilot_provider ?? null} loaded={!!config} />
        )}
      </div>
    </>
  );
}

function CompanyModule({ m, rank, wide }: { m: Match; rank: number; wide: boolean }) {
  const list = stations(m);
  return (
    <article className={`mod co${wide ? " wide" : ""}`} aria-labelledby={`co-${rank}`}>
      <CityPhoto company={m.company} />
      <header className="mod-h">
        <span className={`rank${wide ? " top" : ""}`} aria-hidden="true">{rank}</span>
        <h3 id={`co-${rank}`}><span className="sr-only">Rank {rank}: </span>{m.company}</h3>
        <span className="meta">{m.location}</span>
      </header>
      <p className="fit"><b>{bandLabel[m.band]}</b> <span>{progressText(list)}</span> <Coverage list={list} /></p>
      <Breakdown m={m} />
      {wide && (
        <p className="next">
          {m.gap_skills[0]
            ? <>Next skill to learn: <strong>{label(m.gap_skills[0], false)}</strong></>
            : m.related_skills.length
              ? <>Nothing missing. Learning {m.related_skills.map((r) => label(r.skill, false)).join(", ")} directly completes it.</>
              : <><strong>You cover every skill.</strong> Worth applying.</>}
          <span className="hint"> · {m.interns} past interns · avg rating {m.avg_rating}/4 (synthetic)</span>
        </p>
      )}
    </article>
  );
}

function UnscoredModule({ name, skills, location }: { name: string; skills: string[]; location: string }) {
  return (
    <article className="mod co unscored" aria-label={`${name}: asks for ${skills.map((s) => label(s, false)).join(", ")}`}>
      <CityPhoto company={name} />
      <header className="mod-h">
        <h3>{name}</h3>
        <span className="meta">{location}</span>
      </header>
      <p className="asks"><span className="hint">Asks for</span> {skills.map((s) => <span key={s} className="chip">{label(s, false)}</span>)}</p>
    </article>
  );
}

function CityPhoto({ company }: { company: string }) {
  const photo = COMPANY_PHOTOS[company];
  if (!photo) return null;
  return (
    <figure className="photo">
      <img src={photo.src} alt="" loading="lazy" decoding="async" />
    </figure>
  );
}
