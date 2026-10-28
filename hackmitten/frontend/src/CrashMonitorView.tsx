import React, { useState, useEffect, useRef } from 'react';
import {
  AlertTriangle, Flame, Activity, ShieldAlert, CheckCircle2, Clock3,
  ExternalLink, Search, RefreshCw, Download, Filter, ArrowUpRight,
  ChevronRight, X, Copy, Check, Eye, Bug, Database, Cpu, Wifi,
  Sliders, Radio, Terminal, Sparkles, Layers, ArrowRight, Sun, Moon,
  FileSpreadsheet, FileJson
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
  trend_over_time?: Array<{ bucket: number; count: number }>;
  occurrences?: any[];
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
}

export const CATEGORY_COLORS: Record<string, string> = {
  'Database': '#ef4444',
  'Memory': '#f97316',
  'JavaScript Runtime': '#ec4899',
  'Network/HTTP': '#3b82f6',
  'Timeout/Performance': '#eab308',
  'Resource Loading': '#8b5cf6',
  'Auth/Permissions': '#14b8a6',
  'Validation/Input': '#6366f1',
  'Unknown': '#64748b',
};

export default function CrashMonitorView({
  darkMode,
  toggleDarkMode,
}: {
  darkMode: boolean;
  toggleDarkMode: () => void;
}) {
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [selectedCluster, setSelectedCluster] = useState<Cluster | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [selectedStatus, setSelectedStatus] = useState<string>('active');
  const [timeRange, setTimeRange] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sortBy, setSortBy] = useState<'risk' | 'count' | 'recent'>('risk');
  const [copied, setCopied] = useState<boolean>(false);
  const [toast, setToast] = useState<{ msg: string; type: 'critical' | 'info' | 'success' } | null>(null);
  const [liveStreamEvents, setLiveStreamEvents] = useState<any[]>([]);
  const [showLiveDrawer, setShowLiveDrawer] = useState<boolean>(false);
  const [showSettingsModal, setShowSettingsModal] = useState<boolean>(false);

  // Load initial data
  const loadData = async () => {
    try {
      const [clustersRes, statsRes] = await Promise.all([
        fetch(`${API_BASE}/clusters?status=${selectedStatus}&category=${selectedCategory}&sort_by=${sortBy}&search=${encodeURIComponent(searchQuery)}`),
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

  useEffect(() => {
    loadData();
  }, [selectedCategory, selectedStatus, sortBy, searchQuery]);

  // Connect to real-time Server-Sent Events (SSE)
  useEffect(() => {
    let eventSource: EventSource | null = null;
    try {
      const streamUrl = `${API_BASE}/stream`;
      eventSource = new EventSource(streamUrl);

      eventSource.addEventListener('crash', (e) => {
        try {
          const data = JSON.parse(e.data);
          const newCrash = data.crash;
          const updatedCluster: Cluster = data.cluster;

          setLiveStreamEvents((prev) => [newCrash, ...prev.slice(0, 49)]);

          // Update cluster list in place
          setClusters((prev) => {
            const idx = prev.findIndex((c) => c.id === updatedCluster.id || c.fingerprint === updatedCluster.fingerprint);
            if (idx !== -1) {
              const updated = [...prev];
              updated[idx] = updatedCluster;
              return updated;
            }
            return [updatedCluster, ...prev];
          });

          // Show toast if critical
          if (updatedCluster.risk_level === 'CRITICAL') {
            setToast({
              msg: `CRITICAL Incident Spike: ${updatedCluster.title}`,
              type: 'critical',
            });
            setTimeout(() => setToast(null), 5000);
          }

          // Refresh stats
          fetch(`${API_BASE}/stats`).then((r) => r.json()).then(setStats).catch(() => {});
        } catch (err) {
          console.error('SSE parse error:', err);
        }
      });

      eventSource.addEventListener('health_check', (e) => {
        try {
          const data = JSON.parse(e.data);
          setStats((prev) => prev ? {
            ...prev,
            siteStatus: data.status,
            lastLatencyMs: data.latencyMs,
          } : null);
        } catch {
          // safe
        }
      });
    } catch (err) {
      console.warn('SSE connection unavailable, falling back to interval:', err);
    }

    const interval = setInterval(loadData, 5000);
    return () => {
      clearInterval(interval);
      if (eventSource) eventSource.close();
    };
  }, []);

  const openClusterDetail = async (cluster: Cluster) => {
    try {
      const res = await fetch(`${API_BASE}/clusters/${cluster.id}`);
      if (res.ok) {
        const fullDetail = await res.json();
        setSelectedCluster(fullDetail);
      } else {
        setSelectedCluster(cluster);
      }
    } catch {
      setSelectedCluster(cluster);
    }
  };

  const updateStatus = async (clusterId: string, status: 'active' | 'resolved' | 'ignored') => {
    try {
      const res = await fetch(`${API_BASE}/clusters/${clusterId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        setClusters((prev) =>
          prev.map((c) => (c.id === clusterId ? { ...c, status } : c))
        );
        if (selectedCluster && selectedCluster.id === clusterId) {
          setSelectedCluster({ ...selectedCluster, status });
        }
        setToast({ msg: `Cluster marked as ${status}.`, type: 'success' });
        setTimeout(() => setToast(null), 3000);
      }
    } catch {
      // safe
    }
  };

  const copyStackTrace = (text?: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const exportReport = (format: 'json' | 'csv') => {
    if (format === 'json') {
      const jsonStr = JSON.stringify({ stats, clusters }, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `crash-report-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
    } else {
      const headers = ['ID', 'Risk Level', 'Risk Score', 'Category', 'Title', 'Count', 'Status', 'Last Seen', 'Affected Endpoints'];
      const rows = clusters.map((c) => [
        c.id,
        c.risk_level,
        c.risk_score,
        `"${c.category}"`,
        `"${c.title.replace(/"/g, '""')}"`,
        c.count,
        c.status,
        c.last_seen,
        `"${(c.affected_endpoints || []).join('; ')}"`,
      ]);
      const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `crash-report-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
    }
  };

  const highRiskClusters = clusters.filter(
    (c) => (c.risk_level === 'CRITICAL' || c.risk_level === 'HIGH') && c.status === 'active'
  );

  const categoriesList = [
    'All', 'Database', 'JavaScript Runtime', 'Network/HTTP', 'Timeout/Performance',
    'Memory', 'Resource Loading', 'Auth/Permissions', 'Validation/Input'
  ];

  return (
    <div className="cm-container">
      {/* Toast Alert */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 px-5 py-3 rounded-xl shadow-2xl flex items-center gap-3 border text-sm font-semibold transition-all ${
            toast.type === 'critical'
              ? 'bg-rose-950 border-rose-500 text-rose-200'
              : toast.type === 'success'
              ? 'bg-emerald-950 border-emerald-500 text-emerald-200'
              : 'bg-slate-900 border-slate-700 text-slate-200'
          }`}
        >
          {toast.type === 'critical' ? (
            <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 animate-bounce" />
          ) : (
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          )}
          <span>{toast.msg}</span>
          <button onClick={() => setToast(null)} className="ml-2 hover:opacity-75">
            <X size={15} />
          </button>
        </div>
      )}

      {/* TOP STATUS & CONTROLS BANNER */}
      <section className="site-health-banner">
        <div className="site-health-info">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                Target Victim Site:
              </span>
              <a
                href={stats?.targetUrl || 'http://localhost:3000'}
                target="_blank"
                rel="noreferrer"
                className="font-bold text-sm text-indigo-500 hover:underline flex items-center gap-1 font-mono"
              >
                {stats?.targetUrl || 'http://localhost:3000'}
                <ExternalLink size={12} />
              </a>
            </div>
            <div className="flex items-center gap-2.5 mt-1">
              <span
                className={`health-badge ${
                  stats?.siteStatus === 'Healthy'
                    ? 'healthy'
                    : stats?.siteStatus === 'Degraded'
                    ? 'degraded'
                    : 'down'
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-current animate-pulse" />
                {stats?.siteStatus ? stats.siteStatus.toUpperCase() : 'HEALTHY'}
              </span>
              <span className="text-xs text-slate-500 font-mono">
                Latency: <b className="text-slate-300">{stats?.lastLatencyMs || 42} ms</b>
              </span>
              <span className="text-xs text-slate-500 font-mono">
                Uptime: <b className="text-slate-300">{stats?.uptimePct || 100}%</b>
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Live Feed Toggle */}
          <button
            onClick={() => setShowLiveDrawer(!showLiveDrawer)}
            className="button secondary compact flex items-center gap-1.5"
            title="Toggle Live Ingestion Feed"
          >
            <Radio size={14} className="text-rose-500 animate-pulse" />
            <span>Live Stream</span>
            {liveStreamEvents.length > 0 && (
              <span className="nav-count">{liveStreamEvents.length}</span>
            )}
          </button>

          {/* Export Dropdown */}
          <button
            onClick={() => exportReport('json')}
            className="button secondary compact flex items-center gap-1.5"
            title="Export Report as JSON"
          >
            <FileJson size={14} />
            <span>Export JSON</span>
          </button>
          <button
            onClick={() => exportReport('csv')}
            className="button secondary compact flex items-center gap-1.5"
            title="Export Report as CSV"
          >
            <FileSpreadsheet size={14} />
            <span>CSV</span>
          </button>

          {/* Refresh */}
          <button
            onClick={loadData}
            className="button secondary compact"
            title="Refresh clusters"
          >
            <RefreshCw size={14} />
          </button>

          {/* Dark Mode Toggle */}
          <button
            onClick={toggleDarkMode}
            className="button secondary compact"
            title="Toggle Light/Dark Theme"
          >
            {darkMode ? <Sun size={14} /> : <Moon size={14} />}
          </button>

          {/* Settings */}
          <button
            onClick={() => setShowSettingsModal(true)}
            className="button secondary compact"
            title="Target Site & Onboarding Settings"
          >
            <Sliders size={14} />
          </button>
        </div>
      </section>

      {/* QUICK METRICS GRID */}
      <section className="cm-metrics-grid">
        <div className="cm-card">
          <div className="cm-card-header">
            <span>Total Crashes</span>
            <Bug size={16} className="text-indigo-500" />
          </div>
          <div className="cm-card-value text-indigo-500">
            {stats?.totalCrashes?.toLocaleString() || 0}
          </div>
          <div className="cm-card-sub">
            across {stats?.activeClusters || 0} active clusters
          </div>
        </div>

        <div className="cm-card alert-card">
          <div className="cm-card-header">
            <span>High-Risk Errors</span>
            <AlertTriangle size={16} className="text-rose-500" />
          </div>
          <div className="cm-card-value text-rose-500">
            {stats?.highRiskCount || 0}
          </div>
          <div className="cm-card-sub text-rose-400 font-semibold">
            Require immediate attention
          </div>
        </div>

        <div className="cm-card">
          <div className="cm-card-header">
            <span>Crash Velocity</span>
            <Activity size={16} className="text-amber-500" />
          </div>
          <div className="cm-card-value text-amber-500">
            {stats?.crashRatePerMin || 0} <small className="text-xs font-normal">/min</small>
          </div>
          <div className="cm-card-sub">
            Calculated over 5-minute rolling window
          </div>
        </div>

        <div className="cm-card">
          <div className="cm-card-header">
            <span>Impacted Sessions</span>
            <Cpu size={16} className="text-teal-600" />
          </div>
          <div className="cm-card-value text-teal-600">
            {stats?.sessionsImpacted || 0}
          </div>
          <div className="cm-card-sub">
            Unique user & bot sessions affected
          </div>
        </div>
      </section>

      {/* CATEGORY DISTRIBUTION BAR */}
      {stats?.categoryDistribution && Object.keys(stats.categoryDistribution).length > 0 && (
        <section className="cm-card mb-6 p-4">
          <div className="flex items-center justify-between text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
            <span>Crash Breakdown by Category</span>
            <span>{stats.totalCrashes} Incidents</span>
          </div>
          <div className="cat-bar-container">
            {Object.entries(stats.categoryDistribution).map(([cat, cnt]) => {
              const pct = stats.totalCrashes > 0 ? (cnt / stats.totalCrashes) * 100 : 0;
              return (
                <div
                  key={cat}
                  className="cat-bar-slice"
                  style={{
                    width: `${pct}%`,
                    backgroundColor: CATEGORY_COLORS[cat] || '#64748b',
                  }}
                  title={`${cat}: ${cnt} (${pct.toFixed(1)}%)`}
                />
              );
            })}
          </div>
          <div className="flex flex-wrap gap-3 text-[11px] text-slate-400">
            {Object.entries(stats.categoryDistribution).map(([cat, cnt]) => (
              <span key={cat} className="flex items-center gap-1.5">
                <span
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ backgroundColor: CATEGORY_COLORS[cat] || '#64748b' }}
                />
                <span className="font-semibold text-slate-300">{cat}:</span>
                <span className="font-mono">{cnt}</span>
              </span>
            ))}
          </div>
        </section>
      )}

      {/* HIGH-RISK ERRORS SPOTLIGHT (AUTO-FLAGGED AT TOP) */}
      {highRiskClusters.length > 0 && (
        <section className="high-risk-section">
          <div className="high-risk-header">
            <div className="high-risk-title">
              <Flame size={20} className="text-rose-500 animate-pulse" />
              <span>HIGH-RISK ERRORS (CRITICAL & HIGH SEVERITY)</span>
            </div>
            <span className="risk-pill critical">
              {highRiskClusters.length} ALERT{highRiskClusters.length > 1 ? 'S' : ''} ACTIVE
            </span>
          </div>

          <div className="high-risk-list">
            {highRiskClusters.map((cluster) => (
              <div
                key={cluster.id}
                onClick={() => openClusterDetail(cluster)}
                className="high-risk-card"
              >
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className={`risk-pill ${cluster.risk_level.toLowerCase()}`}>
                      {cluster.risk_level} · {cluster.risk_score}
                    </span>
                    <span
                      className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider font-mono"
                      style={{
                        backgroundColor: `${CATEGORY_COLORS[cluster.category]}18`,
                        color: CATEGORY_COLORS[cluster.category],
                        border: `1px solid ${CATEGORY_COLORS[cluster.category]}40`,
                      }}
                    >
                      {cluster.category}
                    </span>
                    {cluster.is_spike && (
                      <span className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-400 border border-rose-500/40 text-[10px] font-bold font-mono animate-pulse">
                        SPIKE DETECTED (5x)
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-slate-500 font-mono">
                    <span><b>{cluster.count}</b> occurrences</span>
                    <span>Last: {new Date(cluster.last_seen).toLocaleTimeString()}</span>
                  </div>
                </div>

                <div className="font-bold text-sm text-slate-100 flex items-center justify-between">
                  <span>{cluster.title}</span>
                  <ChevronRight size={16} className="text-slate-400" />
                </div>

                {cluster.plain_explanation && (
                  <p className="text-xs text-rose-300/90 font-medium">
                    <b>Impact:</b> {cluster.plain_explanation}
                  </p>
                )}

                {cluster.suggested_fix && (
                  <div className="text-[11px] text-slate-400 bg-black/20 p-2 rounded border border-white/5 font-mono">
                    <span className="text-emerald-400 font-semibold">Suggested Fix:</span> {cluster.suggested_fix}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* FILTER & SEARCH BAR */}
      <section className="space-y-4 mb-6">
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
          {/* Search */}
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-2.5 text-slate-400" size={16} />
            <input
              type="text"
              placeholder="Search by error type, message, endpoint..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 rounded-xl bg-slate-900/60 border border-slate-700/60 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div className="flex items-center gap-3">
            {/* Status Filter */}
            <div className="flex rounded-xl bg-slate-900/60 border border-slate-700/60 p-1 text-xs">
              {(['active', 'resolved', 'all'] as const).map((st) => (
                <button
                  key={st}
                  onClick={() => setSelectedStatus(st)}
                  className={`px-3 py-1 rounded-lg font-semibold capitalize transition ${
                    selectedStatus === st
                      ? 'bg-indigo-600 text-white shadow'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>

            {/* Sort Dropdown */}
            <select
              value={sortBy}
              onChange={(e: any) => setSortBy(e.target.value)}
              className="bg-slate-900/60 border border-slate-700/60 rounded-xl px-3 py-2 text-xs font-semibold text-slate-300"
            >
              <option value="risk">Sort by Risk Score</option>
              <option value="count">Sort by Frequency</option>
              <option value="recent">Sort by Most Recent</option>
            </select>
          </div>
        </div>

        {/* Category Pills */}
        <div className="cm-filters">
          {categoriesList.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`cm-filter-pill ${selectedCategory === cat ? 'active' : ''}`}
            >
              {cat}
            </button>
          ))}
        </div>
      </section>

      {/* CLUSTERS GRID VIEW */}
      <section>
        {loading ? (
          <div className="text-center py-16 text-slate-500">
            <RefreshCw className="w-8 h-8 mx-auto animate-spin mb-3 text-indigo-500" />
            Loading crash clusters...
          </div>
        ) : clusters.length === 0 ? (
          <div className="text-center py-16 bg-slate-900/30 border border-dashed border-slate-800 rounded-2xl">
            <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
            <h3 className="text-lg font-bold text-slate-200">No matching crashes found</h3>
            <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
              Your system is clean or the filter matches zero items. Start the bots in CrashWeb to generate live traffic!
            </p>
          </div>
        ) : (
          <div className="clusters-grid">
            {clusters.map((cluster) => (
              <div
                key={cluster.id}
                onClick={() => openClusterDetail(cluster)}
                className={`cluster-item-card ${cluster.status === 'resolved' ? 'is-resolved' : ''}`}
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span
                      className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider font-mono"
                      style={{
                        backgroundColor: `${CATEGORY_COLORS[cluster.category]}18`,
                        color: CATEGORY_COLORS[cluster.category],
                        border: `1px solid ${CATEGORY_COLORS[cluster.category]}40`,
                      }}
                    >
                      {cluster.category}
                    </span>

                    <span className={`risk-pill ${cluster.risk_level.toLowerCase()}`}>
                      {cluster.risk_level} · {cluster.risk_score}
                    </span>
                  </div>

                  <h3 className="font-bold text-sm text-slate-100 line-clamp-2 leading-snug">
                    {cluster.title}
                  </h3>

                  <div className="text-xs text-slate-400 font-mono mt-2 truncate">
                    {cluster.affected_endpoints?.[0] || '/'}
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-800 flex items-center justify-between text-xs text-slate-500 font-mono">
                  <div>
                    <b className="text-slate-200">{cluster.count}</b> events
                  </div>

                  {/* Sparkline */}
                  <div className="sparkline-container" title="Recent activity trend">
                    {(cluster.trend_over_time || [{ bucket: 1, count: 2 }, { bucket: 2, count: 5 }]).map((t, idx) => (
                      <div
                        key={idx}
                        className="sparkline-bar"
                        style={{
                          height: `${Math.min(24, Math.max(4, t.count * 3))}px`,
                          backgroundColor: cluster.risk_level === 'CRITICAL' ? '#ef4444' : '#6269ce',
                        }}
                      />
                    ))}
                  </div>

                  <div className="text-[11px]">
                    {new Date(cluster.last_seen).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* CLUSTER DETAIL DRAWER */}
      {selectedCluster && (
        <div className="cm-drawer-overlay" onClick={() => setSelectedCluster(null)}>
          <div className="cm-drawer-content" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between pb-4 border-b border-slate-800">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className="px-2 py-0.5 rounded text-[10px] font-bold font-mono uppercase"
                    style={{
                      backgroundColor: `${CATEGORY_COLORS[selectedCluster.category]}20`,
                      color: CATEGORY_COLORS[selectedCluster.category],
                    }}
                  >
                    {selectedCluster.category}
                  </span>
                  <span className={`risk-pill ${selectedCluster.risk_level.toLowerCase()}`}>
                    {selectedCluster.risk_level} · Score {selectedCluster.risk_score}
                  </span>
                  <span className="text-xs text-slate-500 font-mono">ID: {selectedCluster.id}</span>
                </div>
                <h2 className="text-lg font-bold text-white leading-snug">
                  {selectedCluster.title}
                </h2>
              </div>
              <button
                onClick={() => setSelectedCluster(null)}
                className="p-1 rounded-lg hover:bg-slate-800 text-slate-400"
              >
                <X size={20} />
              </button>
            </div>

            <div className="space-y-6 mt-6">
              {/* Actions: Mark as Resolved / Ignored */}
              <div className="flex items-center gap-3">
                {selectedCluster.status !== 'resolved' ? (
                  <button
                    onClick={() => updateStatus(selectedCluster.id, 'resolved')}
                    className="button primary compact flex items-center gap-1.5"
                  >
                    <Check size={14} /> Mark as Resolved
                  </button>
                ) : (
                  <button
                    onClick={() => updateStatus(selectedCluster.id, 'active')}
                    className="button secondary compact flex items-center gap-1.5"
                  >
                    <RefreshCw size={14} /> Reopen Incident
                  </button>
                )}
                {selectedCluster.status !== 'ignored' && (
                  <button
                    onClick={() => updateStatus(selectedCluster.id, 'ignored')}
                    className="button secondary compact"
                  >
                    Ignore Cluster
                  </button>
                )}
              </div>

              {/* Plain English Root Cause & Suggested Fix */}
              <div className="bg-slate-900/80 rounded-xl p-4 border border-slate-800 space-y-3">
                <div>
                  <span className="text-xs font-bold text-rose-400 uppercase tracking-wider block mb-1">
                    Plain-English Incident Explanation
                  </span>
                  <p className="text-xs text-slate-300">
                    {selectedCluster.plain_explanation || 'Detailed root-cause analysis is generated from stack frames and category weights.'}
                  </p>
                </div>
                <div className="pt-3 border-t border-slate-800">
                  <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider block mb-1">
                    Recommended Fix
                  </span>
                  <p className="text-xs text-slate-300 font-mono bg-black/30 p-2.5 rounded border border-white/5">
                    {selectedCluster.suggested_fix || 'Review recent commits affecting this route.'}
                  </p>
                </div>
              </div>

              {/* Stack Trace */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                    Normalized Stack Trace
                  </span>
                  <button
                    onClick={() => copyStackTrace(selectedCluster.sample_stack_trace)}
                    className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
                  >
                    {copied ? <Check size={12} /> : <Copy size={12} />}
                    <span>{copied ? 'Copied' : 'Copy Trace'}</span>
                  </button>
                </div>
                <div className="code-block">
                  {selectedCluster.sample_stack_trace || 'No stack trace captured.'}
                </div>
              </div>

              {/* Affected Endpoints & Browsers */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-slate-900/50 p-3 rounded-xl border border-slate-800">
                  <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">
                    Affected Pages
                  </span>
                  <div className="space-y-1">
                    {(selectedCluster.affected_endpoints || []).map((ep, i) => (
                      <div key={i} className="text-xs font-mono text-slate-300 truncate">
                        {ep}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-slate-900/50 p-3 rounded-xl border border-slate-800">
                  <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">
                    Affected Browsers
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {(selectedCluster.affected_browsers || []).map((b, i) => (
                      <span key={i} className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">
                        {b}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {/* Sample Occurrences */}
              {selectedCluster.occurrences && selectedCluster.occurrences.length > 0 && (
                <div>
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-2">
                    Recent Occurrences ({selectedCluster.occurrences.length})
                  </span>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {selectedCluster.occurrences.map((occ: any, i: number) => (
                      <div key={i} className="flex items-center justify-between text-xs bg-slate-900/40 p-2 rounded border border-slate-800 font-mono">
                        <span className="text-slate-400">{occ.timestamp}</span>
                        <span className="text-indigo-400">{occ.sessionId || 'anonymous'}</span>
                        <span className="text-slate-300">{occ.browser || 'Unknown'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* REAL-TIME LIVE INGESTION DRAWER */}
      {showLiveDrawer && (
        <div className="cm-drawer-overlay" onClick={() => setShowLiveDrawer(false)}>
          <div className="cm-drawer-content" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Radio className="w-4 h-4 text-rose-500 animate-pulse" />
                <h3 className="font-bold text-white text-base">Live Ingestion Event Stream</h3>
              </div>
              <button
                onClick={() => setShowLiveDrawer(false)}
                className="p-1 rounded-lg hover:bg-slate-800 text-slate-400"
              >
                <X size={18} />
              </button>
            </div>

            <p className="text-xs text-slate-400 mt-2 mb-4">
              Real-time SSE event stream of all raw incoming crash events reported by CrashWeb bots and frontend listeners.
            </p>

            <div className="space-y-2 flex-1 overflow-y-auto">
              {liveStreamEvents.length > 0 ? (
                liveStreamEvents.map((ev, i) => (
                  <div
                    key={i}
                    className="p-3 rounded-xl bg-slate-900 border border-slate-800 text-xs font-mono space-y-1"
                  >
                    <div className="flex items-center justify-between text-[10px] text-slate-500">
                      <span>{ev.timestamp || new Date().toLocaleTimeString()}</span>
                      <span className="text-indigo-400 font-bold">{ev.botId || ev.sessionId || 'session'}</span>
                    </div>
                    <div className="font-bold text-rose-400">{ev.errorType}</div>
                    <div className="text-slate-300 truncate">{ev.message}</div>
                    <div className="text-[10px] text-slate-500">{ev.url}</div>
                  </div>
                ))
              ) : (
                <div className="text-center py-12 text-slate-500 text-xs">
                  Listening for incoming crashes on /api/stream...
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* SETTINGS & ONBOARDING MODAL */}
      {showSettingsModal && (
        <div className="cm-drawer-overlay" onClick={() => setShowSettingsModal(false)}>
          <div className="cm-drawer-content max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <h3 className="font-bold text-white text-base">Project & Health Settings</h3>
              <button
                onClick={() => setShowSettingsModal(false)}
                className="p-1 rounded-lg hover:bg-slate-800 text-slate-400"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4 mt-4 text-xs">
              <div>
                <label className="block font-bold text-slate-400 uppercase tracking-wider mb-1">
                  Target Website URL
                </label>
                <input
                  type="text"
                  readOnly
                  value={stats?.targetUrl || 'http://localhost:3000'}
                  className="w-full p-2.5 rounded-lg bg-slate-900 border border-slate-800 font-mono text-slate-300"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-400 uppercase tracking-wider mb-1">
                  Project API Key
                </label>
                <input
                  type="text"
                  readOnly
                  value="key_live_crashweb_2026"
                  className="w-full p-2.5 rounded-lg bg-slate-900 border border-slate-800 font-mono text-slate-300"
                />
              </div>

              <div className="pt-4 border-t border-slate-800 space-y-2">
                <span className="font-bold text-slate-300 block">Judge / Demo Quick Actions</span>
                <button
                  onClick={async () => {
                    await fetch(`${API_BASE}/seed-crashes`, { method: 'POST' });
                    setToast({ msg: 'Database reset & demo clusters seeded!', type: 'success' });
                    loadData();
                    setShowSettingsModal(false);
                  }}
                  className="w-full button primary py-2.5 flex items-center justify-center gap-2"
                >
                  <Sparkles size={15} /> Reset & Re-Seed Demo Clusters
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

