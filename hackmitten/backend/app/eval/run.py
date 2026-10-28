"""Run the deterministic synthetic holdout evaluation and write dated reports."""
from datetime import datetime,timezone
import json
from pathlib import Path
from app.ingest.synthetic import generate
from app.engine.correlate import build_groups
from app.eval.metrics import evaluate

services,edges,incidents,alerts=generate()
groups=build_groups(alerts,services,edges)
metrics=evaluate(alerts,groups,incidents)
metrics["temporal_split"]="No learned model is fit. Metrics are computed over the complete generated replay; a proper train/test backtest remains future work."
metrics["root_cause_top1_accuracy"]="not computed by current heuristic baseline"
metrics["b_cubed_ari"]="not implemented in prototype"
metrics["time_to_surface"]="not computed; all displayed recall counts are replay end-state"
metrics["robustness"]="not run in prototype"
report=Path(__file__).resolve().parents[3]/"reports"; report.mkdir(exist_ok=True)
stamp=datetime.now(timezone.utc).strftime("%Y%m%d")
(report/f"eval_{stamp}.json").write_text(json.dumps(metrics,indent=2),encoding="utf-8")
table="\n".join(f"- **{k.replace('_',' ').title()}:** {v}" for k,v in metrics.items())
(report/f"eval_{stamp}.md").write_text(f"# SignalDesk synthetic evaluation — {stamp}\n\n{table}\n\n> Synthetic-only prototype results. Missing metrics are explicitly marked; do not interpret these as production claims.\n",encoding="utf-8")
print(json.dumps(metrics,indent=2))
