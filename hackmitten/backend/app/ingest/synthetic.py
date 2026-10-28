"""Seeded, deterministic generator for a compact but realistic 6-week demo."""
from datetime import datetime, timedelta, timezone
import random

KINDS = ["gateway", "app", "db", "cache", "queue", "infra", "status_page"]
SEVERITIES = ["info", "warning", "error", "critical"]

def generate(seed=41, days=42):
    rng = random.Random(seed)
    services = [{"name": "db-primary", "kind": "db", "tier": 0, "team": "data"},
                {"name": "cache-main", "kind": "cache", "tier": 1, "team": "platform"},
                {"name": "queue-main", "kind": "queue", "tier": 1, "team": "platform"},
                {"name": "gateway", "kind": "gateway", "tier": 0, "team": "edge"}]
    for i in range(66):
        services.append({"name": f"svc-{i:02d}", "kind": "app" if i < 52 else "infra", "tier": 1 + (i % 3), "team": ["commerce", "identity", "platform", "data"][i % 4]})
    edges = []
    for i in range(52):
        edges.append({"upstream": "gateway" if i < 20 else f"svc-{(i-1)%20:02d}", "downstream": f"svc-{i:02d}", "edge_type": "calls", "weight": 1.0})
        edges.append({"upstream": "db-primary" if i % 4 != 0 else "cache-main", "downstream": f"svc-{i:02d}", "edge_type": "depends_on", "weight": 0.9})
    edges += [{"upstream":"svc-51","downstream":"queue-main","edge_type":"depends_on","weight":0.8}]
    now = datetime(2026, 10, 26, 12, tzinfo=timezone.utc) - timedelta(days=days)
    incidents, alerts = [], []
    # About 3–4 incidents per week, matching the brief's synthetic history range.
    incident_days = set(range(1, days, 2))
    for ix, day in enumerate(sorted(incident_days)):
        iid = f"inc-{ix+1:03d}"
        start = now + timedelta(days=day, hours=2 + (ix*7)%18, minutes=(ix*13)%50)
        root = "db-primary" if ix % 3 == 0 else ("gateway" if ix % 3 == 1 else "queue-main")
        affected = [s["name"] for s in services if s["name"] != root and (root == "db-primary" and s["kind"] == "app" and int(s["name"].split("-")[-1]) < 15 or root == "gateway" and s["kind"] == "app" and int(s["name"].split("-")[-1]) < 6 or root == "queue-main" and s["name"] in ["svc-48","svc-49","svc-50","svc-51"])]
        if not affected: affected = ["svc-00"]
        impacted = [root] + affected
        cause = ["database slowdown", "gateway saturation", "queue backlog"][ix % 3]
        end = start + timedelta(minutes=12 + ix % 32)
        incidents.append({"incident_id":iid,"start":start.isoformat(),"end":end.isoformat(),"root_cause_service":root,"root_cause_category":cause,"root_cause_text":cause,"severity":"critical" if ix % 4 == 0 else "error","linked_alert_ids":[]})
        for j, service in enumerate(impacted):
            ts = start + timedelta(seconds=(j * 27) % 210)
            sev = "warning" if ix % 5 == 0 and j < 2 else ("critical" if j == 0 and ix % 4 == 0 else "error")
            alerts.append(_alert(len(alerts), ts, service, sev, f"{cause} detected on {service}; latency={{value}}ms", iid, "monitoring", rng))
            # Cross-tool echoes on some members
            if j % 3 == 0: alerts.append(_alert(len(alerts), ts+timedelta(seconds=7), service, sev, f"{cause} detected on {service}; latency={{value}}ms", iid, "logging", rng))
    # Noise includes chronic, flapping, scheduled, deploy, weekend-like and echo alerts.
    base_count = days * 400
    for i in range(base_count):
        ts = now + timedelta(seconds=rng.randrange(days*86400))
        service = rng.choice(services)["name"]
        kind = rng.choices(["chronic", "flapping", "scheduled", "deploy", "random"], [15, 20, 15, 12, 38])[0]
        sev = "warning" if kind in ("chronic", "flapping", "scheduled") else rng.choice(["info","warning","error"])
        msg = {"chronic":"CPU threshold exceeded on {service}","flapping":"health check toggled on {service}","scheduled":"backup job CPU spike on {service}","deploy":"post-deploy latency blip on {service}","random":"request latency elevated on {service}"}[kind].format(service=service)
        original=_alert(len(alerts), ts, service, sev, msg, None, "monitoring" if i%2 else "logging", rng, kind)
        alerts.append(original)
        # Repeated tool firings create realistic duplicate noise while keeping
        # overall volume within the brief's 400–900 alerts/day target.
        if i % 5 == 0:
            for repeat in (1,2):
                echo=original.copy()
                echo["alert_id"]=f"alt-{len(alerts):06d}"
                echo["ts"]=(ts+timedelta(seconds=repeat*8)).isoformat()
                echo["_noise_kind"]="duplicate"
                alerts.append(echo)
    alerts.sort(key=lambda a:a["ts"])
    for alert in alerts:
        if alert["incident_id"]:
            next(x for x in incidents if x["incident_id"] == alert["incident_id"])["linked_alert_ids"].append(alert["alert_id"])
    return services, edges, incidents, alerts

def _alert(i, ts, service, severity, message, incident_id, source, rng, noise_kind=None):
    return {"alert_id":f"alt-{i:06d}","ts":ts.isoformat(),"source":source,"service":service,"severity":severity,
            "alert_type":message.split(" detected")[0],"message":message,"host":f"{service}-host-{rng.randrange(1,8)}","ip":f"10.24.{rng.randrange(1,20)}.{rng.randrange(2,254)}",
            "customer_id":f"cust-{rng.randrange(1,1000):04d}","metric_name":"latency_ms","metric_value":round(rng.uniform(50,1600),1),"threshold":500,
            "labels":{},"incident_id":incident_id,"_noise_kind":noise_kind}
