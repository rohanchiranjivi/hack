import { NextRequest, NextResponse } from 'next/server';
import { sendCrashReport } from '@/lib/reporter';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Server-side simulated memory leak store
const serverMemoryStore: any[] = [];

// Rate-limiting counter for 429 simulation
let simulatedRequestCount = 0;
let lastReset = Date.now();

export async function GET(req: NextRequest) {
  return handleChaos(req);
}

export async function POST(req: NextRequest) {
  return handleChaos(req);
}

async function handleChaos(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const scenario = searchParams.get('scenario') || 'be-storage-503';
  const botId = searchParams.get('botId') || req.headers.get('x-bot-id') || undefined;
  const sessionId = searchParams.get('sessionId') || req.headers.get('x-session-id') || undefined;

  const targetBase = (process.env.TARGET_URL || 'https://crashweb-gules.vercel.app').replace(/\/+$/, '');

  switch (scenario) {
    case 'be-storage-503': {
      const errMessage = 'HTTP 503: Persistent storage is not configured. Add the Upstash Redis environment variables in Vercel.';
      const stack = `StorageNotConfiguredError: ${errMessage}\n    at getRedisClient (lib/backend.ts:32:11)\n    at handleEngine (app/api/engine/route.ts:58:24)\n    at processTicksAndRejections (node:internal/process/task_queues:95:5)`;

      await sendCrashReport({
        errorType: 'StorageNotConfiguredError',
        message: errMessage,
        stackTrace: stack,
        url: `${targetBase}/api/engine`,
        httpStatus: 503,
        botId,
        sessionId,
        severityHint: 'critical',
      });

      return NextResponse.json(
        { error: errMessage, code: 'STORAGE_NOT_CONFIGURED', scenario },
        { status: 503 }
      );
    }

    case 'be-http-500': {
      const errMessage = 'Internal Server Error: Database transaction deadlock detected on Zon inventory commit.';
      const stack = `Error: ${errMessage}\n    at InventoryManager.commitStock (src/inventory/stock.ts:182:19)\n    at OrderEngine.processOrder (src/engine/processor.ts:94:12)\n    at handleChaos (/api/chaos/route.ts:42:15)`;

      await sendCrashReport({
        errorType: 'InternalServerError',
        message: errMessage,
        stackTrace: stack,
        url: `${targetBase}/api/checkout`,
        httpStatus: 500,
        botId,
        sessionId,
        severityHint: 'critical',
      });

      return NextResponse.json(
        { error: errMessage, code: 'INTERNAL_ERROR', scenario },
        { status: 500 }
      );
    }

    case 'be-db-pool-exhausted': {
      const errMessage = 'DatabaseConnectionTimeout: Connection pool exhausted (0/50 available). Unable to acquire client within 5000ms.';
      const stack = `DatabasePoolError: ${errMessage}\n    at Pool.acquireConnection (node_modules/pg-pool/index.js:312:11)\n    at DatabaseSession.query (src/db/connection.ts:65:28)\n    at handleChaos (/api/chaos/route.ts:58:15)`;

      await sendCrashReport({
        errorType: 'DatabaseConnectionError',
        message: errMessage,
        stackTrace: stack,
        url: `${targetBase}/api/checkout`,
        httpStatus: 503,
        botId,
        sessionId,
        severityHint: 'critical',
      });

      return NextResponse.json(
        { error: errMessage, code: 'DB_POOL_EMPTY', scenario },
        { status: 503 }
      );
    }

    case 'be-timeout': {
      const errMessage = 'Gateway Timeout: Upstream catalog service failed to respond within SLA window (504).';
      const stack = `GatewayTimeout: Upstream SLA exceeded\n    at HttpClient.fetchWithTimeout (src/lib/fetcher.ts:42:19)\n    at CatalogService.getSnapshot (src/catalog/service.ts:112:8)`;

      await sendCrashReport({
        errorType: 'GatewayTimeout',
        message: errMessage,
        stackTrace: stack,
        url: `${targetBase}/api/engine`,
        httpStatus: 504,
        botId,
        sessionId,
        severityHint: 'critical',
      });

      return NextResponse.json(
        { error: errMessage, code: 'GATEWAY_TIMEOUT', scenario },
        { status: 504 }
      );
    }

    case 'be-null-pointer': {
      const errMessage = "TypeError: Cannot read properties of undefined (reading 'hashedToken') in AuthSessionManager";
      const stack = `TypeError: ${errMessage}\n    at AuthSessionManager.validateToken (src/auth/session.ts:88:22)\n    at handleChaos (/api/chaos/route.ts:92:15)`;

      await sendCrashReport({
        errorType: 'TypeError',
        message: errMessage,
        stackTrace: stack,
        url: `${targetBase}/api/auth/verify`,
        httpStatus: 500,
        botId,
        sessionId,
        severityHint: 'high',
      });

      return NextResponse.json(
        { error: errMessage, code: 'NULL_POINTER_EXCEPTION', scenario },
        { status: 500 }
      );
    }

    case 'be-unhandled-exception': {
      const errMessage = 'UnhandledDomainException: FraudCheckService returned unexpected verification state code 998';
      const stack = `UnhandledDomainException: ${errMessage}\n    at FraudCheckService.verifyTransaction (src/services/fraud.ts:47:13)\n    at handleChaos (/api/chaos/route.ts:110:15)`;

      await sendCrashReport({
        errorType: 'UnhandledDomainException',
        message: errMessage,
        stackTrace: stack,
        url: `${targetBase}/api/checkout/fraud-check`,
        httpStatus: 500,
        botId,
        sessionId,
        severityHint: 'high',
      });

      return NextResponse.json(
        { error: errMessage, code: 'UNHANDLED_EXCEPTION', scenario },
        { status: 500 }
      );
    }

    case 'be-oom-simulation': {
      for (let i = 0; i < 20; i++) {
        serverMemoryStore.push(new Array(50000).fill('server_oom_alloc_' + Math.random()));
      }
      if (serverMemoryStore.length > 200) {
        serverMemoryStore.splice(0, 100);
      }

      const errMessage = 'OutOfMemoryError: JavaScript heap out of memory in Vercel Edge compute (Heap Limit: 512 MB)';
      const stack = `OutOfMemoryError: ${errMessage}\n    at BufferPool.allocateChunk (src/memory/allocator.ts:31:9)\n    at handleChaos (/api/chaos/route.ts:133:15)`;

      await sendCrashReport({
        errorType: 'OutOfMemoryError',
        message: errMessage,
        stackTrace: stack,
        url: `${targetBase}/api/engine`,
        httpStatus: 500,
        botId,
        sessionId,
        severityHint: 'critical',
      });

      return NextResponse.json(
        { error: errMessage, code: 'OUT_OF_MEMORY', scenario, retainedChunks: serverMemoryStore.length },
        { status: 500 }
      );
    }

    case 'be-malformed-input': {
      const errMessage = 'BadRequestError: Invalid encoding or malformed JSON payload structure received.';
      await sendCrashReport({
        errorType: 'BadRequestError',
        message: errMessage,
        url: `${targetBase}/api/engine`,
        httpStatus: 400,
        botId,
        sessionId,
        severityHint: 'medium',
      });

      return NextResponse.json(
        { error: errMessage, code: 'MALFORMED_INPUT' },
        { status: 400 }
      );
    }

    case 'net-5xx': {
      const errMessage = 'HTTP 502 Bad Gateway: Downstream order service upstream proxy returned invalid response.';
      await sendCrashReport({
        errorType: 'HTTP_502',
        message: errMessage,
        url: `${targetBase}/api/engine`,
        httpStatus: 502,
        botId,
        sessionId,
        severityHint: 'critical',
      });

      return NextResponse.json(
        { error: errMessage, code: 'BAD_GATEWAY' },
        { status: 502 }
      );
    }

    case 'net-rate-limit': {
      const now = Date.now();
      if (now - lastReset > 10000) {
        simulatedRequestCount = 0;
        lastReset = now;
      }
      simulatedRequestCount++;

      const errMessage = 'HTTP 429 Too Many Requests: Rate limit exceeded (Threshold: 250 req/sec from bot fleet).';
      await sendCrashReport({
        errorType: 'HTTP_429',
        message: errMessage,
        url: `${targetBase}/`,
        httpStatus: 429,
        botId,
        sessionId,
        severityHint: 'high',
      });

      return NextResponse.json(
        { error: errMessage, code: 'RATE_LIMIT_EXCEEDED', retryAfter: 10 },
        {
          status: 429,
          headers: { 'Retry-After': '10' },
        }
      );
    }

    default:
      return NextResponse.json(
        { error: `Unknown chaos scenario: ${scenario}` },
        { status: 400 }
      );
  }
}
