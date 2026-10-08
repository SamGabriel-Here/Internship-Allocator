"""Flask server for the internship recommender: serves the UI and the JSON API."""
import os
import time
from collections import defaultdict, deque
from functools import wraps

import joblib
from flask import Flask, jsonify, redirect, request, send_from_directory

import copilot
from recommender import build_bundle, recommend, score_company, split_skills
from skills import canonical_set, extract_skills_from_text, vocabulary
from train import DATA_PATH, MODEL_PATH, load_dataset

APP_DIR = os.path.dirname(__file__)
# The React app (web/) builds into static/; Flask serves it and falls back to
# index.html for client-side routes.
STATIC_DIR = os.path.join(APP_DIR, "static")

app = Flask(__name__, static_folder=None)

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


def known_skills() -> set[str]:
    """Every skill the recommender can reason about: the ontology plus the dataset."""
    bundle = get_bundle()
    company = {s for skills in bundle["company_skills"].values() for s in skills}
    return vocabulary(bundle["skill_frequency"]) | company


def fit_band(coverage: float) -> str:
    """A coarse, honest label for skill coverage; the dataset can't support decimals."""
    if coverage >= 0.7:
        return "strong"
    if coverage >= 0.4:
        return "partial"
    return "reach"


def read_profile(data: dict) -> tuple[list[str], list[str], object]:
    """(recognised, unrecognised, cgpa) from a request body's skills and CGPA."""
    raw = data.get("Technical skills") or data.get("skills") or ""
    if isinstance(raw, list):
        raw = ", ".join(str(s) for s in raw)
    skills = canonical_set(split_skills(raw))
    known = known_skills()
    cgpa = data.get("CGPA") if data.get("CGPA") is not None else data.get("cgpa")
    try:
        cgpa = float(cgpa) if cgpa not in (None, "") else None
    except (TypeError, ValueError):
        cgpa = None
    if cgpa is not None and not 0 <= cgpa <= 10:
        cgpa = None
    return [s for s in skills if s in known], [s for s in skills if s not in known], cgpa


def rank(recognised: list[str], cgpa, top_k=None) -> list[dict]:
    """Every company ranked for the profile, shaped for the API."""
    if not recognised:
        return []
    bundle = get_bundle()
    student = {"Technical skills": ", ".join(recognised), "CGPA": cgpa}
    return [
        {
            "company": p["company"],
            "confidence": round(p["score"] * 100),
            "coverage": round(p["coverage"] * 100),
            "band": fit_band(p["coverage"]),
            "required_skills": bundle["company_skills"][p["company"]],
            "matched_skills": p["matched_skills"],
            "related_skills": p["related_skills"],
            "gap_skills": p["gap_skills"],
            "avg_rating": p["meta"]["avg_rating"],
            "location": p["meta"]["top_location"],
            "interns": p["meta"]["count"],
        }
        for p in recommend(bundle, student, top_k=top_k or len(bundle["companies"]))
    ]


def body() -> dict:
    data = request.get_json(force=True, silent=True)
    return data if isinstance(data, dict) else {}


def copilot_guard():
    if not copilot.enabled():
        return jsonify({"ok": False, "error": "The AI copilot isn't set up on this server (no API key)"}), 503
    return None


@app.route("/health")
def health():
    return jsonify({"ok": True, "model_loaded": os.path.exists(MODEL_PATH)})


@app.route("/api/config")
def api_config():
    return jsonify({"ok": True, "copilot_enabled": copilot.enabled(), "copilot_provider": copilot.provider()})


@app.route("/api/skills")
def api_skills():
    """Known skills, most common first, for autocomplete."""
    freq = get_bundle()["skill_frequency"]
    return jsonify({"ok": True, "skills": sorted(known_skills(), key=lambda s: (-freq.get(s, 0), s))})


@app.route("/api/predict", methods=["POST"])
@rate_limit(60)
def api_predict():
    data = body()
    raw = data.get("Technical skills") or data.get("skills")
    if not raw or not str(raw).strip():
        return jsonify({"ok": False, "error": "Add at least one skill"}), 400

    recognised, unrecognised, cgpa = read_profile(data)
    try:
        ranked = rank(recognised, cgpa)
    except Exception as exc:  # surface a clean message rather than a stack trace
        return jsonify({"ok": False, "error": str(exc)}), 500

    return jsonify(
        {
            "ok": True,
            "recognised": recognised,
            "unrecognised": unrecognised,
            "cgpa": cgpa,
            "recommendations": ranked,
        }
    )


@app.route("/api/match_jd", methods=["POST"])
@rate_limit(30)
def api_match_jd():
    """Match a student against a pasted job description instead of the seeded companies."""
    data = body()
    jd_text = str(data.get("jd_text", "")).strip()
    recognised, _, _ = read_profile(data)
    if not jd_text:
        return jsonify({"ok": False, "error": "Paste a job description"}), 400
    if not recognised:
        return jsonify({"ok": False, "error": "Add skills to your profile first"}), 400

    bundle = get_bundle()
    required = extract_skills_from_text(jd_text, extra_vocabulary=bundle["skill_frequency"])
    if not required:
        return jsonify({"ok": False, "error": "No skills we recognise in that posting — paste the requirements section"}), 400

    sc = score_company(required, recognised)
    return jsonify(
        {
            "ok": True,
            "jd_skills": required,
            "coverage": round(sc["coverage"] * 100),
            "band": fit_band(sc["coverage"]),
            "matched_skills": sc["matched"],
            "related_skills": sc["related"],
            "gap_skills": sc["gaps"],
        }
    )


@app.route("/api/copilot/extract", methods=["POST"])
@rate_limit(10)
def api_copilot_extract():
    """Resume text -> a profile for the student to review before anything is ranked."""
    if (blocked := copilot_guard()):
        return blocked
    text = str(body().get("text", "")).strip()
    if len(text) < 40:
        return jsonify({"ok": False, "error": "Paste a bit more — a resume or a paragraph about your experience"}), 400
    try:
        profile = copilot.extract_profile(text)
    except copilot.CopilotError as exc:
        return jsonify({"ok": False, "error": str(exc)}), exc.status
    recognised, unrecognised, cgpa = read_profile({"skills": profile["skills"], "cgpa": profile["cgpa"]})
    return jsonify(
        {
            "ok": True,
            "provider": copilot.provider(),
            "name": profile["name"],
            "recognised": recognised,
            "unrecognised": unrecognised,
            "cgpa": cgpa,
        }
    )


@app.route("/api/copilot/plan", methods=["POST"])
@rate_limit(10)
def api_copilot_plan():
    """A learning plan for the gap skills of the top three matches."""
    if (blocked := copilot_guard()):
        return blocked
    recognised, _, cgpa = read_profile(body())
    if not recognised:
        return jsonify({"ok": False, "error": "Add skills to your profile first"}), 400
    top = rank(recognised, cgpa, top_k=3)
    try:
        plan = copilot.learning_plan(recognised, cgpa, top)
    except copilot.CopilotError as exc:
        return jsonify({"ok": False, "error": str(exc)}), exc.status
    return jsonify({"ok": True, "provider": copilot.provider(), **plan})


@app.route("/api/copilot/ask", methods=["POST"])
@rate_limit(20)
def api_copilot_ask():
    """One follow-up question about the results, with up to six earlier turns."""
    if (blocked := copilot_guard()):
        return blocked
    data = body()
    recognised, _, cgpa = read_profile(data)
    question = str(data.get("question", "")).strip()[:500]
    if not recognised:
        return jsonify({"ok": False, "error": "Add skills to your profile first"}), 400
    if not question:
        return jsonify({"ok": False, "error": "Type a question"}), 400
    history = [
        {"role": t["role"], "content": str(t["content"])[:2000]}
        for t in (data.get("history") or [])[-6:]
        if isinstance(t, dict) and t.get("role") in ("user", "assistant") and t.get("content")
    ]
    try:
        reply = copilot.answer(recognised, cgpa, rank(recognised, cgpa), question, history)
    except copilot.CopilotError as exc:
        return jsonify({"ok": False, "error": str(exc)}), exc.status
    return jsonify({"ok": True, "provider": copilot.provider(), "answer": reply})


@app.route("/api/copilot/tailor", methods=["POST"])
@rate_limit(10)
def api_copilot_tailor():
    """Resume bullets reworded for one company from the dataset or a pasted posting."""
    if (blocked := copilot_guard()):
        return blocked
    data = body()
    recognised, _, _ = read_profile(data)
    resume = str(data.get("resume_text", "")).strip()
    company = str(data.get("company", "")).strip()
    jd_text = str(data.get("jd_text", "")).strip()
    if len(resume) < 40:
        return jsonify({"ok": False, "error": "Paste your resume text to tailor it"}), 400

    bundle = get_bundle()
    if company in bundle["company_skills"]:
        target, required = company, bundle["company_skills"][company]
    elif jd_text:
        target = "the pasted job posting"
        required = extract_skills_from_text(jd_text, extra_vocabulary=bundle["skill_frequency"])
    else:
        return jsonify({"ok": False, "error": "Pick a company or paste a posting"}), 400
    if not required:
        return jsonify({"ok": False, "error": "No skills we recognise in that posting"}), 400

    have = score_company(required, recognised)["matched"]
    try:
        result = copilot.tailor(resume, target, required, have)
    except copilot.CopilotError as exc:
        return jsonify({"ok": False, "error": str(exc)}), exc.status
    return jsonify({"ok": True, "provider": copilot.provider(), "target": target, **result})


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


@app.route("/api/<path:_>")
def api_not_found(_):
    return jsonify({"ok": False, "error": "Unknown endpoint"}), 404


# Pages of the previous multi-page UI, so old links still land somewhere sensible.
LEGACY_PAGES = {"index.html": "/", "results.html": "/map", "insights.html": "/insights",
                "history.html": "/history", "about.html": "/about"}


@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def spa(path):
    """Built assets by path; every other route is a client-side page."""
    if path in LEGACY_PAGES:
        return redirect(LEGACY_PAGES[path], 301)
    if path and os.path.isfile(os.path.join(STATIC_DIR, path)):
        return send_from_directory(STATIC_DIR, path)
    if not os.path.isfile(os.path.join(STATIC_DIR, "index.html")):
        return "Frontend not built — run `npm ci && npm run build` in web/", 503
    return send_from_directory(STATIC_DIR, "index.html")


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 7860))
    debug = os.environ.get("FLASK_DEBUG", "").lower() in {"1", "true", "yes"}
    app.run(host="0.0.0.0", port=port, debug=debug)
