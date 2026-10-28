"""Deterministic, default-on identifier masking for demo data and API output."""
import hashlib
import hmac
import ipaddress
import ipaddress
import os
import re

SALT = os.getenv("REDACTION_SALT", "signaldesk-demo-session").encode()
PATTERNS = [
    (re.compile(r"\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b"), "email"),
    (re.compile(r"\b(?:cust|customer)[-_]?[A-Za-z0-9]{3,}\b", re.I), "cust"),
    (re.compile(r"\b(?:token|key)[-_:= ]+[A-Za-z0-9._-]{8,}\b", re.I), "secret"),
    (re.compile(r"\b(?:[A-Za-z0-9-]+\.)+(?:internal|local|com|net|org)\b", re.I), "host"),
    (re.compile(r"\b(?:[A-Za-z0-9-]*\d[A-Za-z0-9-]*-(?:db|app|host|node)-\d+)\b", re.I), "host"),
    (re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b|\b[0-9a-fA-F:]{3,}:[0-9a-fA-F:]+\b"), "ip"),
]

def _mask_ip(match):
    value=match.group(0)
    try: ipaddress.ip_address(value)
    except ValueError: return value
    return _token(value,"ip")

def _token(value: str, kind: str) -> str:
    digest = hmac.new(SALT, value.lower().encode(), hashlib.sha256).hexdigest()[:4]
    return f"{kind}-{digest}"

def redact_text(value: str) -> str:
    for pattern, kind in PATTERNS:
        value = pattern.sub(_mask_ip if kind=="ip" else lambda m: _token(m.group(0), kind), value)
    return value

def redact(value):
    if isinstance(value, str):
        return redact_text(value)
    if isinstance(value, list):
        return [redact(item) for item in value]
    if isinstance(value, dict):
        return {key: redact(item) for key, item in value.items()}
    return value
