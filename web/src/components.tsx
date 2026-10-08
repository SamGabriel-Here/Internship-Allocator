import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { api, type Prediction } from "./api";
import { store, type Profile } from "./store";
import { herePosition, label, lineColour, progressText, stations, type Station } from "./lines";

// ---------- icons: one 24px grid, 2px stroke ----------
const icon = (d: ReactNode) => (props: { title?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden={props.title ? undefined : true} role={props.title ? "img" : undefined}>
    {props.title && <title>{props.title}</title>}
    {d}
  </svg>
);
export const IconClose = icon(<path d="M6 6l12 12M18 6L6 18" />);
export const IconMenu = icon(<path d="M4 7h16M4 12h16M4 17h16" />);
export const IconArrow = icon(<path d="M5 12h14M13 6l6 6-6 6" />);
export const IconPlus = icon(<path d="M12 5v14M5 12h14" />);

export function BrandMark() {
  return (
    <svg viewBox="0 0 34 18" aria-hidden="true">
      <rect x="1" y="7" width="32" height="4" rx="2" fill="#13202f" />
      <circle cx="9" cy="9" r="6" fill="#fff" stroke="#13202f" strokeWidth="3" />
      <rect x="23" y="5" width="3" height="10" rx="1" fill="#d01f3a" />
    </svg>
  );
}

// ---------- the legend every line diagram is read with ----------
export function Legend() {
  return (
    <ul className="legend" aria-label="How to read a line">
      <li><i className="k-reached" />You have it</li>
      <li><i className="k-transfer" />A related skill counts half</li>
      <li><i className="k-ahead" />Still to learn</li>
    </ul>
  );
}

// ---------- strip map: one company's required skills as a line ----------
type StripProps = {
  company: string;
  colour?: string;
  matched_skills: string[];
  related_skills: { skill: string; via: string }[];
  gap_skills: string[];
  compact?: boolean;
  network?: boolean; // dataset view: every station drawn, no "you are here"
};

export function StripMap(props: StripProps) {
  const list: Station[] = stations(props);
  const n = Math.max(list.length, 1);
  const here = props.network ? list.length : herePosition(list);
  const herePct = (here / n) * 100;
  const style = { "--c": props.colour ?? lineColour(props.company), "--n": n, "--here": `${herePct}%` } as CSSProperties;
  const edge = here === 0 ? "edge-start" : here === n ? "edge-end" : "";
  return (
    <div className={`strip${props.compact ? " compact" : ""}${props.network ? " network-strip" : ""}`} style={style}>
      <span className={`here ${edge}`} aria-hidden="true">{here === 0 ? "Start here" : here === n && !list.some((s) => s.kind === "transfer") ? "Arrived" : "You are here"}</span>
      <ol className="track" aria-label={props.network ? `${props.company}: ${list.length} skills` : `${props.company}: ${progressText(list)}`}>
        {list.map((s) => (
          <li key={s.skill} className={s.kind}>
            <span className="mark" aria-hidden="true" />
            <span className="st-label">
              {!props.network && <span className="sr-only">{s.kind === "reached" ? "You have " : s.kind === "transfer" ? "Partly covered: " : "To learn: "}</span>}
              <abbr title={label(s.skill, false)} style={{ textDecoration: "none" }}>{label(s.skill)}</abbr>
              {s.via && <span className="via">via {label(s.via)}</span>}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ---------- your own line: one station per skill in the profile ----------
export function YourLine({ skills, unrecognised, onRemove }: { skills: string[]; unrecognised: string[]; onRemove: (s: string) => void }) {
  const seen = useRef(new Set(skills));
  const fresh = skills.filter((s) => !seen.current.has(s));
  useEffect(() => { skills.forEach((s) => seen.current.add(s)); }, [skills]);
  if (!skills.length) return <p className="empty-line">No skills yet. Add your first one below; each becomes a station on your line.</p>;
  return (
    <ol className="yourline" aria-label="Your skills">
      {skills.map((s) => {
        const off = unrecognised.includes(s);
        return (
          <li key={s} className={`${off ? "off" : ""} ${fresh.includes(s) ? "new" : ""}`}>
            <span className="stop" aria-hidden="true" />
            <span className="name">
              {label(s, false)}
              {off && <span className="tag"><br />Not on our map, so it can't be matched</span>}
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
