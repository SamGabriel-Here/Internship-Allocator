import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from recommender import build_bundle, recommend, skill_tokens
from train import load_dataset


@pytest.fixture(scope="module")
def bundle():
    return build_bundle(load_dataset())


def test_skill_tokens_splits_and_normalises():
    assert skill_tokens("Python, ML, Data Analysis") == ["python", "ml", "data analysis"]
    assert skill_tokens("") == []
    assert skill_tokens(None) == []


def test_bundle_covers_every_company(bundle):
    assert bundle["metrics"]["n_companies"] == len(bundle["companies"]) == 11


def test_recommend_returns_three_ranked_companies(bundle):
    picks = recommend(bundle, {"Technical skills": "Python, ML, Data Analysis", "CGPA": 8.5})
    assert len(picks) == 3
    scores = [p["score"] for p in picks]
    assert scores == sorted(scores, reverse=True)
    assert all(0.0 <= p["score"] <= 1.0 for p in picks)


def test_matched_skills_are_real_overlaps(bundle):
    picks = recommend(bundle, {"Technical skills": "React, Node.js", "CGPA": 8.0})
    top = picks[0]
    assert top["matched_skills"], "expected at least one matched skill for a clear profile"
    assert set(top["matched_skills"]).issubset(set(bundle["company_skills"][top["company"]]))


def test_loo_accuracy_is_reported(bundle):
    m = bundle["metrics"]
    assert 0.0 <= m["top1_accuracy"] <= m["top3_accuracy"] <= 1.0
