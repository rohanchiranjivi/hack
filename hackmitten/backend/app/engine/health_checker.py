"""Background health checker for monitored client URLs."""

import asyncio
import time
from datetime import datetime, timezone
import httpx
from .storage import get_all_projects, record_health_check
from .sse import broadcaster

_running = False

async def ping_project(project: dict, client: httpx.AsyncClient):
    project_id = project['project_id']
    target_url = project['target_url']
    start_time = time.time()
    status_code = 0
    is_up = False
    latency_ms = 0.0

    try:
        # Check target health
        # Prefer /api/engine if crashweb or base url
        ping_url = target_url
        if target_url.endswith(':3000') or target_url.endswith(':3000/'):
            ping_url = target_url.rstrip('/') + '/api/engine'

        resp = await client.get(ping_url, timeout=3.5)
        latency_ms = (time.time() - start_time) * 1000.0
        status_code = resp.status_code
        is_up = (200 <= status_code < 500)
    except httpx.TimeoutException:
        latency_ms = (time.time() - start_time) * 1000.0
        status_code = 504
        is_up = False
    except Exception as err:
        latency_ms = (time.time() - start_time) * 1000.0
        status_code = 500
        is_up = False

    record_health_check(project_id, status_code, latency_ms, is_up)

    health_info = {
        "projectId": project_id,
        "targetUrl": target_url,
        "status": "Healthy" if is_up and latency_ms < 1500 else ("Degraded" if is_up else "Down"),
        "statusCode": status_code,
        "latencyMs": round(latency_ms, 1),
        "isUp": is_up,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

    # Broadcast to SSE listeners
    await broadcaster.broadcast("health_check", health_info)

    # If the check failed, create a synthetic health check crash event
    if not is_up:
        from ..main import process_incoming_crash
        from ..models import CrashReport
        crash = CrashReport(
            projectId=project_id,
            timestamp=datetime.now(timezone.utc).isoformat(),
            errorType="HealthCheckFailure",
            message=f"Monitored endpoint {target_url} health check failed with HTTP {status_code} (Latency: {round(latency_ms)}ms)",
            url=target_url,
            httpStatus=status_code,
            severityHint="critical",
            environment="production",
            metadata={"latencyMs": latency_ms, "targetUrl": target_url}
        )
        await process_incoming_crash(crash)

async def health_check_loop():
    global _running
    _running = True
    async with httpx.AsyncClient(verify=False) as client:
        while _running:
            try:
                projects = get_all_projects()
                for project in projects:
                    await ping_project(project, client)
            except Exception as e:
                pass
            await asyncio.sleep(10)

def stop_health_checker():
    global _running
    _running = False

