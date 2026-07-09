# Nextern — Internship Recommender

A content-based recommender that matches students to internships. Every company is
described by the skills it has historically required; a student is scored against each
company by how much their skill sets overlap, so every recommendation is explainable —
it comes with the exact skills that matched.

## How it works

1. **Company profiles.** For each company, all skills it has required (and that its past
   interns had) are pooled into one profile and vectorised with TF-IDF over
   comma-delimited skills, so multi-word skills like `data science` stay intact.
2. **Scoring.** A student's skills are vectorised in the same space. The match score is
   the cosine similarity between the student and each company, nudged slightly (15%) by
   how close the student's CGPA is to that company's past interns.
3. **Explanation.** Alongside the score, the API returns the skills that actually
   overlapped, the company's typical location, and its average intern rating.

The trained artifacts (vectorizer, company matrix, per-company metadata, evaluation
metrics) are bundled together with `joblib`.

### On accuracy

The dataset is small and synthetic — 51 students across 11 companies. A genuine
leave-one-out evaluation (each student removed from the company profiles before scoring
them) gives **~86% top-1** and **~96% top-3** accuracy. Treat these as a sanity signal
that skill overlap is a sensible ranking, not a production benchmark.

## Project structure

```
.
├── app.py             # Flask server: static UI + JSON API
├── recommender.py     # Scoring engine (vectorise, rank, explain, evaluate)
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
    { "company": "Google", "confidence": 63.0, "matched_skills": ["python", "ml"],
      "avg_rating": 4.0, "location": "Bangalore" }
  ]
}
```

`GET /api/insights` — live dataset/model figures (metrics, per-company stats, top skills).
`GET /health` — liveness check.

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
