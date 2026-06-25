# AI-Based Internship Portal

A machine learning powered portal that recommends companies to students for internships based on their profile (age, gender, location, CGPA, technical skills, work experience, etc.).

## How it works

A `RandomForestClassifier` is trained on historical internship placement data (`internship data.csv` / `internship data.xlsx`). Categorical fields are label-encoded and technical skills are vectorized with a `CountVectorizer`. The trained model, encoders, and vectorizer are bundled together with `joblib` (`internship_company_recommender.joblib`) and served behind a Flask API that returns the top-3 recommended companies with match probabilities.

## Project structure

```
.
├── app.py                              # Flask API + static site server
├── interactive_intern_recommender.py   # Model training script
├── internship data.csv / .xlsx         # Training dataset
├── internship_company_recommender.joblib  # Trained model bundle
└── ui2/                                 # Standalone UI variant
    ├── app.py
    └── static/                          # index, results, insights, history pages
```

## Setup

```bash
pip install flask pandas scikit-learn joblib
```

Train the model (optional — a trained bundle is already included):

```bash
python interactive_intern_recommender.py
```

Run the app:

```bash
python app.py
```

The server starts on `http://localhost:7860`.

## API

`POST /api/predict`

Request body:

```json
{
  "Age": 21,
  "Gender": "Male",
  "Location": "Delhi",
  "CGPA": 8.2,
  "Technical skills": "python sql machine learning",
  "Work experience": "6",
  "Company location": "Bangalore",
  "Rating by company": 4,
  "Internship status": "NO"
}
```

Response:

```json
{
  "ok": true,
  "top3": [["CompanyA", 0.41], ["CompanyB", 0.30], ["CompanyC", 0.15]],
  "matched": { "CompanyA": ["python", "sql"] },
  "notes": "Returned top-3 companies (model probabilities)."
}
```

## Pages

- `/` — home / input form
- `/results` — recommendation results
- `/insights` — data insights
- `/history` — past predictions

## Deployment

A GitHub Actions workflow (`.github/workflows/aws.yml`) is included for deploying to Amazon ECS via ECR. Fill in the AWS region, ECR repository, ECS cluster/service, and task definition values, and configure `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` secrets to use it.
