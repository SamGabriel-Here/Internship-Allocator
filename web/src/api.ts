// Typed client for the Flask JSON API. Every endpoint answers {ok, error?}.

export type Band = "strong" | "partial" | "reach";
export type Related = { skill: string; via: string };

export type Match = {
  company: string;
  confidence: number;
  coverage: number;
  band: Band;
  required_skills: string[];
  matched_skills: string[];
  related_skills: Related[];
  gap_skills: string[];
  avg_rating: number;
  location: string;
  interns: number;
};

export type Prediction = {
  recognised: string[];
  unrecognised: string[];
  cgpa: number | null;
  recommendations: Match[];
};

export type JdMatch = {
  jd_skills: string[];
  coverage: number;
  band: Band;
  matched_skills: string[];
  related_skills: Related[];
  gap_skills: string[];
};

export type Config = { copilot_enabled: boolean; copilot_provider: "anthropic" | "gemini" | null };

export type Extracted = {
  provider: string;
  name: string | null;
  recognised: string[];
  unrecognised: string[];
  cgpa: number | null;
};

export type Plan = {
  summary: string;
  steps: { skill: string; company: string; why: string; first_step: string }[];
};

export type Turn = { role: "user" | "assistant"; content: string };

export type Tailored = { target: string; bullets: { text: string; shows: string[] }[]; note: string };

export type Insights = {
  metrics: { n_samples: number; n_companies: number; top1_accuracy: number; top3_accuracy: number };
  companies: { name: string; interns: number; avg_rating: number; avg_cgpa: number; location: string; top_skills: string[] }[];
  top_skills: { skill: string; count: number }[];
};

export class ApiError extends Error {}

async function call<T>(path: string, body?: unknown): Promise<T> {
  let resp: Response;
  try {
    resp = await fetch(path, body === undefined ? undefined : {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError("Can't reach Nextern — check your connection and try again.");
  }
  let json: { ok?: boolean; error?: string } & T;
  try {
    json = await resp.json();
  } catch {
    throw new ApiError(`The server answered with an error (${resp.status}). Try again in a moment.`);
  }
  if (!json.ok) throw new ApiError(json.error || "Something went wrong — try again.");
  return json;
}

type ProfileBody = { skills: string[]; cgpa: number | null };

export const api = {
  config: () => call<Config>("/api/config"),
  skills: () => call<{ skills: string[] }>("/api/skills").then((r) => r.skills),
  insights: () => call<Insights>("/api/insights"),
  predict: (p: ProfileBody) => call<Prediction>("/api/predict", p),
  matchJd: (p: ProfileBody, jd_text: string) => call<JdMatch>("/api/match_jd", { ...p, jd_text }),
  extract: (text: string) => call<Extracted>("/api/copilot/extract", { text }),
  plan: (p: ProfileBody) => call<Plan & { provider: string }>("/api/copilot/plan", p),
  ask: (p: ProfileBody, question: string, history: Turn[]) =>
    call<{ answer: string }>("/api/copilot/ask", { ...p, question, history }),
  tailor: (p: ProfileBody, resume_text: string, target: { company?: string; jd_text?: string }) =>
    call<Tailored>("/api/copilot/tailor", { ...p, resume_text, ...target }),
};

export const providerName = (p: string | null | undefined) =>
  p === "anthropic" ? "Claude" : p === "gemini" ? "Gemini" : "the AI";
