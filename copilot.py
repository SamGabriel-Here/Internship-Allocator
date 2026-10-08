"""AI copilot: read a resume, plan the skill gaps, answer follow-ups, tailor bullets.

Provider is picked from the environment — ANTHROPIC_API_KEY (Claude) if present,
else GEMINI_API_KEY (Google AI Studio free tier). With neither, the app runs fine
and every /api/copilot/* endpoint reports itself as disabled.

The recommender stays the source of truth: the model only extracts a profile and
explains results the ontology already computed. It never ranks companies itself.
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request

DEFAULT_MODELS = {"anthropic": "claude-opus-5-5"}  # gemini is discovered at runtime

EXTRACT_SYSTEM = (
    "You extract candidate profiles from resume or profile text for an internship "
    "matcher. Report only skills actually evidenced in the text. Normalise skills to "
    "short lowercase names (e.g. write 'javascript', 'machine learning'). If a GPA is "
    "on a 4-point scale, convert to a 10-point CGPA. If no CGPA is stated, use null."
)

PLAN_SYSTEM = (
    "You are an internship coach for a student. You get their skills and their top "
    "company matches, each with the skills it requires that the student lacks. Write a "
    "one-sentence summary of where they stand, then one step per missing skill, most "
    "valuable first, at most five steps. For each step say why that skill matters for "
    "that company and one concrete first thing to do this week. Plain text, no markdown. "
    "Only use the skills and companies given; never invent requirements."
)

ASK_SYSTEM = (
    "You answer a student's follow-up questions about their internship matches. The "
    "matches were computed by a skill-ontology recommender on a small synthetic dataset "
    "of 11 companies; you only explain them. Ground every answer in the data given "
    "(matched, related and missing skills, fit scores). If the data can't answer the "
    "question, say so. Two short paragraphs at most, plain text, no markdown."
)

TAILOR_SYSTEM = (
    "You help a student reword resume bullets for one target role. Use only experience "
    "evidenced in their resume text: never invent projects, numbers, employers or skills. "
    "Rewrite up to five bullets so the skills the role asks for, and that the student "
    "really has, are stated plainly. For each bullet list the role skills it now shows. "
    "Add one short note on what the resume cannot honestly claim yet. Plain text."
)

PROFILE_SCHEMA = {
    "type": "object",
    "properties": {
        "name": {"type": ["string", "null"]},
        "skills": {"type": "array", "items": {"type": "string"}},
        "cgpa": {"type": ["number", "null"]},
    },
    "required": ["name", "skills", "cgpa"],
    "additionalProperties": False,
}

PLAN_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "steps": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "skill": {"type": "string"},
                    "company": {"type": "string"},
                    "why": {"type": "string"},
                    "first_step": {"type": "string"},
                },
                "required": ["skill", "company", "why", "first_step"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["summary", "steps"],
    "additionalProperties": False,
}

TAILOR_SCHEMA = {
    "type": "object",
    "properties": {
        "bullets": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "text": {"type": "string"},
                    "shows": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["text", "shows"],
                "additionalProperties": False,
            },
        },
        "note": {"type": "string"},
    },
    "required": ["bullets", "note"],
    "additionalProperties": False,
}


class CopilotError(Exception):
    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.status = status


def provider() -> str | None:
    if os.environ.get("ANTHROPIC_API_KEY"):
        return "anthropic"
    if os.environ.get("GEMINI_API_KEY"):
        return "gemini"
    return None


def enabled() -> bool:
    return provider() is not None


def _model() -> str:
    return os.environ.get("COPILOT_MODEL", DEFAULT_MODELS[provider()])


def _matches_summary(recommendations: list[dict]) -> str:
    return "\n".join(
        f"- {r['company']}: fit {r['confidence']}%, matched {r['matched_skills'] or 'none'}, "
        f"related {[x['skill'] for x in r['related_skills']] or 'none'}, "
        f"missing {r['gap_skills'] or 'none'}"
        for r in recommendations
    )


def extract_profile(text: str) -> dict:
    """Pull a structured {name, skills, cgpa} profile out of free resume text."""
    raw = _generate_json(EXTRACT_SYSTEM, text[:20000], PROFILE_SCHEMA)
    cgpa = raw.get("cgpa")
    return {
        "name": raw.get("name") or None,
        "skills": [s for s in (raw.get("skills") or []) if isinstance(s, str)],
        "cgpa": cgpa if isinstance(cgpa, (int, float)) and 0 <= cgpa <= 10 else None,
    }


def learning_plan(skills: list[str], cgpa, recommendations: list[dict]) -> dict:
    """Summary plus one concrete step per missing skill across the top matches."""
    prompt = (
        f"Student skills: {', '.join(skills)}. CGPA: {cgpa if cgpa is not None else 'not given'}.\n\n"
        f"Top matches:\n{_matches_summary(recommendations)}"
    )
    raw = _generate_json(PLAN_SYSTEM, prompt, PLAN_SCHEMA)
    steps = [s for s in (raw.get("steps") or []) if isinstance(s, dict)][:5]
    return {"summary": str(raw.get("summary") or ""), "steps": steps}


def answer(skills: list[str], cgpa, recommendations: list[dict], question: str, history: list[dict]) -> str:
    """Answer one follow-up question, given the earlier turns of this Q&A."""
    context = (
        f"Student skills: {', '.join(skills)}. CGPA: {cgpa if cgpa is not None else 'not given'}.\n\n"
        f"All company matches, best first:\n{_matches_summary(recommendations)}"
    )
    turns = [{"role": "user", "content": context}, {"role": "assistant", "content": "Understood."}]
    turns += history + [{"role": "user", "content": question}]
    return _generate_text(ASK_SYSTEM, turns).strip()


def tailor(resume_text: str, target: str, required: list[str], have: list[str]) -> dict:
    """Reworded resume bullets that state the target's skills the student really has."""
    prompt = (
        f"Target role: {target}\nSkills the role asks for: {', '.join(required)}\n"
        f"Of those, the student has: {', '.join(have) or 'none'}\n\nResume text:\n{resume_text[:20000]}"
    )
    raw = _generate_json(TAILOR_SYSTEM, prompt, TAILOR_SCHEMA)
    bullets = [b for b in (raw.get("bullets") or []) if isinstance(b, dict) and b.get("text")][:5]
    return {"bullets": bullets, "note": str(raw.get("note") or "")}


# --- Anthropic ---------------------------------------------------------------

_anthropic_client = None


def _anthropic(system: str, messages: list[dict], schema=None) -> str:
    global _anthropic_client
    import anthropic

    if _anthropic_client is None:
        _anthropic_client = anthropic.Anthropic()
    # Opus 5.5 always thinks; low effort keeps these short tasks cheap, and max_tokens
    # leaves room for thinking plus the reply. "default" fallbacks re-run a refused
    # request on a suitable model inside the same call.
    output_config = {"effort": "low"}
    if schema:
        output_config["format"] = {"type": "json_schema", "schema": schema}
    try:
        response = _anthropic_client.beta.messages.create(
            model=_model(), max_tokens=16000, system=system, messages=messages,
            output_config=output_config,
            betas=["server-side-fallback-2026-07-01"], fallbacks="default",
        )
    except anthropic.RateLimitError:
        raise CopilotError("The AI service is rate-limited right now — try again shortly", 503)
    except anthropic.APIConnectionError:
        raise CopilotError("Couldn't reach the AI service — try again", 503)
    except anthropic.APIStatusError as exc:
        raise CopilotError(f"AI service error ({exc.status_code})", 502)
    if response.stop_reason == "refusal":
        raise CopilotError("The AI declined this request — try rephrasing", 422)
    return next((b.text for b in response.content if b.type == "text"), "")


# --- Gemini (REST, no extra dependency) --------------------------------------

def _gemini_schema(schema: dict) -> dict:
    """Translate the JSON Schema subset used above into Gemini's OpenAPI-style schema."""
    types = schema["type"] if isinstance(schema["type"], list) else [schema["type"]]
    out = {"type": next(t for t in types if t != "null").upper()}
    if "null" in types:
        out["nullable"] = True
    if "properties" in schema:
        out["properties"] = {k: _gemini_schema(v) for k, v in schema["properties"].items()}
        out["required"] = schema.get("required", [])
    if "items" in schema:
        out["items"] = _gemini_schema(schema["items"])
    return out


_gemini_model = None


def _pick_gemini_model() -> str:
    """Ask the API which models this key can use — model names churn too fast to hardcode."""
    global _gemini_model
    if os.environ.get("COPILOT_MODEL"):
        return os.environ["COPILOT_MODEL"]
    if _gemini_model:
        return _gemini_model

    req = urllib.request.Request(
        "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000",
        headers={"x-goog-api-key": os.environ["GEMINI_API_KEY"]},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            models = json.load(resp).get("models", [])
    except (urllib.error.URLError, json.JSONDecodeError):
        raise CopilotError("Couldn't reach the AI service — try again", 503)

    names = [
        m["name"].split("/")[-1]
        for m in models
        if "generateContent" in m.get("supportedGenerationMethods", [])
    ]
    if not names:
        raise CopilotError("No usable AI model is available for this API key", 502)

    if "gemini-flash-latest" in names:
        _gemini_model = "gemini-flash-latest"
    else:
        noise = ("preview", "exp", "image", "tts", "live", "audio", "embedding", "lite", "8b")
        flash = [n for n in names if "flash" in n and not any(x in n for x in noise)]
        _gemini_model = sorted(flash or names, reverse=True)[0]
    return _gemini_model


def _gemini(system: str, messages: list[dict], schema=None) -> str:
    body = {
        "system_instruction": {"parts": [{"text": system}]},
        "contents": [
            {"role": "model" if m["role"] == "assistant" else "user", "parts": [{"text": m["content"]}]}
            for m in messages
        ],
        "generationConfig": {"maxOutputTokens": 4096},
    }
    if schema:
        body["generationConfig"]["responseMimeType"] = "application/json"
        body["generationConfig"]["responseSchema"] = _gemini_schema(schema)

    req = urllib.request.Request(
        f"https://generativelanguage.googleapis.com/v1beta/models/{_pick_gemini_model()}:generateContent",
        data=json.dumps(body).encode(),
        headers={
            "Content-Type": "application/json",
            "x-goog-api-key": os.environ["GEMINI_API_KEY"],
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            payload = json.load(resp)
    except urllib.error.HTTPError as exc:
        if exc.code == 429:
            raise CopilotError("The free AI quota is exhausted for now — try again later", 503)
        raise CopilotError(f"AI service error ({exc.code})", 502)
    except urllib.error.URLError:
        raise CopilotError("Couldn't reach the AI service — try again", 503)

    try:
        return payload["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError):
        raise CopilotError("The AI service returned an unexpected response", 502)


# --- dispatch -----------------------------------------------------------------

def _call(system: str, messages: list[dict], schema=None) -> str:
    if provider() == "anthropic":
        return _anthropic(system, messages, schema)
    return _gemini(system, messages, schema)


def _generate_text(system: str, messages: list[dict]) -> str:
    return _call(system, messages)


def _generate_json(system: str, prompt: str, schema: dict) -> dict:
    raw = _call(system, [{"role": "user", "content": prompt}], schema)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        raise CopilotError("The AI service returned malformed data — try again", 502)
    if not isinstance(data, dict):
        raise CopilotError("The AI service returned malformed data — try again", 502)
    return data
