.PHONY: dev seed test eval test-safety frontend
dev:
	cd backend && python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
frontend:
	cd frontend && npm run dev
seed:
	cd backend && python -c "from app.ingest.synthetic import generate; import json,pathlib; s,e,i,a=generate(); p=pathlib.Path('../data/synthetic'); p.mkdir(parents=True,exist_ok=True); [ (p/name).write_text(json.dumps(data,indent=2),encoding='utf-8') for name,data in [('services.json',s),('edges.json',e),('incidents.json',i),('alerts.json',a)] ]; print(f'Seeded {len(a)} alerts, {len(i)} incidents, {len(s)} services')"
test:
	cd backend && python -m unittest discover -s tests -v
test-safety:
	cd backend && python -m unittest discover -s tests -p 'test_safety.py' -v
eval:
	cd backend && python -m app.eval.run
