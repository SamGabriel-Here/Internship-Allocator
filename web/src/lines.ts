// Pure helpers behind every line diagram: a company's colour, how a skill is
// labelled, and the order its stations are drawn in.
import type { Match, Related } from "./api";

// One ink per company line. Each passes 3:1 against the ground and white.
const LINE_COLOURS: Record<string, string> = {
  Amazon: "#d9581a",
  Cisco: "#0e8494",
  Deloitte: "#11865a",
  Google: "#1f5fbf",
  IBM: "#6a3fa0",
  Infosys: "#56697d",
  Microsoft: "#d01f3a",
  Paytm: "#ab1179",
  Swiggy: "#a87600",
  TCS: "#cf3d77",
  Wipro: "#8a5a2b",
};
const SPARE = ["#1f5fbf", "#11865a", "#d01f3a", "#6a3fa0", "#d9581a", "#0e8494"];

export function lineColour(company: string): string {
  if (LINE_COLOURS[company]) return LINE_COLOURS[company];
  let h = 0;
  for (const ch of company) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return SPARE[h % SPARE.length];
}

const SHORT: Record<string, string> = {
  "natural language processing": "NLP",
  "data structures and algorithms": "DSA",
  "artificial intelligence": "AI",
  "object oriented programming": "OOP",
};
const EXACT: Record<string, string> = {
  sql: "SQL", mysql: "MySQL", postgresql: "PostgreSQL", html: "HTML", css: "CSS",
  "node.js": "Node.js", "c++": "C++", aws: "AWS", "power bi": "Power BI", "ci/cd": "CI/CD",
  javascript: "JavaScript", typescript: "TypeScript", "spring boot": "Spring Boot",
  pytorch: "PyTorch", tensorflow: "TensorFlow", ios: "iOS", "react native": "React Native",
};

/** How a canonical (lower-case) skill name is shown on a station label. */
export function label(skill: string, short = true): string {
  if (short && SHORT[skill]) return SHORT[skill];
  if (EXACT[skill]) return EXACT[skill];
  return skill.charAt(0).toUpperCase() + skill.slice(1);
}

export type StationKind = "reached" | "transfer" | "ahead";
export type Station = { skill: string; kind: StationKind; via?: string };

/** Stations in journey order: reached, then partial transfers, then the ones still ahead. */
export function stations(m: Pick<Match, "matched_skills" | "related_skills" | "gap_skills">): Station[] {
  return [
    ...m.matched_skills.map((skill) => ({ skill, kind: "reached" as const })),
    ...m.related_skills.map((r: Related) => ({ skill: r.skill, kind: "transfer" as const, via: r.via })),
    ...m.gap_skills.map((skill) => ({ skill, kind: "ahead" as const })),
  ];
}

/** Where "you are here" sits: after the last station that counts (reached or transfer). */
export function herePosition(list: Station[]): number {
  let i = 0;
  while (i < list.length && list[i].kind !== "ahead") i++;
  return i;
}

export const bandLabel = { strong: "Strong fit", partial: "Partial fit", reach: "A reach" } as const;

/** "3 of 5 skills", with related skills (which count half) listed separately. */
export function progressText(list: Station[]): string {
  const reached = list.filter((s) => s.kind === "reached").length;
  const transfers = list.filter((s) => s.kind === "transfer").length;
  const base = `${reached} of ${list.length} skills`;
  return transfers ? `${base} + ${transfers} related` : base;
}
