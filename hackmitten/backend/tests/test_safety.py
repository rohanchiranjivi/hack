import sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from app.core.redaction import redact

class SafetyTests(unittest.TestCase):
    def test_redaction_covers_nested_api_payload(self):
        payload={"message":"Call host svc-01-host-2 at 10.10.1.4","nested":[{"customer_id":"cust-9988","email":"person@example.com"}]}
        output=str(redact(payload))
        for raw in ["svc-01-host-2","10.10.1.4","cust-9988","person@example.com"]: self.assertNotIn(raw,output)
    def test_no_monitoring_write_calls(self):
        root=Path(__file__).resolve().parents[1]/"app"
        source="\n".join(p.read_text(encoding="utf-8") for p in root.rglob("*.py"))
        self.assertNotRegex(source,r"requests\.(post|put|delete)\s*\(")
        self.assertNotIn("pagerduty_client.mute",source.lower())
    def test_guard_requires_explanation(self):
        from app.core.safety_guard import record_proposal,decide
        record_proposal("test-safety",{"action":"local test"})
        with self.assertRaises(ValueError): decide("test-safety","","",True)

if __name__=="__main__":unittest.main()
