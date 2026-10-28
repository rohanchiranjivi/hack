import React, { useState, useEffect, useRef } from 'react';
import {
  AlertTriangle, Flame, Activity, ShieldAlert, CheckCircle2, Clock3,
  ExternalLink, Search, RefreshCw, Download, Filter, ArrowUpRight,
  ChevronRight, X, Copy, Check, Eye, Bug, Database, Cpu, Wifi,
  Sliders, Radio, Terminal, Sparkles, Layers, ArrowRight, Sun, Moon,
  FileSpreadsheet, FileJson, RotateCcw, Wrench
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
  const [copiedFixId, setCopiedFixId] = useState<string | null>(null);
  const [filterTop5Only, setFilterTop5Only] = useState<boolean>(false);
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
        setLiveStreamEvents([]);
        setToast({ msg: 'All metrics and crashes returned to zero.', type: 'info' });
        setTimeout(() => setToast(null), 3000);
      }
    } catch (e) {
      console.error('Reset failed:', e);
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
        setLiveStreamEvents([]);
      });

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

  const top5HighRisks: Cluster[] = (stats?.top5HighRisks && stats.top5HighRisks.length > 0)
    ? stats.top5HighRisks
    : clusters
        .filter((c) => c.status === 'active')
        .sort((a, b) => (b.risk_score - a.risk_score) || (b.count - a.count))
        .slice(0, 5)
        .map((c, i) => ({ ...c, rank: i + 1 }));

  const thresholdReached = (stats?.totalCrashes || 0) >= 500 || Boolean(stats?.thresholdReached);

  const copyFixText = (id: string, fixText?: string) => {
    if (!fixText) return;
    navigator.clipboard.writeText(fixText);
    setCopiedFixId(id);
    setTimeout(() => setCopiedFixId(null), 2500);
  };

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
                href={stats?.targetUrl || 'https://crashweb-gules.vercel.app'}
                target="_blank"
                rel="noreferrer"
                className="font-bold text-sm text-indigo-500 hover:underline flex items-center gap-1 font-mono"
              >
                {stats?.targetUrl || 'https://crashweb-gules.vercel.app'}
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
          {/* Reset All to 0 */}
          <button
            onClick={resetToZero}
            className="btn-reset-zero"
            title="Reset All Monitoring Metrics & Crashes back to 0"
          >
            <RotateCcw size={13} />
            <span>Reset to 0</span>
          </button>

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

      {/* 500+ CRASHES THRESHOLD TRIAGE ALERT BANNER */}
      {thresholdReached && (
        <section className="threshold-alert-banner">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-start md:items-center gap-3">
              <div className="p-2.5 rounded-xl bg-rose-500/20 border border-rose-500/40 text-rose-400 shrink-0">
                <ShieldAlert size={28} className="animate-pulse" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-0.5 rounded-full bg-rose-600 text-white font-mono font-bold text-[10px] tracking-wider uppercase shadow">
                    Threshold Active (500+ Alerts)
                  </span>
                  <h3 className="text-base font-extrabold text-slate-100">
                    Automated High-Risk Triage Engaged · {stats?.totalCrashes?.toLocaleString()} Total Crashes
                  </h3>
                </div>
                <p className="text-xs text-rose-200/90 mt-1">
                  Threshold reached. Background noise suppressed. Categorizing <b>ONLY the Top 5 High-Risk Failures</b> with prioritized remediation fixes below.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setFilterTop5Only(false)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold font-mono transition ${
                  !filterTop5Only
                    ? 'bg-slate-800 text-slate-200 border border-slate-700 shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                All Clusters ({clusters.length})
              </button>
              <button
                onClick={() => setFilterTop5Only(true)}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold font-mono transition flex items-center gap-1.5 ${
                  filterTop5Only
                    ? 'bg-rose-600 text-white shadow-lg shadow-rose-600/30'
                    : 'bg-rose-950/70 text-rose-300 border border-rose-800/60 hover:bg-rose-900/60'
                }`}
              >
                <Flame size={13} className="text-amber-300" />
                <span>Top 5 High Risks Only</span>
              </button>
            </div>
          </div>
        </section>
      )}

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
            {thresholdReached ? 'Triaged to Top 5 high-risk categories' : 'Require immediate attention'}
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

      {/* TOP 5 HIGH-RISK INCIDENTS & RECOMMENDED FIXES */}
      {top5HighRisks.length > 0 && (
        <section className="high-risk-section mb-8">
          <div className="high-risk-header">
            <div className="high-risk-title flex items-center gap-2">
              <Flame size={22} className="text-rose-500 animate-pulse" />
              <span className="tracking-wide">
                {thresholdReached ? 'TOP 5 HIGH-RISK FAILURES & RECOMMENDED FIXES (TRIAGED)' : 'HIGH-RISK ERRORS & RECOMMENDED FIXES'}
              </span>
            </div>
            <span className="risk-pill critical">
              {top5HighRisks.length} CRITICAL / HIGH ACTIVE
            </span>
          </div>

          <div className="space-y-4">
            {top5HighRisks.map((cluster, index) => (
              <div
                key={cluster.id}
                className="triage-top5-card"
              >
                {/* Header row with Rank, Category, and Counts */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 pb-2 border-b border-white/5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="triage-rank-badge">
                      #{index + 1} HIGHEST RISK
                    </span>
                    <span className={`risk-pill ${cluster.risk_level.toLowerCase()}`}>
                      {cluster.risk_level} · {cluster.risk_score}/100
                    </span>
                    <span
                      className="px-2.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider font-mono"
                      style={{
                        backgroundColor: `${CATEGORY_COLORS[cluster.category]}20`,
                        color: CATEGORY_COLORS[cluster.category],
                        border: `1px solid ${CATEGORY_COLORS[cluster.category]}50`,
                      }}
                    >
                      Category: {cluster.category}
                    </span>
                    {cluster.is_spike && (
                      <span className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/40 text-[10px] font-bold font-mono animate-pulse">
                        SPIKE DETECTED (5x)
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-4 text-xs text-slate-400 font-mono">
                    <span><b>{cluster.count}</b> occurrences</span>
                    <span><b>{cluster.affected_sessions?.length || 1}</b> sessions</span>
                    <span>Last: {new Date(cluster.last_seen).toLocaleTimeString()}</span>
                  </div>
                </div>

                {/* Title & Endpoint */}
                <div className="mt-2.5">
                  <h4
                    onClick={() => openClusterDetail(cluster)}
                    className="font-bold text-base text-slate-100 hover:text-indigo-400 cursor-pointer flex items-center justify-between"
                  >
                    <span>{cluster.title}</span>
                    <ChevronRight size={16} className="text-slate-400" />
                  </h4>
                  {cluster.affected_endpoints && cluster.affected_endpoints.length > 0 && (
                    <div className="text-[11px] text-slate-400 font-mono mt-0.5 flex items-center gap-1.5 flex-wrap">
                      <span className="text-slate-500">Target Endpoint:</span>
                      {cluster.affected_endpoints.slice(0, 3).map((ep, i) => (
                        <span key={i} className="px-1.5 py-0.5 rounded bg-black/40 border border-white/5 text-indigo-300">
                          {ep}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Plain English Root Cause / Impact */}
                {cluster.plain_explanation && (
                  <p className="text-xs text-rose-300/95 font-medium mt-2 bg-rose-950/20 p-2.5 rounded-lg border border-rose-900/30">
                    <b>Root Cause / Impact:</b> {cluster.plain_explanation}
                  </p>
                )}

                {/* Actionable Recommended Fix Box */}
                {cluster.suggested_fix && (
                  <div className="triage-fix-box">
                    <div className="triage-fix-header">
                      <span className="flex items-center gap-1.5 font-bold">
                        <Wrench size={14} className="text-emerald-400" />
                        Recommended Production Fix & Mitigation:
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => copyFixText(cluster.id, cluster.suggested_fix)}
                          className="flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-950 hover:bg-emerald-900 text-emerald-300 text-[10px] font-mono border border-emerald-700/50 transition cursor-pointer"
                        >
                          {copiedFixId === cluster.id ? (
                            <>
                              <Check size={11} className="text-emerald-400" />
                              <span>Copied!</span>
                            </>
                          ) : (
                            <>
                              <Copy size={11} />
                              <span>Copy Fix</span>
                            </>
                          )}
                        </button>
                        <button
                          onClick={() => updateStatus(cluster.id, 'resolved')}
                          className="px-2 py-0.5 rounded bg-indigo-950 hover:bg-indigo-900 text-indigo-300 text-[10px] font-mono border border-indigo-700/50 transition cursor-pointer"
                        >
                          Mark Resolved
                        </button>
                      </div>
                    </div>

                    <div className="space-y-1.5 text-xs text-slate-300 font-mono">
                      {cluster.suggested_fix.split('\n').map((line, lIdx) => (
                        <div key={lIdx} className="leading-relaxed">
                          {line}
                        </div>
                      ))}
                    </div>
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

        {/* Category & Triage Pills */}
        <div className="cm-filters">
          <button
            onClick={() => setFilterTop5Only(!filterTop5Only)}
            className={`cm-filter-pill ${filterTop5Only ? 'active' : ''}`}
            style={filterTop5Only ? { backgroundColor: '#f43f5e', color: '#fff', borderColor: '#f43f5e' } : {}}
            title="Categorize only the top 5 high-risk incidents"
          >
            ⚡ Top 5 High Risks ({top5HighRisks.length})
          </button>
          {categoriesList.map((cat) => (
            <button
              key={cat}
              onClick={() => {
                setFilterTop5Only(false);
                setSelectedCategory(cat);
              }}
              className={`cm-filter-pill ${!filterTop5Only && selectedCategory === cat ? 'active' : ''}`}
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
        ) : (filterTop5Only ? top5HighRisks : clusters).length === 0 ? (
          <div className="text-center py-16 bg-slate-900/30 border border-dashed border-slate-800 rounded-2xl">
            <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
            <h3 className="text-lg font-bold text-slate-200">No matching crashes found</h3>
            <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
              Your system is clean or the filter matches zero items. Start the bots in CrashWeb to generate live traffic!
            </p>
          </div>
        ) : (
          <div className="clusters-grid">
            {(filterTop5Only ? top5HighRisks : clusters).map((cluster) => (
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

