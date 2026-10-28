"""Canonical data contracts shared by loaders and API clients."""
from datetime import datetime, timezone
from typing import Any, Literal
from pydantic import BaseModel, Field

# Existing SignalDesk models
class Alert(BaseModel):
    alert_id: str
    ts: datetime
    source: Literal["monitoring","logging","uptime","status_page","other"]="other"
    service: str
    severity: Literal["info","warning","error","critical"]="warning"
    alert_type: str="unknown"
    message: str=""
    host: str|None=None
    ip: str|None=None
    customer_id: str|None=None
    metric_name: str|None=None
    metric_value: float|None=None
    threshold: float|None=None
    labels: dict[str,Any]=Field(default_factory=dict)
    incident_id: str|None=None
    noise_kind: str|None=None

class Incident(BaseModel):
    incident_id: str
    start: datetime
    end: datetime|None=None
    root_cause_service: str
    root_cause_category: str
    root_cause_text: str=""
    severity: Literal["info","warning","error","critical"]="error"
    linked_alert_ids: list[str]=Field(default_factory=list)

class ServiceEdge(BaseModel):
    upstream: str
    downstream: str
    edge_type: Literal["calls","depends_on","hosts"]="depends_on"
    weight: float=1.0

class Service(BaseModel):
    name: str
    tier: int
    team: str
    kind: Literal["db","cache","queue","gateway","app","infra","status_page"]

# ==========================================
# Crash Monitoring Data Contracts
# ==========================================

CrashCategory = Literal[
    "JavaScript Runtime",
    "Network/HTTP",
    "Database",
    "Timeout/Performance",
    "Memory",
    "Resource Loading",
    "Auth/Permissions",
    "Validation/Input",
    "Unknown",
]

RiskLevel = Literal["CRITICAL", "HIGH", "MEDIUM", "LOW"]

class CrashReport(BaseModel):
    projectId: str = Field(..., description="Target project identifier")
    timestamp: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    errorType: str = Field(..., description="Exception or error type")
    message: str = Field(..., description="Human-readable crash message")
    stackTrace: str = Field(default="", description="Stack trace if available")
    url: str = Field(default="/", description="URL or endpoint where crash occurred")
    httpStatus: int | None = Field(default=None, description="HTTP status code if applicable")
    userAgent: str | None = Field(default=None, description="User agent string")
    browser: str | None = Field(default=None, description="Browser family")
    os: str | None = Field(default=None, description="Operating system")
    sessionId: str | None = Field(default=None, description="Client or user session ID")
    botId: str | None = Field(default=None, description="Bot identifier if triggered by automated agent")
    severityHint: Literal["low", "medium", "high", "critical"] | None = Field(default="medium")
    environment: str = Field(default="production")
    metadata: dict[str, Any] = Field(default_factory=dict)

class Cluster(BaseModel):
    id: str
    fingerprint: str
    title: str
    category: CrashCategory
    count: int
    risk_score: float = Field(..., description="Risk score between 0 and 100")
    risk_level: RiskLevel
    first_seen: str
    last_seen: str
    affected_endpoints: list[str] = Field(default_factory=list)
    affected_browsers: list[str] = Field(default_factory=list)
    affected_sessions: list[str] = Field(default_factory=list)
    sample_stack_trace: str = ""
    sample_message: str = ""
    status: Literal["active", "resolved", "ignored"] = "active"
    trend_over_time: list[dict[str, Any]] = Field(default_factory=list)
    is_spike: bool = False
    plain_explanation: str = ""
    suggested_fix: str = ""

class ClusterUpdate(BaseModel):
    status: Literal["active", "resolved", "ignored"]

class Project(BaseModel):
    projectId: str
    name: str
    targetUrl: str
    apiKey: str
    createdAt: str
    healthStatus: Literal["Healthy", "Degraded", "Down"] = "Healthy"
    lastLatencyMs: float = 0.0
    uptimePct: float = 100.0

class ProjectRegistration(BaseModel):
    projectId: str
    name: str
    targetUrl: str
    apiKey: str | None = None

class HealthStatus(BaseModel):
    status: Literal["Healthy", "Degraded", "Down"]
    latencyMs: float
    statusCode: int
    uptimePct: float
    lastChecked: str
    targetUrl: str
