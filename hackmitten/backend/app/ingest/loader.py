"""Schema-tolerant CSV/JSON/Parquet loader driven by a YAML column map."""
import csv
import json
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_MAP={"alert_id":["alert_id","id"],"ts":["timestamp","ts","time","created_at"],"source":["source","tool"],"service":["service","service_name"],"severity":["severity","level"],"alert_type":["alert_type","check_name","metric"],"message":["message","description","text"],"incident_id":["incident_id","incident"]}

def load_rows(path, column_map=None):
    path=Path(path); suffix=path.suffix.lower()
    if suffix==".csv":
        with path.open(newline="",encoding="utf-8-sig") as f: rows=list(csv.DictReader(f))
    elif suffix in (".json",".jsonl"):
        if suffix==".jsonl": rows=[json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
        else:
            value=json.loads(path.read_text(encoding="utf-8")); rows=value if isinstance(value,list) else value.get("alerts",value.get("data",[]))
    elif suffix==".parquet":
        try:
            import pandas as pd
        except ImportError as exc: raise RuntimeError("Parquet input requires pandas and a parquet engine") from exc
        rows=pd.read_parquet(path).to_dict(orient="records")
    else: raise ValueError(f"Unsupported file type: {suffix}")
    mapping=column_map or DEFAULT_MAP; normalized=[]; seen=set()
    for ix,row in enumerate(rows):
        out={}
        for field,candidates in mapping.items():
            if isinstance(candidates,str): candidates=[candidates]
            out[field]=next((row.get(name) for name in candidates if row.get(name) not in (None,"")),None)
        if not out["alert_id"]: out["alert_id"]=f"row-{ix+1}"
        if out["alert_id"] in seen: continue
        seen.add(out["alert_id"])
        if out["ts"]:
            dt=datetime.fromisoformat(str(out["ts"]).replace("Z","+00:00"))
            out["ts"]=(dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)).isoformat()
        else: out["ts"]=None
        out.setdefault("source","other"); out.setdefault("severity","warning"); out.setdefault("labels",{})
        normalized.append(out)
    fields=list(mapping)
    return normalized,{"input_rows":len(rows),"accepted_rows":len(normalized),"duplicates_removed":len(rows)-len(normalized),"null_rates":{f:round(sum(r.get(f) is None for r in normalized)/max(1,len(normalized)),4) for f in fields},"time_range":{"from":min((r["ts"] for r in normalized if r["ts"]),default=None),"to":max((r["ts"] for r in normalized if r["ts"]),default=None)}}
