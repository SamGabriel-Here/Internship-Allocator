import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { api, type Match, type Prediction } from "./api";
import { store, type Profile } from "./store";
import { label, type Station } from "./lines";

// ---------- icons: one 24px grid, 2px stroke ----------
const icon = (d: ReactNode) => (props: { title?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden={props.title ? undefined : true} role={props.title ? "img" : undefined}>
    {props.title && <title>{props.title}</title>}
    {d}
  </svg>
);
export const IconClose = icon(<path d="M6 6l12 12M18 6L6 18" />);
export const IconMenu = icon(<path d="M4 7h16M4 12h16M4 17h16" />);
export const IconPlus = icon(<path d="M12 5v14M5 12h14" />);
export const IconSun = icon(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>);
export const IconMoon = icon(<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />);

/** The seal: 次 (tsugi, "next") cut from Shippori Mincho, white on the board's red. */
export function BrandMark() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <rect className="mark-red" width="32" height="32" rx="3" />
      <path fill="#fff" d="M23.52 9.38Q23.64 9.26 23.82 9.05Q24.01 8.84 24.12 8.74Q24.24 8.63 24.33 8.63Q24.47 8.63 25.07 9.17Q25.66 9.7 26.19 10.28Q26.71 10.87 26.71 11.03Q26.45 11.29 25.8 11.31Q25.08 12.38 23.94 13.56Q22.8 14.73 21.68 15.48L21.49 15.31Q21.94 14.34 22.34 13.08Q22.75 11.82 22.98 10.75H19.59V10.96H19.61Q19.82 14.29 20.54 16.71Q21.26 19.13 22.74 20.91Q24.22 22.69 26.66 23.81L26.62 24.09Q24.64 24.58 24.29 27Q21.84 25.23 20.77 21.88Q19.7 18.53 19.4 13.59Q19 17.08 17.87 19.62Q16.74 22.16 14.43 24.03Q12.11 25.91 8.25 27L8.08 26.72Q11.55 25.04 13.49 22.74Q15.42 20.43 16.17 17.56Q16.93 14.68 17 10.75H15.84Q13.83 14.03 10.99 15.94L10.72 15.76Q12.37 13.4 13.56 10.05Q13.95 8.96 14.25 7.46Q14.56 5.95 14.56 5L18.56 6.3Q18.4 6.82 17.68 6.79Q17.09 8.47 16.19 10.1H22.87ZM6.69 7.07Q8.43 7.26 9.56 7.81Q10.69 8.35 11.19 9.05Q11.69 9.75 11.69 10.47Q11.69 11.12 11.3 11.58Q10.9 12.03 10.27 12.03Q9.71 12.03 9.16 11.63Q8.92 10.49 8.18 9.31Q7.43 8.12 6.52 7.23ZM5.29 19.5Q6.36 19.08 8.74 18.01Q11.11 16.94 13.56 15.78L13.65 15.99Q11.06 18.76 7.46 21.86Q7.32 22.41 6.97 22.58Z" />
    </svg>
  );
}

// ---------- your own line: one station per skill in the profile ----------
export function YourLine({ skills, unrecognised, onRemove }: { skills: string[]; unrecognised: string[]; onRemove: (s: string) => void }) {
  const seen = useRef(new Set(skills));
  const fresh = skills.filter((s) => !seen.current.has(s));
  useEffect(() => { skills.forEach((s) => seen.current.add(s)); }, [skills]);
  if (!skills.length) return <p className="empty-line">No skills yet. Add your first one above.</p>;
  return (
    <ol className="yourline" aria-label="Your skills">
      {skills.map((s) => {
        const off = unrecognised.includes(s);
        return (
          <li key={s} className={`${off ? "off" : ""} ${fresh.includes(s) ? "new" : ""}`}>
            <span className="stop" aria-hidden="true" />
            <span className="name">
              {label(s, false)}
              {off && <span className="tag"><br />Not recognised, so it can't be matched</span>}
            </span>
            <button type="button" className="x" onClick={() => onRemove(s)} aria-label={`Remove ${label(s, false)}`}>
              <IconClose />
            </button>
          </li>
        );
      })}
    </ol>
  );
}

// ---------- skill input with native autocomplete from the known skills ----------
let skillCache: Promise<string[]> | null = null;
export function useKnownSkills() {
  const [skills, setSkills] = useState<string[]>([]);
  useEffect(() => {
    skillCache ??= api.skills().catch(() => { skillCache = null; return []; });
    let live = true;
    skillCache.then((s) => live && setSkills(s));
    return () => { live = false; };
  }, []);
  return skills;
}

export function SkillInput({ onAdd, autoFocus }: { onAdd: (skills: string[]) => void; autoFocus?: boolean }) {
  const known = useKnownSkills();
  const [value, setValue] = useState("");
  const listId = useId();
  const add = () => {
    const parts = value.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
    if (parts.length) onAdd(parts);
    setValue("");
  };
  return (
    <form className="field" onSubmit={(e) => { e.preventDefault(); add(); }}>
      <label htmlFor={`${listId}-in`}>Add a skill</label>
      <div className="add-row">
        <input
          id={`${listId}-in`} type="text" list={listId} value={value} autoComplete="off" autoFocus={autoFocus}
          placeholder="e.g. Python, React, SQL" onChange={(e) => setValue(e.target.value)}
        />
        <button className="btn" type="submit" disabled={!value.trim()}><IconPlus />Add</button>
      </div>
      <datalist id={listId}>{known.map((s) => <option key={s} value={label(s, false)} />)}</datalist>
      <p className="hint">Pick from the list or type your own; separate several with commas.</p>
    </form>
  );
}

// ---------- live ranking for the current profile ----------
type PredictionState = { data: Prediction | null; error: string; loading: boolean };

/** Re-ranks whenever the profile changes (debounced), and canonicalises its skills. */
const lastPrediction = new Map<string, Prediction>(); // so a revisited page draws instantly

export function usePrediction(profile: Profile, delay = 300): PredictionState {
  const key = profile.skills.join("|") + "#" + profile.cgpa;
  const [state, setState] = useState<PredictionState>({ data: lastPrediction.get(key) ?? null, error: "", loading: false });
  useEffect(() => {
    if (!profile.skills.length) {
      setState({ data: null, error: "", loading: false });
      return;
    }
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    const t = setTimeout(() => {
      api.predict({ skills: profile.skills, cgpa: profile.cgpa })
        .then((data) => {
          if (!live) return;
          lastPrediction.set(key, data);
          setState({ data, error: "", loading: false });
          // Store skills in the recommender's own spelling (JS -> javascript), once.
          const canonical = [...data.recognised, ...data.unrecognised];
          if (canonical.join("|") !== profile.skills.join("|")) store.setProfile({ ...profile, skills: canonical });
        })
        .catch((e: Error) => live && setState({ data: null, error: e.message, loading: false }));
    }, delay);
    return () => { live = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}

export function Busy({ children }: { children: ReactNode }) {
  return <p className="status" role="status"><span className="spinner" aria-hidden="true" />{children}</p>;
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return <p className="notice err" role="alert">{children}</p>;
}

// ---------- the fixed company breakdown shared by every module ----------
export function Key() {
  return (
    <dl className="key" aria-label="How to read a company">
      <dt><i className="sq have" aria-hidden="true" />Have</dt><dd>you list this skill</dd>
      <dt><i className="sq related" aria-hidden="true" />Related</dt><dd>a skill in the same family counts half</dd>
      <dt><i className="sq learn" aria-hidden="true" />To learn</dt><dd>asked for, and you don't have it yet</dd>
    </dl>
  );
}

/** One square per required skill, in the order have → related → to learn. */
export function Coverage({ list }: { list: Station[] }) {
  return (
    <span className="coverage" aria-hidden="true">
      {list.map((s) => <i key={s.skill} className={`sq ${s.kind === "reached" ? "have" : s.kind === "transfer" ? "related" : "learn"}`} />)}
    </span>
  );
}

/** The fixed breakdown every company module and the posting check share. */
export function Breakdown({ m }: { m: Pick<Match, "matched_skills" | "related_skills" | "gap_skills"> }) {
  const none = <span className="none">—</span>;
  return (
    <dl className="rows">
      <dt>Have</dt>
      <dd>{m.matched_skills.length ? m.matched_skills.map((s) => <span key={s} className="chip have">{label(s, false)}</span>) : none}</dd>
      <dt>Related</dt>
      <dd>{m.related_skills.length ? m.related_skills.map((r) => (
        <span key={r.skill} className="chip related" title={`Counts half, through ${label(r.via, false)}`}>
          {label(r.skill, false)} <span className="via">via {label(r.via)}</span>
        </span>)) : none}</dd>
      <dt className={m.gap_skills.length ? "learn" : undefined}>To learn</dt>
      <dd>{m.gap_skills.length ? m.gap_skills.map((s) => <span key={s} className="chip learn">{label(s, false)}</span>) : none}</dd>
    </dl>
  );
}

