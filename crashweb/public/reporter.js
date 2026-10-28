/**
 * CrashWeb Lightweight Reporter SDK (Standalone Browser Build)
 * Self-initializing error reporter with fetch/XHR interceptors.
 */
(function (window) {
  if (typeof window === 'undefined' || window.__CrashWebReporterLoaded) return;
  window.__CrashWebReporterLoaded = true;

  var serverUrl = window.__MONITOR_URL || 'http://localhost:8000';
  var projectId = window.__PROJECT_ID || 'proj_crashweb_01';
  var apiKey = window.__PROJECT_KEY || 'key_live_crashweb_2026';

  var recentCount = 0;
  var lastWindow = Date.now();
  var seen = {};

  function isLimited(msg, url) {
    var now = Date.now();
    if (now - lastWindow > 5000) {
      recentCount = 0;
      lastWindow = now;
      seen = {};
    }
    if (recentCount >= 25) return true;
    var k = url + ':' + (msg || '').substring(0, 100);
    if (seen[k] && now - seen[k] < 2000) return true;
    seen[k] = now;
    recentCount++;
    return false;
  }

  function getBrowserOS() {
    var ua = navigator.userAgent || '';
    var b = 'Chrome', os = 'Windows';
    if (/Firefox/i.test(ua)) b = 'Firefox';
    else if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) b = 'Safari';
    else if (/Edg/i.test(ua)) b = 'Edge';
    if (/Mac/i.test(ua)) os = 'macOS';
    else if (/Linux/i.test(ua)) os = 'Linux';
    else if (/iPhone|iPad/i.test(ua)) os = 'iOS';
    return { browser: b, os: os };
  }

  function getSession() {
    try {
      var s = window.sessionStorage.getItem('zon_session_id');
      if (!s) {
        s = 'sess_' + Math.random().toString(36).substring(2, 9);
        window.sessionStorage.setItem('zon_session_id', s);
      }
      return s;
    } catch (e) {
      return 'sess_fallback';
    }
  }

  function getBot() {
    try {
      var p = new URLSearchParams(window.location.search);
      return p.get('botId') || window.sessionStorage.getItem('zon_bot_id') || undefined;
    } catch (e) {
      return undefined;
    }
  }

  function sendReport(data) {
    try {
      var msg = data.message || 'Unknown error';
      var url = data.url || window.location.href;
      if (url.indexOf('/api/crashes') !== -1 || msg.indexOf('api/crashes') !== -1) return;
      if (isLimited(msg, url)) return;

      var bo = getBrowserOS();
      var payload = {
        projectId: projectId,
        timestamp: data.timestamp || new Date().toISOString(),
        errorType: data.errorType || 'Error',
        message: msg,
        stackTrace: data.stackTrace || '',
        url: url,
        httpStatus: data.httpStatus,
        userAgent: navigator.userAgent,
        browser: data.browser || bo.browser,
        os: data.os || bo.os,
        sessionId: data.sessionId || getSession(),
        botId: data.botId || getBot(),
        severityHint: data.severityHint || 'medium',
        environment: 'development',
        metadata: data.metadata || {}
      };

      var endpoint = serverUrl.replace(/\/+$/, '') + '/api/crashes';
      var str = JSON.stringify(payload);

      if (navigator.sendBeacon) {
        var blob = new Blob([str], { type: 'application/json' });
        if (navigator.sendBeacon(endpoint, blob)) return;
      }

      var xhr = new XMLHttpRequest();
      xhr.open('POST', endpoint, true);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.setRequestHeader('X-Project-Key', apiKey);
      xhr.send(str);
    } catch (err) {
      // Never crash host
    }
  }

  window.__reportCrash = sendReport;

  // Window error handler
  window.addEventListener('error', function (e) {
    try {
      var target = e.target;
      if (target && (target.tagName === 'IMG' || target.tagName === 'SCRIPT' || target.tagName === 'LINK')) {
        var src = target.src || target.href || '';
        sendReport({
          errorType: 'ResourceLoadError',
          message: 'Failed to load resource: <' + target.tagName.toLowerCase() + '> at ' + src,
          severityHint: 'medium',
          metadata: { tagName: target.tagName, resourceUrl: src }
        });
        return;
      }
      var err = e.error;
      sendReport({
        errorType: (err && err.name) || 'UncaughtException',
        message: (err && err.message) || e.message || 'Script error',
        stackTrace: (err && err.stack) || ('at ' + e.filename + ':' + e.lineno + ':' + e.colno),
        severityHint: 'high'
      });
    } catch (ignore) {}
  }, true);

  // Unhandled promise rejection
  window.addEventListener('unhandledrejection', function (e) {
    try {
      var r = e.reason;
      var msg = (r && r.message) || (typeof r === 'string' ? r : 'Unhandled Promise Rejection');
      var stack = (r && r.stack) || '';
      sendReport({
        errorType: (r && r.name) || 'UnhandledRejection',
        message: msg,
        stackTrace: stack,
        severityHint: 'high'
      });
    } catch (ignore) {}
  });

  // Intercept fetch
  var origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function () {
      var args = arguments;
      var input = args[0];
      var u = typeof input === 'string' ? input : (input && input.url) || '';
      if (u.indexOf('/api/crashes') !== -1 || u.indexOf(serverUrl) !== -1) {
        return origFetch.apply(this, args);
      }
      return origFetch.apply(this, args).then(function (res) {
        if (!res.ok) {
          sendReport({
            errorType: 'HTTP_' + res.status,
            message: 'HTTP ' + res.status + ' ' + (res.statusText || '') + ' on ' + u,
            httpStatus: res.status,
            severityHint: res.status >= 500 ? 'critical' : res.status === 429 ? 'high' : 'medium'
          });
        }
        return res;
      }).catch(function (netErr) {
        sendReport({
          errorType: 'NetworkError',
          message: (netErr && netErr.message) || ('Failed to fetch ' + u),
          stackTrace: (netErr && netErr.stack) || '',
          severityHint: 'high'
        });
        throw netErr;
      });
    };
  }
})(typeof window !== 'undefined' ? window : this);

