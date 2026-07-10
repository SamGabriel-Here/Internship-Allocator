"""AI copilot: extract a profile from resume text, explain the results.

Provider is picked from the environment — ANTHROPIC_API_KEY (Claude) if present,
else GEMINI_API_KEY (Google AI Studio free tier). With neither, the app runs fine
and the /api/copilot endpoint reports itself as disabled.
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request

DEFAULT_MODELS = {"anthropic": "claude-opus-4-8", "gemini": "gemini-2.5-flash"}

EXTRACT_SYSTEM = (
    "You extract candidate profiles from resume or profile text for an internship "
    "matcher. Report only skills actually evidenced in the text. Normalise skills to "
    "short lowercase names (e.g. write 'javascript', 'machine learning'). If a GPA is "
    "on a 4-point scale, convert to a 10-point CGPA. If no CGPA is stated, use null."
)

COACH_SYSTEM = (
    "You are a friendly internship coach. Given a candidate's skills and their ranked "
    "company matches, write 2-3 short paragraphs of plain text (no markdown, no lists): "
    "why the top match fits them, and the one or two highest-impact skills to learn next "
    "and why. Be specific and encouraging, never generic."
)


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


def extract_profile(text: str) -> dict:
    """Pull a structured {name, skills, cgpa} profile out of free resume text."""
    raw = _generate_json(EXTRACT_SYSTEM, text[:20000])
    return {
        "name": raw.get("name") or None,
        "skills": [s for s in (raw.get("skills") or []) if isinstance(s, str)],
        "cgpa": raw.get("cgpa"),
    }


def write_rationale(skills: list[str], cgpa, recommendations: list[dict]) -> str:
    """Short personalised narrative: why the top match fits, what to learn next."""
    summary = "\n".join(
        f"- {r['company']}: confidence {r['confidence']}%, matched {r['matched_skills'] or 'none'}, "
        f"related {[x['skill'] for x in r['related_skills']] or 'none'}, gaps {r['gap_skills'] or 'none'}"
        for r in recommendations
    )
    prompt = f"Candidate skills: {', '.join(skills)}. CGPA: {cgpa}.\n\nMatches:\n{summary}"
    return _generate_text(COACH_SYSTEM, prompt).strip()


# --- Anthropic ---------------------------------------------------------------

ANTHROPIC_PROFILE_SCHEMA = {
    "type": "object",
    "properties": {
        "name": {"type": ["string", "null"]},
        "skills": {"type": "array", "items": {"type": "string"}},
        "cgpa": {"type": ["number", "null"]},
    },
    "required": ["name", "skills", "cgpa"],
    "additionalProperties": False,
}

_anthropic_client = None


def _anthropic(system: str, prompt: str, schema=None) -> str:
    global _anthropic_client
    import anthropic

    if _anthropic_client is None:
        _anthropic_client = anthropic.Anthropic()
    kwargs = {}
    if schema:
        kwargs["output_config"] = {"format": {"type": "json_schema", "schema": schema}}
    try:
        response = _anthropic_client.messages.create(
            model=_model(), max_tokens=1024, system=system,
            messages=[{"role": "user", "content": prompt}], **kwargs,
        )
    except anthropic.RateLimitError:
        raise CopilotError("The AI service is rate-limited right now — try again shortly", 503)
    except anthropic.APIConnectionError:
        raise CopilotError("Couldn't reach the AI service — try again", 503)
    except anthropic.APIStatusError as exc:
        raise CopilotError(f"AI service error ({exc.status_code})", 502)
    return next(b.text for b in response.content if b.type == "text")


# --- Gemini (REST, no extra dependency) --------------------------------------

GEMINI_PROFILE_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "name": {"type": "STRING", "nullable": True},
        "skills": {"type": "ARRAY", "items": {"type": "STRING"}},
        "cgpa": {"type": "NUMBER", "nullable": True},
    },
    "required": ["skills"],
}


def _gemini(system: str, prompt: str, schema=None) -> str:
    body = {
        "system_instruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"maxOutputTokens": 2048},
    }
    if schema:
        body["generationConfig"]["responseMimeType"] = "application/json"
        body["generationConfig"]["responseSchema"] = schema

    req = urllib.request.Request(
        f"https://generativelanguage.googleapis.com/v1beta/models/{_model()}:generateContent",
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

def _generate_text(system: str, prompt: str) -> str:
    if provider() == "anthropic":
        return _anthropic(system, prompt)
    return _gemini(system, prompt)


def _generate_json(system: str, prompt: str) -> dict:
    if provider() == "anthropic":
        raw = _anthropic(system, prompt, schema=ANTHROPIC_PROFILE_SCHEMA)
    else:
        raw = _gemini(system, prompt, schema=GEMINI_PROFILE_SCHEMA)
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        raise CopilotError("The AI service returned malformed data — try again", 502)
