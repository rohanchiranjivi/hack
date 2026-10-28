"""Small deterministic correlation engine with explicit, inspectable evidence."""
from collections import defaultdict
from datetime import datetime, timezone
import re
from .scoring import score_group

def parse_time(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)

def signature(alert):
    return (alert.get("source", "other"), alert.get("alert_type", "unknown"), alert.get("service", "unknown"))

def cause_template(alert):
    text = alert.get("message", "").lower()
    for sep in (" detected", " on "):
        if sep in text: text = text.split(sep, 1)[0]
    return re.sub(r"\d+|\{.*?\}", "#", text).strip()

def build_groups(alerts, services, edges):
    """Correlate temporally close, matching templates; noisy repeats become visible threads."""
    groups, by_template = [], defaultdict(list)
    adj = defaultdict(set)
    for edge in edges:
        adj[edge["upstream"]].add(edge["downstream"])
        adj[edge["downstream"]].add(edge["upstream"])

    def graph_near(left, right, max_hops=2):
        if left == right: return True
        seen={left}; frontier={left}
        for _ in range(max_hops):
            frontier={neighbor for node in frontier for neighbor in adj[node] if neighbor not in seen}
            if right in frontier: return True
            seen.update(frontier)
        return False

    for alert in sorted(alerts, key=lambda a: a["ts"]):
        template = cause_template(alert)
        # Cross-service matching is reserved for clear incident-like symptoms at
        # error/critical severity. Generic recurring noise stays service-scoped.
        incident_pattern = template.startswith(("database slowdown", "gateway saturation", "queue backlog")) and alert.get("severity") in ("error", "critical")
        match_key = template if incident_pattern else f"{template}|{alert.get('service')}"
        t = parse_time(alert["ts"])
        target = next((g for g in reversed(by_template[match_key])
                       if (t-parse_time(g["last_seen"])).total_seconds() <= 900
                       and (not incident_pattern or any(graph_near(alert["service"], service) for service in g["services"]))), None)
        # Same signature repeated in a short interval is de-duplicated into an alert thread.
        if target is None:
            target = {"id":f"sit-{len(groups)+1:05d}","title":"","alerts":[],"services":[],"sources":[],"first_seen":alert["ts"],"last_seen":alert["ts"],"origin":None,"tier":"P4","confidence":0.0,"reasons":[],"notification_count":0}
            groups.append(target); by_template[match_key].append(target)
        target["alerts"].append(alert)
        target["last_seen"] = alert["ts"]
        if alert["service"] not in target["services"]: target["services"].append(alert["service"])
        if alert["source"] not in target["sources"]: target["sources"].append(alert["source"])
    service_map = {s["name"]:s for s in services}
    for group in groups:
        members = group["alerts"]
        group["alert_count"] = len(members); group["notification_count"] = len(members)
        group["peak_severity"] = max((a["severity"] for a in members), key=lambda s:["info","warning","error","critical"].index(s))
        sev = group["peak_severity"]
        recognized_incident_pattern = any(cause_template(a).startswith(("database slowdown", "gateway saturation", "queue backlog")) for a in members)
        group["risk_score"],group["tier"],group["score_reasons"]=score_group(members,len(group["services"]),recognized_incident_pattern)
        if len(group["services"]) > 1:
            votes = defaultdict(float)
            for a in members: votes[a["service"]] += 1/(1+len(adj[a["service"]]))
            origin = min(group["services"], key=lambda s:(parse_time(next(a["ts"] for a in members if a["service"]==s)), -votes[s]))
            group["origin"] = {"service":origin,"status":"probable","reasons":["earliest observed service in this correlated template",f"{len(group['services'])} affected services share a related alert pattern"]}
            group["confidence"] = round(min(.94, .48 + .08*len(group["services"]) + .04*len(group["sources"])),2)
            group["reasons"] = ["Matching message template", "Alerts arrived within the 15 minute correlation window", "Service dependency neighborhood considered"]
        else:
            group["origin"] = {"service":group["services"][0],"status":"candidate","reasons":["Only one affected service observed"]}
            group["confidence"] = .43
            group["reasons"] = ["Same service and alert signature thread"]
        group["title"] = f"{group['origin']['service']} · {len(members)} alerts · {len(group['services'])} services"
        group["blast_radius"] = len(group["services"])
    return sorted(groups, key=lambda g:(g["tier"],g["first_seen"]))
