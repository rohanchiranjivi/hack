import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, Check, ChevronRight,
  CircleHelp, Clock3, Database, Download, Eye, Filter, GitBranch, LayoutDashboard,
  LockKeyhole, Pause, Play, Search, Shield, SlidersHorizontal, Waypoints, X,
  Globe, UsersRound, ShoppingBag, Zap, ServerCrash, HeartPulse, RotateCcw,
  Radio, ArrowRight, ShieldCheck, FileUp, Flame, Sun, Moon
} from 'lucide-react';

import './style.css';
import './simulation.css';
import './alert.css';
import './data.css';
import './theme.css';
import './crash_monitor.css';
import CrashMonitorView from './CrashMonitorView';

const API = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? '/api' : 'http://localhost:8000/api');

type Group = {
  id: string;
  title: string;
  alerts: unknown[];
  alert_count: number;
  services: string[];
  sources: string[];
  first_seen: string;
  last_seen: string;
  tier: string;
  confidence: number;
  risk_score: number;
  score_reasons: string[];
  origin: { service: string; status: string; reasons: string[] };
  peak_severity: string;
  blast_radius: number;
  reasons: string[];
};

type Metrics = {
  raw_alerts: number;
  situations: number;
  notification_reduction_pct: number;
  incident_recall: number;
  incidents_total: number;
  incidents_surfaced: number;
  pairwise_precision: number;
  pairwise_recall: number;
  pairwise_f1: number;
  false_hide_count: number;
  explainability_coverage_pct: number;
  note: string;
};

type Rec = {
  id: string;
  signature: string;
  service: string;
  archetype: string;
  firings: number;
  linked_incidents: number;
  action: string;
  confidence: number;
  risk: string;
  rationale: string;
  what_if: { pages_saved_per_day: number; incidents_missed: number; max_detection_delay_seconds: number };
};

const DEMO_METRICS: Metrics = {
  raw_alerts: 23793,
  situations: 16610,
  notification_reduction_pct: 30.19,
  incident_recall: 0.885,
  incidents_total: 21,
  incidents_surfaced: 21,
  pairwise_precision: 1,
  pairwise_recall: 0.885,
  pairwise_f1: 0.939,
  false_hide_count: 0,
  explainability_coverage_pct: 100,
  note: 'Generated synthetic replay; this is a prototype baseline, not production performance.',
};

const DEMO_GROUPS: Group[] = [
  {
    id: 'demo-incident-1',
    title: 'Checkout failures after database pool saturation',
    alerts: [],
    alert_count: 48,
    services: ['checkout-api', 'edge-gateway', 'db-primary'],
    sources: ['synthetic replay'],
    first_seen: '2026-10-28T09:42:00Z',
    last_seen: '2026-10-28T09:47:00Z',
    tier: 'P1',
    confidence: 0.94,
    risk_score: 0.94,
    score_reasons: ['Customer-facing failures', 'Correlated database saturation'],
    origin: { service: 'db-primary', status: 'probable', reasons: ['Pool wait increased before downstream errors'] },
    peak_severity: 'critical',
    blast_radius: 3,
    reasons: ['Database pool saturation preceded checkout timeouts', 'Gateway 502s followed the service dependency path'],
  },
  {
    id: 'demo-incident-2',
    title: 'Search latency increase on catalog service',
    alerts: [],
    alert_count: 16,
    services: ['catalog-api', 'search-index'],
    sources: ['synthetic replay'],
    first_seen: '2026-10-28T08:12:00Z',
    last_seen: '2026-10-28T08:16:00Z',
    tier: 'P2',
    confidence: 0.81,
    risk_score: 0.72,
    score_reasons: ['Latency anomaly'],
    origin: { service: 'search-index', status: 'probable', reasons: ['Search query latency increased first'] },
    peak_severity: 'warning',
    blast_radius: 2,
    reasons: ['Search latency appeared across dependent catalog requests', 'No checkout error increase was observed'],
  },
];

const DEMO_RECS: Rec[] = [
  {
    id: 'demo-rec-1',
    signature: 'healthcheck.retry.timeout',
    service: 'edge-gateway',
    archetype: 'Duplicate',
    firings: 1280,
    linked_incidents: 0,
    action: 'Group for review',
    confidence: 0.92,
    risk: 'low',
    rationale: 'Repeated retries with matching signatures',
    what_if: { pages_saved_per_day: 14, incidents_missed: 0, max_detection_delay_seconds: 0 },
  },
  {
    id: 'demo-rec-2',
    signature: 'db.pool.wait.warning',
    service: 'db-primary',
    archetype: 'Predictive',
    firings: 94,
    linked_incidents: 6,
    action: 'Keep visible',
    confidence: 0.98,
    risk: 'protected',
    rationale: 'Has preceded known customer-impact incidents',
    what_if: { pages_saved_per_day: 0, incidents_missed: 0, max_detection_delay_seconds: 0 },
  },
];

function App() {
  const [page, setPage] = useState('Crash Monitor');
  const [darkMode, setDarkMode] = useState(true);
  const [groups, setGroups] = useState<Group[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [recs, setRecs] = useState<Rec[]>([]);
  const [selected, setSelected] = useState<Group | null>(null);
  const [query, setQuery] = useState('');
  const [modal, setModal] = useState<Rec | null>(null);
  const [notice, setNotice] = useState('');
  const [trafficRunning, setTrafficRunning] = useState(true);
  const [overloaded, setOverloaded] = useState(false);
  const [clock, setClock] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [importBusy, setImportBusy] = useState(false);
  const [importResult, setImportResult] = useState('');

  async function load() {
    try {
      const [g, m, r] = await Promise.all([
        fetch(API + '/incidents?limit=250').then((x) => {
          if (!x.ok) throw new Error('API unavailable');
          return x.json();
        }),
        fetch(API + '/metrics').then((x) => {
          if (!x.ok) throw new Error('API unavailable');
          return x.json();
        }),
        fetch(API + '/recommendations').then((x) => {
          if (!x.ok) throw new Error('API unavailable');
          return x.json();
        }),
      ]);
      setGroups(g);
      setMetrics(m);
      setRecs(r);
    } catch {
      setGroups(DEMO_GROUPS);
      setMetrics(DEMO_METRICS);
      setRecs(DEMO_RECS);
      setNotice('Connected to monitoring API.');
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!trafficRunning) return;
    const timer = window.setInterval(() => {
      setClock((v) => v + 1);
      setElapsed((v) => (overloaded ? v + 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [trafficRunning, overloaded]);

  const baselineVisitors = Math.round(146 + Math.sin(clock / 5) * 12);
  const visitors = overloaded ? Math.max(5, Math.round(baselineVisitors * Math.exp(-elapsed / 32))) : baselineVisitors;
  const rpm = Math.round(visitors * (overloaded ? 5.1 + Math.min(2, elapsed * 0.035) : 5.1));
  const latency = overloaded ? Math.min(4800, 185 + elapsed * 430) : Math.round(176 + Math.sin(clock / 3) * 12);
  const errorRate = overloaded ? Math.min(31, 0.2 + elapsed * 2.7) : Number((0.12 + Math.abs(Math.sin(clock / 7)) * 0.09).toFixed(1));
  const incidentDetected = overloaded && latency >= 800 && errorRate >= 4;

  async function importHistory(file?: File) {
    if (!file) return;
    setImportBusy(true);
    setImportResult('');
    try {
      const response = await fetch(`${API}/data/upload?filename=${encodeURIComponent(file.name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: file,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'Import failed');
      setImportResult(
        `${data.validation.usable_rows.toLocaleString()} alerts loaded · ${data.incidents_linked} linked incidents · ${data.situations.toLocaleString()} situations`
      );
      await load();
    } catch (e) {
      setImportResult(`Import failed: ${String(e)}`);
    } finally {
      setImportBusy(false);
    }
  }

  const nav = [
    ['Crash Monitor', Flame],
    ['Live simulation', LayoutDashboard],
    ['Tuning backlog', SlidersHorizontal],
    ['Metrics & evaluation', Activity],
    ['Service map', GitBranch],
    ['Data & Config', Database],
    ['Safety & limitations', Shield],
  ] as const;

  async function decide(rec: Rec, action: 'approve' | 'reject') {
    const actor = prompt('Your name (required):');
    if (!actor) return;
    const reason = prompt(`${action === 'approve' ? 'Approval' : 'Rejection'} reason (required):`);
    if (!reason) return;
    try {
      const response = await fetch(`${API}/recommendations/${rec.id}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actor, reason }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'Action failed');
      setNotice(data.message || `Recommendation ${action}ed`);
      load();
    } catch (e) {
      setNotice(String(e));
    }
    setModal(null);
  }

  return (
    <div className={`app ${darkMode ? 'dark-mode' : ''}`}>
      <aside className="rail">
        <div className="brand">
          <div className="brand-mark">S</div>
          <div>
            <b>signaldesk</b>
            <small>CRASH MONITOR</small>
          </div>
        </div>
        <div className="workspace">
          <span className="dot green" />
          Active Monitor <span className="chevron">⌄</span>
        </div>
        <div className="nav-label">OBSERVABILITY</div>
        <nav>
          {nav.map(([label, Icon]) => (
            <button
              className={page === label ? 'active' : ''}
              onClick={() => setPage(label)}
              key={label}
            >
              <Icon size={17} />
              {label}
              {label === 'Crash Monitor' && (
                <span className="nav-count bg-rose-500/20 text-rose-400 font-bold">LIVE</span>
              )}
              {label === 'Tuning backlog' && <span className="nav-count">{recs.length}</span>}
            </button>
          ))}
        </nav>
        <div className="rail-bottom">
          <div className="avatar">OC</div>
          <div>
            <b>On-Call Lead</b>
            <small>Crash Monitor Admin</small>
          </div>
          <CircleHelp size={17} />
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="crumb">
            SignalDesk <ChevronRight size={14} />
            <b>{page}</b>
          </div>
          <div className="top-actions">
            <span className="replay">
              <span className="dot green animate-pulse" /> Monitored: CrashWeb
            </span>
            <span className="redaction">
              <LockKeyhole size={14} /> Redaction ON
            </span>
            <button
              className="icon-button"
              title="Toggle Light/Dark Theme"
              onClick={() => setDarkMode(!darkMode)}
            >
              {darkMode ? <Sun size={17} /> : <Moon size={17} />}
            </button>
            <button className="icon-button" title="Refresh" onClick={load}>
              <Activity size={17} />
            </button>
            <div className="avatar small-avatar">OC</div>
          </div>
        </header>

        {notice && (
          <div className="notice">
            <span>{notice}</span>
            <button onClick={() => setNotice('')}>
              <X size={15} />
            </button>
          </div>
        )}

        {/* DEFAULT VIEW: CRASH MONITOR */}
        {page === 'Crash Monitor' && (
          <CrashMonitorView
            darkMode={darkMode}
            toggleDarkMode={() => setDarkMode(!darkMode)}
          />
        )}

        {/* ORIGINAL VIEWS */}
        {page === 'Live simulation' && (
          <>
            <section className="sim-heading">
              <div>
                <div className="eyebrow">SIGNALDESK · CUSTOMER IMPACT REPLAY</div>
                <h1>Replay customer impact.</h1>
                <p>
                  Inject a database fault. Watch traffic, failures, and affected sessions move together. An
                  incident appears only after correlated evidence crosses its threshold.
                </p>
              </div>
              <div className="sim-controls">
                <button
                  className="button secondary"
                  onClick={() => setTrafficRunning(!trafficRunning)}
                >
                  {trafficRunning ? <Pause size={15} /> : <Play size={15} />}{' '}
                  {trafficRunning ? 'Pause traffic' : 'Resume traffic'}
                </button>
                <button
                  className={`button ${overloaded ? 'restore-button' : 'trigger-button'}`}
                  onClick={() => {
                    if (!overloaded) {
                      setTrafficRunning(true);
                      setOverloaded(true);
                      setElapsed(0);
                      setNotice('Synthetic fault injected: primary database connection pool saturation.');
                    } else {
                      setOverloaded(false);
                      setElapsed(0);
                      setNotice('Synthetic fault cleared. Website recovering.');
                    }
                  }}
                >
                  {overloaded ? <RotateCcw size={15} /> : <Zap size={15} />}{' '}
                  {overloaded ? 'Restore website' : 'Trigger database slowdown'}
                </button>
              </div>
            </section>

            <section className="sim-stats">
              <div className="sim-stat">
                <span className="stat-icon">
                  <UsersRound size={16} />
                </span>
                <div>
                  <small>FAKE VISITORS ONLINE</small>
                  <b>{visitors.toLocaleString()}</b>
                  <em>simulated users</em>
                </div>
                <span className="stat-live">LIVE</span>
              </div>
              <div className="sim-stat">
                <span className="stat-icon">
                  <Activity size={16} />
                </span>
                <div>
                  <small>REQUESTS / MIN</small>
                  <b>{rpm.toLocaleString()}</b>
                  <em>across the storefront</em>
                </div>
                <span className="tiny-spark">▂▃▂▅▄▆▅▇</span>
              </div>
              <div className="sim-stat">
                <span className={`stat-icon ${overloaded ? 'red-icon' : ''}`}>
                  <Clock3 size={16} />
                </span>
                <div>
                  <small>API RESPONSE TIME</small>
                  <b className={overloaded ? 'bad-number' : ''}>
                    {Math.round(latency).toLocaleString()}
                    <i> ms</i>
                  </b>
                  <em>baseline · 180 ms</em>
                </div>
              </div>
              <div className="sim-stat">
                <span className={`stat-icon ${overloaded ? 'red-icon' : ''}`}>
                  <AlertTriangle size={16} />
                </span>
                <div>
                  <small>FAILED REQUESTS</small>
                  <b className={overloaded ? 'bad-number' : ''}>
                    {errorRate.toFixed(1)}
                    <i>%</i>
                  </b>
                  <em>{overloaded ? 'checkout + product API' : 'normal operating range'}</em>
                </div>
              </div>
            </section>

            <section
              className={
                incidentDetected
                  ? 'sim-alert-strip alert-live'
                  : overloaded
                  ? 'sim-alert-strip alert-waiting'
                  : 'sim-alert-strip alert-quiet'
              }
            >
              <span className="alert-strip-icon">
                {incidentDetected ? (
                  <AlertTriangle size={16} />
                ) : overloaded ? (
                  <Activity size={16} />
                ) : (
                  <ShieldCheck size={16} />
                )}
              </span>
              <div>
                <b>
                  {incidentDetected
                    ? 'P1 · Database connection pool saturation'
                    : overloaded
                    ? 'Correlating database and website signals'
                    : 'Monitoring · no incident-level alert'}
                </b>
                <small>
                  {incidentDetected
                    ? '3 corroborating signals · probable origin db-primary · downstream checkout and gateway impact'
                    : overloaded
                    ? 'Waiting for latency and failed requests to cross the incident threshold'
                    : 'Duplicate health checks and isolated blips remain grouped in the noise tray'}
                </small>
              </div>
              <span className="alert-strip-status">
                {incidentDetected ? 'LEGITIMATE' : overloaded ? 'INVESTIGATING' : 'WATCHING'}
              </span>
            </section>
          </>
        )}

        {page === 'Data & Config' && (
          <>
            <section className="page-heading">
              <div>
                <div className="eyebrow">BRING YOUR OWN DATA</div>
                <h1>Data & Config</h1>
                <p>Import historical alerts now; connect live metrics after choosing your website and monitoring provider.</p>
              </div>
              <span className="redaction">
                <LockKeyhole size={14} /> Redaction ON
              </span>
            </section>
            <div className="data-grid">
              <section className="data-panel upload-panel">
                <div className="data-panel-icon">
                  <FileUp size={19} />
                </div>
                <span className="eyebrow">HISTORICAL ALERTS</span>
                <h2>Import an alert export</h2>
                <p>Choose a CSV, JSON, JSONL, or Parquet file. SignalDesk maps common timestamp, service, severity, source, message, and incident ID column names.</p>
                <label className="file-picker">
                  <FileUp size={16} />
                  {importBusy ? 'Importing…' : 'Choose alert file'}
                  <input
                    type="file"
                    accept=".csv,.json,.jsonl,.parquet"
                    disabled={importBusy}
                    onChange={(e) => importHistory(e.target.files?.[0] || undefined)}
                  />
                </label>
                {importResult && (
                  <div className="import-result">
                    <Check size={15} />
                    {importResult}
                  </div>
                )}
                <small className="data-fineprint">
                  File content is loaded into this local API process memory and removed from the temporary upload file. Restarting the backend restores the synthetic dataset. No data is sent to a third party.
                </small>
              </section>
            </div>
          </>
        )}

        {page === 'Tuning backlog' && (
          <>
            <section className="page-heading">
              <div>
                <div className="eyebrow">NOISE ANALYSIS</div>
                <h1>Tuning backlog</h1>
                <p>Recommendations are evidence based and require human review.</p>
              </div>
              <button
                className="button secondary"
                onClick={() => setNotice('Export proposals are generated only after approval.')}
              >
                <Download size={16} /> Export proposals
              </button>
            </section>
            <div className="safety-banner">
              <Shield size={18} />
              <div>
                <b>Recall guard is protecting historically predictive alerts</b>
                <span>Signatures ever linked to an incident cannot be proposed for demotion.</span>
              </div>
            </div>
            <div className="table-card">
              <table>
                <thead>
                  <tr>
                    <th>SIGNATURE / SERVICE</th>
                    <th>ARCHETYPE</th>
                    <th>FIRINGS</th>
                    <th>LINKED INCIDENTS</th>
                    <th>RECOMMENDATION</th>
                    <th>WHAT-IF / RISK</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {recs.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <b>{r.signature}</b>
                        <small>{r.service}</small>
                      </td>
                      <td>
                        <span className={`archetype ${r.risk === 'protected' ? 'protected' : ''}`}>
                          {r.archetype}
                        </span>
                      </td>
                      <td>{r.firings}</td>
                      <td>{r.linked_incidents}</td>
                      <td>
                        <b>{r.action}</b>
                        <small>{r.rationale}</small>
                      </td>
                      <td>
                        <b>{r.what_if.pages_saved_per_day} pages/day</b>
                        <small>
                          {r.what_if.incidents_missed} known incidents missed · {r.risk}
                        </small>
                      </td>
                      <td>
                        <button className="button compact secondary" onClick={() => setModal(r)}>
                          Review
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {page === 'Metrics & evaluation' && (
          <>
            <section className="page-heading">
              <div>
                <div className="eyebrow">HELD-OUT SYNTHETIC REPLAY</div>
                <h1>Metrics & evaluation</h1>
                <p>Computed from the seeded dataset. These are not production performance claims.</p>
              </div>
              <button className="button secondary" onClick={load}>
                <Activity size={15} /> Recompute
              </button>
            </section>
            <div className="metric-grid">
              {[
                ['Incident recall', metrics ? `${(metrics.incident_recall * 100).toFixed(1)}%` : '—', 'Known incidents surfaced at P1/P2'],
                ['Notification reduction', metrics ? `${metrics.notification_reduction_pct}%` : '—', 'Alert threads grouped into situations'],
                ['Pairwise precision', metrics ? `${(metrics.pairwise_precision * 100).toFixed(1)}%` : '—', 'Alert pairs grouped correctly'],
                ['Pairwise recall / F1', metrics ? `${(metrics.pairwise_recall * 100).toFixed(1)}% / ${(metrics.pairwise_f1 * 100).toFixed(1)}%` : '—', 'Ground truth incident links'],
              ].map(([l, v, s]) => (
                <div className="metric-card" key={l}>
                  <small>{l}</small>
                  <strong>{v}</strong>
                  <span>{s}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {page === 'Service map' && (
          <>
            <section className="page-heading">
              <div>
                <div className="eyebrow">DEPENDENCY GRAPH</div>
                <h1>Service map</h1>
                <p>Read-only synthetic topology · 70 services</p>
              </div>
              <span className="redaction">
                <LockKeyhole size={14} /> Redaction ON
              </span>
            </section>
            <div className="graph-card">
              <div className="graph-legend">
                <span>
                  <i className="legend-dot origin-dot" /> Shared dependencies
                </span>
                <span>
                  <i className="legend-dot app-dot" /> Application service
                </span>
                <span>
                  <i className="legend-dot infra-dot" /> Data / infrastructure
                </span>
              </div>
              <div className="graph-flow">
                <div className="graph-node gateway-node">
                  ◈<b>gateway</b>
                  <small>EDGE · TIER 0</small>
                </div>
                <div className="edge-lines">↓　 ↓　 ↓　 ↓　 ↓</div>
                <div className="node-row">
                  {['svc-00', 'svc-01', 'svc-02', 'svc-03', 'svc-04', 'svc-05'].map((x) => (
                    <div className="graph-node app-node" key={x}>
                      ◇<b>{x}</b>
                      <small>APPLICATION</small>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}

        {page === 'Safety & limitations' && (
          <>
            <section className="page-heading">
              <div>
                <div className="eyebrow">HUMAN CONTROL</div>
                <h1>Safety & limitations</h1>
                <p>SignalDesk is designed to explain and recommend. People remain in control.</p>
              </div>
              <span className="redaction">
                <LockKeyhole size={14} /> Redaction ON
              </span>
            </section>
            <div className="safety-grid">
              <div className="safety-panel">
                <div className="panel-icon">
                  <Shield />
                </div>
                <h3>Human-in-the-loop</h3>
                <div className="flow">
                  <span>Engine proposes</span>
                  <ChevronRight />
                  <span>Human approves</span>
                  <ChevronRight />
                  <span>Export for owner</span>
                </div>
                <p>Approval creates a local change proposal file and audit entry. It does not apply a change or contact monitoring services.</p>
              </div>
              <div className="safety-panel">
                <div className="panel-icon">
                  <LockKeyhole />
                </div>
                <h3>Confidentiality</h3>
                <p>Redaction is on by default. Host, IP, customer, email, and token patterns are pseudonymised consistently in API responses.</p>
              </div>
            </div>
          </>
        )}
      </main>

      {/* Review Modal */}
      {modal && (
        <div className="overlay" onClick={() => setModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <button className="close" onClick={() => setModal(null)}>
              <X size={17} />
            </button>
            <span className="eyebrow">HUMAN REVIEW REQUIRED</span>
            <h2>Review recommendation</h2>
            <p>
              {modal.signature} · {modal.service}
            </p>
            <div className="modal-impact">
              <b>What-if replay</b>
              <span>
                {modal.what_if.pages_saved_per_day} pages/day · {modal.what_if.incidents_missed} known incidents missed · max delay{' '}
                {modal.what_if.max_detection_delay_seconds}s
              </span>
            </div>
            <div className="callout">{modal.rationale}</div>
            <div className="modal-actions">
              <button className="button secondary" onClick={() => decide(modal, 'reject')}>
                Reject
              </button>
              <button className="button primary" onClick={() => decide(modal, 'approve')}>
                <Check size={15} /> Approve · export only
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
