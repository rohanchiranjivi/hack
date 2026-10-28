"use client";

import React, { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import {
  Activity, ArrowRight, Check, Heart, Search, ShoppingBag, Star,
  Truck, PackageCheck, RotateCcw, Zap, Plus, X, AlertTriangle,
  ExternalLink, Flame, ShieldAlert, Cpu, RefreshCw, AlertOctagon
} from 'lucide-react';
import { products } from '@/lib/store';

const API_BASE = 'http://localhost:8000/api';

export default function VictimStorefront() {
  const [cartOpen, setCartOpen] = useState(false);
  const [cart, setCart] = useState<any[]>([]);
  const [wishlist, setWishlist] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState('All');
  const [toast, setToast] = useState('');
  const [toastType, setToastType] = useState<'success' | 'error' | 'warning'>('success');
  const [checkoutError, setCheckoutError] = useState('');
  const [validationError, setValidationError] = useState('');
  const [isHanging, setIsHanging] = useState(false);
  const [hangingMsg, setHangingMsg] = useState('');

  // Monitoring sync stats
  const [totalCrashes, setTotalCrashes] = useState<number>(0);
  const [healthStatus, setHealthStatus] = useState<string>('Healthy');
  const [lastLatencyMs, setLastLatencyMs] = useState<number>(42);
  const [activeScenarios, setActiveScenarios] = useState<string[]>([]);
  const [triggerRuntimeError, setTriggerRuntimeError] = useState(false);

  // Poll backend monitoring stats every 1500ms to keep victim site in sync
  useEffect(() => {
    let mounted = true;
    const fetchStats = async () => {
      try {
        const res = await fetch(`${API_BASE}/stats`);
        if (res.ok && mounted) {
          const data = await res.json();
          setTotalCrashes(data.totalCrashes || 0);
          setHealthStatus(data.siteStatus || 'Healthy');
          setLastLatencyMs(data.lastLatencyMs || 42);
        }
      } catch {
        // Backend might be offline or starting
      }
    };

    fetchStats();
    const interval = setInterval(fetchStats, 1500);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  // Compute simulated lag based on total crash volume
  // <50 crashes: 0ms
  // 50-200 crashes: 650ms (noticeable stutter)
  // 200-500 crashes: 2200ms (severe lag)
  // >=500 crashes: 5500ms (severe hanging / freeze)
  const lagDelayMs = totalCrashes >= 500 ? 5500 : totalCrashes >= 200 ? 2200 : totalCrashes >= 50 ? 650 : 0;
  const isHangingState = totalCrashes >= 500;
  const isLaggingState = totalCrashes >= 50 && totalCrashes < 500;

  // Simulate server lag on user action
  async function simulateNetworkLag(actionName: string) {
    if (lagDelayMs === 0) return true;
    setIsHanging(true);
    setHangingMsg(
      isHangingState
        ? `🚨 VICTIM SITE HANGING (500+ Crashes): ${actionName} stalling (${lagDelayMs}ms delay)...`
        : `⚠️ VICTIM SITE LAGGING: Simulating server lag (${lagDelayMs}ms delay)...`
    );
    await new Promise((r) => setTimeout(r, lagDelayMs));
    setIsHanging(false);
    setHangingMsg('');
    return true;
  }

  // Handle Search Input (checks for SQL Injection probe)
  async function handleSearch(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setQuery(val);
    if (val.includes("'") || val.includes("1=1") || val.toLowerCase().includes("select") || val.includes("--")) {
      setValidationError("InputValidationException: Malicious SQL injection probe pattern detected in query parameter: \"" + val + "\" (HTTP 400 Bad Request)");
    } else {
      setValidationError('');
    }
  }

  // Add item to bag with lag
  async function addToBag(p: any) {
    await simulateNetworkLag(`Adding "${p[0]}" to bag`);
    setCart((prev) => [...prev, p]);
    setToast(`${p[0]} added to your bag.`);
    setToastType('success');
  }

  // Handle Checkout
  async function handleCheckout() {
    await simulateNetworkLag('Checkout Transaction Commit');
    if (isHangingState || totalCrashes >= 200) {
      setCheckoutError(
        `DatabaseConnectionTimeout: Connection pool exhausted (0/50 available).\nUnable to acquire client within 5000ms on transaction commit.\n\nHTTP 503 Service Unavailable\nat DatabaseSession.query (src/db/connection.ts:65:28)\nat OrderProcessor.commit (src/engine/orders.ts:88:14)`
      );
    } else if (totalCrashes >= 50) {
      setCheckoutError(
        `504 Gateway Timeout: Upstream catalog service failed to respond within 4500ms SLA window under concurrent load.\n\nHTTP 504 Gateway Timeout\nat HttpClient.fetchWithTimeout (src/lib/fetcher.ts:42:19)`
      );
    } else {
      setCart([]);
      setCartOpen(false);
      setToast('Order confirmed! Thanks for shopping with Zon.');
      setToastType('success');
    }
  }

  // Category filter
  async function handleCategorySelect(c: string) {
    await simulateNetworkLag(`Filtering category: ${c}`);
    setCat(c);
  }

  const visible = products.filter((p) => {
    const matchesCat = cat === 'All' || p[1] === cat;
    const matchesQuery = !query || p[0].toLowerCase().includes(query.toLowerCase()) || p[1].toLowerCase().includes(query.toLowerCase());
    return matchesCat && matchesQuery;
  });

  return (
    <main style={{ minHeight: '100vh', background: '#0b0d10', color: '#f5f5f3' }}>
      {/* 1. SEPARATE ARCHITECTURE NAVIGATION & LIVE HEALTH HEADER */}
      <div style={{
        background: isHangingState ? '#3d0a0a' : isLaggingState ? '#2a1a05' : '#14171c',
        borderBottom: `2px solid ${isHangingState ? '#ef4444' : isLaggingState ? '#f59e0b' : '#333740'}`,
        padding: '10px 5.5%',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
        fontSize: '12px',
        position: 'sticky',
        top: 0,
        zIndex: 100,
        boxShadow: isHangingState ? '0 4px 20px rgba(239, 68, 68, 0.4)' : 'none',
        transition: 'all 0.3s ease',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <span style={{
            background: isHangingState ? '#ef4444' : isLaggingState ? '#f59e0b' : '#10b981',
            color: '#fff',
            padding: '3px 8px',
            borderRadius: '4px',
            fontWeight: 800,
            fontSize: '10px',
            letterSpacing: '0.08em',
            display: 'flex',
            alignItems: 'center',
            gap: '5px'
          }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#fff', animation: 'pulse 1.5s infinite' }} />
            {isHangingState ? 'VICTIM SITE: HANGING / 504 TIMEOUT' : isLaggingState ? 'VICTIM SITE: DEGRADED / LAGGING' : 'VICTIM SITE: HEALTHY'}
          </span>

          <span style={{ color: '#9da3ae', fontSize: '11px', fontFamily: 'monospace' }}>
            Crash Count: <b style={{ color: isHangingState ? '#f87171' : isLaggingState ? '#fbbf24' : '#34d399' }}>{totalCrashes.toLocaleString()}</b>
          </span>
          <span style={{ color: '#64748b' }}>|</span>
          <span style={{ color: '#9da3ae', fontSize: '11px', fontFamily: 'monospace' }}>
            Simulated Latency: <b style={{ color: lagDelayMs > 1000 ? '#f87171' : '#e2e8f0' }}>{lastLatencyMs}ms ({lagDelayMs}ms artificial delay)</b>
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
          <Link
            href="/chaos"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              background: '#ef4444',
              color: '#fff',
              padding: '5px 12px',
              borderRadius: '6px',
              fontWeight: 700,
              fontSize: '11px',
              textDecoration: 'none',
              boxShadow: '0 2px 8px rgba(239, 68, 68, 0.4)'
            }}
          >
            <Zap size={14} />
            <span>Open Crash Control Attack Portal ↗</span>
          </Link>

          <a
            href="http://localhost:5173"
            target="_blank"
            rel="noreferrer"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              background: '#6366f1',
              color: '#fff',
              padding: '5px 12px',
              borderRadius: '6px',
              fontWeight: 700,
              fontSize: '11px',
              textDecoration: 'none',
              boxShadow: '0 2px 8px rgba(99, 102, 241, 0.4)'
            }}
          >
            <Activity size={14} />
            <span>SignalDesk Monitor (500+ Triage) ↗</span>
          </a>
        </div>
      </div>

      {/* 2. CRITICAL HANGING BANNER (VISIBLE WHEN >= 500 CRASHES) */}
      {isHangingState && (
        <div style={{
          background: 'linear-gradient(90deg, #7f1d1d, #991b1b, #7f1d1d)',
          borderBottom: '2px solid #f87171',
          padding: '14px 5.5%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '16px',
          color: '#fee2e2',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <AlertOctagon size={28} className="animate-pulse" style={{ color: '#fca5a5' }} />
            <div>
              <div style={{ fontWeight: 800, fontSize: '14px', letterSpacing: '0.04em' }}>
                🚨 SEVERE BOT CONCURRENCY COLLAPSE: 500+ CRASHES REACHED
              </div>
              <div style={{ fontSize: '11px', opacity: 0.9, marginTop: '2px' }}>
                The victim storefront is actively hanging with 5500ms latency. SignalDesk Monitor has isolated the <b>Top 5 High-Risk Failures</b> and recommended code fixes.
              </div>
            </div>
          </div>

          <a
            href="http://localhost:5173"
            target="_blank"
            rel="noreferrer"
            style={{
              background: '#fee2e2',
              color: '#991b1b',
              padding: '8px 16px',
              borderRadius: '6px',
              fontWeight: 800,
              fontSize: '11px',
              textDecoration: 'none',
              whiteSpace: 'nowrap',
              boxShadow: '0 2px 10px rgba(0,0,0,0.3)'
            }}
          >
            View Top 5 Triage & Recommended Fixes →
          </a>
        </div>
      )}

      {/* 3. SIMULATED NETWORK HANG / LAG SPINNER OVERLAY */}
      {isHanging && (
        <div style={{
          position: 'fixed',
          top: '70px',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 999,
          background: 'rgba(15, 23, 42, 0.95)',
          border: '1px solid #f59e0b',
          borderRadius: '8px',
          padding: '12px 24px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
          color: '#fef3c7',
          fontSize: '13px',
          fontWeight: 600,
        }}>
          <RefreshCw size={18} className="animate-spin text-amber-400" />
          <span>{hangingMsg}</span>
        </div>
      )}

      {/* 4. STOREFRONT HEADER */}
      <header>
        <div className="logo">
          zon<span>.</span>
        </div>

        <button className="delivery" style={{ cursor: 'default' }}>
          Deliver to<br />
          <b>Global · Fast Delivery</b>
        </button>

        <div className="search" style={{ position: 'relative' }}>
          <Search size={16} />
          <input
            type="text"
            placeholder="Search home, audio, travel essentials, or try malicious probe: ' OR 1=1 --"
            value={query}
            onChange={handleSearch}
          />
          {query && (
            <button onClick={() => { setQuery(''); setValidationError(''); }} style={{ background: 'none', border: 0, color: '#aaa' }}>
              <X size={14} />
            </button>
          )}
        </div>

        <div className="header-actions">
          <button
            className="bag"
            onClick={() => setCartOpen(true)}
            style={{ position: 'relative' }}
          >
            <ShoppingBag size={20} />
            <b>Bag</b>
            <i>{cart.length}</i>
          </button>
        </div>
      </header>

      {/* 5. INPUT VALIDATION ERROR (MATCHING SQL/XSS PROBE) */}
      {validationError && (
        <div style={{
          background: '#450a0a',
          borderLeft: '4px solid #ef4444',
          borderBottom: '1px solid #7f1d1d',
          padding: '12px 5.5%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          color: '#fecaca',
          fontSize: '12px',
          fontFamily: 'monospace',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertTriangle size={18} className="text-red-400 shrink-0" />
            <span><b>SECURITY SANITIZER TRIGGERED:</b> {validationError}</span>
          </div>
          <button onClick={() => setValidationError('')} style={{ background: 'none', border: 0, color: '#f87171' }}>
            <X size={16} />
          </button>
        </div>
      )}

      {/* 6. HERO SECTION */}
      <section className="hero">
        <div className="hero-copy">
          <small>✳ THE EDIT / AUTUMN 2026</small>
          <h1>Good finds.<br /><em>Better days.</em></h1>
          <p>
            Considered essentials for your workspace, everyday audio, and travel rituals. Designed for simplicity, tested under real-world traffic load.
          </p>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginTop: '16px' }}>
            <a href="#shop" className="hero-copy" style={{ textDecoration: 'none' }}>
              <button>Explore the Edit <ArrowRight size={16} /></button>
            </a>
            <button
              onClick={() => setTriggerRuntimeError((v) => !v)}
              style={{
                background: triggerRuntimeError ? '#ef4444' : '#27272a',
                color: '#fff',
                border: '1px solid #52525b',
                padding: '14px 18px',
                fontSize: '12px',
                fontWeight: 700,
                borderRadius: '2px',
              }}
            >
              {triggerRuntimeError ? '⚡ Simulated Hydration Error Active' : 'Simulate TypeError in ProductGrid'}
            </button>
          </div>
        </div>

        <div className="hero-img">
          <img
            src="https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=1200&q=80"
            alt="Hero collection"
          />
          <b>
            ZON / 01<br />
            <strong>Edition</strong>
          </b>
        </div>
      </section>

      {/* 7. VALUE PROPOSITIONS */}
      <div className="benefits">
        <div>
          <Truck />
          <b>Carbon neutral shipping<small>Free on orders over $50</small></b>
        </div>
        <div>
          <PackageCheck />
          <b>Two-year warranty<small>Engineered for longevity</small></b>
        </div>
        <div>
          <RotateCcw />
          <b>30-day effortless returns<small>Pre-paid return labels</small></b>
        </div>
        <div>
          <Star />
          <b>Small joy guarantee<small>Love it or send it back</small></b>
        </div>
      </div>

      {/* 8. PRODUCTS CATALOG (THE SHOP) */}
      <section className="shop" id="shop">
        <small>✳ CATALOG DIRECTORY</small>
        <h2>Curated Essentials.<br /><em>Engineered to endure.</em></h2>
        <p>Browse our core collection. Every product is stress-tested against real microservice backends.</p>

        <nav>
          {['All', 'Home', 'Audio', 'Travel', 'Lifestyle', 'Accessories'].map((categoryName) => (
            <button
              key={categoryName}
              className={cat === categoryName ? 'chosen' : ''}
              onClick={() => handleCategorySelect(categoryName)}
            >
              {categoryName}
            </button>
          ))}
        </nav>

        {/* SIMULATED RUNTIME ERROR (MATCHING JAVASCRIPT RUNTIME TYPEERROR) */}
        {triggerRuntimeError ? (
          <div style={{
            background: '#1c1012',
            border: '1px solid #ef4444',
            borderRadius: '8px',
            padding: '24px',
            margin: '20px 0',
            color: '#fca5a5',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '15px', fontWeight: 800 }}>
              <AlertTriangle className="text-red-500" size={20} />
              <span>React Error Boundary: TypeError Caught</span>
            </div>
            <pre style={{
              background: '#0a0a0a',
              padding: '16px',
              borderRadius: '4px',
              fontSize: '12px',
              fontFamily: 'monospace',
              marginTop: '12px',
              overflowX: 'auto',
              color: '#f87171'
            }}>
{`TypeError: Cannot read properties of undefined (reading 'price') in ZonProductGrid hydration render.
    at ZonProductGrid (app/components/ProductGrid.tsx:84:32)
    at renderWithHooks (node_modules/react-dom/cjs/react-dom.development.js:14985:18)`}
            </pre>
            <div style={{ marginTop: '12px', fontSize: '12px', color: '#cbd5e1' }}>
              SignalDesk Monitor classified this under <b>JavaScript Runtime</b> with recommended fix:
              <i> "Implement defensive optional chaining (product?.price ?? 0.00) and validate props with Zod."</i>
            </div>
            <button
              onClick={() => setTriggerRuntimeError(false)}
              style={{
                marginTop: '14px',
                background: '#ef4444',
                color: '#fff',
                border: 0,
                padding: '8px 16px',
                borderRadius: '4px',
                fontWeight: 700,
                fontSize: '11px',
              }}
            >
              Recover / Reset Hydration State
            </button>
          </div>
        ) : (
          <div className="products">
            {visible.map((p) => (
              <article key={p[0]}>
                <div className="product-img">
                  <img
                    src={`https://images.unsplash.com/${p[4]}?auto=format&fit=crop&w=700&q=85`}
                    alt={p[0]}
                  />
                  <label>{p[5]}</label>
                  <button
                    className={`wish ${wishlist.includes(p[0]) ? 'loved' : ''}`}
                    aria-label="Wishlist"
                    onClick={() => {
                      setWishlist((prev) =>
                        prev.includes(p[0]) ? prev.filter((i) => i !== p[0]) : [...prev, p[0]]
                      );
                      setToast(wishlist.includes(p[0]) ? 'Removed from saved items.' : 'Saved for later.');
                      setToastType('success');
                    }}
                  >
                    <Heart size={16} />
                  </button>
                  <button className="quick" onClick={() => addToBag(p)}>
                    <Plus size={14} /> QUICK ADD
                  </button>
                </div>
                <small>
                  {p[1]} <span>★ 4.8 &nbsp;(241)</span>
                </small>
                <h3>{p[0]}</h3>
                <b>
                  ${p[2].toFixed(2)} <del>${p[3].toFixed(2)}</del>
                </b>
              </article>
            ))}
          </div>
        )}

        {visible.length === 0 && !triggerRuntimeError && (
          <div className="no-results">
            No finds matching “{query}”. Try adjusting your search query.
          </div>
        )}
      </section>

      {/* 9. FOOTER */}
      <footer>
        <div className="footer-cols">
          <div className="logo">
            zon<span>.</span>
            <p>For the little things<br />that make a day.</p>
          </div>
          <div>
            <b>THE GOOD STUFF</b>
            <a href="#shop">Shop all</a>
            <a href="#shop">Home & living</a>
            <Link href="/chaos">Attack Simulation Center</Link>
          </div>
          <div>
            <b>MONITORING STATUS</b>
            <a href="http://localhost:5173" target="_blank" rel="noreferrer">SignalDesk Monitor</a>
            <a>Target: crashweb-gules.vercel.app</a>
            <a>Total Crashes: {totalCrashes}</a>
          </div>
          <strong>Make room<br />for good.</strong>
        </div>

        <div className="footer-bottom">
          © 2026 ZON GOODS CO. MONITORED VICTIM ENVIRONMENT.
          <Link href="/chaos" style={{ display: 'flex', gap: '8px', alignItems: 'center', color: '#f87171' }}>
            <Zap size={14} /> Open Chaos Attack Portal
          </Link>
        </div>
      </footer>

      {/* 10. SHOPPING BAG DRAWER */}
      {cartOpen && (
        <div className="cart-overlay" onClick={(e) => { if (e.target === e.currentTarget) setCartOpen(false); }}>
          <section className="cart-drawer">
            <div className="cart-head">
              <div>
                <small>YOUR GOOD FINDS</small>
                <h2>Your bag <span>({cart.length})</span></h2>
              </div>
              <button onClick={() => setCartOpen(false)} aria-label="Close bag"><X size={18} /></button>
            </div>

            {cart.length === 0 ? (
              <div className="cart-empty">
                <ShoppingBag size={28} />
                <b>Your bag is taking a little breather.</b>
                <span>Find something lovely for your everyday.</span>
                <button onClick={() => setCartOpen(false)}>Explore the edit →</button>
              </div>
            ) : (
              <>
                <div className="cart-items">
                  {cart.map((p, i) => (
                    <div className="cart-item" key={p[0] + '-' + i}>
                      <img
                        src={`https://images.unsplash.com/${p[4]}?auto=format&fit=crop&w=160&q=75`}
                        alt={p[0]}
                      />
                      <div>
                        <small>{p[1]}</small>
                        <b>{p[0]}</b>
                        <span>${p[2].toFixed(2)}</span>
                      </div>
                      <button onClick={() => setCart((prev) => prev.filter((_, idx) => idx !== i))} aria-label="Remove item">
                        <X size={15} />
                      </button>
                    </div>
                  ))}
                </div>

                <div className="cart-total">
                  <div>
                    <span>Subtotal</span>
                    <b>${cart.reduce((n, p) => n + p[2], 0).toFixed(2)}</b>
                  </div>
                  <small>Shipping calculated at checkout. Free over $50.</small>
                  <button onClick={handleCheckout}>
                    Proceed to checkout <ArrowRight size={16} />
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      )}

      {/* 11. CHECKOUT ERROR OVERLAY (MATCHING SIMULATED BACKEND CRASHES) */}
      {checkoutError && (
        <div className="error-overlay">
          <section>
            <button className="error-close" onClick={() => setCheckoutError('')}>×</button>
            <small>ORDER PROCESSOR / FATAL EXCEPTION</small>
            <h2>Checkout failed.</h2>
            <pre>{checkoutError}</pre>
            <div style={{ marginTop: '14px', fontSize: '11px', color: '#cbd5e1' }}>
              This error was captured and transmitted to <b>SignalDesk Monitor</b>. View prioritized triage and recommended fixes in the dashboard.
            </div>
            <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
              <button className="error-ok" onClick={() => setCheckoutError('')}>Dismiss</button>
              <a
                href="http://localhost:5173"
                target="_blank"
                rel="noreferrer"
                style={{
                  background: '#6366f1',
                  color: '#fff',
                  border: 0,
                  padding: '11px 18px',
                  fontSize: '11px',
                  fontWeight: 700,
                  textDecoration: 'none',
                  borderRadius: '3px',
                }}
              >
                Inspect in SignalDesk Monitor →
              </a>
            </div>
          </section>
        </div>
      )}

      {/* 12. TOAST NOTIFICATIONS */}
      {toast && (
        <div className={`toast ${toastType}`} role="status">
          {toastType === 'error' ? <X size={16} /> : <Check size={16} />}
          <span>{toast}</span>
          <button onClick={() => setToast('')}><X size={14} /></button>
        </div>
      )}

      {/* 13. FLOATING BAG BUTTON */}
      {cart.length > 0 && !cartOpen && (
        <button className="checkout" onClick={() => setCartOpen(true)}>
          View bag · ${cart.reduce((n, p) => n + p[2], 0).toFixed(2)} <ArrowRight size={16} />
        </button>
      )}
    </main>
  );
}
