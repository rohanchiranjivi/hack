import React, { useState, useEffect, useRef } from 'react';
import {
  BarChart2, BarChart3, Flame, Play, Square, RotateCcw, CheckCircle2,
  AlertTriangle, Wrench, Copy, Check, ExternalLink, ShieldAlert,
  Layers, Search, ArrowRight, Clock, Activity, Sparkles, ChevronDown,
  ChevronUp, RefreshCw, Zap, Shield, Bug, Database, Cpu, Wifi, Globe
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
  affected_browsers?: string[];
  affected_sessions?: string[];
  sample_stack_trace?: string;
  sample_message?: string;
  status: 'active' | 'resolved' | 'ignored';
  is_spike?: boolean;
  plain_explanation?: string;
  suggested_fix?: string;
  rank?: number;
}

export interface Stats {
  siteStatus?: string;
  targetUrl?: string;
  uptimePct?: number;
  lastLatencyMs?: number;
  totalCrashes: number;
  activeClusters: number;
  highRiskCount: number;
  crashRatePerMin: number;
  sessionsImpacted: number;
  categoryDistribution: Record<string, number>;
  thresholdReached: boolean;
  thresholdLimit: number;
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

export default function LiveSimulationView({
  darkMode = false,
  onNavigateToMonitor,
}: {
  darkMode?: boolean;
  onNavigateToMonitor?: () => void;
}) {
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [isCrashing, setIsCrashing] = useState<boolean>(false);
  const [graphGenerated, setGraphGenerated] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<'ranked' | 'categories'>('ranked');
  const [sortBy, setSortBy] = useState<'risk' | 'count' | 'sessions'>('risk');
  const [filterTop5, setFilterTop5] = useState<boolean>(false);
  const [expandedClusterId, setExpandedClusterId] = useState<string | null>(null);
  const [copiedFixId, setCopiedFixId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [toast, setToast] = useState<{ msg: string; type: 'info' | 'success' | 'warn' } | null>(null);
  const [simProgress, setSimProgress] = useState<number>(0);
  const simIntervalRef = useRef<any>(null);

  // Load telemetry data from backend
  const loadData = async () => {
    try {
      const [clustersRes, statsRes] = await Promise.all([
        fetch(`${API_BASE}/clusters?status=active&sort_by=risk`),
        fetch(`${API_BASE}/stats`),
      ]);

      if (clustersRes.ok) {
        const cData = await clustersRes.json();
        setClusters(cData);
      }
      if (statsRes.ok) {
        const sData: Stats = await statsRes.json();
        setStats(sData);

        // If there are crashes and velocity is 0 and not currently in active simulation, mark graph as generated
        if (sData.totalCrashes > 0 && sData.crashRatePerMin === 0 && !isCrashing) {
          setGraphGenerated(true);
        } else if (sData.totalCrashes === 0) {
          setGraphGenerated(false);
        }
      }
    } catch (e) {
      console.error('Failed to load telemetry:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 2000);
    return () => clearInterval(interval);
  }, [isCrashing]);

  const showToast = (msg: string, type: 'info' | 'success' | 'warn' = 'info') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  // Start a simulated crash storm (50 or 500+ crashes)
  const triggerSimulationWave = async (flood: boolean = false) => {
    setIsCrashing(true);
    setGraphGenerated(false);
    setSimProgress(10);
    showToast(
      flood
        ? '🌊 Launching 500+ Crash Flood Storm... Collecting telemetry...'
        : '⚡ Firing simulated crash wave (50 crashes)...',
      'warn'
    );

    // Progress bar animation
    let p = 15;
    if (simIntervalRef.current) clearInterval(simIntervalRef.current);
    simIntervalRef.current = setInterval(() => {
      p += Math.floor(Math.random() * 18) + 12;
      if (p >= 90) {
        p = 90;
        clearInterval(simIntervalRef.current);
      }
      setSimProgress(p);
    }, 400);

    try {
      const res = await fetch(`${API_BASE}/seed-crashes?flood=${flood}`, { method: 'POST' });
      if (res.ok) {
        setTimeout(async () => {
          clearInterval(simIntervalRef.current);
          setSimProgress(100);
          await loadData();
          setIsCrashing(false);
          setGraphGenerated(true);
          showToast(
            flood
              ? '✅ 500+ Crash flood concluded! Clusters of Risk Bar Graph synthesized.'
              : '✅ Crash wave completed! Clusters of Risk Bar Graph generated.',
            'success'
          );
        }, 2200);
      }
    } catch (e) {
      clearInterval(simIntervalRef.current);
      setIsCrashing(false);
      showToast('Simulation request failed. Check backend connectivity.', 'warn');
    }
  };

  // Stop Crashing & Generate Bar Graph Immediately
  const stopCrashingAndGenerate = async () => {
    if (simIntervalRef.current) clearInterval(simIntervalRef.current);
    setIsCrashing(false);
    setSimProgress(100);
    await loadData();
    setGraphGenerated(true);
    showToast('🛑 Crashing stopped! Generated Clusters of Risk Bar Graph.', 'success');
  };

  // Reset to Zero
  const resetToZero = async () => {
    try {
      const res = await fetch(`${API_BASE}/reset`, { method: 'POST' });
      if (res.ok) {
        setClusters([]);
        setStats((prev) =>
          prev
            ? {
                ...prev,
                totalCrashes: 0,
                activeClusters: 0,
                highRiskCount: 0,
                crashRatePerMin: 0,
                sessionsImpacted: 0,
                categoryDistribution: {},
                thresholdReached: false,
                top5HighRisks: [],
              }
            : null
        );
        setIsCrashing(false);
        setGraphGenerated(false);
        setSimProgress(0);
        showToast('All monitoring telemetry returned to zero.', 'info');
      }
    } catch {
      showToast('Failed to reset metrics', 'warn');
    }
  };

  const copyFixText = (id: string, fix?: string) => {
    if (!fix) return;
    navigator.clipboard.writeText(fix);
    setCopiedFixId(id);
    setTimeout(() => setCopiedFixId(null), 2500);
  };

  // Risk Color Helper
  const getRiskColor = (score: number) => {
    if (score >= 80) return '#ef4444'; // Critical
    if (score >= 60) return '#f97316'; // High
    if (score >= 40) return '#eab308'; // Medium
    return '#3b82f6'; // Low
  };

  const getRiskGradient = (score: number) => {
    if (score >= 80) return 'linear-gradient(90deg, #ef4444, #dc2626)';
    if (score >= 60) return 'linear-gradient(90deg, #f97316, #ea580c)';
    if (score >= 40) return 'linear-gradient(90deg, #eab308, #ca8a04)';
    return 'linear-gradient(90deg, #38bdf8, #2563eb)';
  };

  // Filtered & Sorted Clusters
  let displayClusters = [...clusters];
  if (filterTop5) {
    displayClusters = displayClusters.slice(0, 5);
  }
  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase();
    displayClusters = displayClusters.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.category.toLowerCase().includes(q) ||
        c.sample_message?.toLowerCase().includes(q)
    );
  }
  if (sortBy === 'risk') {
    displayClusters.sort((a, b) => b.risk_score - a.risk_score);
  } else if (sortBy === 'count') {
    displayClusters.sort((a, b) => b.count - a.count);
  } else if (sortBy === 'sessions') {
    displayClusters.sort(
      (a, b) => (b.affected_sessions?.length || 0) - (a.affected_sessions?.length || 0)
    );
  }

  // Max score / max occurrences for relative bars
  const maxOccurrences = Math.max(1, ...clusters.map((c) => c.count));

  return (
    <div className="cm-container" style={{ padding: '16px 4px 60px' }}>
      {/* Toast Notification */}
      {toast && (
        <div
          style={{
            position: 'fixed',
            bottom: '24px',
            right: '24px',
            background: toast.type === 'success' ? '#065f46' : toast.type === 'warn' ? '#991b1b' : '#0f172a',
            color: '#ffffff',
            padding: '12px 20px',
            borderRadius: '10px',
            boxShadow: '0 10px 30px rgba(0,0,0,0.3)',
            zIndex: 1000,
            fontSize: '13px',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
          }}
        >
          {toast.type === 'success' ? <Check size={16} /> : <AlertTriangle size={16} />}
          <span>{toast.msg}</span>
        </div>
      )}

      {/* 1. TOP HEADER BANNER */}
      <section className="cm-sub-header" style={{ marginBottom: '20px' }}>
        <div className="cm-header-left">
          <div className="cm-title-row">
            <h2 className="cm-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <BarChart2 size={24} style={{ color: '#0f766e' }} />
              Live Simulation & Clusters of Risk Bar Graph
            </h2>
            {isCrashing ? (
              <span
                style={{
                  background: '#fee2e2',
                  color: '#b91c1c',
                  border: '1px solid #fca5a5',
                  padding: '3px 10px',
                  borderRadius: '999px',
                  fontSize: '11px',
                  fontWeight: 800,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <span className="dot red animate-ping" /> CRASH STREAM ACTIVE ({stats?.crashRatePerMin || 0}/min)
              </span>
            ) : graphGenerated && clusters.length > 0 ? (
              <span
                style={{
                  background: '#dcfce7',
                  color: '#15803d',
                  border: '1px solid #bbf7d0',
                  padding: '3px 10px',
                  borderRadius: '999px',
                  fontSize: '11px',
                  fontWeight: 800,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <CheckCircle2 size={13} /> CRASHING STOPPED · BAR GRAPH GENERATED
              </span>
            ) : (
              <span
                style={{
                  background: '#f1f5f9',
                  color: '#475569',
                  border: '1px solid #cbd5e1',
                  padding: '3px 10px',
                  borderRadius: '999px',
                  fontSize: '11px',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <Clock size={13} /> READY · WAITING FOR CRASHES
              </span>
            )}
          </div>

          <div className="cm-subtitle-row" style={{ marginTop: '4px' }}>
            <span>Target: <a href={stats?.targetUrl || 'http://localhost:3000'} target="_blank" rel="noreferrer">{stats?.targetUrl || 'http://localhost:3000'}</a></span>
            <span>Total Crashes: <b>{stats?.totalCrashes || 0}</b></span>
            <span>Active Clusters: <b>{stats?.activeClusters || 0}</b></span>
            <span>High-Risk Failures: <b style={{ color: (stats?.highRiskCount || 0) > 0 ? '#ef4444' : '#10b981' }}>{stats?.highRiskCount || 0}</b></span>
            <span>Velocity: <b>{stats?.crashRatePerMin || 0} /min</b></span>
          </div>
        </div>

        {/* Action Controls */}
        <div className="cm-header-actions">
          {isCrashing ? (
            <button
              onClick={stopCrashingAndGenerate}
              style={{
                background: '#dc2626',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                padding: '8px 16px',
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                boxShadow: '0 2px 8px rgba(220, 38, 38, 0.3)',
              }}
            >
              <Square size={13} /> Stop Crashing & Render Bar Graph
            </button>
          ) : (
            <>
              <button
                onClick={() => triggerSimulationWave(false)}
                style={{
                  background: '#0f766e',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '8px 14px',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <Zap size={14} /> Fire 50 Crashes Wave
              </button>

              <button
                onClick={() => triggerSimulationWave(true)}
                style={{
                  background: '#be123c',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '8px 14px',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <Flame size={14} /> Trigger 500+ Flood Wave
              </button>
            </>
          )}

          <button
            onClick={resetToZero}
            className="cm-btn-reset"
            title="Reset telemetry and crashes to zero"
          >
            <RotateCcw size={13} /> Reset data
          </button>

          {onNavigateToMonitor && (
            <button
              onClick={onNavigateToMonitor}
              style={{
                background: '#ffffff',
                color: '#0f172a',
                border: '1px solid #cbd5e1',
                borderRadius: '8px',
                padding: '8px 12px',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
              }}
            >
              Back to Monitor <ArrowRight size={13} />
            </button>
          )}
        </div>
      </section>

      {/* 2. CRASHING IN PROGRESS LIVE BANNER */}
      {isCrashing && (
        <section
          style={{
            background: 'linear-gradient(135deg, #fff1f2 0%, #fff7ed 100%)',
            border: '1px solid #fecaca',
            borderRadius: '14px',
            padding: '24px',
            marginBottom: '24px',
            boxShadow: '0 4px 14px rgba(239, 68, 68, 0.08)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div
                style={{
                  width: '42px',
                  height: '42px',
                  borderRadius: '50%',
                  background: '#fee2e2',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#dc2626',
                }}
              >
                <Flame size={24} className="animate-pulse" />
              </div>
              <div>
                <h4 style={{ fontSize: '16px', fontWeight: 800, color: '#991b1b', margin: '0 0 2px' }}>
                  Simulated Crash Wave in Progress...
                </h4>
                <span style={{ fontSize: '12px', color: '#b91c1c' }}>
                  Telemetry stream actively recording failures. The <b>Clusters of Risk Bar Graph</b> will be created once crashing stops.
                </span>
              </div>
            </div>

            <button
              onClick={stopCrashingAndGenerate}
              style={{
                background: '#991b1b',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                padding: '8px 16px',
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <Square size={13} /> Stop Crashing & Render Bar Graph
            </button>
          </div>

          {/* Progress Bar */}
          <div style={{ height: '8px', background: '#fee2e2', borderRadius: '4px', overflow: 'hidden', position: 'relative' }}>
            <div
              style={{
                width: `${simProgress}%`,
                height: '100%',
                background: 'linear-gradient(90deg, #f43f5e, #ea580c)',
                borderRadius: '4px',
                transition: 'width 0.3s ease',
              }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#991b1b', marginTop: '8px', fontWeight: 600 }}>
            <span>Streaming crashes into SQLite buffer & running Jaccard token clustering...</span>
            <span>{stats?.totalCrashes || 0} crashes recorded ({simProgress}%)</span>
          </div>
        </section>
      )}

      {/* 3. CLUSTERS OF RISK BAR GRAPH (CREATED AFTER CRASHING STOPS) */}
      {(graphGenerated || (clusters.length > 0 && !isCrashing)) ? (
        <section
          style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '14px',
            padding: '24px',
            boxShadow: 'var(--cm-card-shadow)',
            marginBottom: '24px',
          }}
        >
          {/* Graph Sub-Header & Controls */}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '14px',
              paddingBottom: '16px',
              borderBottom: '1px solid #f1f5f9',
              marginBottom: '20px',
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>
                <BarChart3 size={20} style={{ color: '#0f766e' }} />
                <span>Clusters of Risk — Severity & Impact Bar Chart</span>
                <span
                  style={{
                    fontSize: '11px',
                    background: '#e0f2fe',
                    color: '#0369a1',
                    padding: '2px 8px',
                    borderRadius: '999px',
                    fontWeight: 700,
                  }}
                >
                  {displayClusters.length} Clusters Synthesized
                </span>
              </div>
              <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
                Each bar represents an aggregated failure cluster ranked by <b>Risk Score (0–100)</b>, incident frequency, and blast radius.
              </div>
            </div>

            {/* View Switcher & Filters */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              {/* Top 5 Toggle */}
              <button
                onClick={() => setFilterTop5(!filterTop5)}
                style={{
                  background: filterTop5 ? '#f43f5e' : '#f1f5f9',
                  color: filterTop5 ? '#ffffff' : '#334155',
                  border: filterTop5 ? '1px solid #e11d48' : '1px solid #cbd5e1',
                  borderRadius: '6px',
                  padding: '6px 12px',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <Flame size={13} />
                <span>Top 5 High Risks Only</span>
              </button>

              {/* View mode toggle */}
              <div style={{ display: 'flex', background: '#f1f5f9', padding: '2px', borderRadius: '6px' }}>
                <button
                  onClick={() => setViewMode('ranked')}
                  style={{
                    padding: '5px 12px',
                    borderRadius: '4px',
                    fontSize: '11px',
                    fontWeight: 600,
                    border: 0,
                    background: viewMode === 'ranked' ? '#ffffff' : 'transparent',
                    color: viewMode === 'ranked' ? '#0f172a' : '#64748b',
                    boxShadow: viewMode === 'ranked' ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
                    cursor: 'pointer',
                  }}
                >
                  Ranked Risk Bars
                </button>
                <button
                  onClick={() => setViewMode('categories')}
                  style={{
                    padding: '5px 12px',
                    borderRadius: '4px',
                    fontSize: '11px',
                    fontWeight: 600,
                    border: 0,
                    background: viewMode === 'categories' ? '#ffffff' : 'transparent',
                    color: viewMode === 'categories' ? '#0f172a' : '#64748b',
                    boxShadow: viewMode === 'categories' ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
                    cursor: 'pointer',
                  }}
                >
                  Category Risk Distribution
                </button>
              </div>

              {/* Sort Dropdown */}
              <select
                value={sortBy}
                onChange={(e: any) => setSortBy(e.target.value)}
                className="cm-sort-select"
                style={{ height: '32px', fontSize: '11px' }}
              >
                <option value="risk">Sort: Risk Score (0-100) ⌵</option>
                <option value="count">Sort: Total Occurrences ⌵</option>
                <option value="sessions">Sort: Impacted Sessions ⌵</option>
              </select>
            </div>
          </div>

          {/* Search bar inside graph section */}
          <div style={{ marginBottom: '16px' }}>
            <div className="cm-search-input-wrap" style={{ maxWidth: '400px' }}>
              <Search size={14} />
              <input
                type="text"
                placeholder="Filter risk bars by error message or category..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="cm-search-input"
                style={{ fontSize: '11px' }}
              />
            </div>
          </div>

          {/* VIEW 1: RANKED CLUSTERS HORIZONTAL BAR CHART */}
          {viewMode === 'ranked' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {displayClusters.map((cluster, idx) => {
                const rank = idx + 1;
                const isExpanded = expandedClusterId === cluster.id;
                const riskColor = getRiskColor(cluster.risk_score);
                const riskGradient = getRiskGradient(cluster.risk_score);
                const catColor = CATEGORY_COLORS[cluster.category] || '#64748b';
                const sessionCount = cluster.affected_sessions?.length || 1;

                return (
                  <div
                    key={cluster.id}
                    style={{
                      border: `1px solid ${cluster.risk_score >= 80 ? '#fecaca' : '#e2e8f0'}`,
                      borderRadius: '12px',
                      background: cluster.risk_score >= 80 ? '#fffafa' : '#ffffff',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                      overflow: 'hidden',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {/* Main Bar Card Header */}
                    <div style={{ padding: '16px 20px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                          {/* Rank Badge */}
                          <span
                            style={{
                              background: rank <= 5 ? '#f43f5e' : '#334155',
                              color: '#ffffff',
                              fontSize: '11px',
                              fontWeight: 800,
                              padding: '2px 8px',
                              borderRadius: '4px',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              letterSpacing: '0.04em',
                            }}
                          >
                            {rank <= 5 && <Flame size={12} />}
                            #{rank} {rank <= 5 ? 'HIGHEST RISK' : 'CLUSTER'}
                          </span>

                          {/* Category Badge */}
                          <span
                            style={{
                              background: `${catColor}15`,
                              color: catColor,
                              border: `1px solid ${catColor}33`,
                              padding: '2px 8px',
                              borderRadius: '4px',
                              fontSize: '11px',
                              fontWeight: 700,
                              fontFamily: 'monospace',
                            }}
                          >
                            {cluster.category}
                          </span>

                          {/* Spike Tag */}
                          {cluster.is_spike && (
                            <span style={{ background: '#fee2e2', color: '#b91c1c', padding: '2px 6px', borderRadius: '4px', fontSize: '10px', fontWeight: 800 }}>
                              SPIKE DETECTED
                            </span>
                          )}
                        </div>

                        {/* Risk Score Pill */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span
                            style={{
                              background: `${riskColor}18`,
                              color: riskColor,
                              padding: '3px 10px',
                              borderRadius: '999px',
                              fontSize: '12px',
                              fontWeight: 800,
                              border: `1px solid ${riskColor}33`,
                            }}
                          >
                            {cluster.risk_level} · {cluster.risk_score.toFixed(1)} / 100
                          </span>
                        </div>
                      </div>

                      {/* Cluster Title */}
                      <div style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a', marginBottom: '12px', lineHeight: '1.4' }}>
                        {cluster.title}
                      </div>

                      {/* THE PROGRESS BAR (BAR GRAPH ELEMENT) */}
                      <div style={{ marginBottom: '12px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#64748b', marginBottom: '4px', fontWeight: 600 }}>
                          <span>Risk Severity Metric</span>
                          <span style={{ color: riskColor, fontWeight: 700 }}>{cluster.risk_score}% of max risk threshold</span>
                        </div>

                        <div
                          style={{
                            height: '14px',
                            background: '#f1f5f9',
                            borderRadius: '7px',
                            overflow: 'hidden',
                            position: 'relative',
                            boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.06)',
                          }}
                        >
                          {/* Grid ticks for 20, 40, 60, 80 */}
                          <div style={{ position: 'absolute', left: '20%', top: 0, bottom: 0, width: '1px', background: 'rgba(0,0,0,0.07)' }} />
                          <div style={{ position: 'absolute', left: '40%', top: 0, bottom: 0, width: '1px', background: 'rgba(0,0,0,0.07)' }} />
                          <div style={{ position: 'absolute', left: '60%', top: 0, bottom: 0, width: '1px', background: 'rgba(0,0,0,0.07)' }} />
                          <div style={{ position: 'absolute', left: '80%', top: 0, bottom: 0, width: '1px', background: 'rgba(0,0,0,0.07)' }} />

                          {/* Filled bar portion */}
                          <div
                            style={{
                              width: `${Math.max(4, Math.min(100, cluster.risk_score))}%`,
                              height: '100%',
                              background: riskGradient,
                              borderRadius: '7px',
                              transition: 'width 0.4s ease',
                            }}
                          />
                        </div>
                      </div>

                      {/* Cluster Meta Stats Row & Expand Toggle */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', fontSize: '11px', color: '#64748b' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
                          <span>⚡ <b>{cluster.count}</b> occurrences ({((cluster.count / maxOccurrences) * 100).toFixed(0)}% volume)</span>
                          <span>👥 <b>{sessionCount}</b> sessions affected</span>
                          <span>🌐 <b>{cluster.affected_endpoints?.length || 1}</b> endpoints</span>
                          <span>🕒 Last seen: <b>{new Date(cluster.last_seen).toLocaleTimeString()}</b></span>
                        </div>

                        <button
                          onClick={() => setExpandedClusterId(isExpanded ? null : cluster.id)}
                          style={{
                            background: isExpanded ? '#0f172a' : '#f8fafc',
                            color: isExpanded ? '#ffffff' : '#334155',
                            border: '1px solid #cbd5e1',
                            borderRadius: '6px',
                            padding: '4px 10px',
                            fontSize: '11px',
                            fontWeight: 700,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                          }}
                        >
                          {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                          <span>{isExpanded ? 'Hide Recommended Fix' : 'Inspect Recommended Fix →'}</span>
                        </button>
                      </div>
                    </div>

                    {/* Expandable Root Cause & Actionable Fix Section */}
                    {isExpanded && (
                      <div
                        style={{
                          background: '#f8fafc',
                          borderTop: '1px solid #e2e8f0',
                          padding: '16px 20px',
                        }}
                      >
                        {cluster.plain_explanation && (
                          <div style={{ marginBottom: '14px' }}>
                            <div style={{ fontSize: '11px', fontWeight: 800, color: '#991b1b', textTransform: 'uppercase', marginBottom: '4px' }}>
                              Root Cause / Impact Analysis:
                            </div>
                            <div style={{ background: '#fff1f2', border: '1px solid #fecdd3', borderRadius: '8px', padding: '10px 14px', fontSize: '12px', color: '#881337', lineHeight: '1.5' }}>
                              {cluster.plain_explanation}
                            </div>
                          </div>
                        )}

                        {cluster.suggested_fix && (
                          <div style={{ marginBottom: '14px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                              <span style={{ fontSize: '11px', fontWeight: 800, color: '#047857', display: 'flex', alignItems: 'center', gap: '5px', textTransform: 'uppercase' }}>
                                <Wrench size={13} /> Recommended Production Fix & Mitigation:
                              </span>
                              <button
                                onClick={() => copyFixText(cluster.id, cluster.suggested_fix)}
                                style={{
                                  background: '#ffffff',
                                  color: '#0f766e',
                                  border: '1px solid #99f6e4',
                                  borderRadius: '4px',
                                  padding: '3px 8px',
                                  fontSize: '10px',
                                  fontWeight: 700,
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                }}
                              >
                                {copiedFixId === cluster.id ? <Check size={11} className="text-emerald-500" /> : <Copy size={11} />}
                                <span>{copiedFixId === cluster.id ? 'Copied!' : 'Copy Fix'}</span>
                              </button>
                            </div>
                            <pre style={{ margin: 0, background: '#0f172a', color: '#f8fafc', borderRadius: '8px', padding: '12px 14px', fontFamily: 'monospace', fontSize: '11px', lineHeight: '1.6', whiteSpace: 'pre-line' }}>
                              {cluster.suggested_fix}
                            </pre>
                          </div>
                        )}

                        {cluster.sample_stack_trace && (
                          <div>
                            <div style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: '4px' }}>
                              Sample Stack Trace:
                            </div>
                            <pre style={{ margin: 0, background: '#ffffff', border: '1px solid #e2e8f0', color: '#334155', borderRadius: '6px', padding: '10px 12px', fontFamily: 'monospace', fontSize: '10px', overflowX: 'auto' }}>
                              {cluster.sample_stack_trace}
                            </pre>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* VIEW 2: CATEGORY RISK COMPARISON BAR CHART */}
          {viewMode === 'categories' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
              {Object.entries(stats?.categoryDistribution || {}).map(([cat, totalCrashes]) => {
                const catClusters = clusters.filter((c) => c.category === cat);
                const avgRisk = catClusters.length > 0
                  ? Math.round(catClusters.reduce((a, b) => a + b.risk_score, 0) / catClusters.length)
                  : 0;
                const riskColor = getRiskColor(avgRisk);
                const catColor = CATEGORY_COLORS[cat] || '#64748b';

                return (
                  <div
                    key={cat}
                    style={{
                      border: '1px solid #e2e8f0',
                      borderRadius: '12px',
                      padding: '16px',
                      background: '#fafbfc',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: catColor }} />
                        <span style={{ fontWeight: 800, fontSize: '14px', color: '#0f172a' }}>{cat}</span>
                      </div>
                      <span
                        style={{
                          background: `${riskColor}18`,
                          color: riskColor,
                          padding: '2px 8px',
                          borderRadius: '4px',
                          fontSize: '11px',
                          fontWeight: 800,
                        }}
                      >
                        Risk {avgRisk}/100
                      </span>
                    </div>

                    {/* Progress Track */}
                    <div style={{ height: '10px', background: '#e2e8f0', borderRadius: '5px', overflow: 'hidden', marginBottom: '10px' }}>
                      <div
                        style={{
                          width: `${avgRisk}%`,
                          height: '100%',
                          background: riskColor,
                          borderRadius: '5px',
                        }}
                      />
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#64748b' }}>
                      <span><b>{totalCrashes}</b> crash events</span>
                      <span><b>{catClusters.length}</b> distinct failure clusters</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      ) : (
        /* 4. IDLE / EMPTY STATE CARD (BEFORE SIMULATION RUN) */
        <section className="cm-empty-card" style={{ padding: '60px 24px' }}>
          <div className="cm-empty-icon-circle" style={{ background: '#f0fdf4', color: '#16a34a' }}>
            <BarChart3 size={32} />
          </div>
          <h3 className="cm-empty-title">No Telemetry Recorded Yet</h3>
          <p className="cm-empty-sub">
            Trigger a simulated crash wave against CrashWeb to observe live crash velocity. Once crashing stops, the actionable <b>Clusters of Risk Bar Graph</b> will be automatically synthesized here.
          </p>

          <div style={{ display: 'flex', gap: '10px', marginTop: '14px', flexWrap: 'wrap', justifyContent: 'center' }}>
            <button
              onClick={() => triggerSimulationWave(false)}
              className="cm-btn-open-sim"
              style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              <Zap size={14} /> Fire Quick Wave (50 Crashes)
            </button>
            <button
              onClick={() => triggerSimulationWave(true)}
              style={{
                background: '#be123c',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                padding: '10px 20px',
                fontSize: '13px',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                boxShadow: '0 2px 8px rgba(190, 18, 60, 0.25)',
              }}
            >
              <Flame size={14} /> Launch 500+ Flood Wave
            </button>
            <button
              onClick={() => window.open('http://localhost:3000/chaos', '_blank')}
              style={{
                background: '#ffffff',
                color: '#0f172a',
                border: '1px solid #cbd5e1',
                borderRadius: '8px',
                padding: '10px 16px',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              Open Chaos Portal <ExternalLink size={13} />
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
