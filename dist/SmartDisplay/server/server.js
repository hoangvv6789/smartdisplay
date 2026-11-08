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

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Gracefully handle malformed JSON bodies without crashing the server
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    logDebug('Bad JSON payload received: ' + err.message);
    return res.status(400).json({ success: false, message: 'Dữ liệu JSON không hợp lệ' });
  }
  next();
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
  res.status(500).json({ success: false, message: 'Lỗi máy chủ nội bộ: ' + (err.message || '') });
});

wss.on('connection', (ws) => {
  let logcatProc = null;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      if (data.action === 'start_logcat' && data.target) {
        if (logcatProc) {
          try { logcatProc.kill(); } catch (e) {}
          logcatProc = null;
        }
        logcatProc = adb.streamLogcat(data.target, ws, { level: data.level });
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

