/**
 * Automated Bot Runner for CrashWeb
 *
 * SAFETY WARNING:
 * This bot runner has a strict domain allowlist. It is ONLY permitted
 * to run against local CrashWeb instances (localhost / 127.0.0.1).
 * Never point it to external production websites.
 */

export type BotMode = 'gentle' | 'random' | 'stress' | 'targeted';

export interface BotRunnerConfig {
  targetUrl: string;
  botCount: number;
  intervalMs: number;
  mode: BotMode;
  targetedScenario?: string;
}

export interface BotStats {
  isRunning: boolean;
  activeBots: number;
  totalRequests: number;
  crashesTriggered: number;
  mode: BotMode;
  targetedScenario?: string;
  targetUrl: string;
  recentActivity: Array<{
    timestamp: string;
    botId: string;
    action: string;
    status: number;
    scenario?: string;
  }>;
}

const ALLOWED_HOSTNAMES = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);

export function assertAllowedTarget(targetUrl: string): void {
  try {
    const parsed = new URL(targetUrl);
    if (!ALLOWED_HOSTNAMES.has(parsed.hostname)) {
      throw new Error(
        `[SECURITY POLICY VIOLATION] Target '${parsed.hostname}' is not in the CrashWeb allowlist (${Array.from(ALLOWED_HOSTNAMES).join(', ')}). Aborting immediately.`
      );
    }
  } catch (err: any) {
    throw new Error(`Target URL validation failed: ${err.message}`);
  }
}

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0',
];

const SEARCH_QUERIES = [
  'candle',
  'tote bag',
  'mug',
  'speaker',
  'serum',
  'lamp',
  'headphones',
  "' OR 1=1 --", // malformed search
  '<script>alert(1)</script>',
  '%00%ff%fe',
];

const BACKEND_CHAOS_SCENARIOS = [
  'be-http-500',
  'be-db-pool-exhausted',
  'be-timeout',
  'be-null-pointer',
  'be-unhandled-exception',
  'be-oom-simulation',
  'be-malformed-input',
  'net-4xx',
  'net-5xx',
  'net-rate-limit',
];

class BotInstance {
  id: string;
  config: BotRunnerConfig;
  userAgent: string;
  sessionCookie: string | null = null;
  botSessionId: string;

  constructor(index: number, config: BotRunnerConfig) {
    this.id = `bot-${index + 1}-${Math.random().toString(36).substring(2, 6)}`;
    this.config = config;
    this.userAgent = USER_AGENTS[index % USER_AGENTS.length];
    this.botSessionId = `bot_sess_${Math.random().toString(36).substring(2, 10)}`;
  }

  async runStep(): Promise<{ action: string; status: number; scenario?: string }> {
    const mode = this.config.mode;
    const base = this.config.targetUrl.replace(/\/+$/, '');

    // Decide whether to perform a normal action or a chaos action
    let shouldCrash = false;
    if (mode === 'gentle') {
      shouldCrash = Math.random() < 0.08;
    } else if (mode === 'random') {
      shouldCrash = Math.random() < 0.45;
    } else if (mode === 'stress') {
      shouldCrash = Math.random() < 0.85;
    } else if (mode === 'targeted') {
      shouldCrash = true;
    }

    if (shouldCrash) {
      const scenario =
        mode === 'targeted' && this.config.targetedScenario
          ? this.config.targetedScenario
          : BACKEND_CHAOS_SCENARIOS[Math.floor(Math.random() * BACKEND_CHAOS_SCENARIOS.length)];

      try {
        const res = await fetch(`${base}/api/chaos?scenario=${scenario}&botId=${this.id}&sessionId=${this.botSessionId}`, {
          method: Math.random() > 0.5 ? 'POST' : 'GET',
          headers: {
            'User-Agent': this.userAgent,
            'x-bot-id': this.id,
            'x-session-id': this.botSessionId,
            ...(this.sessionCookie ? { Cookie: `zon_session=${this.sessionCookie}` } : {}),
          },
          signal: AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined,
        });
        return { action: `Trigger Chaos (${scenario})`, status: res.status, scenario };
      } catch (err: any) {
        return { action: `Trigger Chaos (${scenario} - Timeout)`, status: 504, scenario };
      }
    }

    // Normal shopping behavior
    const actionRoll = Math.random();
    try {
      if (actionRoll < 0.35) {
        // Browse catalog snapshot
        const res = await fetch(`${base}/api/engine`, {
          headers: { 'User-Agent': this.userAgent, 'x-bot-id': this.id },
        });
        return { action: 'Browse Store Catalog', status: res.status };
      } else if (actionRoll < 0.6) {
        // Search query
        const q = SEARCH_QUERIES[Math.floor(Math.random() * SEARCH_QUERIES.length)];
        const res = await fetch(`${base}/?query=${encodeURIComponent(q)}`, {
          headers: { 'User-Agent': this.userAgent, 'x-bot-id': this.id },
        });
        return { action: `Search for "${q}"`, status: res.status };
      } else if (actionRoll < 0.8) {
        // Newsletter subscription
        const email = Math.random() > 0.3 ? `shopper_${Date.now()}@testzon.com` : 'invalid-email-format';
        const res = await fetch(`${base}/api/engine`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': this.userAgent,
            'x-bot-id': this.id,
          },
          body: JSON.stringify({ action: 'newsletter', email }),
        });
        return { action: `Newsletter submit (${email})`, status: res.status };
      } else {
        // Cart / Checkout attempt without account (triggers 401)
        const res = await fetch(`${base}/api/engine`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': this.userAgent,
            'x-bot-id': this.id,
          },
          body: JSON.stringify({ action: 'checkout' }),
        });
        return { action: 'Attempt Checkout', status: res.status };
      }
    } catch (e: any) {
      return { action: 'Network fetch error', status: 500 };
    }
  }
}

class BotRunnerManager {
  private config: BotRunnerConfig = {
    targetUrl: 'http://localhost:3000',
    botCount: 3,
    intervalMs: 1500,
    mode: 'random',
  };

  private isRunning = false;
  private bots: BotInstance[] = [];
  private timers: NodeJS.Timeout[] = [];
  private totalRequests = 0;
  private crashesTriggered = 0;
  private recentActivity: BotStats['recentActivity'] = [];

  constructor() {
    // Check initial target
    assertAllowedTarget(this.config.targetUrl);
  }

  getStats(): BotStats {
    return {
      isRunning: this.isRunning,
      activeBots: this.isRunning ? this.bots.length : 0,
      totalRequests: this.totalRequests,
      crashesTriggered: this.crashesTriggered,
      mode: this.config.mode,
      targetedScenario: this.config.targetedScenario,
      targetUrl: this.config.targetUrl,
      recentActivity: this.recentActivity.slice(0, 15),
    };
  }

  start(newConfig?: Partial<BotRunnerConfig>): BotStats {
    if (newConfig) {
      if (newConfig.targetUrl) {
        assertAllowedTarget(newConfig.targetUrl);
      }
      this.config = { ...this.config, ...newConfig };
    }

    this.stop();
    this.isRunning = true;
    this.bots = [];

    const count = Math.max(1, Math.min(this.config.botCount || 3, 20)); // cap at 20 for safety
    for (let i = 0; i < count; i++) {
      this.bots.push(new BotInstance(i, this.config));
    }

    const interval = Math.max(300, this.config.intervalMs || 1500);

    // Stagger bot starts
    this.bots.forEach((bot, index) => {
      const delay = index * Math.floor(interval / this.bots.length);
      const timer = setTimeout(() => {
        const loopTimer = setInterval(async () => {
          if (!this.isRunning) return;
          const result = await bot.runStep();
          this.totalRequests++;
          if (result.status >= 400 || result.scenario) {
            this.crashesTriggered++;
          }

          this.recentActivity.unshift({
            timestamp: new Date().toLocaleTimeString(),
            botId: bot.id,
            action: result.action,
            status: result.status,
            scenario: result.scenario,
          });

          if (this.recentActivity.length > 50) {
            this.recentActivity = this.recentActivity.slice(0, 50);
          }
        }, interval);

        this.timers.push(loopTimer);
      }, delay);

      this.timers.push(timer);
    });

    return this.getStats();
  }

  stop(): BotStats {
    this.isRunning = false;
    this.timers.forEach((t) => clearInterval(t));
    this.timers = [];
    this.bots = [];
    return this.getStats();
  }
}

// Global singleton for Next.js runtime
const globalBots = globalThis as typeof globalThis & { __botManager?: BotRunnerManager };
export const botManager = globalBots.__botManager ?? (globalBots.__botManager = new BotRunnerManager());

