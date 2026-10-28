/**
 * Chaos Engineering Module for CrashWeb
 * Provides realistic frontend, backend, and network failure scenarios.
 */

// Global buffer for memory leak simulation
const globalMemoryLeakStore: any[] = [];

export interface ChaosScenario {
  id: string;
  name: string;
  category: 'frontend' | 'backend' | 'network';
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export const CHAOS_SCENARIOS: ChaosScenario[] = [
  // Frontend
  {
    id: 'fe-uncaught-exception',
    name: 'Uncaught JS Exception',
    category: 'frontend',
    description: 'Throws a synchronous Error outside of a try/catch boundary in the event loop.',
    severity: 'high',
  },
  {
    id: 'fe-unhandled-rejection',
    name: 'Unhandled Promise Rejection',
    category: 'frontend',
    description: 'Rejects an asynchronous promise without a catch handler.',
    severity: 'high',
  },
  {
    id: 'fe-null-dereference',
    name: 'Null / Undefined Property Access',
    category: 'frontend',
    description: 'Attempts to read properties of undefined or null object (TypeError).',
    severity: 'critical',
  },
  {
    id: 'fe-ui-freeze',
    name: 'Infinite Loop / UI Freeze',
    category: 'frontend',
    description: 'Runs a heavy synchronous computational loop that blocks the event loop.',
    severity: 'high',
  },
  {
    id: 'fe-memory-leak',
    name: 'Browser Memory Leak',
    category: 'frontend',
    description: 'Allocates large continuous chunks of data in memory that are never garbage-collected.',
    severity: 'high',
  },
  {
    id: 'fe-broken-network',
    name: 'Broken Network Call',
    category: 'frontend',
    description: 'Attempts to fetch from an unreachable or nonexistent local endpoint.',
    severity: 'medium',
  },
  {
    id: 'fe-failed-resource',
    name: 'Failed Resource Load (404 Assets)',
    category: 'frontend',
    description: 'Injects broken <img> and <script> tags pointing to non-existent assets.',
    severity: 'medium',
  },
  {
    id: 'fe-invalid-json',
    name: 'Invalid JSON Parse',
    category: 'frontend',
    description: 'Executes JSON.parse() on malformed or truncated payload strings.',
    severity: 'medium',
  },
  {
    id: 'fe-render-error',
    name: 'React / DOM Render Error',
    category: 'frontend',
    description: 'Forces a React component to throw an exception during component render.',
    severity: 'critical',
  },

  // Backend
  {
    id: 'be-storage-503',
    name: 'Persistent Storage Failure (Vercel 503)',
    category: 'backend',
    description: 'Triggers the exact 503 STORAGE_NOT_CONFIGURED failure currently occurring on the Vercel site.',
    severity: 'critical',
  },
  {
    id: 'be-http-500',
    name: 'Backend HTTP 500 Internal Error',
    category: 'backend',
    description: 'Server throws an unhandled internal exception during request processing.',
    severity: 'high',
  },
  {
    id: 'be-db-pool-exhausted',
    name: 'Database Connection Pool Failure',
    category: 'backend',
    description: 'Simulates connection pool depletion where all database connections hang or timeout.',
    severity: 'critical',
  },
  {
    id: 'be-timeout',
    name: 'Server Request Timeout',
    category: 'backend',
    description: 'Backend hangs processing request until client or gateway times out (504).',
    severity: 'high',
  },
  {
    id: 'be-null-pointer',
    name: 'Backend Null Pointer / TypeError',
    category: 'backend',
    description: 'Backend attempts to access property on null session or user object.',
    severity: 'high',
  },
  {
    id: 'be-unhandled-exception',
    name: 'Unhandled Backend Exception',
    category: 'backend',
    description: 'Throws an unhandled DomainLogicError in the backend business layer.',
    severity: 'high',
  },
  {
    id: 'be-oom-simulation',
    name: 'Backend Out-Of-Memory Simulation',
    category: 'backend',
    description: 'Backend generates excessive buffer allocations simulating heap pressure.',
    severity: 'critical',
  },
  {
    id: 'be-slow-endpoint',
    name: 'Degraded / Slow Endpoint (5s Latency)',
    category: 'backend',
    description: 'Artificially delays backend response by 5 seconds to simulate extreme latency.',
    severity: 'medium',
  },
  {
    id: 'be-malformed-input',
    name: 'Malformed Input Processing',
    category: 'backend',
    description: 'Sends corrupt binary or malformed payload to backend triggering 400/500.',
    severity: 'medium',
  },

  // Network
  {
    id: 'net-4xx',
    name: 'Client Error (HTTP 400 / 404 / 403)',
    category: 'network',
    description: 'Triggers client-side request errors with bad request bodies or invalid routes.',
    severity: 'medium',
  },
  {
    id: 'net-5xx',
    name: 'Server Error (HTTP 502 / 503 / 504)',
    category: 'network',
    description: 'Returns bad gateway or gateway timeout responses from upstream services.',
    severity: 'high',
  },
  {
    id: 'net-cors',
    name: 'CORS Policy Block',
    category: 'network',
    description: 'Triggers browser cross-origin resource sharing restriction failure.',
    severity: 'medium',
  },
  {
    id: 'net-rate-limit',
    name: 'Rate Limit (HTTP 429)',
    category: 'network',
    description: 'Simulates rate limit throttling with HTTP 429 Too Many Requests.',
    severity: 'high',
  },
];

/**
 * Triggers client-side chaos directly in the browser.
 */
export function executeFrontendChaos(scenarioId: string): { success: boolean; message: string } {
  if (typeof window === 'undefined') {
    return { success: false, message: 'Frontend chaos can only execute in browser' };
  }

  switch (scenarioId) {
    case 'fe-uncaught-exception': {
      setTimeout(() => {
        throw new Error('UncaughtError: Payment verification hash mismatch at checkout (ZonClient runtime).');
      }, 50);
      return { success: true, message: 'Uncaught JS exception scheduled on next tick.' };
    }

    case 'fe-unhandled-rejection': {
      Promise.reject(
        new Error('UnhandledPromiseRejection: Session token synchronization rejected by remote peer.')
      );
      return { success: true, message: 'Unhandled Promise Rejection dispatched.' };
    }

    case 'fe-null-dereference': {
      setTimeout(() => {
        const nullUser: any = null;
        console.log(nullUser.profile.preferences.currency);
      }, 50);
      return { success: true, message: 'Null dereference TypeError triggered.' };
    }

    case 'fe-ui-freeze': {
      const start = Date.now();
      // Freeze for 1.8 seconds synchronously
      while (Date.now() - start < 1800) {
        Math.sqrt(Math.random() * 1000);
      }
      return { success: true, message: 'Synchronous loop executed, event loop unblocked.' };
    }

    case 'fe-memory-leak': {
      for (let i = 0; i < 50; i++) {
        globalMemoryLeakStore.push(new Array(100000).fill('zon_leak_' + Math.random()));
      }
      // Report a memory pressure warning
      if ((window as any).__reportCrash) {
        (window as any).__reportCrash({
          errorType: 'MemoryLeakWarning',
          message: `Memory leak detected: heap buffer increased by 50MB (Retained allocations: ${globalMemoryLeakStore.length} chunks)`,
          severityHint: 'high',
        });
      }
      return {
        success: true,
        message: `Allocated memory chunks. Retained chunks: ${globalMemoryLeakStore.length}`,
      };
    }

    case 'fe-broken-network': {
      fetch('/api/non-existent-endpoint-' + Date.now()).catch(() => {});
      return { success: true, message: 'Fetch to non-existent endpoint dispatched.' };
    }

    case 'fe-failed-resource': {
      const brokenImg = document.createElement('img');
      brokenImg.src = `/assets/missing-banner-${Date.now()}.png`;
      brokenImg.style.display = 'none';
      document.body.appendChild(brokenImg);
      setTimeout(() => brokenImg.remove(), 2000);
      return { success: true, message: 'Injected broken image asset tag.' };
    }

    case 'fe-invalid-json': {
      setTimeout(() => {
        try {
          JSON.parse('{"orderId": 99281, "status": "incomplete", items: [');
        } catch (e: any) {
          if ((window as any).__reportCrash) {
            (window as any).__reportCrash({
              errorType: 'SyntaxError',
              message: `JSON.parse failed: ${e.message}`,
              stackTrace: e.stack,
              severityHint: 'medium',
            });
          }
          throw e;
        }
      }, 50);
      return { success: true, message: 'Invalid JSON parsing scheduled.' };
    }

    default:
      return { success: false, message: `Unknown scenario: ${scenarioId}` };
  }
}

