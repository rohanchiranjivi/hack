"""Clustering Engine for Crash Monitoring.

Computes normalized fingerprints, categorizes errors into predefined domains,
and groups duplicate/near-duplicate crashes using token similarity metrics.
"""

import re
import hashlib
from typing import Tuple, List, Set, Optional
from difflib import SequenceMatcher
from ..models import CrashCategory

CATEGORIES = [
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

# Patterns for normalization
RE_UUID = re.compile(r'[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}')
RE_HEX = re.compile(r'0x[0-9a-fA-F]+|[0-9a-fA-F]{16,}')
RE_TIMESTAMP = re.compile(r'\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?')
RE_NUMBERS = re.compile(r'\b\d+\b')
RE_URL_PARAMS = re.compile(r'\?[^ \t\n\r"\'<>]+')
RE_FILE_PATHS = re.compile(r'([A-Za-z]:\\[^:\n]+|/[a-zA-Z0-9_\-\./]+)(:\d+(:\d+)?)?')
RE_WEBPACK_HASH = re.compile(r'\.[a-f0-9]{8,20}\.')

def categorize_crash(error_type: str, message: str, http_status: Optional[int] = None, stack_trace: str = "") -> CrashCategory:
    combined = f"{error_type} {message} {stack_trace}".lower()

    # 1. Database
    if any(k in combined for k in [
        'database', 'db_pool', 'pool exhausted', 'poollimit', 'pg-pool', 'deadlock',
        'connection pool', 'sql', 'transaction deadlock', 'redis'
    ]):
        return "Database"

    # 2. Memory
    if any(k in combined for k in [
        'outofmemory', 'heap out of memory', 'memory leak', 'memory pressure',
        'heap limit', 'buffer allocation failed', 'memoryleak'
    ]):
        return "Memory"

    # 3. Resource Loading
    if 'resourceloaderror' in combined or any(k in combined for k in [
        'failed to load resource', '<img', '<script', '404_echo', 'nav-sprite'
    ]):
        return "Resource Loading"

    # 4. Timeout / Performance
    if any(k in combined for k in [
        'timeout', 'gateway timeout', 'timed out', 'latency', 'slow endpoint', '504'
    ]) or http_status == 504:
        return "Timeout/Performance"

    # 5. Auth / Permissions
    if any(k in combined for k in [
        'autherror', 'unauthorized', 'forbidden', 'session token', 'invalid credentials',
        'account_exists', 'auth_required'
    ]) or http_status in (401, 403):
        return "Auth/Permissions"

    # 6. Validation / Input
    if any(k in combined for k in [
        'badrequest', 'syntaxerror', 'json.parse', 'malformed', 'invalid json',
        'validation', 'invalid_name', 'invalid_email'
    ]) or http_status == 400:
        return "Validation/Input"

    # 7. JavaScript Runtime
    if any(k in combined for k in [
        'typeerror', 'referenceerror', 'uncaughtexception', 'unhandledrejection',
        'cannot read properties of', 'null dereference', 'reactrendererror',
        'invariant violation', 'undefined'
    ]):
        return "JavaScript Runtime"

    # 8. Network / HTTP
    if http_status is not None and http_status >= 400:
        return "Network/HTTP"
    if any(k in combined for k in [
        'networkerror', 'xhrerror', 'bad gateway', '502', '500', 'cors',
        'fetch failed', 'failed to fetch', 'connection reset', 'rate limit', '429'
    ]):
        return "Network/HTTP"

    return "Unknown"

def normalize_message(msg: str) -> str:
    if not msg:
        return "Empty error message"
    s = RE_UUID.sub('<UUID>', msg)
    s = RE_HEX.sub('<HEX>', s)
    s = RE_TIMESTAMP.sub('<TS>', s)
    s = RE_URL_PARAMS.sub('', s)
    s = RE_NUMBERS.sub('<N>', s)
    s = re.sub(r'\s+', ' ', s).strip()
    return s

def normalize_stack_frames(stack: str, max_frames: int = 4) -> str:
    if not stack:
        return ""
    lines = stack.split('\n')
    normalized_frames = []
    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        # Check if line looks like a stack frame (starts with 'at ')
        if stripped.startswith('at '):
            # Remove line/col numbers (:123:45)
            frame = re.sub(r':\d+(:\d+)?\)?$', '', stripped)
            # Remove webpack/bundle hashes
            frame = RE_WEBPACK_HASH.sub('.', frame)
            # Normalize paths to basenames
            frame = re.sub(r'\(?([A-Za-z]:\\[^)]+|/[^)]+/)([a-zA-Z0-9_\-\.]+)', r'\2', frame)
            normalized_frames.append(frame)
            if len(normalized_frames) >= max_frames:
                break
    return " | ".join(normalized_frames)

def normalize_endpoint(url: str) -> str:
    if not url:
        return "/"
    # Strip protocol and domain
    path = re.sub(r'^https?://[^/]+', '', url)
    # Strip query parameters
    path = RE_URL_PARAMS.sub('', path)
    # Replace numeric or UUID path params with :id
    path = RE_UUID.sub(':id', path)
    path = re.sub(r'/\d+(?=/|$)', '/:id', path)
    return path or "/"

def generate_fingerprint(
    category: CrashCategory,
    error_type: str,
    message: str,
    endpoint: str,
    stack_trace: str = ""
) -> Tuple[str, str]:
    """Generates a stable fingerprint hash and clean human-readable title."""
    norm_msg = normalize_message(message)
    norm_stack = normalize_stack_frames(stack_trace)
    norm_ep = normalize_endpoint(endpoint)

    # Core fingerprint seed
    seed = f"{category}::{error_type.strip()}::{norm_msg}::{norm_ep}::{norm_stack}"
    fp_hash = hashlib.sha256(seed.encode('utf-8')).hexdigest()[:24]

    # Generate descriptive title
    clean_title = norm_msg
    # Trim to 90 chars
    if len(clean_title) > 90:
        clean_title = clean_title[:87] + "..."
    if error_type and not clean_title.startswith(error_type):
        title = f"{error_type}: {clean_title}"
    else:
        title = clean_title

    return fp_hash, title

def calculate_token_similarity(s1: str, s2: str) -> float:
    """Calculates Jaccard token similarity between two normalized messages."""
    tokens1 = set(re.findall(r'\w+', s1.lower()))
    tokens2 = set(re.findall(r'\w+', s2.lower()))
    if not tokens1 or not tokens2:
        return 0.0
    intersection = tokens1.intersection(tokens2)
    union = tokens1.union(tokens2)
    return len(intersection) / len(union)

def calculate_sequence_similarity(s1: str, s2: str) -> float:
    """Levenshtein-based sequence similarity."""
    return SequenceMatcher(None, s1.lower(), s2.lower()).ratio()

def is_near_duplicate(norm_msg1: str, norm_msg2: str, threshold: float = 0.82) -> bool:
    """Determines whether two messages are near-duplicates."""
    if norm_msg1 == norm_msg2:
        return True
    jaccard = calculate_token_similarity(norm_msg1, norm_msg2)
    if jaccard >= threshold:
        return True
    seq_sim = calculate_sequence_similarity(norm_msg1, norm_msg2)
    return seq_sim >= threshold

def generate_explanation_and_fix(category: CrashCategory, error_type: str, message: str) -> Tuple[str, str]:
    """Generates plain-English explanation and suggested actionable fix."""
    lower_msg = message.lower()

    if category == "Database":
        if "pool" in lower_msg or "exhausted" in lower_msg:
            return (
                "Database connection pool capacity was completely saturated under traffic, causing incoming queries to stall and fail.",
                "Increase max connection pool limit (e.g. from 50 to 150), implement aggressive query timeouts, and ensure client connections are properly released in a finally block."
            )
        return (
            "A database layer operation failed or timed out during transaction execution.",
            "Verify database connectivity, inspect slow query logs, and review retry policies with exponential backoff."
        )

    if category == "Memory":
        return (
            "Memory usage reached dangerous thresholds, risking process crash or severe garbage collection pauses.",
            "Profile heap allocations for uncleared event listeners, unbounded in-memory caches, or large retained object arrays."
        )

    if category == "Timeout/Performance":
        return (
            "Upstream service or backend endpoint exceeded the maximum allowed latency SLA.",
            "Add request timeouts on upstream calls, implement circuit breakers, and optimize endpoint database queries."
        )

    if category == "JavaScript Runtime":
        if "cannot read properties of" in lower_msg or "null" in lower_msg or "undefined" in lower_msg:
            return (
                "Attempted to access properties of a null or undefined reference in client/server code.",
                "Add defensive optional chaining (e.g. user?.profile?.preferences) and validate API response payloads before rendering."
            )
        if "unhandled" in lower_msg:
            return (
                "An asynchronous promise rejected without an attached .catch() error handler.",
                "Ensure all Promise chains and async/await blocks are wrapped in try/catch or have dedicated .catch() handlers."
            )
        return (
            "Uncaught runtime exception occurred during execution.",
            "Inspect component call stack, add React Error Boundaries around critical widgets, and test edge-case null states."
        )

    if category == "Network/HTTP":
        if "502" in lower_msg or "gateway" in lower_msg:
            return (
                "Reverse proxy or load balancer received an invalid response from upstream microservices.",
                "Check upstream container health, verify port bindings, and inspect gateway proxy logs."
            )
        if "429" in lower_msg or "rate limit" in lower_msg:
            return (
                "Client was throttled after exceeding the allowable request rate.",
                "Implement client-side request debouncing/throttling and consider raising rate limits for trusted IPs."
            )
        return (
            "Network communication failed between client and backend service.",
            "Review CORS configuration, check DNS resolution, and verify target endpoint availability."
        )

    if category == "Resource Loading":
        return (
            "Static assets (images, stylesheets, or scripts) failed to load from the CDN or server (404/Network).",
            "Verify asset build paths, verify CDN cache rules, and provide fallback image handlers for missing media."
        )

    if category == "Auth/Permissions":
        return (
            "User request lacked valid credentials or attempted an unauthorized action.",
            "Verify session cookie expiration and redirect unauthenticated sessions gracefully to the login screen."
        )

    if category == "Validation/Input":
        return (
            "Input payload was malformed, unparseable, or failed schema validation constraints.",
            "Sanitize user inputs on the client before submission and return clear 400 validation error summaries."
        )

    return (
        "An unexpected error occurred in the application.",
        "Review stack trace and recent code deployments to identify the root cause."
    )

