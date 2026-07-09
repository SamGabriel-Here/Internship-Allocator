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
    assert "confidence" in body["recommendations"][0]


def test_predict_rejects_empty_skills(client):
    resp = client.post("/api/predict", json={"CGPA": 8.0})
    assert resp.status_code == 400
    assert resp.get_json()["ok"] is False


def test_insights_endpoint(client):
    body = client.get("/api/insights").get_json()
    assert body["ok"] is True
    assert body["companies"] and body["top_skills"]
    assert "top3_accuracy" in body["metrics"]
