import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from recommender import build_bundle, recommend, split_skills
from skills import canonical, canonical_set, relatedness
from train import load_dataset


@pytest.fixture(scope="module")
def bundle():
    return build_bundle(load_dataset())


def test_split_skills():
    assert split_skills("Python, ML, Data Analysis") == ["python", "ml", "data analysis"]
    assert split_skills("") == []
    assert split_skills(None) == []


def test_canonical_resolves_aliases():
    assert canonical("JS") == "javascript"
    assert canonical("ML") == "machine learning"
    assert canonical("React.js") == "react"
    assert canonical_set(["JS", "javascript", "ML"]) == ["javascript", "machine learning"]


def test_relatedness_families():
    assert relatedness("react", "react") == 1.0
    assert relatedness("react", "vue") == pytest.approx(0.5)  # same frontend family
    assert relatedness("tensorflow", "pytorch") == pytest.approx(0.5)  # same ml family
    assert relatedness("react", "python") == 0.0


def test_bundle_covers_every_company(bundle):
    assert bundle["metrics"]["n_companies"] == len(bundle["companies"]) == 11


def test_recommend_returns_three_ranked_companies(bundle):
    picks = recommend(bundle, {"Technical skills": "Python, ML, Data Analysis", "CGPA": 8.5})
    assert len(picks) == 3
    scores = [p["score"] for p in picks]
    assert scores == sorted(scores, reverse=True)
    assert all(0.0 <= p["score"] <= 1.0 for p in picks)
    assert {"matched_skills", "related_skills", "gap_skills"} <= picks[0].keys()


def test_matching_is_alias_aware(bundle):
    # A user who types the full names should still match companies that stored abbreviations.
    picks = recommend(bundle, {"Technical skills": "JavaScript, Node.js", "CGPA": 8.0})
    top = picks[0]
    assert top["matched_skills"], "expected at least one matched required skill"
    assert set(top["matched_skills"]).issubset(set(bundle["company_skills"][top["company"]]))


def test_gap_skills_are_reported(bundle):
    picks = recommend(bundle, {"Technical skills": "Excel", "CGPA": 7.0})
    assert any(p["gap_skills"] for p in picks), "expected some company to have unmet skills"


def test_loo_accuracy_is_reported(bundle):
    m = bundle["metrics"]
    assert 0.0 <= m["top1_accuracy"] <= m["top3_accuracy"] <= 1.0


def test_extract_skills_from_text():
    from skills import extract_skills_from_text

    jd = "Looking for interns with React.js, strong ML fundamentals, and C++ basics."
    found = extract_skills_from_text(jd)
    assert {"react", "machine learning", "c++"} <= set(found)
    # substrings must not false-positive: "ml" inside "html" etc.
    assert "javascript" not in extract_skills_from_text("We use html only")
