import React, { useState, useEffect, useRef } from 'react';
import {
  AlertTriangle, Flame, Activity, ShieldAlert, CheckCircle2, Clock3,
  ExternalLink, Search, RefreshCw, Download, Filter, ArrowUpRight,
  ChevronRight, X, Copy, Check, Eye, Bug, Database, Cpu, Wifi,
  Sliders, Radio, Terminal, Sparkles, Layers, ArrowRight, Sun, Moon,
  FileSpreadsheet, FileJson, RotateCcw, Wrench, BarChart2, ScatterChart,
  TrendingUp, CircleAlert, Globe, Server
} from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? '/api' : 'http://localhost:8000/api');

export interface Cluster {
  id: string;
  fingerprint: string;
  title: string;
  category: string;
  count: number;
  risk_score: number;
  risk_level: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  first_seen: string;
  last_seen: string;
  affected_endpoints: string[];
  affected_browsers: string[];
  affected_sessions: string[];
  sample_stack_trace?: string;
  sample_message?: string;
  status: 'active' | 'resolved' | 'ignored';
  is_spike?: boolean;
  plain_explanation?: string;
  suggested_fix?: string;
  rank?: number;
}

export interface Stats {
  projectId: string;
  siteStatus: 'Healthy' | 'Degraded' | 'Down';
  targetUrl: string;
  uptimePct: number;
  lastLatencyMs: number;
  totalCrashes: number;
  activeClusters: number;
  highRiskCount: number;
  crashRatePerMin: number;
  sessionsImpacted: number;
  categoryDistribution: Record<string, number>;
  thresholdReached?: boolean;
  thresholdLimit?: number;
  top5HighRisks?: Cluster[];
}

const CATEGORY_COLORS: Record<string, string> = {
  'Database': '#f59e0b',
  'JavaScript Runtime': '#ec4899',
  'Network/HTTP': '#3b82f6',
  'Timeout/Performance': '#8b5cf6',
  'Memory': '#ef4444',
  'Resource Loading': '#06b6d4',
  'Auth/Permissions': '#10b981',
  'Validation/Input': '#6366f1',
  'Unknown': '#64748b',
};

const CATEGORIES_LIST = [
  'All', 'Database', 'JavaScript runtime', 'Network / HTTP', 'Timeout / performance',
  'Memory', 'Resource loading', 'Auth / permissions', 'Validation / input'
];

export default function CrashMonitorView({
  darkMode = false,
  toggleDarkMode,
  onOpenSimulation,
}: {
  darkMode?: boolean;
  toggleDarkMode?: () => void;
  onOpenSimulation?: () => void;
}) {
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [selectedCluster, setSelectedCluster] = useState<Cluster | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [selectedStatus, setSelectedStatus] = useState<string>('active');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sortBy, setSortBy] = useState<'risk' | 'count' | 'recent'>('risk');
  const [copiedFixId, setCopiedFixId] = useState<string | null>(null);
  const [filterTop5Only, setFilterTop5Only] = useState<boolean>(false);
  const [toast, setToast] = useState<{ msg: string; type: 'critical' | 'info' | 'success' } | null>(null);
  const [showLiveDrawer, setShowLiveDrawer] = useState<boolean>(false);
  const [liveStreamEvents, setLiveStreamEvents] = useState<any[]>([]);

  // Load clusters & stats
  const loadData = async () => {
    try {
      const catParam = selectedCategory === 'All' ? '' : selectedCategory.replace(' / ', '/');
      const [clustersRes, statsRes] = await Promise.all([
        fetch(`${API_BASE}/clusters?status=${selectedStatus}&category=${encodeURIComponent(catParam)}&sort_by=${sortBy}&search=${encodeURIComponent(searchQuery)}`),
        fetch(`${API_BASE}/stats`),
      ]);

      if (clustersRes.ok) {
        const cData = await clustersRes.json();
        setClusters(cData);
      }
      if (statsRes.ok) {
        const sData = await statsRes.json();
        setStats(sData);
      }
    } catch (e) {
      console.error('Failed to load monitoring data:', e);
    } finally {
      setLoading(false);
    }
  };

  const resetToZero = async () => {
    try {
      const res = await fetch(`${API_BASE}/reset`, { method: 'POST' });
      if (res.ok) {
        setClusters([]);
        setStats((prev) => prev ? {
          ...prev,
          totalCrashes: 0,
          activeClusters: 0,
          highRiskCount: 0,
          crashRatePerMin: 0,
          sessionsImpacted: 0,
          categoryDistribution: {},
          thresholdReached: false,
          top5HighRisks: [],
        } : null);
        setSelectedCluster(null);
        setToast({ msg: 'All monitoring metrics returned to zero.', type: 'info' });
        setTimeout(() => setToast(null), 3000);
      }
    } catch (e) {
      console.error('Reset failed:', e);
    }
  };

  useEffect(() => {
    loadData();
  }, [selectedCategory, selectedStatus, sortBy, searchQuery]);

  // Real-time SSE Connection
  useEffect(() => {
    let eventSource: EventSource | null = null;
    try {
      eventSource = new EventSource(`${API_BASE}/stream`);

      eventSource.addEventListener('reset', () => {
        setClusters([]);
        setStats((prev) => prev ? {
          ...prev,
          totalCrashes: 0,
          activeClusters: 0,
          highRiskCount: 0,
          crashRatePerMin: 0,
          sessionsImpacted: 0,
          categoryDistribution: {},
          thresholdReached: false,
          top5HighRisks: [],
        } : null);
        setSelectedCluster(null);
      });

      eventSource.addEventListener('crash', (e) => {
        try {
          const payload = JSON.parse(e.data);
          const newCluster = payload.cluster;

          setClusters((prev) => {
            const idx = prev.findIndex((c) => c.fingerprint === newCluster.fingerprint);
            if (idx >= 0) {
              const updated = [...prev];
              updated[idx] = { ...updated[idx], ...newCluster };
              return updated;
            }
            return [newCluster, ...prev];
          });

          setStats((prev) => {
            if (!prev) return null;
            const newTotal = prev.totalCrashes + 1;
            const thresholdReached = newTotal >= 500;
            return {
              ...prev,
              totalCrashes: newTotal,
              activeClusters: prev.activeClusters + (prev.activeClusters === 0 ? 1 : 0),
              thresholdReached,
            };
          });

          setLiveStreamEvents((prev) => [payload.crash, ...prev.slice(0, 40)]);
        } catch {}
      });

      eventSource.addEventListener('health_check', (e) => {
        try {
          const health = JSON.parse(e.data);
          setStats((prev) => prev ? {
            ...prev,
            siteStatus: health.status,
            lastLatencyMs: health.latencyMs,
          } : null);
        } catch {}
      });
    } catch {}

    return () => {
      if (eventSource) eventSource.close();
    };
  }, []);

  const copyFixText = (id: string, fixText?: string) => {
    if (!fixText) return;
    navigator.clipboard.writeText(fixText);
    setCopiedFixId(id);
    setTimeout(() => setCopiedFixId(null), 2500);
  };

  const exportReport = (format: 'json' | 'csv') => {
    if (format === 'json') {
      const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify({ stats, clusters }, null, 2));
      const a = document.createElement('a');
      a.href = dataStr;
      a.download = `signaldesk_crash_clusters_${Date.now()}.json`;
      a.click();
    } else {
      let csv = 'ID,Title,Category,Count,Risk Score,Risk Level,Status,Last Seen\n';
      clusters.forEach((c) => {
        csv += `"${c.id}","${c.title.replace(/"/g, '""')}","${c.category}",${c.count},${c.risk_score},"${c.risk_level}","${c.status}","${c.last_seen}"\n`;
      });
      const dataStr = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
      const a = document.createElement('a');
      a.href = dataStr;
      a.download = `signaldesk_crash_clusters_${Date.now()}.csv`;
      a.click();
    }
  };

  const top5HighRisks: Cluster[] = (stats?.top5HighRisks && stats.top5HighRisks.length > 0)
    ? stats.top5HighRisks
    : clusters
        .filter((c) => c.status === 'active')
        .sort((a, b) => (b.risk_score - a.risk_score) || (b.count - a.count))
        .slice(0, 5)
        .map((c, i) => ({ ...c, rank: i + 1 }));

  const thresholdReached = (stats?.totalCrashes || 0) >= 500 || Boolean(stats?.thresholdReached);
  const displayClusters = filterTop5Only ? top5HighRisks : clusters;

  const getRiskColor = (score: number) => {
    if (score >= 80) return '#ef4444'; // Critical
    if (score >= 60) return '#f97316'; // High
    if (score >= 40) return '#eab308'; // Medium
    return '#3b82f6'; // Low
  };

  return (
    <div className="cm-container">
      {/* Toast Alert */}
      {toast && (
        <div style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          zIndex: 9999,
          background: toast.type === 'critical' ? '#7f1d1d' : toast.type === 'success' ? '#064e3b' : '#0f172a',
          color: '#ffffff',
          padding: '12px 20px',
          borderRadius: '10px',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          boxShadow: '0 10px 30px rgba(0,0,0,0.3)',
          fontSize: '13px',
          fontWeight: 600,
        }}>
          {toast.type === 'critical' ? <AlertTriangle size={18} className="text-red-400" /> : <CheckCircle2 size={18} className="text-emerald-400" />}
          <span>{toast.msg}</span>
          <button onClick={() => setToast(null)} style={{ background: 'none', border: 0, color: '#aaa', marginLeft: '8px' }}>
            <X size={15} />
          </button>
        </div>
      )}

      {/* 1. SUB-HEADER BANNER (MATCHING REFERENCE SCREENSHOT) */}
      <section className="cm-sub-header">
        <div className="cm-header-left">
          <div className="cm-title-row">
            <h2 className="cm-title">Crash Monitor</h2>
            <span className={`cm-health-pill ${stats?.siteStatus ? stats.siteStatus.toLowerCase() : 'healthy'}`}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'currentColor' }} />
              {stats?.siteStatus ? stats.siteStatus.toUpperCase() : 'HEALTHY'}
            </span>
          </div>

          <div className="cm-subtitle-row">
            <span>
              Target site <a href={stats?.targetUrl || 'https://crashweb-gules.vercel.app'} target="_blank" rel="noreferrer">
                {stats?.targetUrl ? stats.targetUrl.replace(/^https?:\/\//, '') : 'crashweb.example/checkout'}
              </a>
            </span>
            <span>
              Latency <b>{stats?.lastLatencyMs || 48} ms</b>
            </span>
            <span>
              Uptime <b>{stats?.uptimePct || 100}%</b>
            </span>
          </div>
        </div>

        <div className="cm-header-actions">
          {/* Live stream */}
          <button
            onClick={() => setShowLiveDrawer(!showLiveDrawer)}
            className="cm-btn-livestream"
            title="Toggle Live Stream Feed"
          >
            <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#22c55e', animation: 'pulse 1.5s infinite' }} />
            <span>Live stream</span>
            {liveStreamEvents.length > 0 && (
              <span style={{ background: '#334155', borderRadius: '999px', padding: '1px 6px', fontSize: '10px' }}>
                {liveStreamEvents.length}
              </span>
            )}
          </button>

          {/* Export JSON */}
          <button onClick={() => exportReport('json')} className="cm-btn-default" title="Export as JSON">
            Export JSON
          </button>

          {/* Export CSV */}
          <button onClick={() => exportReport('csv')} className="cm-btn-default" title="Export as CSV">
            Export CSV
          </button>

          {/* Refresh Icon */}
          <button onClick={loadData} className="cm-btn-icon" title="Refresh">
            <RefreshCw size={14} />
          </button>

          {/* Reset data */}
          <button onClick={resetToZero} className="cm-btn-reset" title="Reset all data back to 0">
            Reset data
          </button>
        </div>
      </section>

      {/* 2. 4 KPI METRIC CARDS (MATCHING REFERENCE SCREENSHOT) */}
      <section className="cm-kpi-grid">
        {/* TOTAL CRASHES */}
        <div className="cm-kpi-card">
          <div className="cm-kpi-title">TOTAL CRASHES</div>
          <div className="cm-kpi-value">{stats?.totalCrashes?.toLocaleString() || 0}</div>
          <div className="cm-kpi-sub">
            Across {stats?.activeClusters || 0} active clusters
          </div>
        </div>

        {/* HIGH-RISK ERRORS */}
        <div className={`cm-kpi-card accent-card ${(stats?.highRiskCount || 0) > 0 ? 'alert-active' : ''}`}>
          <div className="cm-kpi-title">HIGH-RISK ERRORS</div>
          <div className="cm-kpi-value">{stats?.highRiskCount || 0}</div>
          <div className={`cm-kpi-sub ${(stats?.highRiskCount || 0) > 0 ? 'sub-red' : 'sub-green'}`}>
            {(stats?.highRiskCount || 0) > 0
              ? `${stats?.highRiskCount} require immediate attention`
              : 'Nothing needs attention'}
          </div>
        </div>

        {/* CRASH VELOCITY */}
        <div className="cm-kpi-card">
          <div className="cm-kpi-title">CRASH VELOCITY</div>
          <div className="cm-kpi-value">
            {stats?.crashRatePerMin || 0} <small>/min</small>
          </div>
          <div className="cm-kpi-sub">5-minute rolling window</div>
        </div>

        {/* IMPACTED SESSIONS */}
        <div className="cm-kpi-card">
          <div className="cm-kpi-title">IMPACTED SESSIONS</div>
          <div className="cm-kpi-value">{stats?.sessionsImpacted || 0}</div>
          <div className="cm-kpi-sub">Unique user and bot sessions</div>
        </div>
      </section>

      {/* 3. FILTER & SEARCH BAR (MATCHING REFERENCE SCREENSHOT) */}
      <section className="cm-filter-container">
        <div className="cm-search-row">
          <div className="cm-search-input-wrap">
            <Search size={15} />
            <input
              type="text"
              placeholder="Search by error type, message or stack"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="cm-search-input"
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {/* Status Filter */}
            <div className="cm-status-segmented">
              {(['active', 'resolved', 'all'] as const).map((st) => (
                <button
                  key={st}
                  onClick={() => setSelectedStatus(st)}
                  className={`cm-seg-btn ${selectedStatus === st ? 'active' : ''}`}
                >
                  {st.charAt(0).toUpperCase() + st.slice(1)}
                </button>
              ))}
            </div>

            {/* Sort Dropdown */}
            <select
              value={sortBy}
              onChange={(e: any) => setSortBy(e.target.value)}
              className="cm-sort-select"
            >
              <option value="risk">Sort: Risk score ⌵</option>
              <option value="count">Sort: Frequency ⌵</option>
              <option value="recent">Sort: Most recent ⌵</option>
            </select>
          </div>
        </div>

        {/* Category & Top 5 Pills */}
        <div className="cm-pills-row">
          <button
            onClick={() => setFilterTop5Only(!filterTop5Only)}
            className={`cm-pill top5-pill ${filterTop5Only ? 'active' : ''}`}
          >
            Top 5 high risks ({top5HighRisks.length})
          </button>

          {CATEGORIES_LIST.map((cat) => {
            const isActive = !filterTop5Only && selectedCategory === cat;
            return (
              <button
                key={cat}
                onClick={() => {
                  setFilterTop5Only(false);
                  setSelectedCategory(cat);
                }}
                className={`cm-pill ${isActive ? 'active' : ''}`}
              >
                {cat}
              </button>
            );
          })}
        </div>
      </section>

      {/* Clusters of Risk Bar Graph Banner (Links to Live Simulation) */}
      {clusters.length > 0 && (
        <div style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: '12px',
          padding: '12px 20px',
          marginBottom: '20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          boxShadow: 'var(--cm-card-shadow)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px', color: '#1e293b' }}>
            <BarChart2 size={18} style={{ color: '#0f766e' }} />
            <span><b>{clusters.length} Risk Clusters Active:</b> View the synthesized <b>Clusters of Risk Bar Graph</b> with severity breakdown in Live Simulation.</span>
          </div>
          <button
            onClick={() => onOpenSimulation && onOpenSimulation()}
            style={{
              background: '#0f766e',
              color: '#ffffff',
              border: 0,
              borderRadius: '6px',
              padding: '6px 14px',
              fontSize: '11px',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            Open Risk Bar Graph →
          </button>
        </div>
      )}

      {/* 5. 500+ THRESHOLD ALERT & TOP 5 TRIAGED RISKS SECTION */}
      {thresholdReached && top5HighRisks.length > 0 && (
        <section className="cm-triage-section">
          <div className="cm-triage-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Flame size={22} className="text-rose-500 animate-pulse" />
              <div>
                <h3 style={{ fontSize: '16px', fontWeight: 800, color: '#991b1b', margin: 0 }}>
                  TOP 5 HIGH-RISK FAILURES & RECOMMENDED MITIGATION (TRIAGED)
                </h3>
                <span style={{ fontSize: '11px', color: '#b91c1c' }}>
                  500+ crashes threshold reached. Low-severity background noise suppressed. Categorizing only critical actionable modes below.
                </span>
              </div>
            </div>

            <span style={{ background: '#ef4444', color: '#fff', padding: '4px 10px', borderRadius: '6px', fontSize: '10px', fontWeight: 800, fontFamily: 'monospace' }}>
              {top5HighRisks.length} CRITICAL / HIGH ACTIVE
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {top5HighRisks.map((c, i) => (
              <div key={c.id} className="cm-triage-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ background: '#b91c1c', color: '#fff', padding: '2px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: 800, fontFamily: 'monospace' }}>
                      #{i + 1} HIGHEST RISK
                    </span>
                    <span style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', padding: '2px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: 700 }}>
                      {c.risk_level} · {c.risk_score}/100
                    </span>
                    <span style={{ background: `${CATEGORY_COLORS[c.category]}18`, color: CATEGORY_COLORS[c.category] || '#64748b', border: `1px solid ${CATEGORY_COLORS[c.category]}40`, padding: '2px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: 700 }}>
                      Category: {c.category}
                    </span>
                  </div>

                  <div style={{ fontSize: '11px', color: '#64748b', fontFamily: 'monospace' }}>
                    <b>{c.count}</b> occurrences · <b>{c.affected_sessions?.length || 1}</b> sessions
                  </div>
                </div>

                <h4
                  onClick={() => setSelectedCluster(c)}
                  style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a', margin: '0 0 6px', cursor: 'pointer' }}
                >
                  {c.title}
                </h4>

                {c.plain_explanation && (
                  <p style={{ background: '#fff1f2', border: '1px solid #ffe4e6', borderRadius: '6px', padding: '8px 12px', fontSize: '12px', color: '#9f1239', margin: '0 0 10px' }}>
                    <b>Root Cause / Impact:</b> {c.plain_explanation}
                  </p>
                )}

                {c.suggested_fix && (
                  <div style={{ background: '#0f172a', borderRadius: '8px', padding: '12px 14px', color: '#f8fafc' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <span style={{ color: '#34d399', fontSize: '11px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Wrench size={13} /> Recommended Production Fix & Mitigation:
                      </span>
                      <button
                        onClick={() => copyFixText(c.id, c.suggested_fix)}
                        style={{
                          background: '#1e293b',
                          color: '#38bdf8',
                          border: '1px solid #334155',
                          borderRadius: '4px',
                          padding: '3px 8px',
                          fontSize: '10px',
                          fontWeight: 700,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px'
                        }}
                      >
                        {copiedFixId === c.id ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
                        <span>{copiedFixId === c.id ? 'Copied!' : 'Copy Fix'}</span>
                      </button>
                    </div>

                    <div style={{ fontFamily: 'monospace', fontSize: '11px', lineHeight: '1.6', color: '#e2e8f0', whiteSpace: 'pre-line' }}>
                      {c.suggested_fix}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 6. CLUSTERS LIST OR EMPTY STATE CARD (EXACTLY MATCHING SCREENSHOT) */}
      <section>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: '#64748b' }}>
            <RefreshCw className="animate-spin" size={28} style={{ margin: '0 auto 10px', color: '#0f766e' }} />
            <span>Loading telemetry clusters...</span>
          </div>
        ) : displayClusters.length === 0 ? (
          /* EMPTY STATE CARD (MATCHING REFERENCE SCREENSHOT) */
          <div className="cm-empty-card">
            <div className="cm-empty-icon-circle">
              <CheckCircle2 size={30} />
            </div>
            <h3 className="cm-empty-title">No matching crashes</h3>
            <p className="cm-empty-sub">
              Your system is clean, or the current filters match zero items. Start the bots in CrashWeb to generate live traffic.
            </p>
            <button
              onClick={() => {
                if (onOpenSimulation) onOpenSimulation();
                else window.open('http://localhost:3000/chaos', '_blank');
              }}
              className="cm-btn-open-sim"
            >
              Open live simulation
            </button>
          </div>
        ) : (
          /* ACTIVE CLUSTER CARDS */
          <div className="cm-clusters-grid">
            {displayClusters.map((cluster) => {
              const riskColor = getRiskColor(cluster.risk_score);
              return (
                <div
                  key={cluster.id}
                  onClick={() => setSelectedCluster(cluster)}
                  className="cm-cluster-card"
                >
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <span
                        className="cat-badge"
                        style={{
                          backgroundColor: `${CATEGORY_COLORS[cluster.category]}18`,
                          color: CATEGORY_COLORS[cluster.category] || '#64748b',
                          border: `1px solid ${CATEGORY_COLORS[cluster.category]}40`,
                        }}
                      >
                        {cluster.category}
                      </span>

                      <span style={{ background: `${riskColor}18`, color: riskColor, border: `1px solid ${riskColor}40`, padding: '2px 7px', borderRadius: '4px', fontSize: '10px', fontWeight: 800 }}>
                        {cluster.risk_level} · {cluster.risk_score}
                      </span>
                    </div>

                    <h4 style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a', margin: '0 0 6px', lineHeight: '1.4' }}>
                      {cluster.title}
                    </h4>

                    {cluster.plain_explanation && (
                      <p style={{ fontSize: '11px', color: '#64748b', margin: '0 0 10px', lineHeight: '1.5' }}>
                        {cluster.plain_explanation.slice(0, 110)}...
                      </p>
                    )}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '10px', borderTop: '1px solid #f1f5f9', fontSize: '11px', color: '#64748b', fontFamily: 'monospace' }}>
                    <span><b>{cluster.count}</b> occurrences</span>
                    <span>Last: {new Date(cluster.last_seen).toLocaleTimeString()}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 7. CLUSTER DETAIL MODAL */}
      {selectedCluster && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(15, 23, 42, 0.65)',
          display: 'grid',
          placeItems: 'center',
          zIndex: 9999,
          padding: '20px',
        }} onClick={(e) => { if (e.target === e.currentTarget) setSelectedCluster(null); }}>
          <div style={{
            background: '#ffffff',
            borderRadius: '14px',
            maxWidth: '680px',
            width: '100%',
            maxHeight: '90vh',
            overflowY: 'auto',
            padding: '24px',
            boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
            position: 'relative',
          }}>
            <button
              onClick={() => setSelectedCluster(null)}
              style={{ position: 'absolute', top: '16px', right: '16px', background: 'none', border: 0, color: '#64748b', cursor: 'pointer' }}
            >
              <X size={20} />
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              <span className="cat-badge" style={{ backgroundColor: `${CATEGORY_COLORS[selectedCluster.category]}18`, color: CATEGORY_COLORS[selectedCluster.category] || '#64748b' }}>
                {selectedCluster.category}
              </span>
              <span style={{ fontSize: '11px', color: '#64748b' }}>
                Fingerprint: <code style={{ fontFamily: 'monospace', color: '#0f172a' }}>{selectedCluster.fingerprint}</code>
              </span>
            </div>

            <h3 style={{ fontSize: '18px', fontWeight: 800, color: '#0f172a', margin: '0 0 12px' }}>
              {selectedCluster.title}
            </h3>

            {selectedCluster.plain_explanation && (
              <div style={{ background: '#fff1f2', border: '1px solid #fecdd3', borderRadius: '8px', padding: '12px', fontSize: '12px', color: '#9f1239', marginBottom: '16px' }}>
                <b>Root Cause / Impact:</b> {selectedCluster.plain_explanation}
              </div>
            )}

            {selectedCluster.suggested_fix && (
              <div style={{ background: '#0f172a', borderRadius: '8px', padding: '14px', color: '#f8fafc', marginBottom: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <span style={{ color: '#34d399', fontSize: '12px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Wrench size={14} /> Recommended Production Fix & Mitigation:
                  </span>
                  <button
                    onClick={() => copyFixText(selectedCluster.id, selectedCluster.suggested_fix)}
                    style={{ background: '#1e293b', color: '#38bdf8', border: '1px solid #334155', borderRadius: '4px', padding: '4px 10px', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}
                  >
                    {copiedFixId === selectedCluster.id ? 'Copied!' : 'Copy Fix'}
                  </button>
                </div>
                <pre style={{ margin: 0, fontFamily: 'monospace', fontSize: '11px', lineHeight: '1.6', color: '#e2e8f0', whiteSpace: 'pre-line' }}>
                  {selectedCluster.suggested_fix}
                </pre>
              </div>
            )}

            {selectedCluster.sample_stack_trace && (
              <div style={{ marginBottom: '16px' }}>
                <span style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Sample Stack Trace</span>
                <pre style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '12px', fontSize: '11px', fontFamily: 'monospace', color: '#0f172a', overflowX: 'auto', marginTop: '4px' }}>
                  {selectedCluster.sample_stack_trace}
                </pre>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '16px' }}>
              <button
                onClick={() => setSelectedCluster(null)}
                style={{ background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: '6px', padding: '8px 16px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
