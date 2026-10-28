"""Risk Scoring Engine for Crash Monitoring.

Calculates explainable risk scores [0 - 100] based on:
1. Category severity weights
2. Crash frequency and velocity (spikes)
3. Number of affected unique sessions
4. Critical flow obstruction (checkout, cart, auth)
5. Recency of error occurrence
"""

import math
from datetime import datetime, timezone
from typing import Tuple, List, Optional
from ..models import CrashCategory, RiskLevel

CATEGORY_WEIGHTS: dict[CrashCategory, float] = {
    "Database": 1.35,
    "Memory": 1.30,
    "Network/HTTP": 1.25,
    "JavaScript Runtime": 1.20,
    "Timeout/Performance": 1.15,
    "Auth/Permissions": 1.05,
    "Resource Loading": 0.80,
    "Validation/Input": 0.75,
    "Unknown": 1.0,
}

CRITICAL_ENDPOINTS = [
    '/checkout', 'action=checkout', '/cart', 'action=cart',
    '/payment', '/login', '/register', 'action=login', 'action=register'
]

def is_critical_flow(endpoints: List[str]) -> bool:
    for ep in endpoints:
        lower = ep.lower()
        if any(crit in lower for crit in CRITICAL_ENDPOINTS):
            return True
    return False

def parse_iso_time(ts_str: str) -> datetime:
    try:
        clean = ts_str.replace('Z', '+00:00')
        return datetime.fromisoformat(clean)
    except Exception:
        return datetime.now(timezone.utc)

def calculate_risk(
    category: CrashCategory,
    count: int,
    affected_sessions: List[str],
    affected_endpoints: List[str],
    last_seen_iso: str,
    recent_timestamps: List[str],
    reference_time: Optional[datetime] = None
) -> Tuple[float, RiskLevel, bool, List[dict]]:
    """
    Computes (risk_score, risk_level, is_spike, trend_over_time).
    """
    last_seen = parse_iso_time(last_seen_iso)
    if reference_time:
        now = reference_time
    else:
        wall_now = datetime.now(timezone.utc)
        # If last_seen is within the past 2 hours of wall clock, use wall clock; otherwise use last_seen
        if abs((wall_now - last_seen).total_seconds()) <= 7200:
            now = wall_now
        else:
            now = last_seen

    seconds_ago = max(0.0, (now - last_seen).total_seconds())

    # 1. Frequency Score (0 - 25)
    freq_score = min(25.0, math.log2(count + 1) * 4.5)

    # 2. Velocity & Spike Detection (0 - 30)
    crashes_last_60s = 0
    crashes_prior_5m = 0
    for ts in recent_timestamps:
        dt = parse_iso_time(ts)
        diff = (now - dt).total_seconds()
        if 0 <= diff <= 60:
            crashes_last_60s += 1
        elif 60 < diff <= 300:
            crashes_prior_5m += 1

    prior_rate_per_min = max(0.2, crashes_prior_5m / 4.0)
    is_spike = False
    velocity_score = 0.0

    if crashes_last_60s >= 3:
        ratio = crashes_last_60s / prior_rate_per_min
        if ratio >= 3.5:
            is_spike = True
            velocity_score = min(30.0, 18.0 + ratio * 2.0)
        else:
            velocity_score = min(20.0, crashes_last_60s * 3.0)
    else:
        velocity_score = min(10.0, crashes_last_60s * 2.5)

    # 3. User / Session Impact (0 - 25)
    distinct_sessions = len(set(affected_sessions))
    session_score = min(25.0, distinct_sessions * 4.0)

    # 4. Recency Score (0 - 20)
    if seconds_ago <= 120:
        recency_score = 20.0
    elif seconds_ago <= 600:
        recency_score = 14.0
    elif seconds_ago <= 3600:
        recency_score = 7.0
    else:
        recency_score = 2.0

    base_score = freq_score + velocity_score + session_score + recency_score
    cat_multiplier = CATEGORY_WEIGHTS.get(category, 1.0)
    flow_multiplier = 1.25 if is_critical_flow(affected_endpoints) else 1.0

    final_score = base_score * cat_multiplier * flow_multiplier
    final_score = round(max(0.0, min(100.0, final_score)), 1)

    if final_score >= 80.0:
        risk_level: RiskLevel = "CRITICAL"
    elif final_score >= 60.0:
        risk_level = "HIGH"
    elif final_score >= 35.0:
        risk_level = "MEDIUM"
    else:
        risk_level = "LOW"

    trend_over_time = build_trend(recent_timestamps, count, now)

    return final_score, risk_level, is_spike, trend_over_time

def build_trend(timestamps: List[str], total_count: int, now: Optional[datetime] = None) -> List[dict]:
    if now is None:
        now = datetime.now(timezone.utc)
    buckets = [0] * 6

    for ts in timestamps:
        dt = parse_iso_time(ts)
        diff_mins = (now - dt).total_seconds() / 60.0
        if 0 <= diff_mins < 30:
            idx = int(diff_mins // 5)
            if 0 <= idx < 6:
                buckets[5 - idx] += 1

    if sum(buckets) == 0:
        buckets = [max(1, total_count // 6)] * 6

    return [{"bucket": i + 1, "count": count} for i, count in enumerate(buckets)]
