# SignalDesk Crash Monitor

An end-to-end real-time crash monitoring, automated clustering, and risk scoring platform built with **FastAPI**, **SQLite**, **Server-Sent Events (SSE)**, and **React + Vite**.

SignalDesk continuously ingests raw crash reports from monitored client sites, strips volatile identifiers into normalized fingerprints, groups duplicate and near-duplicate failures into actionable clusters, calculates risk scores, and surfaces high-risk errors at the top of an intuitive dashboard.

---

## Architecture

```mermaid
flowchart TD
    Client["CrashWeb Client (Reporter SDK)"] -->|POST /api/crashes (API Key Auth)| Ingestion["Ingestion API & Rate Limiter"]
    Health["Client Health Checker (10s Ping)"] -->|Downtime / Timeout Events| Ingestion

    subgraph Processing["Processing Pipeline"]
        Ingestion --> Categorize["Domain Categorizer (DB, Memory, JS, Network...)"]
        Categorize --> Normalize["Normalizer (UUID, Timestamp, Path, Number stripping)"]
        Normalize --> Fingerprint["Fingerprint Generator (SHA-256 Seed)"]
        Fingerprint --> Similarity["Near-Duplicate Jaccard Matcher"]
        Similarity --> Scoring["Risk Scoring Engine (Velocity, Spikes, Session Impact)"]
    end

    Scoring --> DB[(SQLite Database: monitoring.db)]
    Scoring --> SSE["Server-Sent Events Broadcaster (/api/stream)"]

    subgraph UI["SignalDesk Dashboard (React 18 + Vite)"]
        SSE -->|Instant Push Updates| LiveFeed["Live Ingestion Stream"]
        SSE -->|State Refresh| HighRisk["High-Risk Spotlight Panel"]
        SSE -->|Cluster Updates| ClusterView["Interactive Clusters Grid & Filters"]
        ClusterView --> DetailDrawer["Cluster Detail Drawer (Stack Trace & Fixes)"]
    end
```

---

## Key Capabilities

### 1. Ingestion API (`POST /api/crashes`)
- **Validation**: Schema-validated via Pydantic model (`CrashReport`).
- **Authentication**: Project API key required via header (`X-Project-Key`) or query parameter (`apiKey`).
- **Rate-Limiting**: Token bucket / sliding window limiter (max 60 reports per 10s window per project) to protect against DDoS or reporting storms.
- **Persistence**: ACID-compliant SQLite storage (`data/monitoring.db`).

### 2. Clustering & Normalization Engine
- **Message Normalization**: Strips ephemeral UUIDs (`[0-9a-fA-F-]{36}`), hex memory addresses, timestamps, file system paths, URL query strings, and numerical IDs into canonical tokens (`<UUID>`, `<HEX>`, `<TS>`, `<N>`).
- **Stack Frame Normalization**: Extracts the top 4 stack frames, stripping line/column numbers, source map hashes, and webpack build prefixes.
- **Predefined Error Categories**:
  1. `Database` (Pool exhaustion, deadlock, query timeouts)
  2. `Memory` (Heap pressure, buffer allocations, leaks)
  3. `JavaScript Runtime` (TypeErrors, unhandled rejections, React boundaries)
  4. `Network/HTTP` (4xx, 5xx, gateway errors, CORS, 429)
  5. `Timeout/Performance` (Gateway 504 timeouts, degraded endpoints)
  6. `Resource Loading` (Failed asset fetches, 404 images/scripts)
  7. `Auth/Permissions` (401, 403, invalid tokens, session expiry)
  8. `Validation/Input` (Malformed payloads, JSON syntax errors)
  9. `Unknown`
- **Similarity Merging**: Computes Jaccard token similarity and Levenshtein sequence matching; merges near-duplicate error variations ($\ge 0.82$ similarity) into existing clusters.

### 3. Explainable Risk Scoring Engine
Calculates risk on a 0–100 scale:
$$\text{Score} = \min\left(100, \; (S_{\text{freq}} + S_{\text{velocity}} + S_{\text{sessions}} + S_{\text{recency}}) \times w_{\text{category}} \times w_{\text{critical\_flow}}\right)$$

- **Category Weights**: Database ($1.35\times$), Memory ($1.30\times$), Network 5xx ($1.25\times$), JS Runtime ($1.20\times$), Resource Loading ($0.80\times$).
- **Critical Flow Multiplier**: $1.25\times$ boost if the crash occurs on checkout, cart, or authentication routes.
- **Spike Detection**: Detects $\ge 4\times$ or $5\times$ surge in error frequency within 60 seconds relative to the prior baseline, immediately raising a `SPIKE DETECTED` alert.
- **Risk Levels**:
  - `CRITICAL` ($\ge 80$, Bright Red)
  - `HIGH` ($\ge 60$, Amber/Orange)
  - `MEDIUM` ($\ge 35$, Yellow)
  - `LOW` ($< 35$, Slate/Blue)
- **Automated Fixes**: Generates plain-English root cause explanations and concrete, actionable code remediation recommendations.

### 4. Real-time Dashboard UI
- **Top Bar**: Live status of the victim site (`HEALTHY`, `DEGRADED`, `DOWN`), real-time ping latency, uptime %, crash rate, active clusters, and total crashes.
- **High-Risk Errors Spotlight**: Auto-surfaced critical incidents pinned at the top with plain-English impact summaries and suggested fixes.
- **Cluster View**: Search, category filters, status filters (`Active`, `Resolved`, `Ignored`), sort by risk/count/recency, and category distribution bar chart.
- **Cluster Detail Drawer**: Syntax-highlighted stack trace with 1-click copy, affected pages, affected browsers, occurrences list, and resolution buttons.
- **Real-Time SSE Stream**: Live ticker drawer receiving events via `/api/stream` with zero page reloads.
- **Exporting**: 1-click export of structured reports as **JSON** or **CSV**.
- **Dark & Light Mode**: Accessible on-call dark mode toggle.

### 5. Client Health Checker
- Async background worker that pings `http://localhost:3000` every 10 seconds.
- Automatically calculates uptime %, records latency, and if the site goes down or returns 5xx, records a synthetic crash event in the dashboard!

---

## Quickstart

### 1. Requirements
- Python 3.11+
- Node.js 20+
- npm

### 2. Setup & Run
```sh
# Backend
cd backend
python -m venv .venv
# On Windows:
.venv\Scripts\Activate.ps1
# On Linux/macOS:
source .venv/bin/activate

pip install -r requirements.txt httpx pytest
python -m app.engine.seed   # Optional: pre-seed demo clusters
python -m uvicorn app.main:app --port 8000

# Frontend (in another terminal)
cd ../frontend
npm install
npm run dev -- --port 5173
```

Open Dashboard: [http://localhost:5173](http://localhost:5173)  
API Docs: [http://localhost:8000/docs](http://localhost:8000/docs)

---

## Running Unit Tests

```sh
# Run clustering and risk scoring tests
$env:PYTHONPATH="hackmitten/backend"
hackmitten/backend/.venv/Scripts/pytest hackmitten/backend/tests/
```
All 15 unit tests pass, verifying normalization, fingerprinting, near-duplicate merging, risk scoring, and safety guards.

---

## Presentation Walkthrough for Judges

1. **Open Dashboard**: Go to [http://localhost:5173](http://localhost:5173). Observe the clean, intuitive top status bar, active clusters, and the **High-Risk Errors Spotlight**.
2. **Open CrashWeb Control Panel**: Go to [http://localhost:3000/chaos](http://localhost:3000/chaos).
3. **Start Automated Bots**: In the Control Panel, set mode to **STRESS** or **RANDOM** and click **START BOTS**.
4. **Watch Real-Time Clustering**: Switch back to [http://localhost:5173]. Within seconds:
   - Live stream ticker pulses with incoming crashes.
   - Crash rate climbs.
   - Database Connection Pool and Gateway Timeout errors surge into the **CRITICAL** risk tier and trigger a spike alert banner!
5. **Inspect Cluster Detail**: Click the top High-Risk card to open the drawer. View the formatted stack trace, plain-English explanation, and click **Mark as Resolved**.
6. **Export Report**: Click **Export JSON** or **CSV** to download a complete incident debrief.
