"use client";

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Flame, Activity, ExternalLink } from 'lucide-react';
import { initBrowserReporter } from '@/lib/reporter';

export default function ClientReporterInit() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    initBrowserReporter();
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return (
    <aside aria-label="Demo Navigation" className="fixed bottom-4 left-4 z-50 flex items-center gap-2 bg-slate-950/90 border border-slate-800 text-slate-200 px-3 py-2 rounded-full shadow-2xl backdrop-blur-md text-xs font-medium">
      <div className="flex items-center gap-1.5 pr-2 border-r border-slate-800 text-emerald-400">
        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
        <span className="font-mono text-[11px]">Reporter Active</span>
      </div>

      <Link
        href="/chaos"
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-500/10 border border-rose-500/30 text-rose-300 hover:bg-rose-500/20 transition font-semibold"
      >
        <Flame className="w-3.5 h-3.5 text-rose-400" />
        <span>Crash Control Panel</span>
      </Link>

      <a
        href="http://localhost:5173"
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/30 text-indigo-300 hover:bg-indigo-500/20 transition font-semibold"
      >
        <Activity className="w-3.5 h-3.5 text-indigo-400" />
        <span>Dashboard</span>
        <ExternalLink className="w-3 h-3 text-indigo-400" />
      </a>
    </aside>
  );
}

