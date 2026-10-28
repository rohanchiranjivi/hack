/**
 * End-to-End Demo Orchestrator for CrashWeb & SignalDesk Monitor
 * Launches Backend (8000), Dashboard UI (5173), and CrashWeb Test Site (3000).
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const isWin = process.platform === 'win32';
const rootDir = __dirname;

const backendDir = path.join(rootDir, 'hackmitten', 'backend');
const frontendDir = path.join(rootDir, 'hackmitten', 'frontend');
const crashwebDir = path.join(rootDir, 'crashweb');

// Find Python in venv
let pythonCmd = isWin
  ? path.join(backendDir, '.venv', 'Scripts', 'python.exe')
  : path.join(backendDir, '.venv', 'bin', 'python');

if (!fs.existsSync(pythonCmd)) {
  pythonCmd = isWin ? 'python' : 'python3';
}

const npmCmd = isWin ? 'npm.cmd' : 'npm';

console.log('\x1b[36m%s\x1b[0m', '===============================================================');
console.log('\x1b[1m\x1b[33m   LAUNCHING CRASH MONITORING END-TO-END DEMO ECOSYSTEM        \x1b[0m');
console.log('\x1b[36m%s\x1b[0m', '===============================================================');
console.log('  1. Monitoring Backend  : \x1b[32mhttp://localhost:8000\x1b[0m');
console.log('  2. Monitoring Dashboard: \x1b[32mhttp://localhost:5173\x1b[0m');
console.log('  3. CrashWeb Test Site  : \x1b[32mhttp://localhost:3000\x1b[0m');
console.log('  4. Crash Control Panel : \x1b[35mhttp://localhost:3000/chaos\x1b[0m');
console.log('\x1b[90mPress Ctrl+C to terminate all services.\x1b[0m\n');

const processes = [];

function startProcess(name, cmd, args, cwd, color) {
  const env = { ...process.env, PYTHONPATH: backendDir };
  const proc = spawn(cmd, args, { cwd, env, shell: true });

  proc.stdout.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    lines.forEach((line) => {
      if (line.trim()) {
        console.log(`${color}[${name}]\x1b[0m ${line}`);
      }
    });
  });

  proc.stderr.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    lines.forEach((line) => {
      if (line.trim()) {
        console.log(`${color}[${name}]\x1b[0m ${line}`);
      }
    });
  });

  proc.on('close', (code) => {
    console.log(`${color}[${name}] exited with code ${code}\x1b[0m`);
  });

  processes.push(proc);
  return proc;
}

// 1. Start Monitoring Backend (FastAPI on 8000)
startProcess(
  'BACKEND  ',
  pythonCmd,
  ['-m', 'uvicorn', 'app.main:app', '--host', '0.0.0.0', '--port', '8000'],
  backendDir,
  '\x1b[34m'
);

// 2. Start Dashboard UI (Vite on 5173)
setTimeout(() => {
  startProcess(
    'DASHBOARD',
    npmCmd,
    ['run', 'dev', '--', '--port', '5173'],
    frontendDir,
    '\x1b[35m'
  );
}, 1000);

// 3. Start CrashWeb Storefront (Next.js on 3000)
setTimeout(() => {
  startProcess(
    'CRASHWEB ',
    npmCmd,
    ['run', 'dev', '--', '--port', '3000'],
    crashwebDir,
    '\x1b[32m'
  );
}, 1500);

function cleanup() {
  console.log('\n\x1b[33mShutting down all services...\x1b[0m');
  processes.forEach((p) => {
    try {
      if (isWin) {
        spawn('taskkill', ['/pid', p.pid, '/f', '/t']);
      } else {
        p.kill('SIGTERM');
      }
    } catch (e) {
      // ignore
    }
  });
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

