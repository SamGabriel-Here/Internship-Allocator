"""Flask server for the internship recommender: serves the UI and the JSON API."""
import os
import time
from collections import defaultdict, deque
from functools import wraps

import joblib
from flask import Flask, jsonify, request, send_from_directory

import copilot
from recommender import build_bundle, recommend, score_company, split_skills
from skills import canonical_set, extract_skills_from_text
from train import DATA_PATH, MODEL_PATH, load_dataset

APP_DIR = os.path.dirname(__file__)
STATIC_DIR = os.path.join(APP_DIR, "static")

app = Flask(__name__, static_folder=STATIC_DIR, static_url_path="")

_bundle = None

# Simple per-IP sliding-window rate limiter. In-memory is fine: the free tier runs a
# single worker, and the goal is basic abuse protection, not distributed quotas.
_hits: dict = defaultdict(deque)

def rate_limit(max_per_minute: int):
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            ip = request.headers.get("X-Forwarded-For", request.remote_addr or "?").split(",")[0].strip()
            now = time.time()
            window = _hits[f"{fn.__name__}:{ip}"]
            while window and now - window[0] > 60:
                window.popleft()
            if len(window) >= max_per_minute:
                return jsonify({"ok": False, "error": "Rate limit exceeded — try again in a minute"}), 429
            window.append(now)
            return fn(*args, **kwargs)
        return wrapper
    return decorator


def get_bundle() -> dict:
    """Load the recommender bundle once, training it on first run if absent."""
    global _bundle
    if _bundle is None:
        if not os.path.exists(MODEL_PATH):
            _bundle = build_bundle(load_dataset())
            joblib.dump(_bundle, MODEL_PATH)
        else:
            _bundle = joblib.load(MODEL_PATH)
    return _bundle


@app.route("/")
def index():
    return send_from_directory(STATIC_DIR, "index.html")


@app.route("/health")
def health():
    return jsonify({"ok": True, "model_loaded": os.path.exists(MODEL_PATH)})


@app.route("/api/config")
def api_config():
    return jsonify({"ok": True, "copilot_enabled": copilot.enabled()})


@app.route("/api/predict", methods=["POST"])
@rate_limit(30)
def api_predict():
    data = request.get_json(force=True, silent=True)
    if not data:
        return jsonify({"ok": False, "error": "Invalid or empty JSON body"}), 400

    skills = str(data.get("Technical skills", "")).strip()
    if not skills:
        return jsonify({"ok": False, "error": "Please provide at least one technical skill"}), 400

    try:
        picks = recommend(get_bundle(), data, top_k=3)
    except Exception as exc:  # surface a clean message rather than a stack trace
        return jsonify({"ok": False, "error": str(exc)}), 500

    return jsonify(
        {
            "ok": True,
            "recommendations": [
                {
                    "company": p["company"],
                    "confidence": round(p["score"] * 100, 1),
                    "matched_skills": p["matched_skills"],
                    "related_skills": p["related_skills"],
                    "gap_skills": p["gap_skills"],
                    "avg_rating": p["meta"]["avg_rating"],
                    "location": p["meta"]["top_location"],
                }
                for p in picks
            ],
        }
    )


@app.route("/api/match_jd", methods=["POST"])
@rate_limit(30)
def api_match_jd():
    """Match a student against a pasted job description instead of the seeded companies."""
    data = request.get_json(force=True, silent=True) or {}
    jd_text = str(data.get("jd_text", "")).strip()
    student_skills = canonical_set(split_skills(data.get("Technical skills", "")))
    if not jd_text:
        return jsonify({"ok": False, "error": "Please paste a job description"}), 400
    if not student_skills:
        return jsonify({"ok": False, "error": "Please provide your skills"}), 400

    bundle = get_bundle()
    required = extract_skills_from_text(jd_text, extra_vocabulary=bundle["skill_frequency"])
    if not required:
        return jsonify({"ok": False, "error": "No recognisable skills found in that job description"}), 400

    sc = score_company(required, student_skills)
    return jsonify(
        {
            "ok": True,
            "jd_skills": required,
            "coverage": round(sc["coverage"] * 100, 1),
            "matched_skills": sc["matched"],
            "related_skills": sc["related"],
            "gap_skills": sc["gaps"],
        }
    )


@app.route("/api/copilot", methods=["POST"])
@rate_limit(10)
def api_copilot():
    """Resume text -> Claude skill extraction -> ranked matches -> coaching rationale."""
    if not copilot.enabled():
        return jsonify({"ok": False, "error": "Copilot is not configured on this server (missing API key)"}), 503

    data = request.get_json(force=True, silent=True) or {}
    text = str(data.get("text", "")).strip()
    if len(text) < 40:
        return jsonify({"ok": False, "error": "Paste a bit more text — a resume or profile paragraph"}), 400

    import anthropic

    try:
        profile = copilot.extract_profile(text)
        skills = canonical_set(profile.get("skills") or [])
        if not skills:
            return jsonify({"ok": False, "error": "Couldn't find any technical skills in that text"}), 400
        student = {"Technical skills": ", ".join(skills), "CGPA": profile.get("cgpa")}
        picks = recommend(get_bundle(), student, top_k=3)
        recommendations = [
            {
                "company": p["company"],
                "confidence": round(p["score"] * 100, 1),
                "matched_skills": p["matched_skills"],
                "related_skills": p["related_skills"],
                "gap_skills": p["gap_skills"],
                "avg_rating": p["meta"]["avg_rating"],
                "location": p["meta"]["top_location"],
            }
            for p in picks
        ]
        rationale = copilot.write_rationale(skills, profile.get("cgpa"), recommendations)
    except anthropic.RateLimitError:
        return jsonify({"ok": False, "error": "The AI service is rate-limited right now — try again shortly"}), 503
    except anthropic.APIConnectionError:
        return jsonify({"ok": False, "error": "Couldn't reach the AI service — try again"}), 503
    except anthropic.APIStatusError as exc:
        return jsonify({"ok": False, "error": f"AI service error ({exc.status_code})"}), 502

    return jsonify(
        {
            "ok": True,
            "profile": {"name": profile.get("name"), "skills": skills, "cgpa": profile.get("cgpa")},
            "recommendations": recommendations,
            "rationale": rationale,
        }
    )


@app.route("/api/insights")
def api_insights():
    bundle = get_bundle()
    companies = [
        {
            "name": name,
            "interns": meta["count"],
            "avg_rating": meta["avg_rating"],
            "avg_cgpa": meta["avg_cgpa"],
            "location": meta["top_location"],
            "top_skills": bundle["company_skills"][name][:6],
        }
        for name, meta in sorted(
            bundle["meta"].items(), key=lambda kv: kv[1]["count"], reverse=True
        )
    ]
    top_skills = [
        {"skill": s, "count": c} for s, c in bundle["skill_frequency"].most_common(10)
    ]
    return jsonify({"ok": True, "metrics": bundle["metrics"], "companies": companies, "top_skills": top_skills})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 7860))
    debug = os.environ.get("FLASK_DEBUG", "").lower() in {"1", "true", "yes"}
    app.run(host="0.0.0.0", port=port, debug=debug)
