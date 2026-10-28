"use client";

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Flame, Play, Square, Bot, Zap, Activity, AlertTriangle, Database,
  Cpu, Wifi, ExternalLink, ArrowLeft, CheckCircle2, XCircle, RefreshCw,
  Bug, ShieldAlert, Sparkles, Sliders
} from 'lucide-react';
import { CHAOS_SCENARIOS, executeFrontendChaos } from '@/lib/chaos';
import { initBrowserReporter } from '@/lib/reporter';

export default function ChaosControlPanel() {
  const [botStats, setBotStats] = useState<any>({
    isRunning: false,
    activeBots: 0,
    totalRequests: 0,
    crashesTriggered: 0,
    mode: 'random',
    recentActivity: [],
  });

  const [mode, setMode] = useState<'gentle' | 'random' | 'stress' | 'targeted'>('random');
  const [botCount, setBotCount] = useState<number>(3);
  const [intervalMs, setIntervalMs] = useState<number>(1200);
  const [targetedScenario, setTargetedScenario] = useState<string>('be-db-pool-exhausted');
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [triggering, setTriggering] = useState<string | null>(null);
  const [renderErrorTriggered, setRenderErrorTriggered] = useState(false);

  // Initialize reporter on client mount
  useEffect(() => {
    initBrowserReporter();
  }, []);

  // Poll bot stats
  useEffect(() => {
    fetchBotStats();
    const timer = setInterval(fetchBotStats, 1500);
    return () => clearInterval(timer);
  }, []);

  async function fetchBotStats() {
    try {
      const res = await fetch('/api/bots');
      if (res.ok) {
        const data = await res.json();
        setBotStats(data);
      }
    } catch {
      // safe
    }
  }

  function showToast(msg: string, type: 'success' | 'error' | 'info' = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }

  async function triggerFlood500() {
    try {
      showToast('Launching 500-crash rapid flood attack against victim site...', 'info');
      const res = await fetch('/api/bots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'flood500', count: 500 }),
      });
      const data = await res.json();
      if (res.ok) {
        showToast('⚡ 500-crash wave in progress! Check Dashboard for Top 5 triage.', 'success');
      } else {
        showToast('Flood failed: ' + data.error, 'error');
      }
    } catch (e: any) {
      showToast('Failed to trigger flood: ' + e.message, 'error');
    }
  }

  async function toggleBots() {
    const action = botStats.isRunning ? 'stop' : 'start';
    try {
      const res = await fetch('/api/bots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          mode,
          botCount,
          intervalMs,
          targetedScenario,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setBotStats(data.stats);
        showToast(
          action === 'start'
            ? `Started ${botCount} automated bots in ${mode.toUpperCase()} mode!`
            : 'Automated bots stopped.',
          'info'
        );
      }
    } catch (e: any) {
      showToast('Failed to toggle bots: ' + e.message, 'error');
    }
  }

  async function handleTrigger(scenario: any) {
    setTriggering(scenario.id);

    try {
      if (scenario.id === 'fe-render-error') {
        setRenderErrorTriggered(true);
        showToast('Triggering React Render Error...', 'error');
        return;
      }

      if (scenario.category === 'frontend') {
        const res = executeFrontendChaos(scenario.id);
        showToast(`[Frontend] ${scenario.name} triggered! Captured by Reporter.`, 'error');
      } else {
        // Backend or Network
        const res = await fetch(`/api/chaos?scenario=${scenario.id}`);
        const data = await res.json().catch(() => ({}));
        showToast(
          `[Backend/Network] ${scenario.name} returned HTTP ${res.status}. Reported to dashboard!`,
          res.ok ? 'success' : 'error'
        );
      }
    } catch (err: any) {
      showToast(`Crash event dispatched: ${scenario.name}`, 'info');
    } finally {
      setTimeout(() => setTriggering(null), 600);
      fetchBotStats();
    }
  }

  const frontendScenarios = CHAOS_SCENARIOS.filter((s) => s.category === 'frontend');
  const backendScenarios = CHAOS_SCENARIOS.filter((s) => s.category === 'backend');
  const networkScenarios = CHAOS_SCENARIOS.filter((s) => s.category === 'network');

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans p-4 md:p-8">
      {/* Toast Notification */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 px-5 py-3 rounded-xl shadow-2xl flex items-center gap-3 border text-sm font-medium transition-all duration-300 ${
            toast.type === 'error'
              ? 'bg-rose-950 border-rose-500/50 text-rose-200'
              : toast.type === 'info'
              ? 'bg-sky-950 border-sky-500/50 text-sky-200'
              : 'bg-emerald-950 border-emerald-500/50 text-emerald-200'
          }`}
        >
          {toast.type === 'error' ? (
            <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
          ) : (
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          )}
          <span>{toast.msg}</span>
        </div>
      )}

      {/* Top Navigation */}
      <header className="max-w-7xl mx-auto flex flex-col md:flex-row items-start md:items-center justify-between gap-4 pb-8 border-b border-slate-800">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1 rounded-lg bg-emerald-950/80 border border-emerald-700/60 text-emerald-300 hover:text-white hover:bg-emerald-900 transition"
            >
              🛒 Open Monitored Victim Storefront
            </Link>
            <a
              href="https://crashweb-gules.vercel.app/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1 rounded-lg bg-indigo-950/80 border border-indigo-700/60 text-indigo-300 hover:text-white hover:bg-indigo-900 transition"
            >
              Victim Storefront (Vercel)
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-rose-500/10 border border-rose-500/30 text-rose-400 font-mono font-bold">
              STANDALONE ATTACK SERVER
            </span>
          </div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight mt-2 flex items-center gap-3">
            <Flame className="w-7 h-7 text-rose-500 animate-pulse" />
            Crash Control Attack Center
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Simulate realistic failure attacks against the victim website, control autonomous bot fleet, and generate incident floods for triage.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 flex items-center gap-2 text-xs">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            <span className="text-slate-300 font-mono">Attack Fleet: Ready</span>
          </div>

          <a
            href="http://localhost:5173"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs tracking-wide shadow-lg shadow-indigo-600/20 transition"
          >
            <span>Open Monitoring Dashboard</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </header>

      <main className="max-w-7xl mx-auto mt-8 space-y-8">
        {/* BOT RUNNER CONTROL CARD */}
        <section className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-xl relative overflow-hidden backdrop-blur-md">
          <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6 pb-6 border-b border-slate-800/80">
            <div>
              <div className="flex items-center gap-2.5 text-indigo-400 font-mono text-xs uppercase tracking-wider font-semibold">
                <Bot className="w-4 h-4" />
                Autonomous Bot Fleet & Flood Attacker
              </div>
              <h2 className="text-xl font-bold text-white mt-1">
                Crash Control Attack Engine
              </h2>
              <p className="text-slate-400 text-xs mt-0.5">
                Launches concurrent HTTP attack waves against <code className="text-indigo-400 font-mono">https://crashweb-gules.vercel.app/</code>.
              </p>
            </div>

            {/* Run / Stop Toggle Button & Flood 500 Button */}
            <div className="flex flex-wrap items-center gap-4">
              <div className="text-right">
                <div className="text-xs text-slate-400">Fleet Status</div>
                <div
                  className={`text-sm font-bold font-mono ${
                    botStats.isRunning ? 'text-emerald-400' : 'text-slate-500'
                  }`}
                >
                  {botStats.isRunning
                    ? `RUNNING (${botStats.activeBots} bots active)`
                    : 'STOPPED / IDLE'}
                </div>
              </div>

              {/* 500 Flood Attack Button */}
              <button
                onClick={triggerFlood500}
                disabled={botStats.isFlooding}
                className="inline-flex items-center gap-2 px-5 py-3 rounded-xl font-bold text-sm tracking-wide bg-gradient-to-r from-amber-500 to-rose-600 hover:from-amber-400 hover:to-rose-500 text-white shadow-xl shadow-rose-600/20 transition-all cursor-pointer disabled:opacity-50"
                title="Rapidly fire 500 attack crashes at the victim site to activate dashboard triage mode"
              >
                <Zap className="w-4 h-4 fill-white animate-bounce" />
                {botStats.isFlooding
                  ? `ATTACKING (${botStats.floodProgress || 0}/500)...`
                  : '⚡ ATTACK TO 500 CRASHES'}
              </button>

              <button
                onClick={toggleBots}
                className={`inline-flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-sm tracking-wide shadow-xl transition-all duration-200 cursor-pointer ${
                  botStats.isRunning
                    ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-600/30'
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/30'
                }`}
              >
                {botStats.isRunning ? (
                  <>
                    <Square className="w-4 h-4 fill-white" />
                    STOP BOTS
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 fill-white" />
                    START BOTS
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Config Controls */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 pt-6">
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                Simulation Mode
              </label>
              <div className="grid grid-cols-2 gap-1.5 bg-slate-950 p-1.5 rounded-xl border border-slate-800">
                {(['gentle', 'random', 'stress', 'targeted'] as const).map((m) => (
                  <button
                    key={m}
                    disabled={botStats.isRunning}
                    onClick={() => setMode(m)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition ${
                      mode === m
                        ? 'bg-indigo-600 text-white shadow'
                        : 'text-slate-400 hover:text-slate-200'
                    } ${botStats.isRunning ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                  >
                    {m === 'stress' ? 'Stress / Burst' : m}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                Bot Count: <span className="text-white font-mono">{botCount} Bots</span>
              </label>
              <input
                type="range"
                min="1"
                max="10"
                value={botCount}
                disabled={botStats.isRunning}
                onChange={(e) => setBotCount(Number(e.target.value))}
                className="w-full accent-indigo-500 cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-slate-500 mt-1 font-mono">
                <span>1 Bot</span>
                <span>5 Bots</span>
                <span>10 Bots</span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                Interval: <span className="text-white font-mono">{intervalMs} ms</span>
              </label>
              <input
                type="range"
                min="400"
                max="3000"
                step="100"
                value={intervalMs}
                disabled={botStats.isRunning}
                onChange={(e) => setIntervalMs(Number(e.target.value))}
                className="w-full accent-indigo-500 cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-slate-500 mt-1 font-mono">
                <span>400ms (Fast)</span>
                <span>1.5s</span>
                <span>3s (Gentle)</span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                Targeted Scenario (Targeted Mode)
              </label>
              <select
                value={targetedScenario}
                disabled={botStats.isRunning || mode !== 'targeted'}
                onChange={(e) => setTargetedScenario(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 font-mono disabled:opacity-40"
              >
                <option value="be-db-pool-exhausted">DB Connection Pool Failure</option>
                <option value="be-http-500">HTTP 500 Internal Error</option>
                <option value="be-timeout">Gateway Timeout (504)</option>
                <option value="be-null-pointer">Backend Null Pointer</option>
                <option value="be-oom-simulation">Out Of Memory Simulation</option>
                <option value="net-rate-limit">Rate Limit (429)</option>
                <option value="net-5xx">Bad Gateway (502)</option>
              </select>
            </div>
          </div>

          {/* Real-time Bot Metrics & Live Stream */}
          <div className="mt-6 pt-6 border-t border-slate-800/80 grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800">
                <div className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">
                  Total Requests
                </div>
                <div className="text-2xl font-black font-mono text-white mt-1">
                  {botStats.totalRequests || 0}
                </div>
              </div>
              <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800">
                <div className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">
                  Crashes Generated
                </div>
                <div className="text-2xl font-black font-mono text-rose-400 mt-1">
                  {botStats.crashesTriggered || 0}
                </div>
              </div>
            </div>

            <div className="lg:col-span-2 bg-slate-950/70 rounded-xl border border-slate-800 p-3 font-mono text-xs">
              <div className="flex items-center justify-between text-slate-400 text-[11px] pb-2 border-b border-slate-800/60 mb-2">
                <span className="flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5 text-indigo-400" />
                  Live Bot Activity Stream
                </span>
                <span className="text-[10px] text-slate-500">Target: http://localhost:3000</span>
              </div>
              <div className="h-28 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
                {botStats.recentActivity && botStats.recentActivity.length > 0 ? (
                  botStats.recentActivity.map((act: any, idx: number) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between py-0.5 text-[11px] text-slate-300"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-slate-500 text-[10px]">{act.timestamp}</span>
                        <span className="text-indigo-400 font-semibold">{act.botId}</span>
                        <span>{act.action}</span>
                      </div>
                      <span
                        className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                          act.status >= 500
                            ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                            : act.status >= 400
                            ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                            : 'bg-emerald-500/20 text-emerald-300'
                        }`}
                      >
                        {act.status}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="h-full flex items-center justify-center text-slate-600 text-xs">
                    Start bots to see real-time requests and errors here.
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* MANUALLY TRIGGERABLE CHAOS SCENARIOS */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Zap className="w-5 h-5 text-amber-400" />
                1-Click Manual Chaos Triggers
              </h2>
              <p className="text-slate-400 text-xs">
                Click any scenario below to immediately trip a specific crash and verify clustering in the dashboard.
              </p>
            </div>
            <span className="text-xs text-slate-500 font-mono">
              {CHAOS_SCENARIOS.length} Scenarios Available
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Frontend Column */}
            <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-5 space-y-3">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <span className="text-xs font-bold text-sky-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Cpu className="w-4 h-4" /> Frontend (Browser)
                </span>
                <span className="text-[11px] font-mono text-slate-500">
                  {frontendScenarios.length} Scenarios
                </span>
              </div>

              <div className="space-y-2.5">
                {frontendScenarios.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => handleTrigger(s)}
                    disabled={triggering === s.id}
                    className="w-full text-left p-3 rounded-xl bg-slate-950/80 hover:bg-slate-800 border border-slate-800/80 hover:border-slate-700 transition flex flex-col gap-1 group cursor-pointer"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-xs text-slate-200 group-hover:text-white">
                        {s.name}
                      </span>
                      <span
                        className={`text-[9px] px-1.5 py-0.5 rounded font-mono uppercase font-bold ${
                          s.severity === 'critical'
                            ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                            : s.severity === 'high'
                            ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                            : 'bg-sky-500/20 text-sky-400 border border-sky-500/30'
                        }`}
                      >
                        {s.severity}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 line-clamp-2">{s.description}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Backend Column */}
            <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-5 space-y-3">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <span className="text-xs font-bold text-rose-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Database className="w-4 h-4" /> Backend / Database
                </span>
                <span className="text-[11px] font-mono text-slate-500">
                  {backendScenarios.length} Scenarios
                </span>
              </div>

              <div className="space-y-2.5">
                {backendScenarios.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => handleTrigger(s)}
                    disabled={triggering === s.id}
                    className="w-full text-left p-3 rounded-xl bg-slate-950/80 hover:bg-slate-800 border border-slate-800/80 hover:border-slate-700 transition flex flex-col gap-1 group cursor-pointer"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-xs text-slate-200 group-hover:text-white">
                        {s.name}
                      </span>
                      <span
                        className={`text-[9px] px-1.5 py-0.5 rounded font-mono uppercase font-bold ${
                          s.severity === 'critical'
                            ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                            : s.severity === 'high'
                            ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                            : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                        }`}
                      >
                        {s.severity}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 line-clamp-2">{s.description}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Network Column */}
            <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-5 space-y-3">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <span className="text-xs font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Wifi className="w-4 h-4" /> Network & Gateway
                </span>
                <span className="text-[11px] font-mono text-slate-500">
                  {networkScenarios.length} Scenarios
                </span>
              </div>

              <div className="space-y-2.5">
                {networkScenarios.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => handleTrigger(s)}
                    disabled={triggering === s.id}
                    className="w-full text-left p-3 rounded-xl bg-slate-950/80 hover:bg-slate-800 border border-slate-800/80 hover:border-slate-700 transition flex flex-col gap-1 group cursor-pointer"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-xs text-slate-200 group-hover:text-white">
                        {s.name}
                      </span>
                      <span
                        className={`text-[9px] px-1.5 py-0.5 rounded font-mono uppercase font-bold ${
                          s.severity === 'critical'
                            ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                            : s.severity === 'high'
                            ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                            : 'bg-sky-500/20 text-sky-400 border border-sky-500/30'
                        }`}
                      >
                        {s.severity}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 line-clamp-2">{s.description}</p>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Demo React Component Thrower for React Render Error scenario */}
        {renderErrorTriggered && (
          <div className="p-4 bg-rose-950/80 border border-rose-500 rounded-xl text-rose-200">
            <h3 className="font-bold">React Error Boundary Test:</h3>
            <BrokenRenderComponent />
          </div>
        )}
      </main>
    </div>
  );
}

function BrokenRenderComponent(): any {
  throw new Error('FatalReactRenderError: Invariant violation during CheckoutDrawer render cycle.');
}

