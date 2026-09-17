"""Offline pairwise learning-to-rank. No Python/model API is needed at serving time."""
import hashlib
import json
import math
from pathlib import Path
import subprocess

import numpy as np
from sklearn.linear_model import LogisticRegression

ROOT = Path(__file__).resolve().parents[1]
data = json.loads(subprocess.check_output(["node", "scripts/search-features.mjs"], cwd=ROOT))
groups = {split: {q["group"] for q in data["queries"] if q["split"] == split} for split in ("train", "test")}
assert groups["train"].isdisjoint(groups["test"]), "Query intent groups must not cross the holdout boundary"
x, y = [], []
for query in data["queries"]:
    if query["split"] != "train":
        continue
    for better in query["candidates"]:
        for worse in query["candidates"]:
            if better["grade"] <= worse["grade"]:
                continue
            diff = np.array(better["features"]) - np.array(worse["features"])
            x.extend([diff.tolist(), (-diff).tolist()])
            y.extend([1, 0])
if not x:
    raise RuntimeError("No judged candidate pairs; training cannot proceed")
model = LogisticRegression(C=1.0, fit_intercept=False, max_iter=1000, random_state=42).fit(x, y)
weights = model.coef_[0].tolist()
digest = hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()[:12]
artifact = {"schemaVersion": 1, "version": f"pairwise-lr-{digest}", "features": data["features"],
            "weights": weights, "trainingPairs": len(x), "indexVersion": data["indexVersion"],
            "labelSource": "provisional author-curated relevance judgments, not visitor-derived labels"}

def metrics(query, learned):
    candidates = sorted(query["candidates"], key=lambda d: (-float(np.dot(weights, d["features"])) if learned else -d["baseline"], d["id"]))
    gains = [(2 ** query["relevance"].get(d["id"], 0) - 1) for d in candidates[:5]]
    ideal = sorted([2 ** g - 1 for g in query["relevance"].values()], reverse=True)[:5]
    dcg = lambda values: sum(g / math.log2(i + 2) for i, g in enumerate(values))
    reciprocal = next((1 / (i + 1) for i, d in enumerate(candidates) if query["relevance"].get(d["id"], 0) > 0), 0)
    relevant = {k for k, v in query["relevance"].items() if v > 0}
    recall = len(relevant.intersection(d["id"] for d in candidates[:5])) / max(1, len(relevant))
    return {"ndcg@5": dcg(gains) / dcg(ideal) if ideal else 1.0 if not candidates else 0.0,
            "mrr": reciprocal if relevant else float(not candidates), "recall@5": recall if relevant else float(not candidates)}

test_queries = [q for q in data["queries"] if q["split"] == "test"]
report = {"version": artifact["version"], "trainingPairs": len(x), "regressionQueries": len(test_queries),
          "note": "Small agent-curated, topic-split development regression fixture. Queries were inspected during development; this is not an unbiased held-out benchmark, online A/B test, or proof of ranking improvement."}
for name, learned in [("baseline", False), ("candidate", True)]:
    rows = [metrics(q, learned) for q in test_queries]
    report[name] = {metric: sum(row[metric] for row in rows) / len(rows) for metric in rows[0]}
report["promoted"] = all(report["candidate"][m] >= report["baseline"][m] - 1e-9 for m in ("ndcg@5", "mrr", "recall@5"))
if report["promoted"]:
    (ROOT / "src/search/ranker.json").write_text(json.dumps(artifact, indent=2) + "\n")
(ROOT / "evaluation/search/report.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report, indent=2))
if not report["promoted"]:
    raise SystemExit("Holdout gate failed; existing serving artifact was not replaced")
