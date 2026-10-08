// The student's profile and history live only in this browser. Resume text is
// kept for the tab session only, so a pasted resume never outlives the visit.
import { useSyncExternalStore } from "react";
import type { Band } from "./api";

export type Profile = { name: string; skills: string[]; cgpa: number | null };
export type HistoryEntry = {
  id: string;
  ts: number;
  skills: string[];
  cgpa: number | null;
  top: { company: string; coverage: number; band: Band }[];
};

const PROFILE_KEY = "nextern.profile";
const HISTORY_KEY = "nextern.history";
const RESUME_KEY = "nextern.resume";
const EMPTY: Profile = { name: "", skills: [], cgpa: null };

function read<T>(storage: () => Storage, key: string, fallback: T): T {
  try {
    const raw = storage().getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(storage: () => Storage, key: string, value: unknown) {
  try {
    if (value === null) storage().removeItem(key);
    else storage().setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked: the app keeps working for this visit */
  }
}

const local = () => window.localStorage;
const session = () => window.sessionStorage;

function sanitizeProfile(p: Partial<Profile> | null): Profile {
  if (!p || typeof p !== "object") return EMPTY;
  const skills = Array.isArray(p.skills) ? p.skills.filter((s): s is string => typeof s === "string") : [];
  const cgpa = typeof p.cgpa === "number" && p.cgpa >= 0 && p.cgpa <= 10 ? p.cgpa : null;
  return { name: typeof p.name === "string" ? p.name : "", skills, cgpa };
}

let profile = sanitizeProfile(read<Partial<Profile> | null>(local, PROFILE_KEY, null));
let history = read<HistoryEntry[]>(local, HISTORY_KEY, []);
if (!Array.isArray(history)) history = [];
let resume = read<string>(session, RESUME_KEY, "");

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const store = {
  setProfile(next: Profile) {
    profile = sanitizeProfile(next);
    write(local, PROFILE_KEY, profile);
    emit();
  },
  addSkill(skill: string) {
    const s = skill.trim().toLowerCase();
    if (s && !profile.skills.includes(s)) store.setProfile({ ...profile, skills: [...profile.skills, s] });
  },
  removeSkill(skill: string) {
    store.setProfile({ ...profile, skills: profile.skills.filter((s) => s !== skill) });
  },
  setResume(text: string) {
    resume = text;
    write(session, RESUME_KEY, text || null);
    emit();
  },
  record(entry: Omit<HistoryEntry, "id" | "ts">) {
    const last = history[0];
    const same = last && last.skills.join() === entry.skills.join() && last.cgpa === entry.cgpa;
    const next = { ...entry, id: crypto.randomUUID?.() ?? String(Date.now()), ts: Date.now() };
    history = [next, ...(same ? history.slice(1) : history)].slice(0, 50);
    write(local, HISTORY_KEY, history);
    emit();
  },
  clearHistory() {
    history = [];
    write(local, HISTORY_KEY, null);
    emit();
  },
};

export const useProfile = () => useSyncExternalStore(subscribe, () => profile);
export const useHistory = () => useSyncExternalStore(subscribe, () => history);
export const useResume = () => useSyncExternalStore(subscribe, () => resume);
