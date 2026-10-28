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
    et_lower = (error_type or "").strip().lower()

    # 1. JavaScript Runtime (Check FIRST so TypeErrors/hydrations never get swallowed by HTTP 403 or DB keywords)
    if any(k in et_lower for k in ['typeerror', 'referenceerror', 'rangeerror', 'evalerror', 'urierror', 'reactrendererror', 'invariant']) or any(k in combined for k in [
        'cannot read properties of', 'is not a function', 'undefined (reading',
        'null dereference', 'reactrendererror', 'invariant violation', 'hydration render'
    ]):
        return "JavaScript Runtime"

    # 2. Validation / Input (Check BEFORE Database so SQL injection probes are categorized as Validation/Input, not DB)
    if any(k in et_lower for k in ['inputvalidation', 'validationerror', 'badrequest', 'syntaxerror', 'invalidinput']) or any(k in combined for k in [
        'malicious sql injection probe', 'sql injection probe', 'xss injection probe',
        'inputvalidationexception', 'invalid query parameter', 'malformed query',
        'malformed json', 'invalid json', 'badrequest'
    ]) or (http_status == 400 and 'sql injection' in combined):
        return "Validation/Input"

    # 3. Database
    if any(k in et_lower for k in ['databaseconnection', 'storagenotconfigured', 'poollimit', 'postgres', 'redis', 'deadlock']) or any(k in combined for k in [
        'persistent storage is not configured', 'upstash redis', 'databaseconnectiontimeout',
        'connection pool exhausted', 'poollimit', 'pg-pool', 'transaction deadlock',
        'db_pool', 'pool exhausted', 'database connection'
    ]):
        return "Database"

    # 4. Timeout / Performance
    if any(k in et_lower for k in ['gatewaytimeout', 'timeouterror', 'deadlineexceeded']) or any(k in combined for k in [
        '504 gateway timeout', 'gateway timeout', 'upstream catalog service failed to respond',
        'sla window', 'sla exceeded', 'request timeout', 'timed out'
    ]) or http_status == 504:
        return "Timeout/Performance"

    # 5. Memory
    if any(k in et_lower for k in ['outofmemory', 'heaplimit', 'memoryleak']) or any(k in combined for k in [
        'heap allocation failed', 'fatal javascript out of memory', 'heap out of memory',
        'memory leak', 'heap limit reached', 'buffer allocation failed', 'array buffer allocation failed'
    ]):
        return "Memory"

    # 6. Auth / Permissions
    if any(k in et_lower for k in ['unauthorizedaccess', 'authtokenforged', 'autherror', 'jsonwebtokenerror', 'forbidden']) or any(k in combined for k in [
        'authtokenforgederror', 'invalid signature', 'tampered header', 'session token',
        'invalid credentials', 'auth_required', 'unauthorized', 'forbidden'
    ]):
        return "Auth/Permissions"

    # 7. Resource Loading
    if 'resourceloaderror' in et_lower or any(k in combined for k in [
        'resourceloaderror', 'failed to load resource', '<img', '<script', '404_echo', 'nav-sprite'
    ]):
        return "Resource Loading"

    # 8. Network / HTTP
    if any(k in et_lower for k in ['ratelimit', 'badgateway', 'networkerror', 'httperror']) or any(k in combined for k in [
        'rate limit exceeded', 'too many requests', '429 too many requests', '502 bad gateway',
        'networkerror', 'xhrerror', 'bad gateway', 'fetch failed', 'failed to fetch'
    ]) or http_status == 429:
        return "Network/HTTP"

    # 9. Fallbacks based on explicit HTTP status codes (ONLY when error_type did not match above)
    if http_status == 400:
        return "Validation/Input"
    if http_status in (401, 403):
        return "Auth/Permissions"
    if http_status == 503:
        return "Database"
    if http_status is not None and http_status >= 500:
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
        if "storage" in lower_msg or "not configured" in lower_msg or "redis" in lower_msg or "503" in lower_msg:
            return (
                "Persistent storage is unconfigured on the Vercel deployment (missing Upstash Redis credentials), causing engine routes to fail with HTTP 503.",
                "1. In Vercel Project Dashboard (Settings > Environment Variables), configure UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.\n2. In lib/backend.ts, add an in-memory Map fallback when Redis credentials are not present so the site degrades gracefully.\n3. Redeploy to Vercel and verify POST /api/engine returns 200 OK."
            )
        if "pool" in lower_msg or "exhausted" in lower_msg:
            return (
                "Database connection pool capacity was completely saturated under traffic, causing incoming queries to stall and fail.",
                "1. Increase max connection pool limit (e.g. from 50 to 150) in db/connection.ts.\n2. Enforce strict connection lease timeouts (acquireTimeout: 3000ms).\n3. Ensure all query execution blocks release connections in a guaranteed finally { client.release(); } block."
            )
        if "deadlock" in lower_msg or "inventory" in lower_msg:
            return (
                "Concurrent checkout transactions competed for identical database row locks in conflicting order, triggering a transaction deadlock.",
                "1. Sort SKU IDs alphabetically before acquiring locks in batch transactions to eliminate circular dependency.\n2. Use SELECT ... FOR UPDATE SKIP LOCKED for high-contention checkout carts.\n3. Wrap inventory updates in an automatic retry loop with exponential jitter."
            )
        return (
            "A database layer operation failed or timed out during transaction execution.",
            "Verify database connectivity, inspect slow query logs, and review retry policies with exponential backoff."
        )

    if category == "Memory":
        return (
            "JavaScript heap memory approached or exceeded maximum threshold, risking container termination and GC freeze.",
            "1. Audit in-memory buffers; replace raw arrays with bounded LRU caches (max: 1000 items).\n2. Ensure unmounted React components and listeners detach event subscribers cleanly.\n3. Increase memory ceiling in container config: NODE_OPTIONS='--max-old-space-size=2048'."
        )

    if category == "Timeout/Performance":
        return (
            "Upstream microservice or edge compute function exceeded SLA response timeout under concurrent bot load.",
            "1. Implement circuit breaker pattern (fail-fast after 3 consecutive timeouts).\n2. Add edge caching headers: Cache-Control: s-maxage=60, stale-while-revalidate=300.\n3. Optimize slow queries with composite indexes on foreign keys."
        )

    if category == "JavaScript Runtime":
        if "cannot read properties of" in lower_msg or "null" in lower_msg or "undefined" in lower_msg:
            return (
                "Attempted to access properties of a null or undefined reference during client/server hydration.",
                "1. Implement defensive optional chaining (e.g., product?.price ?? 0.00).\n2. Validate incoming API schema contracts with Zod before passing to React component props.\n3. Wrap high-risk component trees in React Error Boundaries with graceful fallback cards."
            )
        if "unhandled" in lower_msg:
            return (
                "An asynchronous promise rejected without an attached .catch() error handler.",
                "1. Ensure all async/await calls are enclosed in try/catch blocks.\n2. Attach global process.on('unhandledRejection') and window.addEventListener('unhandledrejection') handlers.\n3. Propagate rejections to standard HTTP error middleware."
            )
        return (
            "Uncaught runtime exception occurred during execution.",
            "Inspect component call stack, add React Error Boundaries around critical widgets, and test edge-case null states."
        )

    if category == "Network/HTTP":
        if "429" in lower_msg or "rate limit" in lower_msg:
            return (
                "Distributed bot traffic storm overwhelmed endpoint rate quotas, causing mass rejections.",
                "1. Implement sliding-window rate limiting with Redis Token Bucket at the reverse proxy/WAF.\n2. Return Retry-After HTTP response headers and exponential backoff guidelines to clients.\n3. Apply bot mitigation rules (Cloudflare Bot Management / reCAPTCHA v3) on sensitive endpoints."
            )
        if "502" in lower_msg or "gateway" in lower_msg:
            return (
                "Reverse proxy or load balancer received an invalid response from upstream microservices.",
                "1. Inspect upstream service health and restart crashed worker processes.\n2. Verify upstream keep-alive timeouts match proxy gateway timeouts.\n3. Add health check probes with automatic pod recycling in Kubernetes / Docker."
            )
        return (
            "Network communication failed between client and backend service.",
            "Review CORS configuration, check DNS resolution, and verify target endpoint availability."
        )

    if category == "Auth/Permissions":
        return (
            "Tampered, forged, or unauthenticated session credentials detected during protected transaction.",
            "1. Rotate JWT signing secret and enforce strict HMAC-SHA256 signature verification.\n2. Check token expiration (exp), issuer (iss), and audience (aud) claims on every request.\n3. Terminate compromised sessions immediately by revoking tokens in Redis cache."
        )

    if category == "Validation/Input":
        return (
            "Malicious SQL/XSS injection probe or malformed JSON payload detected in query/body input.",
            "1. Parameterize all SQL queries using prepared statements — never concatenate user input into queries.\n2. Sanitize and escape all user input strings using DOMPurify / validator.js.\n3. Enforce strict request body validation with Pydantic / Zod schemas."
        )

    return (
        "An unexpected error occurred in the application.",
        "Review stack trace and recent code deployments to identify the root cause."
    )

