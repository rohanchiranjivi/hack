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
  const scenario = searchParams.get('scenario') || 'be-http-500';
  const botId = searchParams.get('botId') || req.headers.get('x-bot-id') || undefined;
  const sessionId = searchParams.get('sessionId') || req.headers.get('x-session-id') || undefined;

  const url = req.url;

  switch (scenario) {
    case 'be-http-500': {
      const errMessage = 'Internal Server Error: Database transaction deadlock detected on Zon inventory commit.';
      const stack = `Error: ${errMessage}\n    at InventoryManager.commitStock (src/inventory/stock.ts:182:19)\n    at OrderEngine.processOrder (src/engine/processor.ts:94:12)\n    at handleChaos (/api/chaos/route.ts:42:15)`;

      await sendCrashReport({
        errorType: 'InternalServerError',
        message: errMessage,
        stackTrace: stack,
        url: '/api/chaos?scenario=be-http-500',
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
        url: '/api/chaos?scenario=be-db-pool-exhausted',
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
      // Simulate hanging server that exceeds client timeout
      await new Promise((resolve) => setTimeout(resolve, 4500));

      const errMessage = 'Gateway Timeout: Upstream catalog service failed to respond within SLA window.';
      await sendCrashReport({
        errorType: 'GatewayTimeout',
        message: errMessage,
        url: '/api/chaos?scenario=be-timeout',
        httpStatus: 504,
        botId,
        sessionId,
        severityHint: 'high',
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
        url: '/api/chaos?scenario=be-null-pointer',
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
        url: '/api/chaos?scenario=be-unhandled-exception',
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
      // Allocate simulated server memory pressure
      for (let i = 0; i < 20; i++) {
        serverMemoryStore.push(new Array(50000).fill('server_oom_alloc_' + Math.random()));
      }
      if (serverMemoryStore.length > 200) {
        serverMemoryStore.splice(0, 100); // keep bounded so process doesn't truly crash host
      }

      const errMessage = 'OutOfMemoryError: JavaScript heap out of memory or approaching limit (Simulated)';
      const stack = `OutOfMemoryError: ${errMessage}\n    at BufferPool.allocateChunk (src/memory/allocator.ts:31:9)\n    at handleChaos (/api/chaos/route.ts:133:15)`;

      await sendCrashReport({
        errorType: 'OutOfMemoryError',
        message: errMessage,
        stackTrace: stack,
        url: '/api/chaos?scenario=be-oom-simulation',
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

    case 'be-slow-endpoint': {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      return NextResponse.json({
        ok: true,
        message: 'Endpoint completed after 3000ms artificial latency delay.',
        latency: 3000,
      });
    }

    case 'be-malformed-input': {
      const errMessage = 'BadRequestError: Invalid encoding or malformed JSON payload structure received.';
      await sendCrashReport({
        errorType: 'BadRequestError',
        message: errMessage,
        url: '/api/chaos?scenario=be-malformed-input',
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

    // Network Scenarios
    case 'net-4xx': {
      const errMessage = 'HTTP 404: The requested resource /api/v1/user/payment-methods was not found.';
      await sendCrashReport({
        errorType: 'HTTP_404',
        message: errMessage,
        url: '/api/chaos?scenario=net-4xx',
        httpStatus: 404,
        botId,
        sessionId,
        severityHint: 'medium',
      });

      return NextResponse.json(
        { error: errMessage, code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    case 'net-5xx': {
      const errMessage = 'HTTP 502 Bad Gateway: Downstream order service upstream proxy returned invalid response.';
      await sendCrashReport({
        errorType: 'HTTP_502',
        message: errMessage,
        url: '/api/chaos?scenario=net-5xx',
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

    case 'net-cors': {
      const response = NextResponse.json(
        { error: 'CORS header mismatch: Origin not allowed.' },
        { status: 403 }
      );
      // Explicitly reject origin
      response.headers.set('Access-Control-Allow-Origin', 'null');
      return response;
    }

    case 'net-rate-limit': {
      const now = Date.now();
      if (now - lastReset > 10000) {
        simulatedRequestCount = 0;
        lastReset = now;
      }
      simulatedRequestCount++;

      const errMessage = 'HTTP 429 Too Many Requests: Rate limit exceeded (Threshold: 5 req/10s).';
      await sendCrashReport({
        errorType: 'HTTP_429',
        message: errMessage,
        url: '/api/chaos?scenario=net-rate-limit',
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

