import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import app as flask_app


@pytest.fixture()
def client():
    flask_app.app.config.update(TESTING=True)
    return flask_app.app.test_client()


def test_health(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.get_json()["ok"] is True


def test_predict_returns_recommendations(client):
    resp = client.post("/api/predict", json={"Technical skills": "Python, ML", "CGPA": 8.5})
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["ok"] is True
    assert len(body["recommendations"]) == 3
    rec = body["recommendations"][0]
    assert {"confidence", "matched_skills", "related_skills", "gap_skills"} <= rec.keys()


def test_predict_rejects_empty_skills(client):
    resp = client.post("/api/predict", json={"CGPA": 8.0})
    assert resp.status_code == 400
    assert resp.get_json()["ok"] is False


def test_insights_endpoint(client):
    body = client.get("/api/insights").get_json()
    assert body["ok"] is True
    assert body["companies"] and body["top_skills"]
    assert "top3_accuracy" in body["metrics"]


def test_config_reports_copilot_flag(client):
    body = client.get("/api/config").get_json()
    assert body["ok"] is True
    assert isinstance(body["copilot_enabled"], bool)
    assert "copilot_provider" in body


def test_copilot_provider_selection(monkeypatch):
    import copilot

    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    assert copilot.provider() is None
    monkeypatch.setenv("GEMINI_API_KEY", "test")
    assert copilot.provider() == "gemini"
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    assert copilot.provider() == "anthropic"


def test_copilot_gemini_path(client, monkeypatch):
    import json as _json

    import copilot

    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setenv("GEMINI_API_KEY", "test")

    def fake_gemini(system, prompt, schema=None):
        if schema:
            return _json.dumps({"name": "Riya", "skills": ["python", "ml"], "cgpa": 8.6})
        return "You look like a great fit for Google."

    monkeypatch.setattr(copilot, "_gemini", fake_gemini)
    resp = client.post("/api/copilot", json={"text": "Riya, CGPA 8.6, knows Python and ML. " * 3})
    body = resp.get_json()
    assert resp.status_code == 200 and body["ok"] is True
    assert body["provider"] == "gemini"
    assert body["profile"]["skills"] == ["python", "machine learning"]
    assert len(body["recommendations"]) == 3
    assert "fit" in body["rationale"]


def test_match_jd_scores_coverage(client):
    jd = (
        "We are hiring a frontend intern. Requirements: strong React and JavaScript, "
        "experience with Node.js, and familiarity with SQL databases."
    )
    resp = client.post("/api/match_jd", json={"Technical skills": "react, js", "jd_text": jd})
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["ok"] is True
    assert {"react", "javascript"} <= set(body["jd_skills"])
    assert "react" in body["matched_skills"]
    assert 0 < body["coverage"] <= 100


def test_match_jd_requires_inputs(client):
    resp = client.post("/api/match_jd", json={"jd_text": "React developer needed"})
    assert resp.status_code == 400


def test_copilot_disabled_without_key(client, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    resp = client.post("/api/copilot", json={"text": "x" * 100})
    assert resp.status_code == 503
