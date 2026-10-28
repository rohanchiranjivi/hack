"""Realistic demo seed data generator for crash monitoring."""

import uuid
from datetime import datetime, timezone, timedelta
from .storage import reset_database, insert_crash, upsert_cluster
from .clustering import categorize_crash, generate_fingerprint, generate_explanation_and_fix, normalize_message
from .risk_scoring import calculate_risk

SEED_SCENARIOS = [
    {
        "title": "Database Connection Pool Saturated (0/50 Available)",
        "errorType": "DatabaseConnectionError",
        "category": "Database",
        "message": "DatabaseConnectionTimeout: Connection pool exhausted (0/50 available). Unable to acquire client within 5000ms.",
        "stackTrace": "DatabasePoolError: Connection pool exhausted\n    at Pool.acquireConnection (node_modules/pg-pool/index.js:312:11)\n    at DatabaseSession.query (src/db/connection.ts:65:28)\n    at OrderService.commitOrder (src/orders/service.ts:144:19)",
        "url": "/api/engine?action=checkout",
        "httpStatus": 503,
        "severityHint": "critical",
        "count": 58,
        "isSpike": True,
        "endpoints": ["/api/engine?action=checkout", "/cart", "/api/engine?action=cart-add"],
        "browsers": ["Chrome", "Safari", "Edge"],
        "sessions": ["sess_91a82", "sess_482b1", "sess_092cf", "sess_aa812", "sess_ee291", "sess_bot_01", "sess_bot_02"],
    },
    {
        "title": "Fatal React Render Error during CheckoutDrawer mount",
        "errorType": "FatalReactRenderError",
        "category": "JavaScript Runtime",
        "message": "Invariant violation during CheckoutDrawer render cycle: Cannot read properties of null (reading 'shippingAddress')",
        "stackTrace": "TypeError: Cannot read properties of null (reading 'shippingAddress')\n    at CheckoutDrawer (app/components/CheckoutDrawer.tsx:72:24)\n    at renderWithHooks (node_modules/react-dom/cjs/react-dom.development.js:14985:18)\n    at mountIndeterminateComponent (node_modules/react-dom/cjs/react-dom.development.js:17811:13)",
        "url": "/checkout",
        "httpStatus": None,
        "severityHint": "high",
        "count": 34,
        "isSpike": False,
        "endpoints": ["/checkout", "/"],
        "browsers": ["Chrome", "Firefox", "Safari"],
        "sessions": ["sess_bc128", "sess_77192", "sess_482b1", "sess_fa381"],
    },
    {
        "title": "Gateway Timeout (504): Catalog service upstream SLA exceeded",
        "errorType": "GatewayTimeout",
        "category": "Timeout/Performance",
        "message": "Gateway Timeout: Upstream catalog service failed to respond within 5000ms SLA window.",
        "stackTrace": "TimeoutError: Request exceeded 5000ms limit\n    at GatewayProxy.forward (src/proxy/gateway.ts:89:15)\n    at handleRequest (src/server.ts:42:10)",
        "url": "/api/chaos?scenario=be-timeout",
        "httpStatus": 504,
        "severityHint": "high",
        "count": 22,
        "isSpike": False,
        "endpoints": ["/api/chaos?scenario=be-timeout", "/api/engine"],
        "browsers": ["Chrome", "Edge", "Bot/Automated"],
        "sessions": ["sess_91a82", "sess_bot_03", "sess_bot_04"],
    },
    {
        "title": "Memory Leak Warning: Heap buffer exceeded 85% headroom",
        "errorType": "MemoryLeakWarning",
        "category": "Memory",
        "message": "Memory leak detected: heap buffer increased by 50MB (Retained allocations: 120 chunks)",
        "stackTrace": "Error: Memory limit warning\n    at MemoryWatcher.checkHealth (src/telemetry/memory.ts:38:12)\n    at Timeout.poll [as _onTimeout] (src/telemetry/memory.ts:18:9)",
        "url": "/chaos",
        "httpStatus": None,
        "severityHint": "high",
        "count": 14,
        "isSpike": False,
        "endpoints": ["/chaos", "/"],
        "browsers": ["Chrome", "Safari"],
        "sessions": ["sess_482b1", "sess_ee291"],
    },
    {
        "title": "Resource Load Failure: 404 missing promotional asset banner",
        "errorType": "ResourceLoadError",
        "category": "Resource Loading",
        "message": "Failed to load resource: <img> at /assets/nav-sprite-v2.png (Frontend asset missing during overload)",
        "stackTrace": "at HTMLImageElement.onerror (/public/reporter.js:88:9)",
        "url": "/",
        "httpStatus": 404,
        "severityHint": "medium",
        "count": 41,
        "isSpike": False,
        "endpoints": ["/", "/shop"],
        "browsers": ["Chrome", "Firefox", "Safari", "Edge"],
        "sessions": ["sess_91a82", "sess_482b1", "sess_092cf", "sess_aa812", "sess_fa381", "sess_ee291"],
    },
    {
        "title": "Rate Limit Exceeded (HTTP 429): Bot traffic burst throttled",
        "errorType": "HTTP_429",
        "category": "Network/HTTP",
        "message": "HTTP 429 Too Many Requests: Rate limit exceeded (Threshold: 5 req/10s) on /api/chaos?scenario=net-rate-limit",
        "stackTrace": "at fetch (/lib/reporter.ts:241:13)",
        "url": "/api/chaos?scenario=net-rate-limit",
        "httpStatus": 429,
        "severityHint": "medium",
        "count": 19,
        "isSpike": False,
        "endpoints": ["/api/chaos?scenario=net-rate-limit"],
        "browsers": ["Bot/Automated", "Chrome"],
        "sessions": ["sess_bot_01", "sess_bot_02"],
    },
]

def seed_demo_data(project_id: str = "proj_crashweb_01", multiplier: int = 1):
    reset_database()
    now = datetime.now(timezone.utc)

    for scen in SEED_SCENARIOS:
        cluster_id = f"clust_{uuid.uuid4().hex[:10]}"
        fp, _ = generate_fingerprint(
            category=scen["category"],
            error_type=scen["errorType"],
            message=scen["message"],
            endpoint=scen["url"],
            stack_trace=scen["stackTrace"]
        )

        timestamps = []
        # Generate simulated past timestamps
        count = scen["count"] * multiplier
        for i in range(count):
            # Spread over last 20 minutes with clustering toward now
            offset_seconds = (count - i) * 18 + (i % 5) * 3
            ts = (now - timedelta(seconds=offset_seconds)).isoformat()
            timestamps.append(ts)

            # Insert raw crash record
            insert_crash({
                "projectId": project_id,
                "timestamp": ts,
                "errorType": scen["errorType"],
                "message": scen["message"],
                "stackTrace": scen["stackTrace"],
                "url": scen["url"],
                "httpStatus": scen["httpStatus"],
                "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0.0.0",
                "browser": scen["browsers"][i % len(scen["browsers"])],
                "os": "Windows",
                "sessionId": scen["sessions"][i % len(scen["sessions"])],
                "botId": f"bot-{i % 3 + 1}" if "bot" in scen["sessions"][i % len(scen["sessions"])] else None,
                "severityHint": scen["severityHint"],
                "environment": "production",
                "metadata": {},
                "fingerprint": fp,
                "clusterId": cluster_id
            })

        first_seen = timestamps[0]
        last_seen = timestamps[-1]

        risk_score, risk_level, is_spike, trend = calculate_risk(
            category=scen["category"],
            count=count,
            affected_sessions=scen["sessions"],
            affected_endpoints=scen["endpoints"],
            last_seen_iso=last_seen,
            recent_timestamps=timestamps
        )

        if scen.get("isSpike"):
            is_spike = True
            risk_score = max(risk_score, 88.5)
            risk_level = "CRITICAL"

        explanation, fix = generate_explanation_and_fix(
            category=scen["category"],
            error_type=scen["errorType"],
            message=scen["message"]
        )

        upsert_cluster({
            "id": cluster_id,
            "project_id": project_id,
            "fingerprint": fp,
            "title": scen["title"],
            "category": scen["category"],
            "count": count,
            "risk_score": risk_score,
            "risk_level": risk_level,
            "first_seen": first_seen,
            "last_seen": last_seen,
            "affected_endpoints": scen["endpoints"],
            "affected_browsers": scen["browsers"],
            "affected_sessions": scen["sessions"],
            "sample_stack_trace": scen["stackTrace"],
            "sample_message": scen["message"],
            "status": "active",
            "is_spike": is_spike,
            "plain_explanation": explanation,
            "suggested_fix": fix
        })

    print(f"[Seed] Successfully seeded {len(SEED_SCENARIOS)} realistic clusters into SQLite.")

if __name__ == "__main__":
    seed_demo_data()

