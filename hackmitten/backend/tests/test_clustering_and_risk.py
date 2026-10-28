"""Basic unit tests for crash fingerprinting, normalization, clustering, and risk scoring."""

import pytest
from app.engine.clustering import (
    categorize_crash,
    normalize_message,
    normalize_endpoint,
    normalize_stack_frames,
    generate_fingerprint,
    is_near_duplicate,
    calculate_token_similarity
)
from app.engine.risk_scoring import calculate_risk

def test_categorize_crash():
    assert categorize_crash("DatabaseConnectionError", "Connection pool exhausted (0/50)") == "Database"
    assert categorize_crash("TypeError", "Cannot read properties of undefined") == "JavaScript Runtime"
    # Even if HTTP status 403 is received from proxy, TypeError must stay JavaScript Runtime
    assert categorize_crash("TypeError", "Cannot read properties of undefined (reading 'price') in ZonProductGrid hydration render.", http_status=403) == "JavaScript Runtime"
    # SQL injection probe must be categorized as Validation/Input, NOT Database
    assert categorize_crash("InputValidationException", "Malicious SQL injection probe pattern detected in query parameter: \"' OR 1=1 --\"", http_status=400) == "Validation/Input"
    assert categorize_crash("StorageNotConfiguredError", "HTTP 503: Persistent storage is not configured. Add the Upstash Redis environment variables in Vercel.", http_status=503) == "Database"
    assert categorize_crash("UnauthorizedAccess", "AuthTokenForgedError: Invalid signature or tampered header detected on user session token.", http_status=401) == "Auth/Permissions"
    assert categorize_crash("OutOfMemoryError", "JavaScript heap out of memory") == "Memory"
    assert categorize_crash("GatewayTimeout", "Upstream timeout 504", http_status=504) == "Timeout/Performance"
    assert categorize_crash("ResourceLoadError", "Failed to load resource: <img>") == "Resource Loading"
    assert categorize_crash("AuthError", "Unauthorized request", http_status=401) == "Auth/Permissions"
    assert categorize_crash("BadRequestError", "Malformed JSON syntax", http_status=400) == "Validation/Input"
    assert categorize_crash("HTTP_502", "Bad Gateway proxy error", http_status=502) == "Network/HTTP"

def test_normalize_message():
    raw1 = "Order 48291 failed for user 550e8400-e29b-41d4-a716-446655440000 at 2026-10-28T14:20:00Z"
    raw2 = "Order 99120 failed for user c305c08d-8c27-494b-a23b-76f19ef4719f at 2026-10-28T18:05:12Z"
    norm1 = normalize_message(raw1)
    norm2 = normalize_message(raw2)
    assert norm1 == norm2
    assert "<UUID>" in norm1
    assert "<TS>" in norm1

def test_normalize_endpoint():
    ep1 = "/api/v1/orders/12345?ref=promo&tracker=99"
    ep2 = "/api/v1/orders/98765"
    assert normalize_endpoint(ep1) == "/api/v1/orders/:id"
    assert normalize_endpoint(ep2) == "/api/v1/orders/:id"

def test_fingerprint_consistency():
    fp1, title1 = generate_fingerprint(
        category="Database",
        error_type="PoolError",
        message="Connection pool exhausted (0/50 available) for user 123",
        endpoint="/api/engine?action=checkout"
    )
    fp2, title2 = generate_fingerprint(
        category="Database",
        error_type="PoolError",
        message="Connection pool exhausted (0/50 available) for user 456",
        endpoint="/api/engine?action=checkout"
    )
    assert fp1 == fp2
    assert "PoolError" in title1

def test_near_duplicate_matching():
    msg1 = "PaymentGateway down: transaction id generation blocked on upstream"
    msg2 = "PaymentGateway down: transaction id generation blocked on upstream provider"
    assert is_near_duplicate(msg1, msg2, threshold=0.8)

    different_msg = "Database pool exhausted slots: 0/50"
    assert not is_near_duplicate(msg1, different_msg, threshold=0.8)

def test_risk_scoring():
    from datetime import datetime, timezone
    # Critical checkout failure with high count and spike
    now_iso = datetime.now(timezone.utc).isoformat()
    recent_ts = [now_iso] * 10
    score, level, is_spike, trend = calculate_risk(
        category="Database",
        count=45,
        affected_sessions=["s1", "s2", "s3", "s4", "s5", "s6"],
        affected_endpoints=["/api/engine?action=checkout"],
        last_seen_iso=now_iso,
        recent_timestamps=recent_ts
    )

    assert score >= 75.0
    assert level in ("HIGH", "CRITICAL")
    assert is_spike is True
    assert len(trend) == 6

    # Low severity blip
    old_iso = "2026-10-28T10:00:00Z"
    score_low, level_low, is_spike_low, _ = calculate_risk(
        category="Validation/Input",
        count=1,
        affected_sessions=["s1"],
        affected_endpoints=["/search"],
        last_seen_iso=old_iso,
        recent_timestamps=[old_iso]
    )

    assert score_low < 35.0
    assert level_low == "LOW"
    assert is_spike_low is False

def test_explanation_and_recommended_fix():
    from app.engine.clustering import generate_explanation_and_fix

    # Test Vercel 503 Persistent Storage error
    exp, fix = generate_explanation_and_fix(
        category="Database",
        error_type="StorageNotConfiguredError",
        message="HTTP 503: Persistent storage is not configured. Add the Upstash Redis environment variables in Vercel."
    )
    assert "Persistent storage is unconfigured" in exp
    assert "UPSTASH_REDIS" in fix

    # Test OOM
    exp_oom, fix_oom = generate_explanation_and_fix(
        category="Memory",
        error_type="OutOfMemoryError",
        message="Fatal JavaScript out of memory"
    )
    assert "heap memory" in exp_oom.lower()
    assert "LRU" in fix_oom

def test_reset_and_triage_api():
    from fastapi.testclient import TestClient
    from app.main import app

    client = TestClient(app)

    # 1. Test Reset API returns all values to 0
    res = client.post("/api/reset")
    assert res.status_code == 200
    assert res.json()["ok"] is True

    # Check stats after reset
    stats = client.get("/api/stats").json()
    assert stats["totalCrashes"] == 0
    assert stats["activeClusters"] == 0
    assert stats["thresholdReached"] is False
    assert stats["targetUrl"] == "https://crashweb-gules.vercel.app"

    # 2. Simulate ingesting 500 crashes
    for i in range(500):
        c_type = "StorageNotConfiguredError" if i % 2 == 0 else "DatabaseConnectionError"
        res = client.post(
            "/api/crashes",
            headers={"X-Project-Key": "key_live_crashweb_2026"},
            json={
                "projectId": "proj_crashweb_01",
                "errorType": c_type,
                "message": f"Failure event {i % 5} on catalog",
                "url": "https://crashweb-gules.vercel.app/api/engine",
                "httpStatus": 503,
                "severityHint": "critical",
                "sessionId": f"sess_{i % 10}"
            }
        )
        assert res.status_code == 201

    # Verify threshold reached and top 5 triage
    stats_after = client.get("/api/stats").json()
    assert stats_after["totalCrashes"] >= 500
    assert stats_after["thresholdReached"] is True
    assert len(stats_after["top5HighRisks"]) <= 5
    for r in stats_after["top5HighRisks"]:
        assert "rank" in r
        assert "suggested_fix" in r
        assert len(r["suggested_fix"]) > 0

    # Test top5-triage endpoint
    triage = client.get("/api/clusters/top5-triage").json()
    assert triage["thresholdReached"] is True
    assert len(triage["top5"]) <= 5

    # Reset again
    res_clean = client.post("/api/reset")
    assert res_clean.status_code == 200
    stats_clean = client.get("/api/stats").json()
    assert stats_clean["totalCrashes"] == 0
