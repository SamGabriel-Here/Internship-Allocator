# Nextern — Internship Recommender

A content-based recommender that matches students to internships. Every company is
described by the skills it has historically required; a student is scored by how well
they cover those skills, so every recommendation is explainable — it comes with the
skills that matched, the ones that partially matched, and the gaps left to close.

Three ways in:

- **By skills** — type your skills, get ranked companies with a skill-gap breakdown.
- **Job description** — paste any posting; the ontology extracts its requirements and
  scores your coverage (works for roles outside the seeded companies, no LLM needed).
- **AI copilot** *(optional)* — paste your resume; Claude extracts your profile, the
  recommender ranks it, and Claude writes a personalised coaching narrative. Enabled by
  setting `ANTHROPIC_API_KEY` (model configurable via `COPILOT_MODEL`, default
  `claude-opus-4-8`); without a key the app runs fully with the first two modes.

## How it works

1. **Skill ontology.** Every skill is normalised through an alias map (`JS` → JavaScript,
   `ML` → machine learning, `React.js` → React) and grouped into families (`skills.py`).
   This makes matching robust to how a user actually phrases things and lets related
   skills count partially — a React/Node profile gets partial credit toward a company
   that wants Vue.
2. **Coverage scoring.** For each company, every required skill is matched to the
   student's closest skill: an exact/alias match counts fully, a same-family skill counts
   partially. The company's score is the average coverage, nudged slightly (15%) by how
   close the student's CGPA is to that company's past interns.
3. **Explanation & gaps.** Each recommendation returns three buckets — **matched**,
   **related** (with the family link, e.g. `power bi ↔ excel`), and **skills to learn**
   (required skills the student is missing) — turning the result into actionable coaching.

The artifacts (per-company requirement sets, metadata, evaluation metrics) are bundled
with `joblib`.

> **Why not embeddings?** Static word embeddings were tried and rejected: on short tech
> jargon they scored `react`↔`vue` ≈ 0.05 and `ML`↔`machine learning` ≈ 0.29 — worse than
> the ontology. A real transformer model would work but won't fit the 512 MB free tier.
> True semantic understanding is planned via an LLM-powered path instead.

### On accuracy

The dataset is small and synthetic — 51 students across 11 companies. A genuine
leave-one-out evaluation (each student removed from the company requirements before
scoring them) gives **~82% top-1** and **~100% top-3** accuracy. Treat these as a sanity
signal that skill coverage is a sensible ranking, not a production benchmark.

## Project structure

```
.
├── app.py             # Flask server: static UI + JSON API
├── recommender.py     # Scoring engine (coverage, rank, explain, evaluate)
├── skills.py          # Skill ontology: alias resolution + related-skill families
├── train.py           # Builds and saves the model bundle from the dataset
├── internship_data.csv
├── static/            # index / results / insights / history pages
├── tests/             # pytest suite for the recommender and the API
├── Dockerfile
└── .github/workflows/ # ci.yml (tests) + aws.yml (optional ECS deploy)
```

## Setup

```bash
pip install -r requirements.txt
```

Build the model bundle (the app also builds it automatically on first run if missing):

```bash
python train.py
```

Run the app:

```bash
python app.py            # http://localhost:7860
```

Set `PORT` to change the port and `FLASK_DEBUG=1` to enable the reloader.

## API

`POST /api/predict`

```json
{ "Technical skills": "python, ml, data analysis", "CGPA": 8.5 }
```

```json
{
  "ok": true,
  "recommendations": [
    {
      "company": "Google",
      "confidence": 82.9,
      "matched_skills": ["machine learning", "python"],
      "related_skills": [{ "skill": "natural language processing", "via": "machine learning" }],
      "gap_skills": ["artificial intelligence"],
      "avg_rating": 4.0,
      "location": "Bangalore"
    }
  ]
}
```

`POST /api/match_jd` — `{"Technical skills", "jd_text"}` → coverage % against a pasted
job description with the matched/related/gap breakdown.
`POST /api/copilot` — `{"text"}` → extracted profile, ranked matches, and an AI coaching
narrative (503 when no API key is configured).
`GET /api/config` — feature flags (whether the copilot is enabled).
`GET /api/insights` — live dataset/model figures (metrics, per-company stats, top skills).
`GET /health` — liveness check.

Prediction endpoints are rate-limited per IP (30/min; copilot 10/min). A model card and
full API reference live at `/about.html`.

## Pages

- `/` — enter a student's skills and CGPA
- `/results.html` — top-3 matches with confidence and matched skills
- `/insights.html` — dataset and model insights, served from `/api/insights`
- `/history.html` — past recommendations (stored in the browser)

## Tests

```bash
pip install pytest && pytest -q
```

## Docker

```bash
docker build -t nextern .
docker run -p 7860:7860 nextern
```

## Deployment

`.github/workflows/aws.yml` is an optional template for deploying the container to
Amazon ECS via ECR. It is **manual-only** (`workflow_dispatch`): fill in the region,
repository, cluster/service, and task-definition values and add the
`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` secrets before running it.
