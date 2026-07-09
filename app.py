"""Flask server for the internship recommender: serves the UI and the JSON API."""
import os

import joblib
from flask import Flask, jsonify, request, send_from_directory

from recommender import recommend
from train import DATA_PATH, MODEL_PATH, load_dataset
from recommender import build_bundle

APP_DIR = os.path.dirname(__file__)
STATIC_DIR = os.path.join(APP_DIR, "static")

app = Flask(__name__, static_folder=STATIC_DIR, static_url_path="")

_bundle = None


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


@app.route("/api/predict", methods=["POST"])
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
                    "avg_rating": p["meta"]["avg_rating"],
                    "location": p["meta"]["top_location"],
                }
                for p in picks
            ],
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
