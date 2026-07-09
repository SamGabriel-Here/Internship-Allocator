"""Claude-powered copilot: extract a profile from resume/JD text, explain the results.

Requires ANTHROPIC_API_KEY. Everything here degrades gracefully — the app runs fine
without a key, the /api/copilot endpoint just reports itself as disabled.
"""
from __future__ import annotations

import json
import os

MODEL = os.environ.get("COPILOT_MODEL", "claude-opus-4-8")

PROFILE_SCHEMA = {
    "type": "object",
    "properties": {
        "name": {"type": ["string", "null"], "description": "Candidate's name if stated"},
        "skills": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Technical skills as short lowercase names, e.g. 'python', 'machine learning'",
        },
        "cgpa": {"type": ["number", "null"], "description": "CGPA/GPA on a 10-point scale if stated, else null"},
    },
    "required": ["name", "skills", "cgpa"],
    "additionalProperties": False,
}

_client = None


def enabled() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY"))


def _get_client():
    global _client
    if _client is None:
        import anthropic

        _client = anthropic.Anthropic()
    return _client


def extract_profile(text: str) -> dict:
    """Pull a structured candidate profile out of free resume/profile text."""
    response = _get_client().messages.create(
        model=MODEL,
        max_tokens=1024,
        system=(
            "You extract candidate profiles from resume or profile text for an internship "
            "matcher. Report only skills actually evidenced in the text. Normalise skills to "
            "short lowercase names (e.g. 'js' stays as the candidate wrote it conceptually: "
            "'javascript'). If a GPA is on a 4-point scale, convert to a 10-point CGPA."
        ),
        output_config={"format": {"type": "json_schema", "schema": PROFILE_SCHEMA}},
        messages=[{"role": "user", "content": text[:20000]}],
    )
    payload = next(b.text for b in response.content if b.type == "text")
    return json.loads(payload)


def write_rationale(skills: list[str], cgpa, recommendations: list[dict]) -> str:
    """Short personalised narrative: why the top match fits, what to learn next."""
    summary = "\n".join(
        f"- {r['company']}: confidence {r['confidence']}%, matched {r['matched_skills'] or 'none'}, "
        f"related {[x['skill'] for x in r['related_skills']] or 'none'}, gaps {r['gap_skills'] or 'none'}"
        for r in recommendations
    )
    response = _get_client().messages.create(
        model=MODEL,
        max_tokens=600,
        system=(
            "You are a friendly internship coach. Given a candidate's skills and their ranked "
            "company matches, write 2-3 short paragraphs of plain text (no markdown, no lists): "
            "why the top match fits them, and the one or two highest-impact skills to learn next "
            "and why. Be specific and encouraging, never generic."
        ),
        messages=[
            {
                "role": "user",
                "content": f"Candidate skills: {', '.join(skills)}. CGPA: {cgpa}.\n\nMatches:\n{summary}",
            }
        ],
    )
    return next(b.text for b in response.content if b.type == "text").strip()
