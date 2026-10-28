"""SQLite persistent database storage for crash monitoring system."""

import sqlite3
import json
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

DB_DIR = Path(__file__).resolve().parents[2] / "data"
DB_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DB_DIR / "monitoring.db"

_lock = threading.Lock()

def get_db():
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with _lock:
        conn = get_db()
        cursor = conn.cursor()

        # Projects table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS projects (
            project_id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            target_url TEXT NOT NULL,
            api_key TEXT NOT NULL,
            created_at TEXT NOT NULL,
            health_status TEXT DEFAULT 'Healthy',
            last_latency_ms REAL DEFAULT 0.0,
            uptime_pct REAL DEFAULT 100.0
        )
        """)

        # Crashes table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS crashes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            error_type TEXT NOT NULL,
            message TEXT NOT NULL,
            stack_trace TEXT,
            url TEXT,
            http_status INTEGER,
            user_agent TEXT,
            browser TEXT,
            os TEXT,
            session_id TEXT,
            bot_id TEXT,
            severity_hint TEXT,
            environment TEXT,
            metadata TEXT,
            fingerprint TEXT,
            cluster_id TEXT
        )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_crashes_project ON crashes(project_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_crashes_fingerprint ON crashes(fingerprint)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_crashes_timestamp ON crashes(timestamp)")

        # Clusters table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS clusters (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            fingerprint TEXT NOT NULL UNIQUE,
            title TEXT NOT NULL,
            category TEXT NOT NULL,
            count INTEGER DEFAULT 1,
            risk_score REAL DEFAULT 0.0,
            risk_level TEXT DEFAULT 'LOW',
            first_seen TEXT NOT NULL,
            last_seen TEXT NOT NULL,
            affected_endpoints TEXT,
            affected_browsers TEXT,
            affected_sessions TEXT,
            sample_stack_trace TEXT,
            sample_message TEXT,
            status TEXT DEFAULT 'active',
            is_spike INTEGER DEFAULT 0,
            plain_explanation TEXT,
            suggested_fix TEXT
        )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_clusters_project ON clusters(project_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_clusters_risk ON clusters(risk_score DESC)")

        # Health checks table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS health_checks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            status_code INTEGER,
            latency_ms REAL,
            is_up INTEGER
        )
        """)

        # Pre-seed default CrashWeb project if not exists
        cursor.execute("SELECT project_id FROM projects WHERE project_id = 'proj_crashweb_01'")
        if not cursor.fetchone():
            cursor.execute("""
            INSERT INTO projects (project_id, name, target_url, api_key, created_at, health_status, last_latency_ms, uptime_pct)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                'proj_crashweb_01',
                'Zon Commerce (CrashWeb Test Site)',
                'http://localhost:3000',
                'key_live_crashweb_2026',
                datetime.now(timezone.utc).isoformat(),
                'Healthy',
                42.0,
                100.0
            ))

        conn.commit()
        conn.close()

# Auto-initialize tables
init_db()

def get_project(project_id: str) -> Optional[dict]:
    with _lock:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM projects WHERE project_id = ?", (project_id,))
        row = cursor.fetchone()
        conn.close()
        return dict(row) if row else None

def get_all_projects() -> list[dict]:
    with _lock:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM projects ORDER BY created_at DESC")
        rows = [dict(r) for r in cursor.fetchall()]
        conn.close()
        return rows

def save_project(project_id: str, name: str, target_url: str, api_key: str):
    with _lock:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("""
        INSERT INTO projects (project_id, name, target_url, api_key, created_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(project_id) DO UPDATE SET
            name = excluded.name,
            target_url = excluded.target_url,
            api_key = excluded.api_key
        """, (project_id, name, target_url, api_key, datetime.now(timezone.utc).isoformat()))
        conn.commit()
        conn.close()

def insert_crash(crash_dict: dict) -> int:
    with _lock:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("""
        INSERT INTO crashes (
            project_id, timestamp, error_type, message, stack_trace, url, http_status,
            user_agent, browser, os, session_id, bot_id, severity_hint, environment,
            metadata, fingerprint, cluster_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            crash_dict.get('projectId', 'proj_crashweb_01'),
            crash_dict.get('timestamp') or datetime.now(timezone.utc).isoformat(),
            crash_dict.get('errorType', 'Error'),
            crash_dict.get('message', ''),
            crash_dict.get('stackTrace', ''),
            crash_dict.get('url', '/'),
            crash_dict.get('httpStatus'),
            crash_dict.get('userAgent', ''),
            crash_dict.get('browser', 'Unknown'),
            crash_dict.get('os', 'Unknown'),
            crash_dict.get('sessionId'),
            crash_dict.get('botId'),
            crash_dict.get('severityHint', 'medium'),
            crash_dict.get('environment', 'production'),
            json.dumps(crash_dict.get('metadata', {})),
            crash_dict.get('fingerprint', ''),
            crash_dict.get('clusterId', '')
        ))
        crash_id = cursor.lastrowid
        conn.commit()
        conn.close()
        return crash_id

def get_crashes(project_id: str = 'proj_crashweb_01', limit: int = 100, cluster_id: Optional[str] = None) -> list[dict]:
    with _lock:
        conn = get_db()
        cursor = conn.cursor()
        if cluster_id:
            cursor.execute("""
            SELECT * FROM crashes
            WHERE project_id = ? AND cluster_id = ?
            ORDER BY id DESC LIMIT ?
            """, (project_id, cluster_id, limit))
        else:
            cursor.execute("""
            SELECT * FROM crashes
            WHERE project_id = ?
            ORDER BY id DESC LIMIT ?
            """, (project_id, limit))
        rows = [dict(r) for r in cursor.fetchall()]
        conn.close()

        # Parse metadata json
        for r in rows:
            if r.get('metadata'):
                try:
                    r['metadata'] = json.loads(r['metadata'])
                except Exception:
                    r['metadata'] = {}
        return rows

def get_all_clusters(project_id: str = 'proj_crashweb_01', status: Optional[str] = None) -> list[dict]:
    with _lock:
        conn = get_db()
        cursor = conn.cursor()
        if status and status != 'all':
            cursor.execute("""
            SELECT * FROM clusters
            WHERE project_id = ? AND status = ?
            ORDER BY risk_score DESC, last_seen DESC
            """, (project_id, status))
        else:
            cursor.execute("""
            SELECT * FROM clusters
            WHERE project_id = ?
            ORDER BY risk_score DESC, last_seen DESC
            """, (project_id,))
        rows = [dict(r) for r in cursor.fetchall()]
        conn.close()

        # Parse JSON fields
        for r in rows:
            for field in ('affected_endpoints', 'affected_browsers', 'affected_sessions'):
                if r.get(field):
                    try:
                        r[field] = json.loads(r[field])
                    except Exception:
                        r[field] = []
                else:
                    r[field] = []
            r['is_spike'] = bool(r.get('is_spike'))
        return rows

def get_cluster(cluster_id: str) -> Optional[dict]:
    with _lock:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM clusters WHERE id = ?", (cluster_id,))
        row = cursor.fetchone()
        conn.close()
        if not row:
            return None
        d = dict(row)
        for field in ('affected_endpoints', 'affected_browsers', 'affected_sessions'):
            if d.get(field):
                try:
                    d[field] = json.loads(d[field])
                except Exception:
                    d[field] = []
            else:
                d[field] = []
        d['is_spike'] = bool(d.get('is_spike'))
        return d

def find_cluster_by_fingerprint(fingerprint: str) -> Optional[dict]:
    with _lock:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM clusters WHERE fingerprint = ?", (fingerprint,))
        row = cursor.fetchone()
        conn.close()
        if not row:
            return None
        d = dict(row)
        for field in ('affected_endpoints', 'affected_browsers', 'affected_sessions'):
            if d.get(field):
                try:
                    d[field] = json.loads(d[field])
                except Exception:
                    d[field] = []
            else:
                d[field] = []
        return d

def upsert_cluster(c: dict):
    with _lock:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("""
        INSERT INTO clusters (
            id, project_id, fingerprint, title, category, count, risk_score, risk_level,
            first_seen, last_seen, affected_endpoints, affected_browsers, affected_sessions,
            sample_stack_trace, sample_message, status, is_spike, plain_explanation, suggested_fix
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(fingerprint) DO UPDATE SET
            count = excluded.count,
            risk_score = excluded.risk_score,
            risk_level = excluded.risk_level,
            last_seen = excluded.last_seen,
            affected_endpoints = excluded.affected_endpoints,
            affected_browsers = excluded.affected_browsers,
            affected_sessions = excluded.affected_sessions,
            sample_stack_trace = excluded.sample_stack_trace,
            sample_message = excluded.sample_message,
            is_spike = excluded.is_spike,
            plain_explanation = excluded.plain_explanation,
            suggested_fix = excluded.suggested_fix
        """, (
            c['id'],
            c.get('project_id', 'proj_crashweb_01'),
            c['fingerprint'],
            c['title'],
            c['category'],
            c['count'],
            c['risk_score'],
            c['risk_level'],
            c['first_seen'],
            c['last_seen'],
            json.dumps(c.get('affected_endpoints', [])),
            json.dumps(c.get('affected_browsers', [])),
            json.dumps(c.get('affected_sessions', [])),
            c.get('sample_stack_trace', ''),
            c.get('sample_message', ''),
            c.get('status', 'active'),
            1 if c.get('is_spike') else 0,
            c.get('plain_explanation', ''),
            c.get('suggested_fix', '')
        ))
        conn.commit()
        conn.close()

def update_cluster_status(cluster_id: str, status: str):
    with _lock:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("UPDATE clusters SET status = ? WHERE id = ?", (status, cluster_id))
        conn.commit()
        conn.close()

def record_health_check(project_id: str, status_code: int, latency_ms: float, is_up: bool):
    with _lock:
        conn = get_db()
        cursor = conn.cursor()
        now = datetime.now(timezone.utc).isoformat()
        cursor.execute("""
        INSERT INTO health_checks (project_id, timestamp, status_code, latency_ms, is_up)
        VALUES (?, ?, ?, ?, ?)
        """, (project_id, now, status_code, latency_ms, 1 if is_up else 0))

        # Update project table summary
        # Compute uptime over last 50 checks
        cursor.execute("""
        SELECT AVG(is_up) * 100 as uptime, AVG(latency_ms) as avg_latency
        FROM (SELECT is_up, latency_ms FROM health_checks WHERE project_id = ? ORDER BY id DESC LIMIT 50)
        """, (project_id,))
        stats = cursor.fetchone()
        uptime = round(stats['uptime'] if stats and stats['uptime'] is not None else 100.0, 1)

        health_status = "Healthy" if is_up and latency_ms < 1500 else ("Degraded" if is_up else "Down")

        cursor.execute("""
        UPDATE projects SET
            health_status = ?,
            last_latency_ms = ?,
            uptime_pct = ?
        WHERE project_id = ?
        """, (health_status, round(latency_ms, 1), uptime, project_id))

        conn.commit()
        conn.close()

def get_recent_crash_timestamps(project_id: str = 'proj_crashweb_01', limit: int = 100) -> list[str]:
    with _lock:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT timestamp FROM crashes WHERE project_id = ? ORDER BY id DESC LIMIT ?", (project_id, limit))
        rows = [r['timestamp'] for r in cursor.fetchall()]
        conn.close()
        return rows

def get_cluster_crash_timestamps(cluster_id: str, limit: int = 100) -> list[str]:
    with _lock:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT timestamp FROM crashes WHERE cluster_id = ? ORDER BY id DESC LIMIT ?", (cluster_id, limit))
        rows = [r['timestamp'] for r in cursor.fetchall()]
        conn.close()
        return rows

def reset_database():
    with _lock:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM crashes")
        cursor.execute("DELETE FROM clusters")
        cursor.execute("DELETE FROM health_checks")
        conn.commit()
        conn.close()

