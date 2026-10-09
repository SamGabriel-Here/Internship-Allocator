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
    resp = client.post("/api/predict", json={"Technical skills": "Python, ML, Klingon", "CGPA": 8.5})
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["ok"] is True
    assert body["recognised"] == ["python", "machine learning"]
    assert body["unrecognised"] == ["klingon"]
    recs = body["recommendations"]
    assert len(recs) == 11  # every company, best first
    assert [r["confidence"] for r in recs] == sorted((r["confidence"] for r in recs), reverse=True)
    rec = recs[0]
    assert {"confidence", "band", "required_skills", "matched_skills", "related_skills", "gap_skills"} <= rec.keys()
    assert rec["band"] in {"strong", "partial", "reach"}


def test_predict_ranks_nothing_when_no_skill_is_recognised(client):
    body = client.post("/api/predict", json={"Technical skills": "asdfgh, qwerty"}).get_json()
    assert body["ok"] is True
    assert body["recognised"] == [] and body["unrecognised"] == ["asdfgh", "qwerty"]
    assert body["recommendations"] == []


def test_skills_endpoint_lists_known_skills(client):
    skills = client.get("/api/skills").get_json()["skills"]
    assert "python" in skills and "react" in skills


def test_spa_routes_fall_back_to_index(client):
    resp = client.get("/results")
    assert resp.status_code in (200, 503)  # 503 only when the frontend isn't built
    assert client.get("/api/nope").status_code == 404
    old = client.get("/results.html")
    assert old.status_code == 301 and old.headers["Location"].endswith("/")


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


@pytest.fixture()
def fake_gemini(monkeypatch):
    import json as _json

    import copilot

    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setenv("GEMINI_API_KEY", "test")
    calls = []

    def fake(system, messages, schema=None):
        calls.append({"system": system, "messages": messages, "schema": schema})
        if schema and "cgpa" in schema["properties"]:
            return _json.dumps({"name": "Riya", "skills": ["python", "ml", "underwater basket weaving"], "cgpa": 8.6})
        if schema and "steps" in schema["properties"]:
            return _json.dumps({"summary": "Close to Google.", "steps": [
                {"skill": "sql", "company": "Google", "why": "Data work.", "first_step": "Do 10 SQL problems."}]})
        if schema and "bullets" in schema["properties"]:
            return _json.dumps({"bullets": [{"text": "Built a Python ML model.", "shows": ["python"]}], "note": "No SQL yet."})
        return "Google fits because you match Python."

    monkeypatch.setattr(copilot, "_gemini", fake)
    return calls


def test_copilot_extract_returns_a_profile_to_review(client, fake_gemini):
    body = client.post("/api/copilot/extract", json={"text": "Riya, CGPA 8.6, knows Python and ML. " * 3}).get_json()
    assert body["ok"] is True and body["provider"] == "gemini"
    assert body["recognised"] == ["python", "machine learning"]
    assert body["unrecognised"] == ["underwater basket weaving"]
    assert body["cgpa"] == 8.6 and body["name"] == "Riya"


def test_copilot_plan_ask_and_tailor(client, fake_gemini):
    profile = {"skills": ["python", "ml"], "cgpa": 8.6}
    plan = client.post("/api/copilot/plan", json=profile).get_json()
    assert plan["ok"] is True and plan["steps"][0]["skill"] == "sql"

    ask = client.post("/api/copilot/ask", json={**profile, "question": "Why Google?",
                                                 "history": [{"role": "user", "content": "hi"},
                                                             {"role": "bogus", "content": "x"}]}).get_json()
    assert ask["ok"] is True and "Google" in ask["answer"]
    sent = fake_gemini[-1]["messages"]
    assert sent[-1] == {"role": "user", "content": "Why Google?"}
    assert all(m["role"] in ("user", "assistant") for m in sent)

    tailor = client.post("/api/copilot/tailor", json={**profile, "company": "Google",
                                                       "resume_text": "Built ML models in Python at uni. " * 3}).get_json()
    assert tailor["ok"] is True and tailor["target"] == "Google"
    assert tailor["bullets"][0]["shows"] == ["python"]


def test_gemini_schema_translation():
    import copilot

    out = copilot._gemini_schema(copilot.PROFILE_SCHEMA)
    assert out["type"] == "OBJECT"
    assert out["properties"]["name"] == {"type": "STRING", "nullable": True}
    assert out["properties"]["skills"]["items"] == {"type": "STRING"}


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


def test_copilot_endpoints_disabled_without_key(client, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    for path in ("extract", "plan", "ask", "tailor"):
        assert client.post(f"/api/copilot/{path}", json={"text": "x" * 100}).status_code == 503
