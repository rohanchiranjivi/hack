import sys,unittest,tempfile,csv
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from app.ingest.synthetic import generate
from app.ingest.loader import load_rows
from app.core.redaction import redact_text
from app.engine.correlate import build_groups
from app.eval.metrics import evaluate
from app.engine.scoring import score_group

class CoreTests(unittest.TestCase):
    def test_generator_is_deterministic(self):
        self.assertEqual(generate(seed=7,days=3),generate(seed=7,days=3))
    def test_generator_contract(self):
        services,edges,incidents,alerts=generate(seed=2,days=7)
        self.assertEqual(len(services),70);self.assertTrue(edges);self.assertTrue(incidents);self.assertTrue(alerts)
        self.assertTrue(all("incident_id" in a for a in alerts))
    def test_loader_maps_dedupes_and_normalizes_timezone(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/"a.csv"
            p.write_text("id,time,level,service_name\n1,2026-01-01T12:00:00+02:00,error,api\n1,2026-01-01T12:00:00+02:00,error,api\n",encoding="utf-8")
            rows,report=load_rows(p)
            self.assertEqual(len(rows),1);self.assertTrue(rows[0]["ts"].endswith("10:00:00+00:00"));self.assertEqual(report["duplicates_removed"],1)
    def test_redacts_identifiers(self):
        text=redact_text("host svc-01-host-2 at 10.2.3.4 customer cust-1234 email a@b.com")
        for raw in ["10.2.3.4","cust-1234","a@b.com","svc-01-host-2"]: self.assertNotIn(raw,text)
        self.assertIn("2026-10-28T14:30:00+00:00",redact_text("2026-10-28T14:30:00+00:00"))
    def test_evaluation_is_bounded(self):
        s,e,i,a=generate(seed=5,days=7);groups=build_groups(a,s,e);m=evaluate(a,groups,i)
        self.assertGreaterEqual(m["incident_recall"],0);self.assertLessEqual(m["incident_recall"],1)
    def test_score_respects_recall_guard_floors(self):
        self.assertEqual(score_group([{"severity":"critical"}],1,False)[1],"P1")
        self.assertEqual(score_group([{"severity":"warning"}],1,True)[1],"P2")

if __name__=="__main__":unittest.main()
