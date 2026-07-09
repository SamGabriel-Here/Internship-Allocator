"""Build the internship recommender bundle from the dataset and report a quick eval."""
import os

import joblib
import pandas as pd

from recommender import build_bundle, recommend

DATA_PATH = os.path.join(os.path.dirname(__file__), "internship_data.csv")
MODEL_PATH = os.path.join(os.path.dirname(__file__), "internship_company_recommender.joblib")

REQUIRED_COLUMNS = [
    "Student name", "Age", "Gender", "Location", "CGPA", "Technical skills",
    "Work experience", "Company name", "Company location",
    "Skills required by company", "Internship status", "Rating by company",
]


def load_dataset(path: str = DATA_PATH) -> pd.DataFrame:
    if not os.path.exists(path):
        raise FileNotFoundError(f"Dataset not found at {path}")
    df = pd.read_csv(path)
    missing = [c for c in REQUIRED_COLUMNS if c not in df.columns]
    if missing:
        raise ValueError(f"Dataset is missing columns: {missing}")
    return df


def main() -> None:
    df = load_dataset()
    bundle = build_bundle(df)
    joblib.dump(bundle, MODEL_PATH)

    m = bundle["metrics"]
    print(f"Saved bundle -> {MODEL_PATH}")
    print(f"Trained on {m['n_samples']} students across {m['n_companies']} companies")
    print(f"Leave-one-out top-1 accuracy: {m['top1_accuracy'] * 100:.1f}%")
    print(f"Leave-one-out top-3 accuracy: {m['top3_accuracy'] * 100:.1f}%")

    print("\nSample recommendations:")
    for _, row in df.head(3).iterrows():
        student = {"Technical skills": row["Technical skills"], "CGPA": row["CGPA"]}
        picks = recommend(bundle, student)
        names = ", ".join(f"{p['company']} ({p['score'] * 100:.0f}%)" for p in picks)
        print(f"  {row['Student name']:<16} [{row['Technical skills']}] -> {names}")


if __name__ == "__main__":
    main()
