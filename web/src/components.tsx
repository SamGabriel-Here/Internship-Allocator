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

export function BrandMark() {
  return (
    <svg viewBox="0 0 34 18" aria-hidden="true">
      <rect className="mark-red" x="0" y="0" width="16" height="18" />
      <rect className="mark-ink" x="18" y="0" width="16" height="8" />
      <rect className="mark-ink" x="18" y="10" width="16" height="8" />
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

