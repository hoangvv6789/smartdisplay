const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

const adb = require('../adb/adb-manager');
const smartDisplayApi = require('./smartdisplay');
const DataStore = require('../storage/data-store');
const { checkPort, pingHost, scanSubnet } = require('../utils/ping');

const isPkg = typeof process.pkg !== 'undefined';
let ROOT_DIR = isPkg ? path.dirname(process.execPath) : path.join(__dirname, '../..');
if (path.basename(ROOT_DIR).toLowerCase() === 'dist') {
  ROOT_DIR = path.join(ROOT_DIR, '..');
}

// APK storage configuration
const APK_DIR = path.join(ROOT_DIR, 'apks');
const PACKAGES_DIR = path.join(ROOT_DIR, 'packages/pico-8.1');
if (!fs.existsSync(APK_DIR)) fs.mkdirSync(APK_DIR, { recursive: true });
if (!fs.existsSync(PACKAGES_DIR)) fs.mkdirSync(PACKAGES_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, APK_DIR),
  filename: (req, file, cb) => {
    const safeName = Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    cb(null, safeName);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 300 * 1024 * 1024 }
});

const zipStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(ROOT_DIR, 'packages')),
  filename: (req, file, cb) => cb(null, 'temp_opengapps_' + Date.now() + '.zip')
});
const uploadZip = multer({
  storage: zipStorage,
  limits: { fileSize: 500 * 1024 * 1024 }
});

// Helper: đảm bảo phiên ADB đã mở trước khi gửi lệnh shell.
// Port 5555 mở KHÔNG có nghĩa là adb đã connect — thiếu bước này sẽ ra "device not found".
async function ensureConnected(target) {
  const t = String(target || '');
  if (!t) return false;
  if (/^\d+\.\d+\.\d+\.\d+/.test(t)) {
    await adb.connect(t, 5555); // idempotent — "already connected" nếu đã mở sẵn
  }
  return true;
}

// Helper: lấy package name launcher từ settings (không hardcode)
function getLauncherPackage() {
  return DataStore.getSettings().smartDisplayPackage || 'vn.adtcreative.hongngocdisplay';
}

// --- System & ADB status ---
router.get('/system/status', async (req, res) => {
  const adbVer = await adb.checkVersion();
  const connected = await adb.getConnectedDevices();
  const openGAppsPath = adb.getOpenGAppsPicoPath();
  const mem = process.memoryUsage();
  res.json({
    adbAvailable: adbVer.success,
    adbVersion: adbVer.stdout,
    connectedDevicesCount: connected.length,
    connectedDevices: connected,
    hasOpenGAppsPackage: Boolean(openGAppsPath),
    openGAppsPath: openGAppsPath,
    memory: {
      rss: (mem.rss / (1024 * 1024)).toFixed(1) + ' MB',
      heapUsed: (mem.heapUsed / (1024 * 1024)).toFixed(1) + ' MB'
    },
    pid: process.pid,
    uptime: Math.floor(process.uptime()),
    watchdog: getWatchdogStatus()
  });
});

// --- Launcher Watchdog (Tự động kiểm tra và phục hồi Launcher 4 tiếng/lần) ---
let watchdogInterval = null;
let watchdogRunning = false;
let watchdogLastRun = null;
let watchdogNextRun = null;
let watchdogResults = [];

function getWatchdogStatus() {
  const settings = DataStore.getSettings();
  const enabled = Boolean(settings.launcherWatchdogEnabled);
  const intervalHours = Number(settings.launcherWatchdogIntervalHours) || 4;
  const autoFixWhiteScreen = settings.autoFixWhiteScreen !== false;
  return {
    enabled,
    intervalHours,
    autoFixWhiteScreen,
    running: watchdogRunning,
    lastRun: watchdogLastRun,
    nextRun: watchdogNextRun,
    targetPackage: getLauncherPackage(),
    lastSummary: watchdogResults.length > 0 ? {
      total: watchdogResults.length,
      restored: watchdogResults.filter(r => r.status === 'restored').length,
      fixedWhiteScreen: watchdogResults.filter(r => r.status === 'fixed_white_screen').length,
      ok: watchdogResults.filter(r => r.status === 'ok').length,
      offline: watchdogResults.filter(r => r.status === 'offline').length
    } : null
  };
}

async function runWatchdogScan(customTargets = null) {
  if (watchdogRunning) return { success: false, message: 'Đang có đợt quét Launcher đang chạy...' };
  watchdogRunning = true;
  watchdogLastRun = new Date().toISOString();

  const settings = DataStore.getSettings();
  const targetPackage = getLauncherPackage();
  const autoFixWhiteScreen = settings.autoFixWhiteScreen !== false;

  let targetList = [];
  if (customTargets && Array.isArray(customTargets) && customTargets.length > 0) {
    targetList = customTargets;
  } else {
    const devices = DataStore.getDevices();
    targetList = devices.map(d => ({ ip: d.ip, name: d.name, room: d.room || d.group })).filter(d => Boolean(d.ip));
  }

  const results = [];
  const chunkSize = 12; // Chạy song song 12 máy cùng lúc với pre-check port để quét cực nhanh và không nghẽn

  for (let i = 0; i < targetList.length; i += chunkSize) {
    const chunk = targetList.slice(i, i + chunkSize);
    await Promise.all(chunk.map(async (dev) => {
      const devIp = typeof dev === 'string' ? dev : dev.ip;
      const devName = typeof dev === 'object' ? (dev.name || dev.room || devIp) : devIp;
      try {
        // Kiểm tra nhanh cổng 5555 trước (400ms timeout) để bỏ qua ngay lập tức các máy offline/tắt nguồn
        const portCheck = await checkPort(devIp, 5555, 400);
        if (!portCheck.open) {
          results.push({
            ip: devIp,
            name: devName,
            status: 'offline',
            success: false,
            message: 'Thiết bị offline (cổng ADB 5555 đóng)'
          });
          return;
        }

        // Máy online: Kiểm tra & phục hồi launcher, tự ngắt ADB ngay sau khi xong (autoDisconnect = true)
        const res = await adb.checkAndRestoreLauncher(devIp, targetPackage, autoFixWhiteScreen, true);
        results.push({
          ip: devIp,
          name: devName,
          ...res
        });
      } catch (e) {
        results.push({
          ip: devIp,
          name: devName,
          status: 'error',
          success: false,
          message: e.message
        });
      }
    }));
  }

  watchdogResults = results;
  watchdogRunning = false;

  const hours = Number(settings.launcherWatchdogIntervalHours) || 4;
  watchdogNextRun = new Date(Date.now() + hours * 3600 * 1000).toISOString();

  return {
    success: true,
    total: results.length,
    restored: results.filter(r => r.status === 'restored').length,
    fixedWhiteScreen: results.filter(r => r.status === 'fixed_white_screen').length,
    ok: results.filter(r => r.status === 'ok').length,
    offline: results.filter(r => r.status === 'offline').length,
    results
  };
}

function initWatchdogTimer() {
  if (watchdogInterval) {
    clearInterval(watchdogInterval);
    watchdogInterval = null;
  }

  const settings = DataStore.getSettings();
  const enabled = Boolean(settings.launcherWatchdogEnabled);
  const hours = Number(settings.launcherWatchdogIntervalHours) || 4;
  const intervalMs = hours * 3600 * 1000;

  if (enabled) {
    watchdogNextRun = new Date(Date.now() + intervalMs).toISOString();
    watchdogInterval = setInterval(() => {
      runWatchdogScan();
    }, intervalMs);
  } else {
    watchdogNextRun = null;
  }
}

// Khởi chạy timer watchdog khi load server
initWatchdogTimer();

router.get('/watchdog/status', (req, res) => {
  res.json({ success: true, ...getWatchdogStatus(), results: watchdogResults.slice(0, 50) });
});

router.post('/watchdog/toggle', (req, res) => {
  const { enabled, intervalHours, autoFixWhiteScreen } = req.body;
  const settings = DataStore.getSettings();
  if (typeof enabled !== 'undefined') {
    settings.launcherWatchdogEnabled = Boolean(enabled);
  }
  if (intervalHours) {
    settings.launcherWatchdogIntervalHours = Number(intervalHours) || 4;
  }
  if (typeof autoFixWhiteScreen !== 'undefined') {
    settings.autoFixWhiteScreen = Boolean(autoFixWhiteScreen);
  }
  DataStore.saveSettings(settings);
  initWatchdogTimer();
  res.json({ success: true, ...getWatchdogStatus() });
});

router.post('/watchdog/scan-now', async (req, res) => {
  const { targets } = req.body;
  const result = await runWatchdogScan(targets);
  res.json(result);
});

// --- OpenGApps Package Store & Status ---
router.get('/system-packages/opengapps-status', (req, res) => {
  const p = adb.getOpenGAppsPicoPath();
  if (p && fs.existsSync(p)) {
    let files = [];
    try { files = fs.readdirSync(p); } catch (e) {}
    return res.json({
      exists: true,
      path: p,
      fileCount: files.length,
      message: 'Bộ OpenGApps Pico x86-64 đã sẵn sàng trên Server!'
    });
  }
  res.json({ exists: false, message: 'Chưa có bộ OpenGApps Pico x86-64 trên Server' });
});

router.post('/system-packages/upload-opengapps', uploadZip.single('packageZip'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'Vui lòng chọn file .ZIP của bộ OpenGApps Pico' });
  }

  const zipPath = req.file.path;
  const destDir = PACKAGES_DIR;

  // Use powershell Expand-Archive
  const psCmd = `powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force"`;
  exec(psCmd, { windowsHide: true }, (err, stdout, stderr) => {
    try { fs.unlinkSync(zipPath); } catch (e) {}

    if (err) {
      return res.status(500).json({ success: false, message: 'Lỗi giải nén ZIP: ' + (stderr || err.message) });
    }

    const p = adb.getOpenGAppsPicoPath();
    res.json({
      success: true,
      message: 'Đã nạp và giải nén thành công bộ OpenGApps Pico vào Server!',
      path: p
    });
  });
});

// --- Smart Display Cloud Sync ---
router.post('/cloud/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Vui lòng nhập tên đăng nhập và mật khẩu' });
  }
  const result = await smartDisplayApi.login(username, password);
  res.json(result);
});

router.post('/cloud/sync', async (req, res) => {
  const token = req.body.token || req.query.token || req.headers.authorization?.replace('Bearer ', '');
  const result = await smartDisplayApi.fetchDevices(token);
  res.json(result);
});

router.get('/cloud/sync', async (req, res) => {
  const token = req.query.token || req.headers.authorization?.replace('Bearer ', '');
  const result = await smartDisplayApi.fetchDevices(token);
  res.json(result);
});

// --- LAN Subnet Scanner ---
router.post('/devices/scan-subnet', async (req, res) => {
  const { subnet, start = 1, end = 254, port = 5555 } = req.body;
  const prefix = (subnet || '172.18.15').replace(/\.\d+$/, '').replace(/\.+$/, '');

  try {
    const foundIps = await scanSubnet(prefix, parseInt(start, 10), parseInt(end, 10), parseInt(port, 10));
    const newDevices = [];
    for (const ip of foundIps) {
      await adb.connect(ip, port);
      const info = await adb.getDeviceInfo(ip);

      const dev = {
        id: 'dev_' + ip.replace(/\./g, '_'),
        name: info.model && info.model !== 'Unknown' ? `Smart Display (${info.model})` : `Smart Display ${ip}`,
        ip: ip,
        mac: '',
        group: `Dải mạng ${prefix}.x`,
        status: 'online',
        model: info.model || 'Android Device',
        resolution: info.resolution || '',
        adbConnected: true,
        adbPortOpen: true
      };
      DataStore.upsertDevice(dev);
      newDevices.push(dev);
    }

    res.json({
      success: true,
      foundCount: foundIps.length,
      ips: foundIps,
      devices: newDevices
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// --- Device CRUD & Management ---
router.get('/devices', async (req, res) => {
  let devices = DataStore.getDevices();
  const connectedAdb = await adb.getConnectedDevices();
  const connectedIps = new Set(connectedAdb.map(d => d.ip));

  const enriched = devices.map(d => {
    const ip = (d.ip || '').trim();
    const isAdbConnected = Boolean(ip) && (
      connectedIps.has(ip) ||
      connectedAdb.some(c => c.serial === ip || c.serial.startsWith(ip + ':') || (c.ip && c.ip === ip))
    );
    return {
      ...d,
      adbConnected: isAdbConnected
    };
  });

  res.json({ success: true, count: enriched.length, devices: enriched });
});

router.post('/devices', (req, res) => {
  const device = req.body;
  if (!device.name && !device.ip) {
    return res.status(400).json({ success: false, message: 'Thiếu thông tin thiết bị' });
  }
  if (!device.id) {
    device.id = 'dev_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 4);
  }
  const saved = DataStore.upsertDevice(device);
  res.json({ success: true, device: saved });
});

router.put('/devices/:id', (req, res) => {
  const updated = DataStore.updateDevice(req.params.id, req.body);
  if (updated) {
    res.json({ success: true, device: updated });
  } else {
    res.status(404).json({ success: false, message: 'Không tìm thấy thiết bị để cập nhật' });
  }
});

router.delete('/devices/:id', (req, res) => {
  DataStore.deleteDevice(req.params.id);
  res.json({ success: true, message: 'Đã xóa thiết bị thành công' });
});

router.post('/devices/import-json', (req, res) => {
  let devices = req.body.devices || req.body;
  if (devices && !Array.isArray(devices) && typeof devices === 'object') {
    if (Array.isArray(devices.data)) devices = devices.data;
    else if (devices.data && Array.isArray(devices.data.list)) devices = devices.data.list;
    else devices = Object.values(devices);
  }

  if (!Array.isArray(devices)) {
    return res.status(400).json({ success: false, message: 'Dữ liệu không đúng định dạng danh sách' });
  }

  let count = 0;
  for (const d of devices) {
    const ip = d.ip_address || d.ip || d.ipAddress || (d.network_info?.ip) || (typeof d.name === 'string' ? d.name.match(/\d+\.\d+\.\d+\.\d+/)?.[0] : '') || '';
    if (ip || d.name || d.device_name) {
      const formatted = {
        id: 'dev_' + (d.id || (ip ? ip.replace(/\./g, '_') : Date.now().toString(36) + Math.random().toString(36).substr(2, 4))),
        cloudId: d.id,
        name: d.device_name || d.name || d.title || (`Smart Display ${ip}`),
        ip: ip,
        activeCode: d.active_code || d.activeCode || '',
        mac: d.deviceId || d.mac || d.mac_address || (d.network_info?.mac) || '',
        group: d._groupTitle || (typeof d.group === 'string' ? d.group : d.group?.name) || d.group_name || d.map || d.room || 'Mặc định',
        room: d.map || d.room || d.location || '',
        status: d.status === 1 ? (d.is_connected === 1 ? 'online' : 'offline') : (d.status || 'offline'),
        model: d.model || d.device_model || 'AR BOX G1 / HIT-W183',
        os: d.os ? 'Android ' + d.os : '',
        resolution: (d.width && d.height) ? (`${d.width}x${d.height}`) : (d.resolution || ''),
        raw: d
      };
      DataStore.upsertDevice(formatted);
      count++;
    }
  }
  res.json({ success: true, count, message: `Đã nhập thành công ${count} thiết bị` });
});

// --- Network Ping & Port Check ---
router.post('/devices/ping', async (req, res) => {
  const { ip } = req.body;
  if (!ip) return res.status(400).json({ success: false, message: 'Thiếu địa chỉ IP' });

  const [pingRes, portRes] = await Promise.all([
    pingHost(ip),
    checkPort(ip, 5555)
  ]);

  res.json({
    ip,
    alive: pingRes.alive,
    pingTime: pingRes.time,
    adbPortOpen: portRes.open
  });
});

router.post('/devices/ping-all', async (req, res) => {
  const devices = DataStore.getDevices();
  const ips = devices.filter(d => d.ip).map(d => d.ip);
  const results = [];
  const chunkSize = 25; // Process in small chunks to keep RAM low & avoid socket exhaustion

  for (let i = 0; i < ips.length; i += chunkSize) {
    const chunk = ips.slice(i, i + chunkSize);
    const chunkRes = await Promise.all(chunk.map(async (ip) => {
      const portRes = await checkPort(ip, 5555, 800);
      return { ip, adbPortOpen: portRes.open };
    }));
    results.push(...chunkRes);
  }

  res.json({ success: true, results });
});

// --- ADB Connect / Disconnect ---
router.post('/adb/connect', async (req, res) => {
  const { ip, port } = req.body;
  if (!ip) return res.status(400).json({ success: false, message: 'Thiếu địa chỉ IP' });
  const result = await adb.connect(ip, port || 5555);
  res.json(result);
});

router.post('/adb/disconnect', async (req, res) => {
  const { ip, port } = req.body;
  if (!ip) return res.status(400).json({ success: false, message: 'Thiếu địa chỉ IP' });
  const result = await adb.disconnect(ip, port || 5555);
  res.json(result);
});

router.post('/adb/disconnect-all', async (req, res) => {
  const result = await adb.execCommand(['disconnect']);
  res.json({ success: true, message: 'Đã ngắt toàn bộ kết nối ADB', output: result.stdout });
});

// --- ADB Quick Fix & Special Commands ---
router.post('/adb/reboot', async (req, res) => {
  const { target, mode } = req.body;
  if (!target) return res.status(400).json({ success: false, message: 'Thiếu target device' });
  await ensureConnected(target);
  const result = await adb.reboot(target, mode);
  res.json(result);
});

router.post('/adb/factory-reset', async (req, res) => {
  const { target, mode = 'android8' } = req.body;
  if (!target) return res.status(400).json({ success: false, message: 'Thiếu target device' });
  await ensureConnected(target);
  const result = await adb.factoryReset(target, mode);
  res.json(result);
});

router.post('/adb/remove-lockscreen', async (req, res) => {
  const { target } = req.body;
  if (!target) return res.status(400).json({ success: false, message: 'Thiếu target device' });
  await ensureConnected(target);
  const result = await adb.removeLockscreen(target);
  res.json(result);
});

router.post('/adb/set-autostart-app', async (req, res) => {
  const { target, packageName } = req.body;
  if (!target || !packageName) return res.status(400).json({ success: false, message: 'Thiếu target device hoặc packageName' });
  await ensureConnected(target);
  const result = await adb.setAutoStartApp(target, packageName);
  res.json(result);
});

router.post('/adb/install-opengapps', async (req, res) => {
  const { target, customPath, autoReset = true } = req.body;
  if (!target) return res.status(400).json({ success: false, message: 'Thiếu target device' });
  await ensureConnected(target);
  const result = await adb.installOpenGApps(target, customPath, autoReset);
  res.json(result);
});

router.get('/adb/google-play-status', async (req, res) => {
  const { target } = req.query;
  if (!target) return res.status(400).json({ success: false, message: 'Thiếu target device' });
  await ensureConnected(target);
  const result = await adb.checkGooglePlayStatus(target);
  res.json(result);
});

router.post('/adb/toggle-google-play', async (req, res) => {
  const { target, enable } = req.body;
  if (!target) return res.status(400).json({ success: false, message: 'Thiếu target device' });
  await ensureConnected(target);
  const result = await adb.toggleGooglePlayServices(target, !!enable);
  res.json(result);
});

router.post('/adb/clear-google-play-cache', async (req, res) => {
  const { target } = req.body;
  if (!target) return res.status(400).json({ success: false, message: 'Thiếu target device' });
  await ensureConnected(target);
  const result = await adb.clearGooglePlayCache(target);
  res.json(result);
});

router.post('/adb/restart-app', async (req, res) => {
  const { target, packageName } = req.body;
  if (!target) return res.status(400).json({ success: false, message: 'Thiếu target device' });
  // FIX: đọc package từ settings thay vì hardcode
  const pkg = packageName || getLauncherPackage();
  await ensureConnected(target);
  const result = await adb.restartApp(target, pkg);
  res.json(result);
});

router.post('/adb/clear-data', async (req, res) => {
  const { target, packageName } = req.body;
  if (!target) return res.status(400).json({ success: false, message: 'Thiếu target device' });
  // FIX: đọc package từ settings thay vì hardcode
  const pkg = packageName || getLauncherPackage();
  await ensureConnected(target);
  const result = await adb.clearAppData(target, pkg);
  res.json(result);
});

router.post('/adb/keyevent', async (req, res) => {
  const { target, key } = req.body;
  if (!target || !key) return res.status(400).json({ success: false, message: 'Thiếu target hoặc key' });
  await ensureConnected(target);
  const result = await adb.sendKey(target, key);
  res.json(result);
});

router.post('/adb/input-text', async (req, res) => {
  const { target, text } = req.body;
  if (!target || !text) return res.status(400).json({ success: false, message: 'Thiếu target hoặc text' });
  await ensureConnected(target);
  const result = await adb.sendText(target, text);
  res.json(result);
});

router.post('/adb/swipe', async (req, res) => {
  const { target, x1, y1, x2, y2, duration = 300 } = req.body;
  if (!target || x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) {
    return res.status(400).json({ success: false, message: 'Thiếu tọa độ x1, y1, x2, y2' });
  }
  await ensureConnected(target);
  const result = await adb.sendSwipe(target, x1, y1, x2, y2, duration);
  res.json(result);
});

router.post('/adb/tap', async (req, res) => {
  const { target, x, y } = req.body;
  if (!target || x === undefined || y === undefined) return res.status(400).json({ success: false, message: 'Thiếu tọa độ x, y' });
  await ensureConnected(target);
  const result = await adb.sendTap(target, x, y);
  res.json(result);
});

router.get('/adb/screenshot', async (req, res) => {
  const { target } = req.query;
  if (!target) return res.status(400).json({ success: false, message: 'Thiếu target' });
  await ensureConnected(target);
  const result = await adb.takeScreenshot(target);
  if (result.success) {
    if (req.query.format === 'binary') {
      res.setHeader('Content-Type', 'image/png');
      return res.send(result.buffer);
    }
    return res.json({ success: true, image: result.base64 });
  }
  res.status(500).json(result);
});

router.post('/adb/shell', async (req, res) => {
  const { target, command } = req.body;
  if (!target || !command) return res.status(400).json({ success: false, message: 'Thiếu target hoặc command' });
  await ensureConnected(target);
  const result = await adb.shell(target, command);
  res.json(result);
});


router.post('/adb/sync-time', async (req, res) => {
  const { target, timezone } = req.body;
  if (!target) return res.status(400).json({ success: false, message: 'Thiếu target' });
  await ensureConnected(target);
  const result = await adb.syncTime(target, timezone);
  res.json(result);
});

router.post('/adb/fix-white-screen', async (req, res) => {
  const { target, targets } = req.body;
  if (!target && (!targets || !targets.length)) {
    return res.status(400).json({ success: false, message: 'Thiếu target hoặc danh sách targets' });
  }

  if (target) {
    await ensureConnected(target);
    const result = await adb.fixWhiteScreenKeepCode(target);
    return res.json(result);
  }

  // Batch execution
  const results = [];
  for (const t of targets) {
    try {
      await ensureConnected(t);
      const r = await adb.fixWhiteScreenKeepCode(t);
      results.push(r);
    } catch (e) {
      results.push({ success: false, target: t, message: e.message });
    }
  }

  res.json({
    success: true,
    total: results.length,
    successCount: results.filter(r => r.success).length,
    results
  });
});

router.post('/adb/restore-launcher', async (req, res) => {
  const { target, targets } = req.body;
  if (!target && (!targets || !targets.length)) {
    return res.status(400).json({ success: false, message: 'Thiếu target hoặc danh sách targets' });
  }

  const settings = DataStore.getSettings();
  const targetPackage = getLauncherPackage();
  const autoFixWhiteScreen = settings.autoFixWhiteScreen !== false;

  if (target) {
    const result = await adb.checkAndRestoreLauncher(target, targetPackage, autoFixWhiteScreen, true);
    return res.json(result);
  }

  // Batch execution
  const results = [];
  for (const t of targets) {
    try {
      const r = await adb.checkAndRestoreLauncher(t, targetPackage, autoFixWhiteScreen, true);
      results.push(r);
    } catch (e) {
      results.push({ success: false, target: t, message: e.message });
    }
  }

  res.json({
    success: true,
    total: results.length,
    successCount: results.filter(r => r.success).length,
    results
  });
});

router.get('/adb/device-info', async (req, res) => {
  const { target } = req.query;
  if (!target) return res.status(400).json({ success: false, message: 'Thiếu target' });
  await ensureConnected(target);
  const info = await adb.getDeviceInfo(target);
  res.json({ success: true, info });
});

router.get('/adb/packages', async (req, res) => {
  const { target, all } = req.query;
  if (!target) return res.status(400).json({ success: false, message: 'Thiếu target' });
  await ensureConnected(target);
  const showAll = all === 'true' || all === '1' || all === undefined;
  const result = await adb.listInstalledPackages(target, !showAll);
  res.json(result);
});

router.post('/adb/uninstall', async (req, res) => {
  const { target, packageName } = req.body;
  if (!target || !packageName) return res.status(400).json({ success: false, message: 'Thiếu target hoặc packageName' });
  await ensureConnected(target);
  const result = await adb.uninstallPackage(target, packageName);
  res.json(result);
});

// --- APK Manager ---
router.get('/apks', (req, res) => {
  const apks = DataStore.getApks();
  const enriched = apks.map(apk => {
    const filePath = path.join(APK_DIR, apk.fileName);
    const exists = fs.existsSync(filePath);
    let size = apk.size || '';
    if (exists) {
      const stat = fs.statSync(filePath);
      size = (stat.size / (1024 * 1024)).toFixed(2) + ' MB';
    }
    return { ...apk, fileExists: exists, size };
  });
  res.json({ success: true, apks: enriched });
});

router.post('/apks/upload', upload.single('apk'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'Vui lòng chọn file APK' });
  }

  const apks = DataStore.getApks();
  const newApk = {
    id: 'apk_' + Date.now().toString(36),
    name: req.body.name || req.file.originalname.replace('.apk', ''),
    packageName: req.body.packageName || '',
    fileName: req.file.filename,
    originalName: req.file.originalname,
    description: req.body.description || 'File APK tải lên',
    version: req.body.version || '1.0',
    uploadDate: new Date().toISOString(),
    size: (req.file.size / (1024 * 1024)).toFixed(2) + ' MB',
    isDefault: false
  };

  apks.push(newApk);
  DataStore.saveApks(apks);

  res.json({ success: true, apk: newApk });
});

router.delete('/apks/:id', (req, res) => {
  const apks = DataStore.getApks();
  const apk = apks.find(a => a.id === req.params.id);
  if (apk) {
    const filePath = path.join(APK_DIR, apk.fileName);
    if (fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch (e) {}
    }
    const updated = apks.filter(a => a.id !== req.params.id);
    DataStore.saveApks(updated);
    return res.json({ success: true, message: 'Đã xóa file APK thành công' });
  }
  res.status(404).json({ success: false, message: 'Không tìm thấy APK' });
});

router.post('/adb/install-apk', async (req, res) => {
  const { target, apkId, grantPermissions } = req.body;
  if (!target || !apkId) return res.status(400).json({ success: false, message: 'Thiếu target hoặc apkId' });

  const apks = DataStore.getApks();
  const apk = apks.find(a => a.id === apkId);
  if (!apk) return res.status(404).json({ success: false, message: 'Không tìm thấy thông tin APK' });

  const apkPath = path.join(APK_DIR, apk.fileName);
  if (!fs.existsSync(apkPath)) {
    return res.status(400).json({ success: false, message: `File ${apk.fileName} chưa có trong thư mục apks/` });
  }

  await ensureConnected(target);
  const result = await adb.installApk(target, apkPath, { grantPermissions: !!grantPermissions });
  res.json(result);
});

// --- Settings ---
router.get('/settings', (req, res) => {
  res.json(DataStore.getSettings());
});

router.post('/settings', (req, res) => {
  // FIX: merge thay vì ghi đè toàn bộ — tránh xóa mất smartDisplayPackage / watchdog settings
  const merged = { ...DataStore.getSettings(), ...req.body };
  DataStore.saveSettings(merged);
  // Áp dụng lại interval/enabled watchdog nếu có đổi
  initWatchdogTimer();
  res.json({ success: true, settings: merged });
});

module.exports = router;