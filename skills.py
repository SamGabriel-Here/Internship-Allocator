"""A small skill ontology: alias resolution + related-skill soft matching.

Tech skills are written every which way — "JS" / "JavaScript", "ML" / "machine
learning", "React.js" / "React". Static word embeddings turned out to be useless on
these short jargon tokens (react~vue scored ~0.05), so instead we normalise every skill
to a canonical form and give partial credit to skills that live in the same family
(React ↔ Vue, TensorFlow ↔ PyTorch). This is deterministic and fully explainable, which
is exactly what the skill-gap feature needs.
"""
from __future__ import annotations

import re

# Weight given to two distinct skills that share a family (vs. 1.0 for an exact match).
RELATED_WEIGHT = 0.5

# Variant / abbreviation -> canonical skill name.
ALIASES = {
    "js": "javascript",
    "reactjs": "react",
    "react.js": "react",
    "node": "node.js",
    "nodejs": "node.js",
    "ml": "machine learning",
    "ai": "artificial intelligence",
    "dl": "deep learning",
    "nlp": "natural language processing",
    "dsa": "data structures and algorithms",
    "oop": "object oriented programming",
    "oops": "object oriented programming",
    "cpp": "c++",
    "postgres": "postgresql",
    "postgresql": "postgresql",
    "power bi": "power bi",
    "powerbi": "power bi",
    "ds": "data science",
    "problem solving": "problem solving",
}

# Skill families. Two different skills in the same family are treated as related.
SKILL_GROUPS = [
    {"html", "css", "javascript", "typescript", "react", "vue", "angular", "node.js"},
    {"machine learning", "deep learning", "artificial intelligence",
     "natural language processing", "data science", "tensorflow", "pytorch",
     "keras", "computer vision"},
    {"sql", "mysql", "postgresql", "excel", "tableau", "power bi", "data analysis",
     "data science"},
    {"java", "spring boot", "object oriented programming"},
    {"python", "django", "flask"},
    {"android", "kotlin", "flutter", "firebase", "swift", "react native"},
    {"docker", "kubernetes", "aws", "azure", "ci/cd"},
    {"cybersecurity", "networking", "security"},
    {"c++", "data structures and algorithms", "problem solving"},
]


def canonical(skill: str) -> str:
    """Lower-case, de-punctuate, and map a skill to its canonical name."""
    s = re.sub(r"\s+", " ", str(skill).strip().lower())
    s = s.rstrip(".")
    return ALIASES.get(s, s)


def canonical_set(skills) -> list[str]:
    """Canonicalise a list of skills, dropping blanks and duplicates (order kept)."""
    seen, out = set(), []
    for s in skills:
        c = canonical(s)
        if c and c not in seen:
            seen.add(c)
            out.append(c)
    return out


def relatedness(a: str, b: str) -> float:
    """1.0 for the same canonical skill, RELATED_WEIGHT for same-family, else 0.0."""
    if a == b:
        return 1.0
    for group in SKILL_GROUPS:
        if a in group and b in group:
            return RELATED_WEIGHT
    return 0.0


def best_match(required: str, student_skills: list[str]) -> tuple[float, str | None]:
    """Best relatedness of one required skill to any of the student's skills."""
    best_score, best_skill = 0.0, None
    for s in student_skills:
        r = relatedness(required, s)
        if r > best_score:
            best_score, best_skill = r, s
    return best_score, best_skill


def vocabulary(extra=()) -> set[str]:
    """Every skill name the ontology knows about, plus any extra terms supplied."""
    vocab = set(ALIASES) | set(ALIASES.values())
    for group in SKILL_GROUPS:
        vocab |= group
    vocab |= {canonical(s) for s in extra}
    return vocab

def extract_skills_from_text(text: str, extra_vocabulary=()) -> list[str]:
    """Scan free text (a job description, a resume) for known skills.

    Longer terms are matched first so "machine learning" wins over "machine", and
    matches are canonicalised, so "React.js" in a JD comes back as "react".
    """
    found = []
    lowered = " " + re.sub(r"\s+", " ", str(text).lower()) + " "
    for term in sorted(vocabulary(extra_vocabulary), key=len, reverse=True):
        if re.search(rf"(?<![a-z0-9+#]){re.escape(term)}(?![a-z0-9+#])", lowered):
            found.append(term)
    return canonical_set(found)
