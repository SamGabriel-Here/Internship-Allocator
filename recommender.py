"""Content-based internship recommender.

Each company is described by the skills it has historically required. A student is
scored against every company by how well they cover those required skills — an exact
(alias-aware) match counts fully, a same-family skill counts partially — nudged by how
closely the student's CGPA matches that company's past interns. Every recommendation is
therefore explainable: it ships with the skills that matched, the ones that partially
matched, and the gaps the student would need to close.
"""
from __future__ import annotations

import re
from collections import Counter, defaultdict

import numpy as np
import pandas as pd

from skills import best_match, canonical, canonical_set

# Weight given to skill coverage vs. CGPA proximity when ranking companies.
SKILL_WEIGHT = 0.85
CGPA_WEIGHT = 0.15
# A required skill with best-match below this is reported as a gap ("skill to learn").
GAP_THRESHOLD = 0.5


def split_skills(text) -> list[str]:
    """Split a free-text skills field into individual skills on commas/slashes/'and'."""
    if text is None or (isinstance(text, float) and np.isnan(text)):
        return []
    parts = re.split(r"[,/;]|\band\b", str(text).lower())
    return [p.strip() for p in parts if p.strip()]


def parse_experience(value) -> int:
    """Pull an integer month count out of values like '6 months', 3, or ''."""
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return 0
    if isinstance(value, (int, float)):
        return int(value)
    match = re.search(r"(\d+)", str(value))
    return int(match.group(1)) if match else 0


def company_requirements(df: pd.DataFrame) -> dict[str, list[str]]:
    """Canonical set of skills each company has historically required.

    A company's required-skills text is sometimes blank on a given row, so we pool
    across all of its rows to form one requirement profile per company.
    """
    pooled: dict[str, list[str]] = defaultdict(list)
    for _, r in df.iterrows():
        name = str(r["Company name"]).strip()
        pooled[name] += split_skills(r.get("Skills required by company"))
    return {name: canonical_set(pooled[name]) for name in sorted(pooled)}


def build_bundle(df: pd.DataFrame) -> dict:
    """Fit the recommender from the training dataframe and return a serialisable bundle."""
    df = df.copy()
    df["Company name"] = df["Company name"].astype(str).str.strip()
    df["CGPA"] = pd.to_numeric(df["CGPA"], errors="coerce")

    company_skills = company_requirements(df)
    companies = list(company_skills)

    meta: dict[str, dict] = {}
    for name in companies:
        sub = df[df["Company name"] == name]
        locs = Counter(sub["Company location"].astype(str))
        meta[name] = {
            "count": int(len(sub)),
            "avg_rating": round(float(pd.to_numeric(sub["Rating by company"], errors="coerce").mean()), 2),
            "avg_cgpa": round(float(sub["CGPA"].mean()), 2),
            "top_location": locs.most_common(1)[0][0] if locs else "N/A",
        }

    cgpa_series = df["CGPA"].dropna()
    bundle = {
        "companies": companies,
        "company_skills": company_skills,
        "meta": meta,
        "cgpa_mean": float(cgpa_series.mean()),
        "cgpa_std": float(cgpa_series.std() or 1.0),
        "skill_frequency": Counter(
            s for _, r in df.iterrows() for s in canonical_set(split_skills(r.get("Technical skills")))
        ),
    }
    bundle["metrics"] = _evaluate(df, bundle)
    return bundle


def score_company(required: list[str], student_skills: list[str]) -> dict:
    """Coverage of a company's required skills by the student, with the breakdown."""
    matched, related, gaps = [], [], []
    total = 0.0
    for r in required:
        score, via = best_match(r, student_skills)
        total += score
        if score >= 1.0:
            matched.append(r)
        elif score >= GAP_THRESHOLD:
            related.append({"skill": r, "via": via})
        else:
            gaps.append(r)
    coverage = total / len(required) if required else 0.0
    return {"coverage": coverage, "matched": matched, "related": related, "gaps": gaps}


def recommend(bundle: dict, student: dict, top_k: int = 3) -> list[dict]:
    """Rank companies for a student, returning score, skill breakdown and metadata."""
    student_skills = canonical_set(split_skills(student.get("Technical skills", "")))
    cgpa = _to_float(student.get("CGPA"), bundle["cgpa_mean"])

    results = []
    for name in bundle["companies"]:
        sc = score_company(bundle["company_skills"][name], student_skills)
        gap = abs(cgpa - bundle["meta"][name]["avg_cgpa"]) / (bundle["cgpa_std"] or 1.0)
        cgpa_fit = float(np.exp(-0.5 * gap * gap))
        score = SKILL_WEIGHT * sc["coverage"] + CGPA_WEIGHT * cgpa_fit
        results.append(
            {
                "company": name,
                "score": round(score, 4),
                "coverage": round(sc["coverage"], 4),
                "matched_skills": sc["matched"],
                "related_skills": sc["related"],
                "gap_skills": sc["gaps"],
                "meta": bundle["meta"][name],
            }
        )

    results.sort(key=lambda r: r["score"], reverse=True)
    return results[:top_k]


def _evaluate(df: pd.DataFrame, bundle: dict) -> dict:
    """Leave-one-out check: is a student's real company in the coverage-ranked top-3?

    Company requirements are company attributes, so for each student we rebuild them with
    that student's row removed and rank companies purely by how well the student covers
    them. An honest sanity signal on a small synthetic dataset, not a production claim.
    """
    n = len(df)
    top1 = top3 = evaluated = 0
    for held_out in df.index:
        reqs = company_requirements(df.drop(index=held_out))
        true_company = str(df.loc[held_out, "Company name"]).strip()
        if true_company not in reqs:
            continue
        student_skills = canonical_set(split_skills(df.loc[held_out, "Technical skills"]))
        ranked = sorted(
            reqs, key=lambda c: score_company(reqs[c], student_skills)["coverage"], reverse=True
        )
        rank = ranked.index(true_company)
        top1 += rank == 0
        top3 += rank < 3
        evaluated += 1
    return {
        "n_samples": int(n),
        "n_companies": len(bundle["companies"]),
        "top1_accuracy": round(top1 / evaluated, 3) if evaluated else 0.0,
        "top3_accuracy": round(top3 / evaluated, 3) if evaluated else 0.0,
    }


def _to_float(value, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default
