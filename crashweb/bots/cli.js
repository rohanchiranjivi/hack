#!/usr/bin/env node

/**
 * CrashWeb CLI Bot Runner
 *
 * Usage:
 *   node bots/cli.js
 *   BOT_COUNT=5 MODE=stress TARGET_URL=http://localhost:3000 node bots/cli.js
 *   node bots/cli.js --count 4 --mode targeted --scenario be-db-pool-exhausted
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

const args = process.argv.slice(2);
function getArg(name, envVal, defaultVal) {
  const flag = `--${name}`;
  const idx = args.indexOf(flag);
  if (idx !== -1 && args[idx + 1]) {
    return args[idx + 1];
  }
  return process.env[envVal] || defaultVal;
}

const targetUrl = getArg('target', 'TARGET_URL', 'http://localhost:3000');
const botCount = parseInt(getArg('count', 'BOT_COUNT', '3'), 10);
const intervalMs = parseInt(getArg('interval', 'INTERVAL', '1200'), 10);
const mode = getArg('mode', 'MODE', 'random');
const targetedScenario = getArg('scenario', 'TARGETED_CRASH', 'be-db-pool-exhausted');

// Strict Allowlist check
const ALLOWED_HOSTS = ['localhost', '127.0.0.1', '0.0.0.0', '::1'];
try {
  const parsed = new URL(targetUrl);
  if (!ALLOWED_HOSTS.includes(parsed.hostname)) {
    console.error(`\x1b[31m[SECURITY REJECTION] Target host "${parsed.hostname}" is NOT allowed.\x1b[0m`);
    console.error(`Bots are strictly confined to CrashWeb instances on: ${ALLOWED_HOSTS.join(', ')}`);
    process.exit(1);
  }
} catch (e) {
  console.error(`Invalid TARGET_URL: ${e.message}`);
  process.exit(1);
}

console.log('\x1b[36m%s\x1b[0m', '=====================================================');
console.log('\x1b[1m\x1b[33m   CRASHWEB AUTOMATED BOT RUNNER (CHAOS SIMULATOR)   \x1b[0m');
console.log('\x1b[36m%s\x1b[0m', '=====================================================');
console.log(` Target URL : \x1b[32m${targetUrl}\x1b[0m`);
console.log(` Bots Count : \x1b[35m${botCount}\x1b[0m`);
console.log(` Interval   : \x1b[35m${intervalMs} ms\x1b[0m`);
console.log(` Mode       : \x1b[33m${mode.toUpperCase()}\x1b[0m`);
if (mode === 'targeted') {
  console.log(` Scenario   : \x1b[31m${targetedScenario}\x1b[0m`);
}
console.log('\x1b[90mPress Ctrl+C to stop the bots at any time.\x1b[0m\n');

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0.0.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7) Safari/605.1.15',
  'Mozilla/5.0 (X11; Ubuntu; Linux x86_64) Firefox/132.0',
];

const SCENARIOS = [
  'be-http-500',
  'be-db-pool-exhausted',
  'be-timeout',
  'be-null-pointer',
  'be-unhandled-exception',
  'be-oom-simulation',
  'net-4xx',
  'net-5xx',
  'net-rate-limit',
];

let totalRequests = 0;
let totalCrashes = 0;

function sendHttpRequest(urlStr, method, headers, postData) {
  return new Promise((resolve) => {
    try {
      const u = new URL(urlStr);
      const isHttps = u.protocol === 'https:';
      const client = isHttps ? https : http;

      const opts = {
        hostname: u.hostname,
        port: u.port || (isHttps ? 443 : 80),
        path: u.pathname + u.search,
        method: method || 'GET',
        headers: headers || {},
        timeout: 4000,
      };

      const req = client.request(opts, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({ status: 504, timeout: true });
      });

      req.on('error', (err) => {
        resolve({ status: 0, error: err.message });
      });

      if (postData) {
        req.write(postData);
      }
      req.end();
    } catch (e) {
      resolve({ status: 0, error: e.message });
    }
  });
}

async function runBot(botIndex) {
  const botId = `cli-bot-${botIndex + 1}`;
  const ua = USER_AGENTS[botIndex % USER_AGENTS.length];
  const sessionId = `cli_sess_${Math.random().toString(36).substring(2, 9)}`;

  while (true) {
    let shouldCrash = false;
    if (mode === 'gentle') shouldCrash = Math.random() < 0.1;
    else if (mode === 'random') shouldCrash = Math.random() < 0.5;
    else if (mode === 'stress') shouldCrash = Math.random() < 0.9;
    else if (mode === 'targeted') shouldCrash = true;

    totalRequests++;

    if (shouldCrash) {
      const scenario =
        mode === 'targeted'
          ? targetedScenario
          : SCENARIOS[Math.floor(Math.random() * SCENARIOS.length)];

      const crashUrl = `${targetUrl}/api/chaos?scenario=${scenario}&botId=${botId}&sessionId=${sessionId}`;
      const res = await sendHttpRequest(crashUrl, 'GET', {
        'User-Agent': ua,
        'x-bot-id': botId,
        'x-session-id': sessionId,
      });

      totalCrashes++;
      const color = res.status >= 500 ? '\x1b[31m' : '\x1b[33m';
      console.log(
        `[${new Date().toLocaleTimeString()}] ${botId} -> ${color}CRASH (${scenario}) [HTTP ${res.status}]\x1b[0m (Total Crashes: ${totalCrashes})`
      );
    } else {
      // Normal request
      const normalUrl = `${targetUrl}/api/engine`;
      const res = await sendHttpRequest(normalUrl, 'GET', {
        'User-Agent': ua,
        'x-bot-id': botId,
      });

      console.log(
        `[${new Date().toLocaleTimeString()}] ${botId} -> \x1b[32mBrowsing Catalog [HTTP ${res.status}]\x1b[0m`
      );
    }

    const jitter = Math.floor(Math.random() * 400) - 200;
    const wait = Math.max(250, intervalMs + jitter);
    await new Promise((r) => setTimeout(r, wait));
  }
}

// Start all bots staggered
for (let i = 0; i < botCount; i++) {
  setTimeout(() => runBot(i), i * Math.floor(intervalMs / botCount));
}

process.on('SIGINT', () => {
  console.log('\n\x1b[33mStopping bot runner...\x1b[0m');
  console.log(`Summary: ${totalRequests} total requests dispatched, ${totalCrashes} crashes triggered.`);
  process.exit(0);
});

