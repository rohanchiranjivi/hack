/**
 * Automated Bot Runner & Attack Engine for CrashWeb
 *
 * Targets the separate CrashWeb victim deployment:
 * https://crashweb-gules.vercel.app/
 */

import { sendCrashReport } from '../lib/reporter';

export type BotMode = 'gentle' | 'random' | 'stress' | 'targeted' | 'flood500';

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
  isFlooding?: boolean;
  floodProgress?: number;
  recentActivity: Array<{
    timestamp: string;
    botId: string;
    action: string;
    status: number;
    scenario?: string;
  }>;
}

const ALLOWED_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  'crashweb-gules.vercel.app',
]);

if (process.env.ALLOWED_TARGET_HOSTS) {
  process.env.ALLOWED_TARGET_HOSTS.split(',').forEach((h) => {
    const cleaned = h.trim().replace(/^https?:\/\//, '').split(':')[0];
    if (cleaned) ALLOWED_HOSTNAMES.add(cleaned);
  });
}

export function assertAllowedTarget(targetUrl: string): void {
  try {
    const parsed = new URL(targetUrl);
    if (!ALLOWED_HOSTNAMES.has(parsed.hostname) && !parsed.hostname.endsWith('.vercel.app')) {
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

export const ATTACK_SCENARIOS = [
  {
    id: 'be-storage-503',
    name: 'Persistent Storage Failure (Vercel 503)',
    category: 'Database',
    riskHint: 'critical',
    endpoint: '/api/engine',
    message: 'HTTP 503: Persistent storage is not configured. Add the Upstash Redis environment variables in Vercel.',
    errorType: 'StorageNotConfiguredError',
    httpStatus: 503,
    stack: 'Error: StorageNotConfiguredError: Persistent storage is not configured.\n    at getRedisClient (/var/task/lib/backend.ts:32:11)\n    at handleEngine (/var/task/app/api/engine/route.ts:58:24)\n    at processTicksAndRejections (node:internal/process/task_queues:95:5)',
  },
  {
    id: 'be-db-pool-exhausted',
    name: 'Database Pool Exhaustion',
    category: 'Database',
    riskHint: 'critical',
    endpoint: '/api/checkout',
    message: 'DatabaseConnectionTimeout: Connection pool exhausted (0/50 available). Unable to acquire client within 5000ms on transaction commit.',
    errorType: 'DatabaseConnectionError',
    httpStatus: 503,
    stack: 'DatabasePoolError: Connection pool exhausted (0/50 available)\n    at Pool.acquireConnection (node_modules/pg-pool/index.js:312:11)\n    at DatabaseSession.query (src/db/connection.ts:65:28)\n    at OrderProcessor.commit (src/engine/orders.ts:88:14)',
  },
  {
    id: 'be-timeout',
    name: 'Gateway SLA Timeout (504)',
    category: 'Timeout/Performance',
    riskHint: 'critical',
    endpoint: '/api/engine',
    message: '504 Gateway Timeout: Upstream catalog service failed to respond within 4500ms SLA window under concurrent load.',
    errorType: 'GatewayTimeout',
    httpStatus: 504,
    stack: 'GatewayTimeout: Upstream SLA exceeded\n    at HttpClient.fetchWithTimeout (src/lib/fetcher.ts:42:19)\n    at CatalogService.getSnapshot (src/catalog/service.ts:112:8)',
  },
  {
    id: 'be-oom-simulation',
    name: 'Fatal JavaScript OOM Heap Exhaustion',
    category: 'Memory',
    riskHint: 'critical',
    endpoint: '/api/engine',
    message: 'Fatal JavaScript out of memory: heap allocation failed in Vercel Edge compute zone (heap limit reached: 512 MB).',
    errorType: 'OutOfMemoryError',
    httpStatus: 500,
    stack: 'RangeError: Array buffer allocation failed\n    at MemoryLeakSimulator.allocateChunk (src/memory/allocator.ts:77:22)\n    at RouteHandler.post (/api/engine:114:9)',
  },
  {
    id: 'net-rate-limit',
    name: 'Distributed Rate Limit Storm (429)',
    category: 'Network/HTTP',
    riskHint: 'high',
    endpoint: '/',
    message: 'HTTP 429: Too Many Requests from distributed bot fleet. Rate limit exceeded (250 req/sec threshold).',
    errorType: 'RateLimitExceeded',
    httpStatus: 429,
    stack: 'RateLimitException: 429 Too Many Requests\n    at RateLimiter.verify (src/middleware/rateLimit.ts:45:13)\n    at NextServer.handle (node_modules/next/server/next-server.js:410:19)',
  },
  {
    id: 'auth-forgery',
    name: 'JWT Auth Signature Forgery Attack',
    category: 'Auth/Permissions',
    riskHint: 'high',
    endpoint: '/api/auth/verify',
    message: 'AuthTokenForgedError: Invalid signature or tampered header detected on user session token.',
    errorType: 'UnauthorizedAccess',
    httpStatus: 401,
    stack: 'JsonWebTokenError: invalid signature\n    at JWT.verify (node_modules/jsonwebtoken/verify.js:133:19)\n    at AuthenticateMiddleware.check (src/auth/middleware.ts:60:12)',
  },
  {
    id: 'sql-injection-probe',
    name: 'Search SQL/XSS Injection Probe',
    category: 'Validation/Input',
    riskHint: 'high',
    endpoint: '/?query=%27%20OR%201%3D1%20--',
    message: 'InputValidationException: Malicious SQL injection probe pattern detected in query parameter: "\' OR 1=1 --"',
    errorType: 'InputValidationException',
    httpStatus: 400,
    stack: 'ValidationError: Malicious input pattern\n    at QuerySanitizer.validate (src/search/sanitizer.ts:31:15)\n    at SearchController.query (src/search/controller.ts:48:9)',
  },
  {
    id: 'fe-hydration-error',
    name: 'React Hydration Null Pointer Error',
    category: 'JavaScript Runtime',
    riskHint: 'high',
    endpoint: '/',
    message: 'TypeError: Cannot read properties of undefined (reading \'price\') in ZonProductGrid hydration render.',
    errorType: 'TypeError',
    httpStatus: 500,
    stack: 'TypeError: Cannot read properties of undefined (reading \'price\')\n    at ZonProductGrid (app/components/ProductGrid.tsx:84:32)\n    at renderWithHooks (node_modules/react-dom/cjs/react-dom.development.js:14985:18)',
  },
];

export class BotInstance {
  id: string;
  config: BotRunnerConfig;
  userAgent: string;
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

    // Decide whether to attack or browse
    let shouldCrash = false;
    if (mode === 'gentle') {
      shouldCrash = Math.random() < 0.15;
    } else if (mode === 'random') {
      shouldCrash = Math.random() < 0.65;
    } else if (mode === 'stress' || mode === 'flood500') {
      shouldCrash = Math.random() < 0.95;
    } else if (mode === 'targeted') {
      shouldCrash = true;
    }

    if (shouldCrash) {
      const scenarioObj =
        mode === 'targeted' && this.config.targetedScenario
          ? ATTACK_SCENARIOS.find((s) => s.id === this.config.targetedScenario) || ATTACK_SCENARIOS[0]
          : ATTACK_SCENARIOS[Math.floor(Math.random() * ATTACK_SCENARIOS.length)];

      try {
        // Send actual HTTP attack probe to victim website
        let victimStatus = 200;
        try {
          const attackUrl = `${base}${scenarioObj.endpoint}`;
          const res = await fetch(attackUrl, {
            method: scenarioObj.endpoint.includes('engine') ? 'POST' : 'GET',
            headers: {
              'User-Agent': this.userAgent,
              'x-bot-id': this.id,
              'x-session-id': this.botSessionId,
              'Content-Type': 'application/json',
            },
            body: scenarioObj.endpoint.includes('engine')
              ? JSON.stringify({ action: 'checkout', sku: 'SKU-ATTACK-904' })
              : undefined,
            signal: AbortSignal.timeout ? AbortSignal.timeout(3500) : undefined,
          });
          victimStatus = res.status;
        } catch {
          victimStatus = 504;
        }

        // Report the crash incident to the Monitoring Backend
        await sendCrashReport({
          errorType: scenarioObj.errorType,
          message: scenarioObj.message,
          stackTrace: scenarioObj.stack,
          url: `${base}${scenarioObj.endpoint}`,
          httpStatus: scenarioObj.httpStatus,
          botId: this.id,
          sessionId: this.botSessionId,
          severityHint: scenarioObj.riskHint as any,
          userAgent: this.userAgent,
          metadata: {
            scenario: scenarioObj.id,
            attackTarget: base,
            isAttack: true,
            victimResponseCode: victimStatus,
          },
        });

        return {
          action: `Attacked ${scenarioObj.name} (HTTP ${victimStatus})`,
          status: victimStatus >= 400 ? victimStatus : scenarioObj.httpStatus,
          scenario: scenarioObj.id,
        };
      } catch (err: any) {
        return { action: `Attack failed (${scenarioObj.id})`, status: 500, scenario: scenarioObj.id };
      }
    }

    // Normal shopping probe against victim site
    try {
      const q = SEARCH_QUERIES[Math.floor(Math.random() * SEARCH_QUERIES.length)];
      const res = await fetch(`${base}/?query=${encodeURIComponent(q)}`, {
        headers: { 'User-Agent': this.userAgent, 'x-bot-id': this.id },
        signal: AbortSignal.timeout ? AbortSignal.timeout(4000) : undefined,
      });
      return { action: `Browsed store with query "${q}"`, status: res.status };
    } catch {
      return { action: 'Storefront probe error', status: 502 };
    }
  }
}

class BotRunnerManager {
  private config: BotRunnerConfig = {
    targetUrl: process.env.TARGET_URL || 'https://crashweb-gules.vercel.app',
    botCount: 4,
    intervalMs: 800,
    mode: 'random',
  };

  private isRunning = false;
  private isFlooding = false;
  private floodProgress = 0;
  private bots: BotInstance[] = [];
  private timers: NodeJS.Timeout[] = [];
  private totalRequests = 0;
  private crashesTriggered = 0;
  private recentActivity: BotStats['recentActivity'] = [];

  constructor() {
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
      isFlooding: this.isFlooding,
      floodProgress: this.floodProgress,
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

    const count = Math.max(1, Math.min(this.config.botCount || 4, 30));
    for (let i = 0; i < count; i++) {
      this.bots.push(new BotInstance(i, this.config));
    }

    const interval = Math.max(150, this.config.intervalMs || 800);

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
    this.isFlooding = false;
    this.timers.forEach((t) => clearInterval(t));
    this.timers = [];
    this.bots = [];
    return this.getStats();
  }

  /**
   * Fast Flood Attack: Rapidly launches concurrent attack waves
   * against the victim site until reaching 500 crashes.
   */
  async triggerFlood500(targetTotal: number = 500): Promise<{ count: number }> {
    if (this.isFlooding) return { count: this.crashesTriggered };
    this.isFlooding = true;
    this.floodProgress = 0;

    const base = this.config.targetUrl.replace(/\/+$/, '');
    const needed = Math.max(50, targetTotal);
    let launched = 0;

    const BATCH_SIZE = 25;
    for (let i = 0; i < needed; i += BATCH_SIZE) {
      if (!this.isFlooding) break;

      const batch = [];
      const currentBatchCount = Math.min(BATCH_SIZE, needed - i);

      for (let j = 0; j < currentBatchCount; j++) {
        const scenario = ATTACK_SCENARIOS[Math.floor(Math.random() * ATTACK_SCENARIOS.length)];
        const botId = `flood-bot-${(i + j) % 20 + 1}`;
        const sessionId = `flood_sess_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

        batch.push(
          sendCrashReport({
            errorType: scenario.errorType,
            message: scenario.message,
            stackTrace: scenario.stack,
            url: `${base}${scenario.endpoint}`,
            httpStatus: scenario.httpStatus,
            botId,
            sessionId,
            severityHint: scenario.riskHint as any,
            userAgent: USER_AGENTS[(i + j) % USER_AGENTS.length],
            metadata: {
              scenario: scenario.id,
              attackTarget: base,
              isAttack: true,
              wave: Math.floor(i / BATCH_SIZE),
            },
          }).then(() => {
            this.totalRequests++;
            this.crashesTriggered++;
            launched++;
            this.floodProgress = Math.min(targetTotal, launched);
          }).catch(() => {})
        );
      }

      await Promise.all(batch);
      this.recentActivity.unshift({
        timestamp: new Date().toLocaleTimeString(),
        botId: 'flood-engine',
        action: `Fired attack burst (${launched}/${needed}) at ${base}`,
        status: 500,
        scenario: 'be-storage-503',
      });

      // Micro delay between batches to allow SSE processing
      await new Promise((r) => setTimeout(r, 60));
    }

    this.isFlooding = false;
    this.floodProgress = targetTotal;
    return { count: launched };
  }
}

// Global singleton for Next.js runtime
const globalBots = globalThis as typeof globalThis & { __botManager?: BotRunnerManager };
export const botManager = globalBots.__botManager ?? (globalBots.__botManager = new BotRunnerManager());
