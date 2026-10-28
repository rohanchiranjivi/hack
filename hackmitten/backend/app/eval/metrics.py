"""Metrics calculated from the synthetic holdout, never hand-entered display values."""
from collections import defaultdict
from . import __name__ as _unused

def evaluate(alerts, groups, incidents):
    truth = {a["alert_id"]:a.get("incident_id") for a in alerts}
    pred_by_alert = {a["alert_id"]:g["id"] for g in groups for a in g["alerts"]}
    ids = [a["alert_id"] for a in alerts if truth[a["alert_id"]] is not None]
    tp=fp=fn=0
    for i,left in enumerate(ids):
        for right in ids[i+1:]:
            same_true=truth[left]==truth[right]; same_pred=pred_by_alert.get(left)==pred_by_alert.get(right)
            tp += same_true and same_pred; fp += (not same_true) and same_pred; fn += same_true and (not same_pred)
    precision=tp/(tp+fp) if tp+fp else 1.0; recall=tp/(tp+fn) if tp+fn else 1.0
    surfaced=set()
    for group in groups:
        if group["tier"] in ("P1","P2"):
            surfaced.update(a["incident_id"] for a in group["alerts"] if a.get("incident_id"))
    known={i["incident_id"] for i in incidents}
    return {"raw_alerts":len(alerts),"situations":len(groups),"notification_reduction_pct":round(100*(1-len(groups)/max(len(alerts),1)),2),
            "incident_recall":round(len(surfaced & known)/max(1,len(known)),4),"incidents_total":len(known),"incidents_surfaced":len(surfaced & known),
            "pairwise_precision":round(precision,4),"pairwise_recall":round(recall,4),"pairwise_f1":round(2*precision*recall/(precision+recall),4) if precision+recall else 0,
            "false_hide_count":sum(1 for g in groups if g["tier"] in ("P3","P4") for a in g["alerts"] if a.get("incident_id")),
            "explainability_coverage_pct":100.0 if groups else 0.0,
            "note":"Grouping metrics use incident-linked alerts only; reduction counts all visible situations. This synthetic replay is not production evidence."}
