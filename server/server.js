const fs = require('fs');
const path = require('path');

const isPkg = typeof process.pkg !== 'undefined';
const ROOT_DIR = isPkg ? path.dirname(process.execPath) : path.join(__dirname, '..');
const logFile = path.join(ROOT_DIR, 'server_debug.log');

function logDebug(msg) {
  try {
    fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${msg}\n`);
  } catch (e) {}
}

logDebug('Server initializing...');

// Prevent EPIPE/EBADF crashes when running completely hidden without a console window on Windows
if (process.stdout && process.stdout.on) {
  process.stdout.on('error', () => {});
}
if (process.stderr && process.stderr.on) {
  process.stderr.on('error', () => {});
}
process.on('uncaughtException', (err) => {
  logDebug('Uncaught Exception: ' + (err ? (err.stack || err.message) : err));
});
process.on('unhandledRejection', (reason) => {
  logDebug('Unhandled Rejection: ' + reason);
});
process.on('beforeExit', (code) => {
  logDebug('Process beforeExit with code ' + code);
});
process.on('exit', (code) => {
  logDebug('Process exited with code ' + code);
});

// Permanent background heartbeat to ensure event loop never drains
setInterval(() => {
  // Keep event loop active indefinitely
}, 60000);

const express = require('express');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');
const adb = require('./adb/adb-manager');
const routes = require('./api/routes');
const DataStore = require('./storage/data-store');

const app = express();
const server = http.createServer(app);

// Origin validation helper for LAN / Localhost security
function isTrustedOrigin(origin) {
  if (!origin) return true; // same-origin or server-to-server requests
  try {
    const url = new URL(origin);
    const host = url.hostname;
    // Allow localhost / loopback
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
    // Allow standard private network ranges (Hospital LAN / Intranet)
    if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
    if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
    if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
    // Check if user specified custom allowed domain in settings
    const settings = DataStore.getSettings();
    if (settings && settings.allowedDomain) {
      if (host === settings.allowedDomain || host.endsWith('.' + settings.allowedDomain)) return true;
    }
  } catch (e) {}
  return false;
}

// WebSocket server with strict handshake verification
const wss = new WebSocket.Server({
  server,
  verifyClient: (info, callback) => {
    const origin = info.origin || info.req.headers.origin;
    if (isTrustedOrigin(origin)) {
      callback(true);
    } else {
      logDebug(`Blocked WebSocket handshake from untrusted origin: ${origin}`);
      callback(false, 403, 'Forbidden origin');
    }
  }
});

// Restrict CORS to trusted local/LAN origins only
app.use(cors({
  origin: (origin, callback) => {
    if (isTrustedOrigin(origin)) {
      callback(null, true);
    } else {
      logDebug(`Blocked CORS request from untrusted origin: ${origin}`);
      callback(new Error('CORS blocked: Origin không được phép truy cập API nội bộ'), false);
    }
  },
  credentials: true
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Gracefully handle malformed JSON bodies without crashing the server
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    logDebug('Bad JSON payload received: ' + err.message);
    return res.status(400).json({ success: false, message: 'Dữ liệu JSON không hợp lệ' });
  }
  next(err);
});

// Determine root directory
let publicPath = path.join(__dirname, '../public');
if (fs.existsSync(path.join(process.cwd(), 'public'))) {
  publicPath = path.join(process.cwd(), 'public');
} else if (fs.existsSync(path.join(ROOT_DIR, 'public'))) {
  publicPath = path.join(ROOT_DIR, 'public');
}

app.use(express.static(publicPath));
app.use('/public', express.static(publicPath));

app.use('/api', routes);

// Global express error handler to ensure server process never terminates on unhandled route errors
app.use((err, req, res, next) => {
  logDebug('Route Error: ' + (err.stack || err.message));
  if (res.headersSent) {
    return next(err);
  }
  const statusCode = err.status || err.statusCode || 500;
  res.status(statusCode).json({
    success: false,
    message: err.message || 'Lỗi máy chủ nội bộ'
  });
});

wss.on('connection', (ws) => {
  let logcatProc = null;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      // Validate target format before spawning adb logcat process
      const validTarget = typeof data.target === 'string' && /^[a-zA-Z0-9_\.\:\-]+$/.test(data.target.trim());
      if (data.action === 'start_logcat' && validTarget) {
        if (logcatProc) {
          try { logcatProc.kill(); } catch (e) {}
          logcatProc = null;
        }
        logcatProc = adb.streamLogcat(data.target.trim(), ws, { level: data.level });
      } else if (data.action === 'stop_logcat') {
        if (logcatProc) {
          try { logcatProc.kill(); } catch (e) {}
          logcatProc = null;
        }
      }
    } catch (e) {}
  });

  ws.on('close', () => {
    if (logcatProc) {
      try { logcatProc.kill(); } catch (e) {}
      logcatProc = null;
    }
  });
});

const PORT = 8686;
server.listen(PORT, () => {
  logDebug(`SmartDisplay ADB Manager running on port ${PORT}`);
  console.log(`SmartDisplay ADB Manager running on port ${PORT}`);
});

