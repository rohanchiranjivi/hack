from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
import tempfile
import json
import os
import uuid
import yaml
import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Request, Header, Query, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

from .models import (
    CrashReport, Cluster, ClusterUpdate, Project, ProjectRegistration,
    HealthStatus, CrashCategory
)
from .core.redaction import redact
from .core.safety_guard import record_proposal, decide, audit_entries
from .ingest.synthetic import generate
from .ingest.loader import load_rows
from .engine.correlate import build_groups, parse_time
from .eval.metrics import evaluate

from .engine.storage import (
    get_project, get_all_projects, save_project, insert_crash, get_crashes,
    get_all_clusters, get_cluster, find_cluster_by_fingerprint, upsert_cluster,
    update_cluster_status, get_recent_crash_timestamps, get_cluster_crash_timestamps,
    reset_database
)
from .engine.clustering import (
    categorize_crash, normalize_message, normalize_endpoint, normalize_stack_frames,
    generate_fingerprint, is_near_duplicate, generate_explanation_and_fix
)
from .engine.risk_scoring import calculate_risk
from .engine.sse import broadcaster
from .engine.health_checker import health_check_loop, stop_health_checker
from .engine.seed import seed_demo_data

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data" / "synthetic"
DATA.mkdir(parents=True, exist_ok=True)

# In-memory rate limiting per project/IP for POST /api/crashes
_rate_limits: dict[str, list[float]] = {}
RATE_LIMIT_MAX = 60  # max 60 crashes per 10 seconds per project
RATE_LIMIT_WINDOW = 10.0

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Auto-seed initial demo dataset if database is fresh
    try:
        clusters = get_all_clusters()
        if not clusters:
            seed_demo_data()
    except Exception as e:
        print(f"[Init] Seed check note: {e}")

    # Launch background health checker
    task = asyncio.create_task(health_check_loop())
    yield
    stop_health_checker()
    task.cancel()

app = FastAPI(
    title="SignalDesk Crash Monitor",
    version="1.0.0",
    description="Real-time crash clustering, risk scoring, and failure monitor",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# SignalDesk synthetic alert baseline
services, edges, incidents, alerts = generate()
groups = build_groups(alerts, services, edges)
data_source_label = "synthetic"

def safe(data):
    return redact(data)

# ==========================================
# Crash Monitoring & Ingestion Endpoints
# ==========================================

async def process_incoming_crash(crash: CrashReport) -> dict:
    project_id = crash.projectId or 'proj_crashweb_01'
    project = get_project(project_id)
    if not project:
        # Auto-register project if unseen
        save_project(
            project_id=project_id,
            name=f"Project ({project_id})",
            target_url="http://localhost:3000",
            api_key="key_live_crashweb_2026"
        )

    # 1. Categorize
    category = categorize_crash(
        error_type=crash.errorType,
        message=crash.message,
        http_status=crash.httpStatus,
        stack_trace=crash.stackTrace or ""
    )

    # 2. Normalize and compute fingerprint
    fp_hash, title = generate_fingerprint(
        category=category,
        error_type=crash.errorType,
        message=crash.message,
        endpoint=crash.url,
        stack_trace=crash.stackTrace or ""
    )

    # 3. Check for existing cluster by fingerprint or near-duplicate
    existing_cluster = find_cluster_by_fingerprint(fp_hash)
    target_cluster_id = None

    if not existing_cluster:
        # Check near-duplicate matching among active clusters in same category
        norm_msg = normalize_message(crash.message)
        norm_ep = normalize_endpoint(crash.url)
        all_active = get_all_clusters(project_id=project_id, status='active')

        for c in all_active:
            if c['category'] == category:
                # Compare endpoint similarity
                c_endpoints = c.get('affected_endpoints', [])
                if any(normalize_endpoint(ep) == norm_ep for ep in c_endpoints):
                    if is_near_duplicate(norm_msg, normalize_message(c['sample_message'])):
                        existing_cluster = c
                        fp_hash = c['fingerprint']
                        break

    now_iso = crash.timestamp or datetime.now(timezone.utc).isoformat()

    if existing_cluster:
        target_cluster_id = existing_cluster['id']
        new_count = existing_cluster['count'] + 1
        first_seen = existing_cluster['first_seen']

        # Update endpoints, browsers, sessions
        endpoints = list(set(existing_cluster.get('affected_endpoints', []) + [crash.url]))
        browsers = list(set(existing_cluster.get('affected_browsers', []) + ([crash.browser] if crash.browser else [])))
        sessions = list(set(existing_cluster.get('affected_sessions', []) + ([crash.sessionId] if crash.sessionId else [])))
    else:
        target_cluster_id = f"clust_{uuid.uuid4().hex[:10]}"
        new_count = 1
        first_seen = now_iso
        endpoints = [crash.url]
        browsers = [crash.browser] if crash.browser else []
        sessions = [crash.sessionId] if crash.sessionId else []

    # Insert raw crash record
    crash_record = crash.model_dump()
    crash_record['fingerprint'] = fp_hash
    crash_record['clusterId'] = target_cluster_id
    crash_id = insert_crash(crash_record)
    crash_record['id'] = crash_id

    # Retrieve recent timestamps for this cluster to compute velocity and risk
    recent_ts = get_cluster_crash_timestamps(target_cluster_id, limit=80)
    risk_score, risk_level, is_spike, trend = calculate_risk(
        category=category,
        count=new_count,
        affected_sessions=sessions,
        affected_endpoints=endpoints,
        last_seen_iso=now_iso,
        recent_timestamps=recent_ts
    )

    explanation, fix = generate_explanation_and_fix(
        category=category,
        error_type=crash.errorType,
        message=crash.message
    )

    cluster_data = {
        "id": target_cluster_id,
        "project_id": project_id,
        "fingerprint": fp_hash,
        "title": title,
        "category": category,
        "count": new_count,
        "risk_score": risk_score,
        "risk_level": risk_level,
        "first_seen": first_seen,
        "last_seen": now_iso,
        "affected_endpoints": endpoints,
        "affected_browsers": browsers,
        "affected_sessions": sessions,
        "sample_stack_trace": crash.stackTrace or (existing_cluster.get('sample_stack_trace') if existing_cluster else ""),
        "sample_message": crash.message,
        "status": existing_cluster.get('status', 'active') if existing_cluster else 'active',
        "is_spike": is_spike,
        "plain_explanation": explanation,
        "suggested_fix": fix
    }

    upsert_cluster(cluster_data)
    cluster_data['trend_over_time'] = trend

    # Broadcast real-time SSE events
    await broadcaster.broadcast("crash", {
        "crash": crash_record,
        "cluster": cluster_data
    })

    return {"status": "ingested", "crashId": crash_id, "clusterId": target_cluster_id, "risk": risk_level}

@app.post("/api/crashes", status_code=status.HTTP_201_CREATED)
async def ingest_crash(
    crash: CrashReport,
    x_project_key: str | None = Header(None, alias="X-Project-Key"),
    api_key: str | None = Query(None, alias="apiKey")
):
    """Ingests, validates, rate-limits, clusters, and risk-scores incoming crash reports."""
    # 1. Validate API Key
    provided_key = x_project_key or api_key
    project = get_project(crash.projectId)
    if project and project.get('api_key'):
        if not provided_key or provided_key != project['api_key']:
            raise HTTPException(status_code=401, detail="Invalid or missing API key for this project.")

    # 2. Rate Limiting Check
    now_ts = datetime.now().timestamp()
    key = crash.projectId or "default"
    history = _rate_limits.setdefault(key, [])
    # purge old entries
    _rate_limits[key] = [t for t in history if now_ts - t < RATE_LIMIT_WINDOW]
    if len(_rate_limits[key]) >= RATE_LIMIT_MAX:
        raise HTTPException(status_code=429, detail="Rate limit exceeded: too many crash reports submitted.")
    _rate_limits[key].append(now_ts)

    result = await process_incoming_crash(crash)
    return result

@app.get("/api/crashes")
def list_crashes(
    projectId: str = "proj_crashweb_01",
    clusterId: str | None = None,
    limit: int = 100
):
    crashes = get_crashes(project_id=projectId, limit=limit, cluster_id=clusterId)
    return crashes

@app.get("/api/clusters")
def list_clusters(
    projectId: str = "proj_crashweb_01",
    status: str | None = None,
    category: str | None = None,
    sort_by: str = "risk",
    search: str | None = None
):
    clusters = get_all_clusters(project_id=projectId, status=status)

    if category and category != 'All':
        clusters = [c for c in clusters if c['category'].lower() == category.lower()]

    if search:
        s = search.lower()
        clusters = [
            c for c in clusters
            if s in c['title'].lower()
            or s in c['category'].lower()
            or s in c.get('sample_message', '').lower()
            or any(s in ep.lower() for ep in c.get('affected_endpoints', []))
        ]

    # Recalculate sparkline trends
    for c in clusters:
        recent_ts = get_cluster_crash_timestamps(c['id'], limit=30)
        c['trend_over_time'] = [{"bucket": i+1, "count": max(1, c['count']//6)} for i in range(6)]

    if sort_by == 'risk':
        clusters.sort(key=lambda x: x['risk_score'], reverse=True)
    elif sort_by == 'count':
        clusters.sort(key=lambda x: x['count'], reverse=True)
    elif sort_by == 'recent':
        clusters.sort(key=lambda x: x['last_seen'], reverse=True)

    return clusters

@app.get("/api/clusters/{cluster_id}")
def get_cluster_detail(cluster_id: str):
    cluster = get_cluster(cluster_id)
    if not cluster:
        raise HTTPException(status_code=404, detail="Cluster not found")
    # Fetch recent crash occurrences for this cluster
    occurrences = get_crashes(cluster_id=cluster_id, limit=25)
    cluster['occurrences'] = occurrences
    cluster['trend_over_time'] = [{"bucket": i+1, "count": max(1, cluster['count']//6)} for i in range(6)]
    return cluster

@app.patch("/api/clusters/{cluster_id}")
def update_cluster(cluster_id: str, body: ClusterUpdate):
    cluster = get_cluster(cluster_id)
    if not cluster:
        raise HTTPException(status_code=404, detail="Cluster not found")
    update_cluster_status(cluster_id, body.status)
    return {"ok": True, "clusterId": cluster_id, "status": body.status}

@app.get("/api/stats")
def get_monitoring_stats(projectId: str = "proj_crashweb_01"):
    clusters = get_all_clusters(project_id=projectId)
    crashes = get_crashes(project_id=projectId, limit=200)
    project = get_project(projectId)

    total_crashes = sum(c['count'] for c in clusters)
    active_clusters = sum(1 for c in clusters if c.get('status') == 'active')
    high_risk_count = sum(1 for c in clusters if c.get('risk_level') in ('CRITICAL', 'HIGH') and c.get('status') == 'active')

    # Calculate crash rate (crashes in last 5 mins / 5)
    now = datetime.now(timezone.utc)
    recent_count = 0
    for cr in crashes:
        try:
            diff = (now - datetime.fromisoformat(cr['timestamp'].replace('Z', '+00:00'))).total_seconds()
            if diff <= 300:
                recent_count += 1
        except Exception:
            pass
    crash_rate_per_min = round(recent_count / 5.0, 1) if recent_count > 0 else 0.0

    # Category distribution
    categories_dist: dict[str, int] = {}
    for c in clusters:
        cat = c['category']
        categories_dist[cat] = categories_dist.get(cat, 0) + c['count']

    # Unique sessions impacted
    all_sessions = set()
    for c in clusters:
        all_sessions.update(c.get('affected_sessions', []))

    return {
        "projectId": projectId,
        "siteStatus": project.get('health_status', 'Healthy') if project else 'Healthy',
        "targetUrl": project.get('target_url', 'http://localhost:3000') if project else 'http://localhost:3000',
        "uptimePct": project.get('uptime_pct', 100.0) if project else 100.0,
        "lastLatencyMs": project.get('last_latency_ms', 42.0) if project else 42.0,
        "totalCrashes": total_crashes,
        "activeClusters": active_clusters,
        "highRiskCount": high_risk_count,
        "crashRatePerMin": crash_rate_per_min,
        "sessionsImpacted": len(all_sessions),
        "categoryDistribution": categories_dist,
    }

@app.get("/api/stream")
async def sse_event_stream(request: Request):
    """Server-Sent Events (SSE) live stream for instantaneous dashboard updates."""
    queue = await broadcaster.subscribe()

    async def event_generator():
        try:
            # Send initial keepalive
            yield f": connected to signaldesk stream\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    data = await asyncio.wait_for(queue.get(), timeout=15.0)
                    yield data
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
        finally:
            broadcaster.unsubscribe(queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )

@app.get("/api/health-status")
def get_site_health(projectId: str = "proj_crashweb_01"):
    project = get_project(projectId)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return {
        "projectId": project['project_id'],
        "targetUrl": project['target_url'],
        "status": project.get('health_status', 'Healthy'),
        "statusCode": 200 if project.get('health_status') == 'Healthy' else 500,
        "latencyMs": project.get('last_latency_ms', 0.0),
        "uptimePct": project.get('uptime_pct', 100.0),
        "lastChecked": datetime.now(timezone.utc).isoformat()
    }

@app.get("/api/projects")
def list_projects():
    return get_all_projects()

@app.post("/api/projects")
def register_project(body: ProjectRegistration):
    api_key = body.apiKey or f"key_{uuid.uuid4().hex[:12]}"
    save_project(
        project_id=body.projectId,
        name=body.name,
        target_url=body.targetUrl,
        api_key=api_key
    )
    return {"ok": True, "projectId": body.projectId, "apiKey": api_key}

@app.post("/api/seed-crashes")
def trigger_seed_demo_data(projectId: str = "proj_crashweb_01"):
    seed_demo_data(projectId)
    return {"ok": True, "message": "Demo crash data seeded successfully."}

# ==========================================
# Original SignalDesk Endpoints Preserved
# ==========================================

@app.get("/api/health")
@app.get("/api/healthz")
def health():
    return {"status": "ok", "redaction": "on", "dataset": "synthetic", "module": "crash_monitor"}

@app.get("/api/data/summary")
def summary():
    days = max(1, (parse_time(alerts[-1]["ts"]) - parse_time(alerts[0]["ts"])).days)
    return safe({
        "dataset": data_source_label,
        "alerts": len(alerts),
        "incidents": len(incidents),
        "services": len(services),
        "alerts_per_day": round(len(alerts) / days),
        "noise_fraction": round(sum(a.get("incident_id") is None for a in alerts) / len(alerts), 3),
        "range": {"from": alerts[0]["ts"], "to": alerts[-1]["ts"]}
    })

@app.post("/api/data/upload")
async def upload_alert_history(request: Request, filename: str):
    global alerts, incidents, services, edges, groups, data_source_label
    suffix = Path(filename).suffix.lower()
    if suffix not in (".csv", ".json", ".jsonl", ".parquet"):
        raise HTTPException(415, "Use a CSV, JSON, JSONL, or Parquet alert file")
    body = await request.body()
    if len(body) > 100_000_000:
        raise HTTPException(413, "Alert export is larger than the 100 MB demo limit")
    try:
        with tempfile.TemporaryDirectory(prefix="signaldesk-") as folder:
            path = Path(folder) / ("alerts" + suffix)
            path.write_bytes(body)
            column_map = yaml.safe_load((ROOT / "data" / "config" / "column_map.yaml").read_text(encoding="utf-8"))
            rows, report = load_rows(path, column_map=column_map)
    except Exception:
        raise HTTPException(400, "Could not read this alert export; check the file format and column mapping")
    if not rows:
        raise HTTPException(400, "No alert rows were found in this file")
    valid = []
    allowed_sources = {"monitoring", "logging", "uptime", "status_page", "other"}
    allowed_severities = {"info", "warning", "error", "critical"}
    for row in rows:
        if not row.get("ts") or not row.get("service"):
            continue
        row["source"] = (str(row.get("source") or "other").lower() if str(row.get("source") or "other").lower() in allowed_sources else "other")
        row["severity"] = (str(row.get("severity") or "warning").lower() if str(row.get("severity") or "warning").lower() in allowed_severities else "warning")
        row["service"] = str(row["service"])
        row["alert_type"] = str(row.get("alert_type") or "unknown")
        row["message"] = str(row.get("message") or row["alert_type"])
        row["incident_id"] = str(row["incident_id"]) if row.get("incident_id") not in (None, "") else None
        row.setdefault("labels", {})
        valid.append(row)
    if not valid:
        raise HTTPException(400, "Rows need a timestamp and service column; map source columns in data/config/column_map.yaml")
    valid.sort(key=lambda row: row["ts"])
    alerts = valid
    data_source_label = "user_alert_import"
    services = [{"name": name, "kind": "app", "tier": 2, "team": "unknown"} for name in sorted({a["service"] for a in alerts})]
    edges = []
    by_incident = {}
    for alert in alerts:
        if alert.get("incident_id"):
            by_incident.setdefault(alert["incident_id"], []).append(alert)
    incidents = []
    for iid, members in by_incident.items():
        first = min(members, key=lambda a: a["ts"])
        last = max(members, key=lambda a: a["ts"])
        incidents.append({
            "incident_id": iid,
            "start": first["ts"],
            "end": last["ts"],
            "root_cause_service": first["service"],
            "root_cause_category": "Imported incident label; cause not supplied",
            "root_cause_text": "Root cause requires an incident record",
            "severity": first["severity"],
            "linked_alert_ids": [a["alert_id"] for a in members]
        })
    groups = build_groups(alerts, services, edges)
    report["usable_rows"] = len(valid)
    report["rows_skipped_missing_time_or_service"] = len(rows) - len(valid)
    return safe({
        "status": "loaded_in_memory",
        "dataset": "user_alert_import",
        "validation": report,
        "incidents_linked": len(incidents),
        "situations": len(groups),
        "note": "Imported content is held in memory only and redacted in API responses; restart returns to synthetic demo data."
    })

@app.get("/api/incidents")
def list_incidents(status: str | None = None, tier: str | None = None, limit: int = 100):
    items = [{k: v for k, v in g.items() if k != "alerts"} for g in groups]
    if tier:
        items = [g for g in items if g["tier"] == tier]
    items = sorted(items, key=lambda g: (g["tier"], g["first_seen"]))[:max(1, min(limit, 500))]
    return safe(items)

@app.get("/api/incidents/{incident_id}")
def get_incident(incident_id: str):
    g = next((g for g in groups if g["id"] == incident_id), None)
    if not g:
        raise HTTPException(404, "Situation not found")
    return safe(g)

@app.get("/api/incidents/{incident_id}/explain")
def explain(incident_id: str):
    g = next((g for g in groups if g["id"] == incident_id), None)
    if not g:
        raise HTTPException(404, "Situation not found")
    return safe({
        "situation_id": incident_id,
        "confidence": g["confidence"],
        "edges": [{"from": g["origin"]["service"], "to": s, "score": g["confidence"], "reasons": g["reasons"]} for s in g["services"] if s != g["origin"]["service"]],
        "feature_contributions": {"template_similarity": 0.45, "time_proximity": 0.30, "dependency_context": 0.25}
    })

@app.get("/api/alerts/{alert_id}")
def get_alert(alert_id: str):
    a = next((a for a in alerts if a["alert_id"] == alert_id), None)
    if not a:
        raise HTTPException(404, "Alert not found")
    group = next(g for g in groups if any(x["alert_id"] == alert_id for x in g["alerts"]))
    return safe({"alert": a, "situation_id": group["id"], "reasons": group["reasons"]})

@app.get("/api/services/graph")
def graph():
    return safe({"nodes": services, "edges": edges})

def recommendations():
    counts = Counter((a["alert_type"], a["service"]) for a in alerts if not a.get("incident_id"))
    result = []
    for (typ, service), n in counts.most_common(20):
        protected = any(a["alert_type"] == typ and a.get("incident_id") for a in alerts)
        result.append({
            "id": f"rec-{len(result)+1:03d}",
            "signature": typ,
            "service": service,
            "archetype": "Redundant-but-valuable" if protected else "Chronic / stale threshold",
            "firings": n,
            "linked_incidents": sum(a["alert_type"] == typ and a.get("incident_id") is not None for a in alerts),
            "action": "Keep — historically predictive" if protected else "Needs review — insufficient history",
            "confidence": 0.99 if protected else 0.42,
            "risk": "protected" if protected else "review",
            "what_if": {"pages_saved_per_day": 0 if protected else round(n / 42, 1), "incidents_missed": 0, "max_detection_delay_seconds": 0},
            "rationale": "Protected because at least one alert with this signature was linked to a real incident." if protected else "Synthetic history shows recurring alerts without linked incidents; absence of links is not proof of safety."
        })
    return result

@app.get("/api/noise/signatures")
def noise_signatures():
    return safe(recommendations())

@app.get("/api/recommendations")
def get_recommendations():
    return safe(recommendations())

class Decision(BaseModel):
    actor: str
    reason: str

@app.post("/api/recommendations/{rid}/approve")
def approve(rid: str, body: Decision):
    rec = next((r for r in recommendations() if r["id"] == rid), None)
    if not rec:
        raise HTTPException(404, "Recommendation not found")
    if rec["risk"] == "protected":
        raise HTTPException(409, "Recall guard protects this signature")
    record_proposal(rid, rec)
    try:
        payload = decide(rid, body.actor, body.reason, True)
    except ValueError as e:
        raise HTTPException(400, str(e))
    out = ROOT / "reports" / f"{rid}-change-proposal.json"
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps({"status": "NOT APPLIED — export only", "proposal": payload, "approved_by": body.actor, "reason": body.reason}, indent=2), encoding="utf-8")
    return {"status": "approved_export_only", "message": "NOT APPLIED — export only", "file": out.name}

@app.post("/api/recommendations/{rid}/reject")
def reject(rid: str, body: Decision):
    rec = next((r for r in recommendations() if r["id"] == rid), None)
    if not rec:
        raise HTTPException(404, "Recommendation not found")
    record_proposal(rid, rec)
    try:
        decide(rid, body.actor, body.reason, False)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"status": "rejected"}

@app.get("/api/metrics")
@app.get("/api/eval/run")
def metrics():
    return safe(evaluate(alerts, groups, incidents))

@app.get("/api/audit")
def audit():
    return safe(audit_entries())

@app.get("/api/limitations")
def limitations():
    return {
        "title": "Known limitations",
        "items": [
            "The model reflects patterns in historical data. New failure modes can be under-recognised; novel signatures should go to review.",
            "No incident link in history does not mean an alert is safe to demote. Small samples require human review.",
            "Stale or incorrect service dependencies can cause incorrect groupings.",
            "Simultaneous incidents may merge and slow-burn incidents may split.",
            "Uneven monitoring coverage and clock skew can misattribute probable origin.",
            "Synthetic data and thresholds do not establish production performance.",
            "Redaction uses patterns and can miss unknown identifier formats.",
            "Recommendations are export-only. No monitoring write integration exists."
        ]
    }

# Serve the built frontend when available
@app.get("/{path:path}")
def frontend(path: str):
    file = ROOT / "frontend" / "dist" / path
    if path and file.exists() and file.is_file():
        return FileResponse(file)
    index = ROOT / "frontend" / "dist" / "index.html"
    if index.exists():
        return FileResponse(index)
    return {"message": "SignalDesk API is running. Start frontend dev server at http://localhost:5173."}
