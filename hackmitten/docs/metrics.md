# Metrics

The `/api/metrics` endpoint and `make eval` calculate current synthetic replay counts, incident recall at P1/P2, pairwise precision/recall/F1 over incident-linked alert pairs, false-hide count, and explainability coverage. Evaluation uses generated incident IDs only as labels; correlation does not consume them. The current report evaluates the complete generated sequence and does not claim a train/test holdout.

The current prototype does **not** calculate B-Cubed, ARI, root-cause top-k, per-incident time-to-surface, robustness injection, or real-data confidence intervals. Reports must label those as unavailable. Notification reduction is a count of generated alert threads versus raw alerts, not evidence of reduced production paging.
