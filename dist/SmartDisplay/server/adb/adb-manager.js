const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const keycodes = require('./keycodes');
const DataStore = require('../storage/data-store');

// Package name mặc định của launcher SmartDisplay — thống nhất toàn bộ
const DEFAULT_LAUNCHER_PKG = 'vn.adtcreative.hongngocdisplay';

const isPkg = typeof process.pkg !== 'undefined';
let ROOT_DIR = isPkg ? path.dirname(process.execPath) : path.join(__dirname, '../..');
if (path.basename(ROOT_DIR).toLowerCase() === 'dist') {
  ROOT_DIR = path.join(ROOT_DIR, '..');
}

class AdbManager {
  getAdbPath() {
    const candidates = [
      path.join(ROOT_DIR, 'platform-tools', 'adb.exe'),
      path.join(ROOT_DIR, 'adb.exe'),
      path.join(process.cwd(), 'platform-tools', 'adb.exe'),
      path.join(process.cwd(), 'adb.exe'),
      path.join(__dirname, '../../platform-tools/adb.exe'),
      'C:\\platform-tools\\adb.exe',
      'C:\\adb\\adb.exe'
    ];

    for (const c of candidates) {
      if (fs.existsSync(c)) {
        return c;
      }
    }

    try {
      const settings = DataStore.getSettings();
      if (settings && settings.adbPath && fs.existsSync(settings.adbPath)) {
        return settings.adbPath;
      }
    } catch (e) {}

    return 'adb';
  }



  execCommand(args, options = {}) {
    return new Promise((resolve) => {
      const adbBin = this.getAdbPath();
      const cmd = `"${adbBin}" ${args.join(' ')}`;
      exec(cmd, { windowsHide: true, timeout: options.timeout || 20000, maxBuffer: 10 * 1024 * 1024, ...options }, (err, stdout, stderr) => {
        resolve({
          success: !err,
          stdout: (stdout || '').toString().trim(),
          stderr: (stderr || '').toString().trim(),
          error: err ? err.message : null
        });
      });
    });
  }

  async checkVersion() {
    const res = await this.execCommand(['version']);
    return res;
  }

  async getConnectedDevices() {
    const res = await this.execCommand(['devices', '-l']);
    if (!res.success) return [];

    const lines = res.stdout.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('List of devices'));
    const devices = [];

    for (const line of lines) {
      const parts = line.split(/\s+/);
      if (parts.length >= 2) {
        const id = parts[0];
        const status = parts[1];
        const modelMatch = line.match(/model:(\S+)/);
        const deviceMatch = line.match(/device:(\S+)/);
        const ip = id.includes(':') ? id.split(':')[0] : id;

        devices.push({
          serial: id,
          ip: ip,
          status: status,
          model: modelMatch ? modelMatch[1] : (deviceMatch ? deviceMatch[1] : 'Android Device'),
          raw: line
        });
      }
    }
    return devices;
  }

  async connect(ip, port = 5555) {
    const target = ip.includes(':') ? ip : `${ip}:${port}`;
    const res = await this.execCommand(['connect', target], { timeout: 8000 });
    const success = res.stdout.toLowerCase().includes('connected to') || res.stdout.toLowerCase().includes('already connected');
    return {
      success,
      target,
      output: res.stdout || res.stderr,
      error: !success ? (res.stdout || res.stderr || 'Không thể kết nối') : null
    };
  }

  async disconnect(ip, port = 5555) {
    const target = ip.includes(':') ? ip : `${ip}:${port}`;
    const res = await this.execCommand(['disconnect', target]);
    return {
      success: res.success,
      target,
      output: res.stdout || res.stderr
    };
  }

  getTargetArg(ipOrSerial, port = 5555) {
    const target = (ipOrSerial.includes(':') || !ipOrSerial.includes('.')) ? ipOrSerial : `${ipOrSerial}:${port}`;
    return ['-s', target];
  }

  async shell(target, command) {
    const targetArgs = this.getTargetArg(target);
    const res = await this.execCommand([...targetArgs, 'shell', command]);
    return res;
  }

  async reboot(target, mode = '') {
    const targetArgs = this.getTargetArg(target);
    const args = [...targetArgs, 'reboot'];
    if (mode) args.push(mode);
    const res = await this.execCommand(args);
    return res;
  }

  execSuScript(target, scriptContent, options = {}) {
    return new Promise((resolve) => {
      const adbBin = this.getAdbPath();
      const targetArgs = this.getTargetArg(target);
      const child = spawn(adbBin, [...targetArgs, 'shell'], { windowsHide: true, timeout: options.timeout || 30000 });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (d) => stdout += d.toString());
      child.stderr.on('data', (d) => stderr += d.toString());

      child.on('close', (code) => {
        resolve({
          success: code === 0,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          code
        });
      });

      child.on('error', (err) => {
        resolve({ success: false, error: err.message });
      });

      const fullScript = `su\n${scriptContent}\nexit\nexit\n`;
      child.stdin.write(fullScript);
      child.stdin.end();
    });
  }

  // FIX: Chạy script nhiều dòng TRỰC TIẾP trên shell thiết bị (qua stdin của adb shell).
  // Dùng cho script có ; | || && 2>/dev/null — cmd.exe Windows sẽ nuốt các ký tự này nếu đưa qua execCommand.
  execDeviceShell(target, scriptContent, options = {}) {
    return new Promise((resolve) => {
      const adbBin = this.getAdbPath();
      const targetArgs = this.getTargetArg(target);
      const child = spawn(adbBin, [...targetArgs, 'shell'], { windowsHide: true });

      let stdout = '';
      let stderr = '';
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) { try { child.kill(); } catch (_) {} }
      }, options.timeout || 15000);

      child.stdout.on('data', (d) => stdout += d.toString());
      child.stderr.on('data', (d) => stderr += d.toString());

      child.on('close', (code) => {
        settled = true;
        clearTimeout(timer);
        resolve({ success: code === 0, stdout: stdout.trim(), stderr: stderr.trim(), code });
      });
      child.on('error', (err) => {
        settled = true;
        clearTimeout(timer);
        resolve({ success: false, error: err.message });
      });

      child.stdin.write(scriptContent + '\nexit\n');
      child.stdin.end();
    });
  }

  // FIX: Đọc giờ thiết bị dạng epoch seconds (date +%s) → so sánh timezone-safe với Date.now()
  async readDeviceTime(target) {
    const res = await this.execDeviceShell(target, 'date +%s', { timeout: 5000 });
    const epoch = parseInt((res.stdout || '').trim(), 10);
    if (isNaN(epoch) || epoch <= 0) return null;
    return new Date(epoch * 1000);
  }

  async factoryReset(target, mode = 'android8') {
    const targetArgs = this.getTargetArg(target);

    if (mode === 'android8' || mode === 'auto') {
      const cmd8 = 'am broadcast -p "android" --receiver-foreground -a android.intent.action.FACTORY_RESET';
      const res8 = await this.execSuScript(target, `${cmd8}\n${cmd8}`);
      // Also send direct broadcast without su as fallback
      await this.execCommand([...targetArgs, 'shell', cmd8]);

      if (mode === 'android8') {
        return {
          success: true,
          output: 'Đã gửi lệnh Factory Reset cho Android 8!',
          details: res8.stdout || res8.stderr
        };
      }
    }

    if (mode === 'android10' || mode === 'recovery' || mode === 'auto') {
      const targetWithPort = target.includes(':') ? target : `${target}:5555`;
      // 1. Elevate via adb root to bypass SuperSU dialog prompt
      await this.execCommand([...targetArgs, 'root'], { timeout: 4000 });
      await new Promise(resolve => setTimeout(resolve, 1500));
      if (target.includes('.')) {
        await this.execCommand(['connect', targetWithPort], { timeout: 4000 });
      }

      // 2. Clean any stale recovery command files to prevent bootloop/hang in recovery
      await this.execCommand([...targetArgs, 'shell', 'rm -f /cache/recovery/command 2>/dev/null']);

      // 3. Trigger native Android MasterClear via system broadcast (100% works cleanly on Android 10 without getting stuck)
      const broadcastCmd = 'am broadcast -a android.intent.action.FACTORY_RESET -p android --receiver-foreground --receiver-include-background';
      let res10 = await this.execCommand([...targetArgs, 'shell', broadcastCmd], { timeout: 8000 });

      // Fallback: If broadcast doesn't initiate reboot within 5 seconds, use RecoverySystem service wipe
      if (!res10.success || res10.stderr.includes('Error')) {
        const fallbackCmd = 'am broadcast -n android/com.android.server.MasterClearReceiver -a android.intent.action.FACTORY_RESET --receiver-foreground';
        res10 = await this.execCommand([...targetArgs, 'shell', fallbackCmd], { timeout: 8000 });
      }

      return {
        success: true,
        output: 'Đã gửi lệnh Factory Reset sạch cho Android 10! Thiết bị sẽ tự động wipe sạch dữ liệu và khởi động lại bình thường (không bị treo màn hình boot).',
        details: res10.stdout || res10.stderr
      };
    }

    return { success: true, output: 'Đã gửi lệnh Factory Reset' };
  }

  async removeLockscreen(target) {
    const targetArgs = this.getTargetArg(target);

    // Nuclear approach: stop services, delete credential DB + policy, reboot
    const unlockScript = `
# 1. Disable Advantech OEM Lockscreen
pm clear advantech.android.lockscreen 2>/dev/null
pm disable-user advantech.android.lockscreen 2>/dev/null
pm disable advantech.android.lockscreen 2>/dev/null
rm -rf /data/data/advantech.android.lockscreen 2>/dev/null
rm -rf /data/user/0/advantech.android.lockscreen 2>/dev/null

# 2. Stop keystore services before touching credential files
stop gatekeeperd 2>/dev/null
stop keystore 2>/dev/null
sleep 1

# 3. Delete locksettings database (credential hash store) and device policies
rm -f /data/system/locksettings.db 2>/dev/null
rm -f /data/system/locksettings.db-shm 2>/dev/null
rm -f /data/system/locksettings.db-wal 2>/dev/null
rm -f /data/system/device_policies.xml 2>/dev/null
rm -f /data/system/gesture.key 2>/dev/null
rm -f /data/system/password.key 2>/dev/null
rm -f /data/system/pattern.key 2>/dev/null
rm -f /data/system/gatekeeper.* 2>/dev/null
rm -f /data/system/users/0/gatekeeper.* 2>/dev/null
rm -f /data/system/users/0/*.key 2>/dev/null
rm -rf /data/system/users/0/spblob/* 2>/dev/null
rm -rf /data/misc/gatekeeper/* 2>/dev/null
rm -f /data/misc/keystore/user_0/*synthetic_password* 2>/dev/null
rm -f /data/misc/keystore/user_0/.*synthetic_password* 2>/dev/null

# 4. Restart keystore services
start keystore 2>/dev/null
start gatekeeperd 2>/dev/null

# 5. Disable lockscreen in settings
settings put secure lockscreen.disabled 1
settings put secure lockscreen.password_type 0
settings put secure lockscreen.password_salt ''
settings put secure lockscreen.password_history ''
settings put global lockscreen.disabled 1

# 6. Reboot to apply (clears all in-memory lock state)
reboot
`;

    const res = await this.execSuScript(target, unlockScript);
    // Device will reboot automatically - no further commands needed

    return {
      success: true,
      output: 'Đã xóa mật khẩu/PIN thành công! Thiết bị đang reboot để áp dụng. Sau khi khởi động lại, màn hình sẽ không còn yêu cầu PIN.',
      details: res.stdout || res.stderr
    };
  }

  async setAutoStartApp(target, packageName) {
    if (!packageName) return { success: false, message: 'Chưa chọn package ứng dụng' };
    const targetArgs = this.getTargetArg(target);

    // 1. Find launcher activity for this package
    const dumpRes = await this.execCommand([...targetArgs, 'shell', `cmd package resolve-activity --brief ${packageName}`]);
    let activityName = '';
    if (dumpRes.stdout) {
      const lines = dumpRes.stdout.trim().split('\n');
      for (const l of lines) {
        if (l.includes('/') && l.includes(packageName)) {
          activityName = l.trim();
          break;
        }
      }
    }

    // 2. Commands to set default launcher, whitelist battery, allow background & boot run
    const script = `
# Set home activity (Default Launcher / Kiosk mode)
cmd package set-home-activity ${activityName || packageName}
cmd package set-home-activity ${packageName}

# Whitelist from battery optimization & doze mode
dumpsys deviceidle whitelist +${packageName}

# Grant BOOT_COMPLETED and background permissions
appops set ${packageName} BOOT_COMPLETED allow
appops set ${packageName} RUN_IN_BACKGROUND allow
appops set ${packageName} SYSTEM_ALERT_WINDOW allow

# Set Android vendor persist properties (if supported)
setprop persist.sys.defaultapp ${packageName}
setprop persist.sys.auto_start ${packageName}

# Test launch app now
am start -n ${activityName || packageName}
`;

    const suRes = await this.execSuScript(target, script);

    // Also run direct commands via shell as fallback
    if (activityName) {
      await this.execCommand([...targetArgs, 'shell', `cmd package set-home-activity ${activityName}`]);
    }
    await this.execCommand([...targetArgs, 'shell', `dumpsys deviceidle whitelist +${packageName}`]);
    await this.execCommand([...targetArgs, 'shell', `monkey -p ${packageName} -c android.intent.category.LAUNCHER 1`]);

    return {
      success: true,
      packageName,
      activity: activityName,
      output: `Đã thiết lập ứng dụng [${packageName}] làm ứng dụng mặc định & tự động khởi động cùng hệ thống (Auto-Start / Kiosk)!`,
      details: suRes.stdout || suRes.stderr
    };
  }

  findSystemDirectory(startDir) {
    if (!startDir || !fs.existsSync(startDir)) return null;

    // Check if direct system subdirectory exists
    const directSystem = path.join(startDir, 'system');
    if (fs.existsSync(directSystem) && fs.statSync(directSystem).isDirectory()) {
      if (fs.existsSync(path.join(directSystem, 'priv-app')) || fs.existsSync(path.join(directSystem, 'app')) || fs.existsSync(path.join(directSystem, 'framework'))) {
        return directSystem;
      }
    }

    // Check if startDir itself is the system folder
    if (fs.existsSync(path.join(startDir, 'priv-app')) || fs.existsSync(path.join(startDir, 'framework'))) {
      return startDir;
    }

    // Search 1-3 levels deep
    try {
      const items = fs.readdirSync(startDir);
      for (const item of items) {
        const itemPath = path.join(startDir, item);
        if (fs.statSync(itemPath).isDirectory()) {
          const res = this.findSystemDirectory(itemPath);
          if (res) return res;
        }
      }
    } catch (e) {}
    return null;
  }

  getOpenGAppsPicoPath() {
    const execDir = path.dirname(process.execPath);
    const candidates = [
      path.join(ROOT_DIR, 'packages'),
      path.join(ROOT_DIR, 'packages/pico-8.1'),
      path.join(execDir, 'packages'),
      path.join(execDir, 'packages/pico-8.1'),
      path.join(process.cwd(), 'packages'),
      path.join(process.cwd(), 'packages/pico-8.1'),
      path.join(__dirname, '../../packages'),
      path.join(__dirname, '../../packages/pico-8.1')
    ];

    for (const c of candidates) {
      const found = this.findSystemDirectory(c);
      if (found) return found;
    }
    return null;
  }

  async installOpenGApps(target, customPath = '', autoReset = true) {
    const targetArgs = this.getTargetArg(target);

    let systemDir = customPath ? this.findSystemDirectory(customPath) : this.getOpenGAppsPicoPath();

    if (!systemDir || !fs.existsSync(systemDir)) {
      return {
        success: false,
        error: 'Chưa tìm thấy thư mục system của bộ OpenGApps Pico x86_64! Vui lòng tải file ZIP lên kho trước.'
      };
    }

    // 1. Root
    await this.execCommand([...targetArgs, 'root']);

    // 2. Remount
    const remountRes = await this.execCommand([...targetArgs, 'remount']);
    if (!remountRes.success && !remountRes.stdout.toLowerCase().includes('remount succeeded')) {
      return {
        success: false,
        error: 'adb remount thất bại: ' + (remountRes.stdout || remountRes.stderr)
      };
    }

    // 3. Push the exact system folder to /
    const pushRes = await this.execCommand([...targetArgs, 'push', `"${systemDir}"`, '/'], { timeout: 240000 });
    if (!pushRes.success) {
      return {
        success: false,
        error: 'Lỗi push file system vào thiết bị: ' + (pushRes.stderr || pushRes.stdout)
      };
    }

    // 4. Factory Reset if requested
    if (autoReset) {
      await this.factoryReset(target, 'android8');
    }

    return {
      success: true,
      output: 'Đã nạp thành công 30+ file OpenGApps Pico x86-64 vào /system và kích hoạt Factory Reset! Thiết bị đang tự khởi động lại...',
      details: pushRes.stdout
    };
  }

  async checkGooglePlayStatus(target) {
    const targetArgs = this.getTargetArg(target);
    const res = await this.execCommand([...targetArgs, 'shell', 'pm', 'list', 'packages', '-d']);
    const isGmsDisabled = res.stdout.includes('package:com.google.android.gms');
    return {
      success: true,
      isGmsDisabled
    };
  }

  async toggleGooglePlayServices(target, enable = false) {
    const targetArgs = this.getTargetArg(target);
    if (enable) {
      const cmd = 'pm enable com.google.android.gms; pm enable com.google.android.gsf; pm enable com.android.vending';
      const res = await this.execCommand([...targetArgs, 'shell', cmd]);
      return {
        success: true,
        isGmsDisabled: false,
        output: 'Đã BẬT LẠI Google Play Services!',
        details: res.stdout
      };
    } else {
      const cmd = 'pm disable-user com.google.android.gms; pm disable-user com.google.android.gsf; pm disable-user com.android.vending';
      const res = await this.execCommand([...targetArgs, 'shell', cmd]);
      return {
        success: true,
        isGmsDisabled: true,
        output: 'Đã VÔ HIỆU HÓA Google Play Services. Đã tắt triệt để thông báo lỗi dừng ứng dụng!',
        details: res.stdout
      };
    }
  }

  async clearGooglePlayCache(target) {
    const targetArgs = this.getTargetArg(target);
    const cmd = 'pm clear com.google.android.gms; pm clear com.google.android.gsf; pm clear com.android.vending';
    const res = await this.execCommand([...targetArgs, 'shell', cmd]);
    return {
      success: true,
      output: 'Đã xóa toàn bộ Cache & Dữ liệu của Google Play Services!',
      details: res.stdout
    };
  }

  async restartApp(target, packageName) {
    const pkg = packageName || DataStore.getSettings()?.smartDisplayPackage || DEFAULT_LAUNCHER_PKG;
    const targetArgs = this.getTargetArg(target);
    await this.execCommand([...targetArgs, 'shell', 'am', 'force-stop', pkg]);
    const launchRes = await this.execCommand([...targetArgs, 'shell', 'monkey', '-p', pkg, '-c', 'android.intent.category.LAUNCHER', '1']);
    return {
      success: launchRes.success && !launchRes.stdout.includes('No activities found'),
      output: launchRes.stdout || launchRes.stderr
    };
  }

  async clearAppData(target, packageName) {
    const pkg = packageName || DataStore.getSettings()?.smartDisplayPackage || DEFAULT_LAUNCHER_PKG;
    const targetArgs = this.getTargetArg(target);
    const res = await this.execCommand([...targetArgs, 'shell', 'pm', 'clear', pkg]);
    const success = res.stdout.toLowerCase().includes('success');
    return {
      success,
      output: res.stdout || res.stderr
    };
  }

  async sendKey(target, keyNameOrAction) {
    const targetArgs = this.getTargetArg(target);

    if (keyNameOrAction === 'KEYCODE_SETTINGS' || keyNameOrAction === 'ACTION_SETTINGS') {
      return await this.execCommand([...targetArgs, 'shell', 'am', 'start', '-a', 'android.settings.SETTINGS']);
    }
    if (keyNameOrAction === 'ACTION_WIFI') {
      return await this.execCommand([...targetArgs, 'shell', 'am', 'start', '-a', 'android.settings.WIFI_SETTINGS']);
    }
    if (keyNameOrAction === 'ACTION_RESET_MENU') {
      return await this.execCommand([...targetArgs, 'shell', 'am', 'start', '-a', 'android.settings.BACKUP_AND_RESET_SETTINGS']);
    }
    // FIX: 2 lệnh liền nhau phải chạy qua execDeviceShell — cmd.exe nuốt dấu ';' nếu đưa qua execCommand
    if (keyNameOrAction === 'KEYCODE_WAKEUP' || keyNameOrAction === 'ACTION_WAKEUP') {
      return await this.execDeviceShell(target, 'input keyevent 224\ninput keyevent 82');
    }
    if (keyNameOrAction === 'KEYCODE_MENU') {
      return await this.execDeviceShell(target, 'input keyevent 82\ninput keyevent 187');
    }
    if (keyNameOrAction === 'KEYCODE_APP_SWITCH') {
      return await this.execCommand([...targetArgs, 'shell', 'input', 'keyevent', '187']);
    }

    let code = keyNameOrAction;
    if (typeof keyNameOrAction === 'string' && keycodes[keyNameOrAction] !== undefined) {
      code = keycodes[keyNameOrAction];
    }
    const res = await this.execCommand([...targetArgs, 'shell', 'input', 'keyevent', code.toString()]);
    return res;
  }

  async sendText(target, text) {
    const targetArgs = this.getTargetArg(target);
    // FIX: Chạy qua execDeviceShell (stdin) để tránh cmd.exe nuốt ký tự đặc biệt ; | & > < ^ %
    const escaped = text.replace(/\s/g, '%s').replace(/['"]/g, '');
    return await this.execDeviceShell(target, `input text '${escaped}'`);
  }

  async sendTap(target, x, y) {
    const targetArgs = this.getTargetArg(target);
    const res = await this.execCommand([...targetArgs, 'shell', 'input', 'tap', Math.round(x).toString(), Math.round(y).toString()]);
    return res;
  }

  async sendSwipe(target, x1, y1, x2, y2, duration = 300) {
    const targetArgs = this.getTargetArg(target);
    const res = await this.execCommand([...targetArgs, 'shell', 'input', 'swipe', x1.toString(), y1.toString(), x2.toString(), y2.toString(), duration.toString()]);
    return res;
  }

  async takeScreenshot(target) {
    const targetArgs = this.getTargetArg(target);
    const adbBin = this.getAdbPath();
    return new Promise((resolve) => {
      const child = spawn(adbBin, [...targetArgs, 'exec-out', 'screencap', '-p'], { windowsHide: true });
      const chunks = [];
      let errData = '';

      child.stdout.on('data', (data) => chunks.push(data));
      child.stderr.on('data', (data) => errData += data.toString());

      child.on('close', (code) => {
        if (code === 0 && chunks.length > 0) {
          const buffer = Buffer.concat(chunks);
          resolve({
            success: true,
            buffer: buffer,
            base64: 'data:image/png;base64,' + buffer.toString('base64')
          });
        } else {
          resolve({
            success: false,
            error: errData || `Exit code ${code}`
          });
        }
      });

      child.on('error', (err) => {
        resolve({ success: false, error: err.message });
      });
    });
  }

  async installApk(target, apkFilePath, options = {}) {
    const targetArgs = this.getTargetArg(target);
    const args = [...targetArgs, 'install', '-r', '-t'];
    if (options.grantPermissions) {
      args.push('-g');
    }
    args.push(apkFilePath);

    const res = await this.execCommand(args, { timeout: 120000 });
    const success = res.stdout.toLowerCase().includes('success');
    return {
      success,
      output: res.stdout || res.stderr,
      error: !success ? (res.stderr || res.stdout) : null
    };
  }

  async uninstallPackage(target, packageName) {
    const targetArgs = this.getTargetArg(target);
    const res = await this.execCommand([...targetArgs, 'uninstall', packageName]);
    const success = res.stdout.toLowerCase().includes('success');
    return {
      success,
      output: res.stdout || res.stderr
    };
  }

  async listInstalledPackages(target, thirdPartyOnly = false) {
    const targetArgs = this.getTargetArg(target);
    const args = [...targetArgs, 'shell', 'pm', 'list', 'packages'];
    if (thirdPartyOnly) args.push('-3');

    const res = await this.execCommand(args);
    if (!res.success) return { success: false, error: res.error, packages: [] };

    const packages = res.stdout.split('\n')
      .map(l => l.trim().replace(/^package:/, '').replace(/\r/, ''))
      .filter(l => l.length > 0);
    return { success: true, packages };
  }

  async getDeviceInfo(target) {
    const targetArgs = this.getTargetArg(target);
    const cmds = [
      'getprop ro.product.model',
      'getprop ro.product.brand',
      'getprop ro.build.version.release',
      'getprop ro.build.version.sdk',
      'wm size',
      'df -h /data',
      'uptime',
      'pm list packages -d',
      'date'
    ];

    const results = {};
    for (const cmd of cmds) {
      const r = await this.execCommand([...targetArgs, 'shell', cmd]);
      results[cmd] = r.stdout;
    }

    const wmMatch = (results['wm size'] || '').match(/Physical size: (\d+x\d+)/);
    const dfLines = (results['df -h /data'] || '').split('\n');
    let diskFree = '';
    if (dfLines.length >= 2) {
      const diskParts = dfLines[1].trim().split(/\s+/);
      diskFree = diskParts.length >= 4 ? `Dung lượng trống: ${diskParts[3]} / ${diskParts[1]}` : '';
    }

    const isGmsDisabled = (results['pm list packages -d'] || '').includes('package:com.google.android.gms');

    return {
      model: results['getprop ro.product.model'] || 'Unknown',
      brand: results['getprop ro.product.brand'] || '',
      androidVersion: results['getprop ro.build.version.release'] || '',
      sdkVersion: results['getprop ro.build.version.sdk'] || '',
      resolution: wmMatch ? wmMatch[1] : (results['wm size'] || ''),
      storage: diskFree,
      uptime: results['uptime'] || '',
      time: results['date'] || '',
      isGmsDisabled
    };
  }

  // FIX: Viết lại toàn bộ — bản cũ gửi `date ... 2>/dev/null || date -s "..."` qua cmd.exe
  // nên Windows nuốt 2>/dev/null + ||, lệnh date không bao giờ tới được thiết bị.
  async syncTime(target, timezone = 'Asia/Ho_Chi_Minh') {
    const targetWithPort = target.includes(':') ? target : `${target}:5555`;
    const targetArgs = ['-s', targetWithPort];

    // 1. Đảm bảo đã kết nối ADB
    if (target.includes('.')) {
      await this.execCommand(['connect', targetWithPort], { timeout: 5000 });
    }

    const d = new Date();
    // FIX: Tính giờ theo TARGET TIMEZONE (không dùng giờ local server) để tránh lệch giờ khi server khác timezone
    const pad = (n) => n.toString().padStart(2, '0');
    let timeToybox;
    try {
      const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false
      });
      const parts = fmt.formatToParts(d);
      const get = (type) => parts.find(p => p.type === type)?.value || '00';
      timeToybox = `${get('month')}${get('day')}${get('hour')}${get('minute')}${get('year')}.${get('second')}`;
    } catch (_) {
      // Fallback nếu Node build thiếu ICU: dùng giờ local server
      timeToybox = `${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${d.getFullYear()}.${pad(d.getSeconds())}`;
    }

    // Script chạy TRÊN THIẾT BỊ — tắt NTP trước để không bị ghi đè, set timezone, rồi set giờ
    const script = [
      'settings put global auto_time 0',
      'settings put global auto_time_zone 0',
      `setprop persist.sys.timezone ${timezone}`,
      `date ${timeToybox}`,
      'date'
    ].join('\n');

    // 2. Cách 1: qua su (SuperSU/Magisk) — script đi vào stdin của adb shell nên ; | 2>/dev/null đều chạy đúng phía thiết bị
    await this.execSuScript(target, script);

    let devTime = await this.readDeviceTime(target);
    let ok = devTime && Math.abs(devTime.getTime() - Date.now()) < 120000;

    // 3. Cách 2 (fallback): adb root rồi chạy thẳng shell thường
    if (!ok) {
      await this.execCommand([...targetArgs, 'root'], { timeout: 4000 });
      await new Promise(r => setTimeout(r, 1500));
      if (target.includes('.')) {
        await this.execCommand(['connect', targetWithPort], { timeout: 4000 });
      }
      await this.execDeviceShell(target, script);
      devTime = await this.readDeviceTime(target);
      ok = devTime && Math.abs(devTime.getTime() - Date.now()) < 120000;
    }

    return {
      success: ok,
      sentStamp: timeToybox,
      deviceTime: devTime ? devTime.toString() : '(không đọc được)',
      output: ok
        ? `Đã đồng bộ giờ thành công! Giờ thiết bị: ${devTime}`
        : `Đã gửi lệnh nhưng giờ thiết bị chưa khớp máy chủ (hiện tại: ${devTime || 'n/a'}). Thiết bị cần quyền root (su hoặc adb root) để đặt giờ.`
    };
  }

  streamLogcat(target, ws, filter = {}) {
    const targetArgs = this.getTargetArg(target);
    const adbBin = this.getAdbPath();
    const args = [...targetArgs, 'logcat', '-v', 'time'];
    if (filter.level) {
      args.push(`*:${filter.level}`);
    }

    const child = spawn(adbBin, args, { windowsHide: true });

    child.stdout.on('data', (data) => {
      const text = data.toString();
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({
          type: 'logcat',
          target,
          data: text
        }));
      }
    });

    child.stderr.on('data', (data) => {
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({
          type: 'logcat_error',
          target,
          data: data.toString()
        }));
      }
    });

    return child;
  }

  /**
   * Trích xuất thông tin package và activity đang hiển thị trên foreground từ dumpsys window
   */
  parseFocusedPackage(windowDumpText) {
    if (!windowDumpText) return { line: '', pkg: '', activity: '' };
    const focusMatch = windowDumpText.match(/mCurrentFocus[^\r\n]+/i) || windowDumpText.match(/mFocusedApp[^\r\n]+/i);
    if (!focusMatch) return { line: '', pkg: '', activity: '' };
    const line = focusMatch[0].trim();

    const cmpMatch = line.match(/u\d+\s+([a-zA-Z0-9_\.]+)\/([a-zA-Z0-9_\.\$]+)/) ||
                     line.match(/([a-zA-Z0-9_\.]+)\/([a-zA-Z0-9_\.\$]+)/);
    const pkg = cmpMatch ? cmpMatch[1] : '';
    const activity = cmpMatch ? cmpMatch[2] : '';
    return { line, pkg, activity };
  }

  /**
   * Lấy nhanh focus hiện tại trên màn hình
   */
  async getCurrentFocusInfo(target) {
    const targetWithPort = target.includes(':') ? target : `${target}:5555`;
    const targetArgs = ['-s', targetWithPort];
    const res = await this.execCommand([...targetArgs, 'shell', 'dumpsys', 'window'], { timeout: 7000 });
    const fullText = (res.stdout || '') + ' ' + (res.stderr || '');
    return this.parseFocusedPackage(fullText);
  }

  /**
   * Kiểm tra xem màn hình đang chạy Launcher SmartDisplay hay bị văng ra ngoài,
   * hoặc có bị tắt màn hình (Asleep) hay bị lỗi trắng màn (Day ngoài khoảng) không.
   * Nếu phát hiện lỗi, tự động phục hồi và sửa lỗi ngay tại chỗ mà KHÔNG mất Mã KH!
   */
  async checkAndRestoreLauncher(target, targetPackage = null, autoFixWhiteScreen = true, autoDisconnect = true) {
    if (!targetPackage) targetPackage = DataStore.getSettings()?.smartDisplayPackage || DEFAULT_LAUNCHER_PKG;
    const targetWithPort = target.includes(':') ? target : `${target}:5555`;
    const targetArgs = ['-s', targetWithPort];

    try {
      // 1. Kiểm tra kết nối ADB trước
      if (target.includes('.')) {
        const connRes = await this.execCommand(['connect', targetWithPort], { timeout: 3500 });
        const connOut = (connRes.stdout || '').toLowerCase();
        if (!connOut.includes('connected to') && !connOut.includes('already connected')) {
          return {
            success: false,
            target,
            status: 'offline',
            message: 'Không thể kết nối cổng ADB'
          };
        }
      }

      // 2. Đánh thức màn hình và cấu hình không bao giờ tắt (tránh lỗi ngủ màn hình)
      const keepAwake = 'settings put system screen_off_timeout 2147483647\nsettings put global stay_on_while_plugged_in 7';
      const powerRes = await this.execCommand([...targetArgs, 'shell', 'dumpsys', 'power'], { timeout: 3500 });
      const powerText = (powerRes.stdout || '');
      const isAsleep = powerText.includes('mWakefulness=Asleep') || powerText.includes('Display Power: state=OFF');
      if (isAsleep) {
        await this.execDeviceShell(target, 'input keyevent KEYCODE_WAKEUP\nwm dismiss-keyguard\n' + keepAwake, { timeout: 5000 });
      } else {
        await this.execDeviceShell(target, keepAwake, { timeout: 3000 });
      }

      // 3. Lấy chính xác app đang hiển thị trên foreground
      const focusInfo = await this.getCurrentFocusInfo(target);
      const currentPkg = focusInfo.pkg;
      const focusLine = focusInfo.line;

      // Kiểm tra xem màn hình hiện tại có ĐANG FOCUS vào SmartDisplay không
      // FIX: Dùng suffix từ targetPackage thay vì hardcode 'hongngocdisplay'
      const pkgSuffix = targetPackage.split('.').pop();
      const isInSmartDisplay = currentPkg === targetPackage || currentPkg.includes(pkgSuffix);

      // 4. Nếu ĐANG ở trong SmartDisplay: Kiểm tra lỗi TRẮNG MÀN HÌNH (Day ngoài khoảng)
      if (isInSmartDisplay) {
        if (autoFixWhiteScreen) {
          const logRes = await this.execCommand([...targetArgs, 'shell', 'logcat', '-d', '-t', '150'], { timeout: 3500 });
          const hasWhiteScreenBug = (logRes.stdout || '').includes('Day ngoai khoang');

          if (hasWhiteScreenBug) {
            // Tự động sửa lỗi trắng màn hình và tải lại lịch phát mà KHÔNG làm mất Mã KH
            const fixRes = await this.fixWhiteScreenKeepCode(target);
            return {
              success: fixRes.success,
              target,
              status: fixRes.success ? 'fixed_white_screen' : 'error',
              currentFocus: focusLine,
              message: fixRes.success
                ? 'Phát hiện lỗi trắng màn (Day ngoài khoảng) -> Đã tự động sửa & tải lại nội dung thành công (Giữ Mã KH)!'
                : `Phát hiện lỗi trắng màn nhưng sửa thất bại: ${fixRes.message}`
            };
          }
        }

        return {
          success: true,
          target,
          status: 'ok',
          currentFocus: focusLine,
          message: isAsleep ? 'Đang chạy SmartDisplay (đã đánh thức màn hình)' : 'Đang chạy đúng Launcher SmartDisplay'
        };
      }

      // 5. Nếu bị OUT Launcher -> Phục hồi lại Launcher đa tầng
      // BƯỚC 5.1: Xử lý ứng dụng chiếm quyền hoặc dialog crash chặn màn hình
      if (currentPkg && !currentPkg.includes(targetPackage) && !currentPkg.includes(pkgSuffix)) {
        if (currentPkg === 'android' || currentPkg.includes('systemui')) {
          // Dialog crash / ANR popup ("Ứng dụng đã dừng lại") -> nhấn BACK và ENTER để tắt
          await this.execCommand([...targetArgs, 'shell', 'input', 'keyevent', '4'], { timeout: 2000 });
          await this.execCommand([...targetArgs, 'shell', 'input', 'keyevent', '66'], { timeout: 2000 });
        } else {
          // Buộc dừng ứng dụng chiếm màn hình (YouTube, Chrome, Settings, Video Player...)
          await this.execCommand([...targetArgs, 'shell', 'am', 'force-stop', currentPkg], { timeout: 3000 });
        }
      }

      // BƯỚC 5.2: Cấu hình lại SmartDisplay là Home Launcher mặc định — resolve activity thật thay vì hardcode .SplashActivity
      try {
        const resolveRes = await this.execCommand([...targetArgs, 'shell', `cmd package resolve-activity --brief ${targetPackage}`], { timeout: 3000 });
        const compLine = (resolveRes.stdout || '').split('\n').find(l => l.includes('/') && l.includes(targetPackage));
        const compName = compLine ? compLine.trim() : `${targetPackage}/.MainActivity`;
        await this.execCommand([...targetArgs, 'shell', 'cmd', 'package', 'set-home-activity', compName], { timeout: 3000 });
      } catch (_) {}

      // BƯỚC 5.3: Kích hoạt đưa Launcher lên tiền cảnh (monkey + Intent HOME + Keycode HOME)
      await this.execDeviceShell(target,
        `monkey -p ${targetPackage} -c android.intent.category.LAUNCHER 1\n` +
        `am start -a android.intent.action.MAIN -c android.intent.category.HOME\n` +
        `input keyevent 3`,
        { timeout: 7000 }
      );
      await new Promise(r => setTimeout(r, 1500));

      // BƯỚC 5.4: Kiểm tra lại focus thực tế xem đã về SmartDisplay chưa
      let recheckInfo = await this.getCurrentFocusInfo(target);
      let restored = recheckInfo.pkg === targetPackage || recheckInfo.pkg.includes(pkgSuffix);

      // BƯỚC 5.5: Nếu vẫn chưa được (app bị treo process ngầm / ANR), khởi động lại process của SmartDisplay
      if (!restored) {
        await this.execCommand([...targetArgs, 'shell', 'am', 'force-stop', targetPackage], { timeout: 3000 });
        await new Promise(r => setTimeout(r, 500));
        await this.execDeviceShell(target,
          `monkey -p ${targetPackage} -c android.intent.category.LAUNCHER 1\n` +
          `input keyevent 3`,
          { timeout: 7000 }
        );
        await new Promise(r => setTimeout(r, 2000));

        recheckInfo = await this.getCurrentFocusInfo(target);
        restored = recheckInfo.pkg === targetPackage || recheckInfo.pkg.includes(pkgSuffix);
      }

      // 6. Nếu vừa phục hồi vào lại app, kiểm tra xem có bị trắng màn không
      if (restored && autoFixWhiteScreen) {
        const logResAfter = await this.execCommand([...targetArgs, 'shell', 'logcat', '-d', '-t', '150'], { timeout: 3500 });
        if ((logResAfter.stdout || '').includes('Day ngoai khoang')) {
          const fixRes = await this.fixWhiteScreenKeepCode(target);
          return {
            success: fixRes.success,
            target,
            status: fixRes.success ? 'fixed_white_screen' : 'restored',
            previousFocus: focusLine || 'Màn hình ngoài/Desktop',
            currentFocus: recheckInfo.line,
            message: fixRes.success
              ? 'Đã phục hồi Launcher và tự động sửa luôn lỗi trắng màn hình (Giữ Mã KH)!'
              : 'Đã phục hồi Launcher.'
          };
        }
      }

      return {
        success: restored,
        target,
        status: restored ? 'restored' : 'failed',
        previousFocus: focusLine || 'Màn hình ngoài/Desktop',
        currentFocus: recheckInfo.line,
        message: restored
          ? `Đã tự động phục hồi đưa về Launcher ${targetPackage} thành công!`
          : `Phát hiện out Launcher (${focusLine || 'Desktop'}) nhưng chưa thể tự mở lại.`
      };
    } finally {
      if (autoDisconnect && target.includes('.')) {
        try {
          await this.disconnect(target);
        } catch (_) {}
      }
    }
  }

  /**
   * Sửa lỗi trắng màn hình / treo cập nhật mà KHÔNG làm mất Mã Kích Hoạt (Mã KH).
   * FIX: Đọc Authorization.xml qua execSuScript (stdin) thay vì chuỗi có || 2>/dev/null qua cmd.exe.
   * FIX: Parse UID bằng JS thay vì pipe sang awk (cmd.exe nuốt ký tự |).
   * FIX: Mở lại app bằng monkey (tự resolve activity thật) thay vì hardcode .SplashActivity.
   */
  async fixWhiteScreenKeepCode(target) {
    const targetWithPort = target.includes(':') ? target : `${target}:5555`;
    const targetArgs = ['-s', targetWithPort];
    const ip = target.includes(':') ? target.split(':')[0] : target;
    // FIX: đọc package từ settings thay vì hardcode
    const PKG = DataStore.getSettings()?.smartDisplayPackage || DEFAULT_LAUNCHER_PKG;
    const APP_DATA = `/data/data/${PKG}`;
    const AUTH_PATH = `${APP_DATA}/shared_prefs/Authorization.xml`;

    // 1. Đảm bảo kết nối ADB
    if (target.includes('.')) {
      await this.execCommand(['connect', targetWithPort], { timeout: 4000 });
    }

    // 2. Bật màn hình và thiết lập không bao giờ tắt màn hình
    await this.execDeviceShell(target, 'input keyevent KEYCODE_WAKEUP\nwm dismiss-keyguard\nsettings put system screen_off_timeout 2147483647\nsettings put global stay_on_while_plugged_in 7', { timeout: 6000 });

    // 3. Tắt ứng dụng SmartDisplay
    await this.execCommand([...targetArgs, 'shell', 'am', 'force-stop', PKG]);

    // 4. Trích xuất Authorization.xml hiện tại để lấy device_token_smart
    let authText = '';
    const suRead = await this.execSuScript(target, `cat ${AUTH_PATH}`);
    authText = suRead.stdout || '';
    if (!authText.includes('<map')) {
      // Fallback: shell thường (máy đã root adbd)
      const plainRead = await this.execDeviceShell(target, `cat ${AUTH_PATH}`);
      authText = plainRead.stdout || '';
    }

    let token = '';
    let typeDisplay = 2;
    let typeTouch = 1;
    let totalCellLayout = 1;
    let wifiAddress = ip;

    const tokenMatch = authText.match(/name="device_token_smart">([^<]+)</);
    if (tokenMatch) {
      token = tokenMatch[1].trim();
    }
    const typeDisplayMatch = authText.match(/name="type_display" value="(\d+)"/);
    if (typeDisplayMatch) {
      typeDisplay = parseInt(typeDisplayMatch[1], 10);
    }
    const wifiMatch = authText.match(/name="device_wifi_address">([^<]+)</);
    if (wifiMatch) {
      wifiAddress = wifiMatch[1].trim();
    }

    // Nếu không đọc được từ thiết bị, thử tìm token dự phòng từ database devices.json
    if (!token) {
      try {
        const devices = DataStore.getDevices() || [];
        const found = devices.find(d => d.ip === ip || d.ip === target);
        if (found && found.raw && found.raw.device_token) {
          token = found.raw.device_token;
        }
      } catch (e) {}
    }

    if (!token) {
      return {
        success: false,
        target,
        message: 'Không tìm thấy Token kích hoạt của thiết bị (máy chưa kích hoạt hoặc không có quyền Root).'
      };
    }

    // 5. Tạo nội dung Authorization.xml sạch (CHỈ giữ token và cấu hình gốc, xóa sạch ngày/cờ download cũ)
    const cleanXml = [
      "<?xml version='1.0' encoding='utf-8' standalone='yes' ?>",
      '<map>',
      `    <string name="device_token_smart">${token}</string>`,
      `    <int name="type_display" value="${typeDisplay}" />`,
      `    <string name="device_wifi_address">${wifiAddress}</string>`,
      `    <int name="type_touch" value="${typeTouch}" />`,
      `    <int name="total_cell_layout" value="${totalCellLayout}" />`,
      '</map>'
    ].join('\n');

    // Ghi file tạm local rồi push lên /sdcard
    const tmpLocal = path.join(ROOT_DIR, `temp_auth_${Date.now()}_${Math.random().toString(36).substr(2, 5)}.xml`);
    fs.writeFileSync(tmpLocal, cleanXml, 'utf8');
    const pushRes = await this.execCommand([...targetArgs, 'push', `"${tmpLocal}"`, '/sdcard/Authorization.xml']);
    try { fs.unlinkSync(tmpLocal); } catch (e) {}

    // FIX: Kiểm tra push thành công trước khi cp — nếu push fail thì cp sẽ ghi đè file cũ bằng rỗng
    if (!pushRes.success) {
      return {
        success: false,
        target,
        message: 'Không thể đẩy file Authorization.xml lên thiết bị: ' + (pushRes.stderr || pushRes.stdout || pushRes.error)
      };
    }

    // 6. Ghi đè vào data app và xoá database Realm lỗi, cache lỗi (chạy dưới quyền root)
    const applyScript = [
      `cp /sdcard/Authorization.xml ${AUTH_PATH}`,
      `rm -f ${APP_DATA}/files/smartdisplay.realm*`,
      `rm -rf ${APP_DATA}/cache/*`,
      `rm -f ${APP_DATA}/app_mediahome/*.temp`,
      `chmod 660 ${AUTH_PATH}`,
      'rm -f /sdcard/Authorization.xml'
    ].join('\n');
    await this.execSuScript(target, applyScript);

    // Lấy UID thực tế của app để chown chính xác — parse bằng JS, KHÔNG pipe sang awk
    const lsRes = await this.execSuScript(target, `ls -ld ${APP_DATA}`);
    const lsLine = ((lsRes.stdout || '').split('\n').find(l => l.trim().startsWith('d')) || '').trim();
    const appUid = lsLine ? (lsLine.split(/\s+/)[2] || '') : '';
    if (appUid && /^u\d+_/.test(appUid)) {
      await this.execSuScript(target, `chown ${appUid}:${appUid} ${AUTH_PATH}`);
    }

    // 7. Khởi động lại ứng dụng — monkey tự tìm activity THẬT (.MainActivity trên máy của mày)
    await this.execDeviceShell(target, `monkey -p ${PKG} -c android.intent.category.LAUNCHER 1`);

    return {
      success: true,
      target,
      token,
      message: 'Đã xóa dữ liệu lỗi, bảo lưu Mã KH thành công và kích hoạt tải lại nội dung mới!'
    };
  }
}

module.exports = new AdbManager();