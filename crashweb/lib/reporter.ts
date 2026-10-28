/**
 * Lightweight Reporter SDK for CrashWeb
 * Captures frontend & backend errors and dispatches structured reports
 * to the Hackmitten Monitoring Server.
 *
 * Guarantees:
 * 1. Never crashes the host application.
 * 2. Never creates recursive reporting loops.
 * 3. Rate-limited and deduplicated in memory.
 */

export interface CrashReportPayload {
  projectId: string;
  timestamp: string;
  errorType: string;
  message: string;
  stackTrace?: string;
  url: string;
  httpStatus?: number;
  userAgent?: string;
  browser?: string;
  os?: string;
  sessionId?: string;
  botId?: string;
  severityHint?: 'low' | 'medium' | 'high' | 'critical';
  environment?: string;
  metadata?: Record<string, any>;
}

export interface ReporterConfig {
  serverUrl?: string;
  projectId?: string;
  apiKey?: string;
  environment?: string;
  sampleRate?: number;
}

const DEFAULT_SERVER_URL =
  process.env.NEXT_PUBLIC_MONITORING_SERVER_URL ||
  process.env.MONITORING_SERVER_URL ||
  'http://localhost:8000';

const DEFAULT_PROJECT_ID =
  process.env.NEXT_PUBLIC_PROJECT_ID ||
  process.env.MONITORING_PROJECT_ID ||
  'proj_crashweb_01';

const DEFAULT_API_KEY =
  process.env.NEXT_PUBLIC_API_KEY ||
  process.env.MONITORING_API_KEY ||
  'key_live_crashweb_2026';

// Client-side rate-limiting and loop protection
let recentReportsCount = 0;
let lastResetTime = Date.now();
const MAX_REPORTS_PER_WINDOW = 25;
const RATE_WINDOW_MS = 5000;
const seenFingerprints = new Map<string, number>();

function isRateLimited(message: string, url: string): boolean {
  const now = Date.now();
  if (now - lastResetTime > RATE_WINDOW_MS) {
    recentReportsCount = 0;
    lastResetTime = now;
    seenFingerprints.clear();
  }

  if (recentReportsCount >= MAX_REPORTS_PER_WINDOW) {
    return true;
  }

  // Deduplicate identical errors occurring within 2 seconds
  const key = `${url}:${message.slice(0, 100)}`;
  const lastSeen = seenFingerprints.get(key);
  if (lastSeen && now - lastSeen < 2000) {
    return true;
  }

  seenFingerprints.set(key, now);
  recentReportsCount++;
  return false;
}

function parseBrowserAndOS(ua: string): { browser: string; os: string } {
  let browser = 'Unknown Browser';
  let os = 'Unknown OS';

  if (!ua) return { browser, os };

  if (/Windows/i.test(ua)) os = 'Windows';
  else if (/Macintosh|Mac OS X/i.test(ua)) os = 'macOS';
  else if (/Linux/i.test(ua)) os = 'Linux';
  else if (/Android/i.test(ua)) os = 'Android';
  else if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS';

  if (/Edg\//i.test(ua)) browser = 'Edge';
  else if (/Chrome\//i.test(ua)) browser = 'Chrome';
  else if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) browser = 'Safari';
  else if (/Firefox\//i.test(ua)) browser = 'Firefox';
  else if (/curl|python|node|playwright|puppeteer/i.test(ua)) browser = 'Bot/Automated';

  return { browser, os };
}

function getSessionId(): string {
  if (typeof window === 'undefined') return 'server_session';
  try {
    let sid = window.sessionStorage.getItem('zon_session_id');
    if (!sid) {
      sid = 'sess_' + Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
      window.sessionStorage.setItem('zon_session_id', sid);
    }
    return sid;
  } catch {
    return 'sess_fallback_' + Date.now();
  }
}

function getBotId(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const params = new URLSearchParams(window.location.search);
    const botId = params.get('botId') || window.sessionStorage.getItem('zon_bot_id');
    if (botId) {
      window.sessionStorage.setItem('zon_bot_id', botId);
      return botId;
    }
  } catch {
    // ignore
  }
  return undefined;
}

export async function sendCrashReport(
  payload: Partial<CrashReportPayload>,
  config?: ReporterConfig
): Promise<boolean> {
  try {
    const serverUrl = config?.serverUrl || DEFAULT_SERVER_URL;
    const projectId = config?.projectId || DEFAULT_PROJECT_ID;
    const apiKey = config?.apiKey || DEFAULT_API_KEY;

    const message = payload.message || 'Unknown error occurred';
    const currentUrl =
      payload.url || (typeof window !== 'undefined' ? window.location.href : '/server');

    // Never report errors resulting from the reporter itself
    if (currentUrl.includes('/api/crashes') || message.includes('api/crashes')) {
      return false;
    }

    if (isRateLimited(message, currentUrl)) {
      return false;
    }

    const ua =
      payload.userAgent || (typeof navigator !== 'undefined' ? navigator.userAgent : 'Server/Node');
    const { browser, os } = parseBrowserAndOS(ua);

    const fullPayload: CrashReportPayload = {
      projectId,
      timestamp: payload.timestamp || new Date().toISOString(),
      errorType: payload.errorType || 'Error',
      message,
      stackTrace: payload.stackTrace || '',
      url: currentUrl,
      httpStatus: payload.httpStatus,
      userAgent: ua,
      browser: payload.browser || browser,
      os: payload.os || os,
      sessionId: payload.sessionId || getSessionId(),
      botId: payload.botId || getBotId(),
      severityHint: payload.severityHint || 'medium',
      environment:
        payload.environment ||
        config?.environment ||
        process.env.NODE_ENV ||
        'development',
      metadata: payload.metadata || {},
    };

    const endpoint = `${serverUrl.replace(/\/+$/, '')}/api/crashes`;
    const jsonBody = JSON.stringify(fullPayload);

    // Prefer fetch with keepalive or beacon
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const blob = new Blob([jsonBody], { type: 'application/json' });
      const sent = navigator.sendBeacon(endpoint, blob);
      if (sent) return true;
    }

    // Fallback to fetch
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Project-Key': apiKey,
      },
      body: jsonBody,
      keepalive: true,
      // Short timeout to avoid hanging if server is busy
      signal: AbortSignal.timeout ? AbortSignal.timeout(3000) : undefined,
    });

    return response.ok;
  } catch (err) {
    // Fail silently: reporter must NEVER crash the application
    return false;
  }
}

let initialized = false;

/**
 * Initializes frontend browser error listeners and network interceptors.
 */
export function initBrowserReporter(config?: ReporterConfig) {
  if (typeof window === 'undefined' || initialized) return;
  initialized = true;

  const serverUrl = config?.serverUrl || DEFAULT_SERVER_URL;

  // 1. Uncaught JS exceptions
  window.addEventListener('error', (event: ErrorEvent) => {
    try {
      // Check if target is an HTMLElement (resource loading error)
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'IMG' || target.tagName === 'SCRIPT' || target.tagName === 'LINK')) {
        const resourceUrl = (target as HTMLImageElement).src || (target as HTMLLinkElement).href || '';
        sendCrashReport(
          {
            errorType: 'ResourceLoadError',
            message: `Failed to load resource: <${target.tagName.toLowerCase()}> at ${resourceUrl || 'unknown path'}`,
            url: window.location.href,
            severityHint: 'medium',
            metadata: { tagName: target.tagName, resourceUrl },
          },
          config
        );
        return;
      }

      const error = event.error;
      const message = error?.message || event.message || 'Script error';
      const stack = error?.stack || `at ${event.filename}:${event.lineno}:${event.colno}`;

      sendCrashReport(
        {
          errorType: error?.name || 'UncaughtException',
          message,
          stackTrace: stack,
          url: window.location.href,
          severityHint: 'high',
        },
        config
      );
    } catch {
      // Safe noop
    }
  }, true); // Use capture phase so resource load errors are captured

  // 2. Unhandled Promise Rejections
  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    try {
      const reason = event.reason;
      let message = 'Unhandled Promise Rejection';
      let stackTrace = '';
      let errorType = 'UnhandledRejection';

      if (reason instanceof Error) {
        message = reason.message;
        stackTrace = reason.stack || '';
        errorType = reason.name || errorType;
      } else if (typeof reason === 'string') {
        message = reason;
      } else if (reason && typeof reason === 'object') {
        message = (reason as any).message || JSON.stringify(reason);
      }

      sendCrashReport(
        {
          errorType,
          message,
          stackTrace,
          url: window.location.href,
          severityHint: 'high',
        },
        config
      );
    } catch {
      // Safe noop
    }
  });

  // 3. Global Fetch Interceptor
  const originalFetch = window.fetch;
  window.fetch = async function (...args: Parameters<typeof originalFetch>) {
    const input = args[0];
    const urlString =
      typeof input === 'string'
        ? input
        : input instanceof URL
        ? input.toString()
        : (input as Request)?.url || '';

    // NEVER intercept calls to the crash reporting API
    if (urlString.includes('/api/crashes') || urlString.includes(serverUrl)) {
      return originalFetch.apply(this, args);
    }

    try {
      const response = await originalFetch.apply(this, args);

      // Report 4xx and 5xx HTTP responses
      if (!response.ok) {
        const severity: CrashReportPayload['severityHint'] =
          response.status >= 500 ? 'critical' : response.status === 429 ? 'high' : 'medium';

        sendCrashReport(
          {
            errorType: `HTTP_${response.status}`,
            message: `HTTP ${response.status} ${response.statusText || 'Error'} on ${urlString}`,
            url: window.location.href,
            httpStatus: response.status,
            severityHint: severity,
            metadata: {
              requestUrl: urlString,
              statusText: response.statusText,
            },
          },
          config
        );
      }

      return response;
    } catch (fetchError: any) {
      // Network error, aborted request, or CORS failure
      sendCrashReport(
        {
          errorType: 'NetworkError',
          message: fetchError?.message || `Failed to fetch from ${urlString}`,
          stackTrace: fetchError?.stack || '',
          url: window.location.href,
          severityHint: 'high',
          metadata: {
            requestUrl: urlString,
            networkFailure: true,
          },
        },
        config
      );
      throw fetchError;
    }
  };

  // 4. XMLHttpRequest Interceptor
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (this: any, ...args: any[]) {
    this.__reqUrl = args[1];
    return originalOpen.apply(this, args as any);
  };

  XMLHttpRequest.prototype.send = function (this: any, ...args: any[]) {
    const xhrUrl = this.__reqUrl || '';
    if (!xhrUrl.includes('/api/crashes') && !xhrUrl.includes(serverUrl)) {
      this.addEventListener('error', () => {
        sendCrashReport(
          {
            errorType: 'XHRError',
            message: `XMLHttpRequest network failure on ${xhrUrl}`,
            url: window.location.href,
            severityHint: 'high',
            metadata: { requestUrl: xhrUrl },
          },
          config
        );
      });

      this.addEventListener('load', () => {
        if (this.status >= 400) {
          sendCrashReport(
            {
              errorType: `XHR_HTTP_${this.status}`,
              message: `XHR HTTP ${this.status} on ${xhrUrl}`,
              url: window.location.href,
              httpStatus: this.status,
              severityHint: this.status >= 500 ? 'critical' : 'medium',
              metadata: { requestUrl: xhrUrl },
            },
            config
          );
        }
      });
    }
    return originalSend.apply(this, args as any);
  };
}

