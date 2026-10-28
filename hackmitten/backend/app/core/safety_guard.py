"""Local proposal workflow. It has no monitoring-system write adapter by design."""
from datetime import datetime, timezone
import json
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).resolve().parents[3] / "signaldesk.sqlite3"

def _db():
    con = sqlite3.connect(DB_PATH)
    con.execute("CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, ts TEXT, actor TEXT, action TEXT, proposal_id TEXT, reason TEXT, evidence TEXT)")
    con.execute("CREATE TABLE IF NOT EXISTS proposals (id TEXT PRIMARY KEY, status TEXT, payload TEXT)")
    return con

def record_proposal(proposal_id: str, payload: dict):
    con = _db()
    con.execute("INSERT OR IGNORE INTO proposals VALUES (?, 'proposed', ?)", (proposal_id, json.dumps(payload)))
    con.commit(); con.close()

def decide(proposal_id: str, actor: str, reason: str, approve: bool):
    if not actor.strip() or not reason.strip():
        raise ValueError("Approver and reason are required")
    con = _db()
    row = con.execute("SELECT payload FROM proposals WHERE id=?", (proposal_id,)).fetchone()
    if not row:
        con.close(); raise KeyError(proposal_id)
    status = "approved_export_only" if approve else "rejected"
    con.execute("UPDATE proposals SET status=? WHERE id=?", (status, proposal_id))
    con.execute("INSERT INTO audit(ts,actor,action,proposal_id,reason,evidence) VALUES(?,?,?,?,?,?)",
                 (datetime.now(timezone.utc).isoformat(), actor, status, proposal_id, reason, row[0]))
    con.commit(); con.close()
    return json.loads(row[0])

def audit_entries():
    con = _db(); rows = con.execute("SELECT ts,actor,action,proposal_id,reason,evidence FROM audit ORDER BY id DESC").fetchall(); con.close()
    return [dict(zip(("ts","actor","action","proposal_id","reason","evidence"), r)) for r in rows]
