"""Content-based internship recommender.

Each company is described by the skills it has historically required. A student is
scored against every company by the cosine similarity of their skill sets, nudged by
how closely the student's CGPA matches that company's past interns. Recommendations
are therefore explainable: every score comes with the exact skills that overlapped.
"""
from __future__ import annotations

import re
from collections import Counter, defaultdict

import numpy as np
import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

# Weight given to skill overlap vs. CGPA proximity when ranking companies.
SKILL_WEIGHT = 0.85
CGPA_WEIGHT = 0.15


def skill_tokens(text) -> list[str]:
    """Split a free-text skills field into normalised, comma-delimited skills.

    Kept as a module-level function (not a lambda) so the fitted vectorizer stays
    picklable. Multi-word skills like "spring boot" or "data science" are preserved.
    """
    if text is None or (isinstance(text, float) and np.isnan(text)):
        return []
    parts = re.split(r"[,/;]|\band\b", str(text).lower())
    return [re.sub(r"\s+", " ", p).strip() for p in parts if p.strip()]


def parse_experience(value) -> int:
    """Pull an integer month count out of values like '6 months', 3, or ''."""
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return 0
    if isinstance(value, (int, float)):
        return int(value)
    match = re.search(r"(\d+)", str(value))
    return int(match.group(1)) if match else 0


def company_documents(df: pd.DataFrame) -> tuple[list[str], dict[str, list[str]]]:
    """Aggregate every skill each company has asked for (and that its interns had).

    A company's required-skills text is sometimes blank on a given row, so we pool
    across all of its rows to form one skill profile per company.
    """
    docs: dict[str, list[str]] = defaultdict(list)
    for _, r in df.iterrows():
        name = str(r["Company name"]).strip()
        docs[name] += skill_tokens(r.get("Skills required by company"))
        docs[name] += skill_tokens(r.get("Technical skills"))
    return sorted(docs), docs


def build_bundle(df: pd.DataFrame) -> dict:
    """Fit the recommender from the training dataframe and return a serialisable bundle."""
    df = df.copy()
    df["Company name"] = df["Company name"].astype(str).str.strip()
    df["CGPA"] = pd.to_numeric(df["CGPA"], errors="coerce")

    companies, company_docs = company_documents(df)
    company_skills = {name: sorted(set(company_docs[name])) for name in companies}

    docs = [", ".join(company_docs[name]) for name in companies]
    vectorizer = TfidfVectorizer(analyzer=skill_tokens)
    matrix = vectorizer.fit_transform(docs)

    # Per-company metadata used for both ranking (CGPA fit) and the insights page.
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
        "vectorizer": vectorizer,
        "matrix": matrix,
        "companies": companies,
        "company_skills": company_skills,
        "meta": meta,
        "cgpa_mean": float(cgpa_series.mean()),
        "cgpa_std": float(cgpa_series.std() or 1.0),
        "skill_frequency": Counter(
            s for _, r in df.iterrows() for s in skill_tokens(r.get("Technical skills"))
        ),
    }
    bundle["metrics"] = _evaluate(df, bundle)
    return bundle


def recommend(bundle: dict, student: dict, top_k: int = 3) -> list[dict]:
    """Rank companies for a student, returning score, matched skills and metadata."""
    student_skills = skill_tokens(student.get("Technical skills", ""))
    student_vec = bundle["vectorizer"].transform([", ".join(student_skills)])
    skill_sim = cosine_similarity(student_vec, bundle["matrix"])[0]

    cgpa = _to_float(student.get("CGPA"), bundle["cgpa_mean"])
    results = []
    for i, name in enumerate(bundle["companies"]):
        # Closeness of the student's CGPA to this company's historical intern average,
        # squashed to 0..1 so it only ever nudges the skill-driven score.
        gap = abs(cgpa - bundle["meta"][name]["avg_cgpa"]) / (bundle["cgpa_std"] or 1.0)
        cgpa_fit = float(np.exp(-0.5 * gap * gap))
        score = SKILL_WEIGHT * float(skill_sim[i]) + CGPA_WEIGHT * cgpa_fit
        matched = [s for s in student_skills if s in set(bundle["company_skills"][name])]
        results.append(
            {
                "company": name,
                "score": round(score, 4),
                "skill_similarity": round(float(skill_sim[i]), 4),
                "matched_skills": matched,
                "meta": bundle["meta"][name],
            }
        )

    results.sort(key=lambda r: r["score"], reverse=True)
    return results[:top_k]


def _evaluate(df: pd.DataFrame, bundle: dict) -> dict:
    """True leave-one-out check: is a student's real company in the skill-ranked top-3?

    For each student we rebuild the company profiles with that student removed, so their
    own skills never leak into the company they are being scored against. It is an honest
    sanity signal on a small synthetic dataset, not a claim of production accuracy.
    """
    n = len(df)
    top1 = top3 = evaluated = 0
    for held_out in df.index:
        train = df.drop(index=held_out)
        companies, docs = company_documents(train)
        idx = {c: i for i, c in enumerate(companies)}
        true_i = idx.get(str(df.loc[held_out, "Company name"]).strip())
        if true_i is None:  # company only ever seen via the held-out row
            continue
        vectorizer = TfidfVectorizer(analyzer=skill_tokens)
        matrix = vectorizer.fit_transform([", ".join(docs[c]) for c in companies])
        vec = vectorizer.transform([", ".join(skill_tokens(df.loc[held_out, "Technical skills"]))])
        order = list(np.argsort(cosine_similarity(vec, matrix)[0])[::-1])
        rank = order.index(true_i)
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
