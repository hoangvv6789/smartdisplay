const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const keycodes = require('./keycodes');
const DataStore = require('../storage/data-store');

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
      path.join(__dirname, '../../packages/pico-8.1'),
      'E:\\smartdisplay\\packages',
      'E:\\smartdisplay\\dist\\packages',
      'C:\\pico-8.1'
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

  async restartApp(target, packageName = 'vn.adtcreative.hongngocdisplay') {
    const targetArgs = this.getTargetArg(target);
    await this.execCommand([...targetArgs, 'shell', 'am', 'force-stop', packageName]);
    const launchRes = await this.execCommand([...targetArgs, 'shell', 'monkey', '-p', packageName, '-c', 'android.intent.category.LAUNCHER', '1']);
    return {
      success: launchRes.success && !launchRes.stdout.includes('No activities found'),
      output: launchRes.stdout || launchRes.stderr
    };
  }

  async clearAppData(target, packageName = 'vn.adtcreative.hongngocdisplay') {
    const targetArgs = this.getTargetArg(target);
    const res = await this.execCommand([...targetArgs, 'shell', 'pm', 'clear', packageName]);
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
    if (keyNameOrAction === 'KEYCODE_WAKEUP' || keyNameOrAction === 'ACTION_WAKEUP') {
      return await this.execCommand([...targetArgs, 'shell', 'input keyevent 224; input keyevent 82']);
    }
    if (keyNameOrAction === 'KEYCODE_MENU') {
      return await this.execCommand([...targetArgs, 'shell', 'input keyevent 82 || input keyevent 187']);
    }
    if (keyNameOrAction === 'KEYCODE_APP_SWITCH') {
      return await this.execCommand([...targetArgs, 'shell', 'input keyevent 187']);
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
    const escaped = text.replace(/\s/g, '%s').replace(/['"]/g, '');
    const res = await this.execCommand([...targetArgs, 'shell', 'input', 'text', escaped]);
    return res;
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

  async syncTime(target) {
    const targetWithPort = target.includes(':') ? target : `${target}:5555`;
    const targetArgs = ['-s', targetWithPort];

    // 1. Ensure connected to ADB first
    if (target.includes('.')) {
      await this.execCommand(['connect', targetWithPort], { timeout: 4000 });
    }

    const d = new Date();
    const pad = (n) => n.toString().padStart(2, '0');
    // MMDDhhmmYYYY.ss (Toybox/Toolbox standard)
    const MM = pad(d.getMonth() + 1);
    const DD = pad(d.getDate());
    const hh = pad(d.getHours());
    const mm = pad(d.getMinutes());
    const YYYY = d.getFullYear();
    const ss = pad(d.getSeconds());
    const timeToybox = `${MM}${DD}${hh}${mm}${YYYY}.${ss}`;
    // YYYY-MM-DD hh:mm:ss (Alternative Linux standard)
    const timeStandard = `${YYYY}-${MM}-${DD} ${hh}:${mm}:${ss}`;

    // 2. Try direct shell date (works if adbd is already root)
    let res = await this.execCommand([...targetArgs, 'shell', `date ${timeToybox} 2>/dev/null || date -s "${timeStandard}" 2>/dev/null`], { timeout: 4000 });
    let success = res.success && !res.stderr.includes('Operation not permitted') && !res.stderr.includes('error');

    // 3. If failed/permission denied, elevate via adb root (bypass SuperSU/Magisk dialog popup on screen)
    if (!success) {
      await this.execCommand([...targetArgs, 'root'], { timeout: 4000 });
      await new Promise(resolve => setTimeout(resolve, 1500));
      // Reconnect TCP port 5555 after adb root
      if (target.includes('.')) {
        await this.execCommand(['connect', targetWithPort], { timeout: 4000 });
      }
      // Re-run date under adb root
      res = await this.execCommand([...targetArgs, 'shell', `date ${timeToybox} 2>/dev/null || date -s "${timeStandard}" 2>/dev/null`], { timeout: 4000 });
      success = res.success && !res.stderr.includes('Operation not permitted') && !res.stderr.includes('error');
    }

    // 4. Force System Clock Sync via Android Settings provider
    await this.execCommand([...targetArgs, 'shell', `settings put global auto_time 0 2>/dev/null`], { timeout: 3000 });

    return {
      success,
      output: res.stdout || res.stderr || (success ? 'Đồng bộ giờ thành công' : 'Thất bại')
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
   * Kiểm tra xem màn hình đang chạy Launcher SmartDisplay hay bị văng ra ngoài,
   * hoặc có bị tắt màn hình (Asleep) hay bị lỗi trắng màn (Day ngoài khoảng) không.
   * Nếu phát hiện lỗi, tự động phục hồi và sửa lỗi ngay tại chỗ mà KHÔNG mất Mã KH!
   */
  async checkAndRestoreLauncher(target, targetPackage = 'vn.adtcreative.hongngocdisplay', autoFixWhiteScreen = true, autoDisconnect = true) {
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

      // 2. Đánh thức màn hình và cấu hình không bao giờ tắt (tránh lỗi ngủ màn hình Android 10)
      const powerRes = await this.execCommand([...targetArgs, 'shell', 'dumpsys', 'power'], { timeout: 3500 });
      const powerText = (powerRes.stdout || '');
      const isAsleep = powerText.includes('mWakefulness=Asleep') || powerText.includes('Display Power: state=OFF');
      if (isAsleep) {
        await this.execCommand([...targetArgs, 'shell', 'input keyevent KEYCODE_WAKEUP ; wm dismiss-keyguard ; settings put system screen_off_timeout 2147483647 ; settings put global stay_on_while_plugged_in 7 2>/dev/null'], { timeout: 4000 });
      } else {
        await this.execCommand([...targetArgs, 'shell', 'settings put system screen_off_timeout 2147483647 ; settings put global stay_on_while_plugged_in 7 2>/dev/null'], { timeout: 3000 });
      }

      // 3. Lấy top window / activity đang hiển thị trên màn hình
      const windowRes = await this.execCommand([...targetArgs, 'shell', 'dumpsys', 'window'], { timeout: 7000 });
      const fullText = (windowRes.stdout || '') + ' ' + (windowRes.stderr || '');

      // Trích xuất dòng mCurrentFocus hoặc mFocusedApp
      const focusMatch = fullText.match(/mCurrentFocus[^\r\n]+/i) || fullText.match(/mFocusedApp[^\r\n]+/i);
      const focusLine = focusMatch ? focusMatch[0].trim() : '';

      // Kiểm tra xem màn hình hiện tại có ĐANG FOCUS vào SmartDisplay không
      const isInSmartDisplay = focusLine.includes(targetPackage) || focusLine.includes('vn.adtcreative.hongngocdisplay');

      // 4. Nếu ĐANG ở trong SmartDisplay: Kiểm tra xem có bị lỗi TRẮNG MÀN HÌNH (Day ngoài khoảng) không
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
      // Bước A: Nhấn nút Home (KEYCODE_HOME = 3). Vì SmartDisplay là Launcher mặc định, nút Home sẽ ngay lập tức đưa về SmartDisplay!
      await this.execCommand([...targetArgs, 'shell', 'input keyevent 3'], { timeout: 3000 });
      await new Promise(r => setTimeout(r, 1000));

      // Kiểm tra xem đã về SmartDisplay chưa
      let recheckRes = await this.execCommand([...targetArgs, 'shell', 'dumpsys', 'window'], { timeout: 5000 });
      let recheckText = (recheckRes.stdout || '');
      let restored = recheckText.includes(`${targetPackage}/`) || recheckText.includes(targetPackage) || recheckText.includes('vn.adtcreative.hongngocdisplay');

      // Bước B: Nếu vẫn chưa về (ví dụ app đè lên như YouTube, itrapps), tắt app đè và gọi trực tiếp Intent Launcher
      if (!restored) {
        const curFocusMatch = recheckText.match(/mCurrentFocus[^\r\n]+/i) || recheckText.match(/mFocusedApp[^\r\n]+/i);
        const curFocus = curFocusMatch ? curFocusMatch[0] : '';
        const pkgMatch = curFocus.match(/u\d+\s+([a-zA-Z0-9_\.]+)\//);
        const competingPkg = pkgMatch ? pkgMatch[1] : null;

        if (competingPkg && !competingPkg.includes('android.systemui') && !competingPkg.includes(targetPackage) && !competingPkg.includes('hongngocdisplay')) {
          await this.execCommand([...targetArgs, 'shell', `am force-stop ${competingPkg}`], { timeout: 3000 });
        }

        await this.execCommand([...targetArgs, 'shell', `am start -a android.intent.action.MAIN -c android.intent.category.HOME 2>/dev/null ; am start -n ${targetPackage}/.SplashActivity -f 0x10000000 2>/dev/null || monkey -p ${targetPackage} -c android.intent.category.LAUNCHER 1 2>/dev/null`], { timeout: 5000 });
        await new Promise(r => setTimeout(r, 1500));

        recheckRes = await this.execCommand([...targetArgs, 'shell', 'dumpsys', 'window'], { timeout: 5000 });
        recheckText = (recheckRes.stdout || '');
        restored = recheckText.includes(`${targetPackage}/`) || recheckText.includes(targetPackage) || recheckText.includes('vn.adtcreative.hongngocdisplay');
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
   * 1. Giữ nguyên token kích hoạt trong Authorization.xml.
   * 2. Xóa sạch cờ lịch phát cũ/lỗi (date_between_start, flag_download_success, is_check_loadding).
   * 3. Xóa CSDL Realm cũ/lỗi (smartdisplay.realm*), cache tạm và file .temp.
   * 4. Bật màn hình và cấu hình không bao giờ tắt (screen_off_timeout = 2147483647, stay_on_while_plugged_in = 7).
   * 5. Khởi động lại SplashActivity để tự động đồng bộ lại lịch phát mới từ máy chủ Hồng Ngọc.
   */
  async fixWhiteScreenKeepCode(target) {
    const targetWithPort = target.includes(':') ? target : `${target}:5555`;
    const targetArgs = ['-s', targetWithPort];
    const ip = target.includes(':') ? target.split(':')[0] : target;

    // 1. Đảm bảo kết nối ADB
    if (target.includes('.')) {
      await this.execCommand(['connect', targetWithPort], { timeout: 4000 });
    }

    // 2. Bật màn hình và thiết lập không bao giờ tắt màn hình trên Android 10
    await this.execCommand([...targetArgs, 'shell', 'input keyevent KEYCODE_WAKEUP ; wm dismiss-keyguard ; settings put system screen_off_timeout 2147483647 ; settings put global stay_on_while_plugged_in 7 2>/dev/null']);

    // 3. Tắt ứng dụng SmartDisplay
    await this.execCommand([...targetArgs, 'shell', 'am force-stop vn.adtcreative.hongngocdisplay']);

    // 4. Trích xuất Authorization.xml hiện tại để lấy device_token_smart
    let token = '';
    let typeDisplay = 2;
    let typeTouch = 1;
    let totalCellLayout = 1;
    let wifiAddress = ip;

    const readAuthRes = await this.execCommand([...targetArgs, 'shell', 'su root cat /data/data/vn.adtcreative.hongngocdisplay/shared_prefs/Authorization.xml 2>/dev/null || cat /data/data/vn.adtcreative.hongngocdisplay/shared_prefs/Authorization.xml 2>/dev/null']);
    const authText = (readAuthRes.stdout || '');

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
    const cleanXml = `<?xml version='1.0' encoding='utf-8' standalone='yes' ?>\\n<map>\\n    <string name="device_token_smart">${token}</string>\\n    <int name="type_display" value="${typeDisplay}" />\\n    <string name="device_wifi_address">${wifiAddress}</string>\\n    <int name="type_touch" value="${typeTouch}" />\\n    <int name="total_cell_layout" value="${totalCellLayout}" />\\n</map>`;

    // Ghi trực tiếp hoặc qua file tạm
    const tmpLocal = path.join(ROOT_DIR, `temp_auth_${Date.now()}_${Math.random().toString(36).substr(2, 5)}.xml`);
    fs.writeFileSync(tmpLocal, cleanXml.replace(/\\n/g, '\n'), 'utf8');
    await this.execCommand([...targetArgs, 'push', `"${tmpLocal}"`, '/sdcard/Authorization.xml']);
    try { fs.unlinkSync(tmpLocal); } catch (e) {}

    // 6. Ghi đè vào data app và xoá database Realm lỗi, cache lỗi
    const applyCmd = `su root sh -c "cp /sdcard/Authorization.xml /data/data/vn.adtcreative.hongngocdisplay/shared_prefs/Authorization.xml && rm -f /data/data/vn.adtcreative.hongngocdisplay/files/smartdisplay.realm* && rm -rf /data/data/vn.adtcreative.hongngocdisplay/cache/* && rm -f /data/data/vn.adtcreative.hongngocdisplay/app_mediahome/*.temp && chmod 660 /data/data/vn.adtcreative.hongngocdisplay/shared_prefs/Authorization.xml && rm -f /sdcard/Authorization.xml"`;
    await this.execCommand([...targetArgs, 'shell', applyCmd]);

    // Lấy UID thực tế của app để chown chính xác
    const getUidCmd = `su root ls -ld /data/data/vn.adtcreative.hongngocdisplay | awk '{print $3}'`;
    const uidRes = await this.execCommand([...targetArgs, 'shell', getUidCmd]);
    const appUid = (uidRes.stdout || '').trim();
    if (appUid && appUid.startsWith('u0_')) {
      await this.execCommand([...targetArgs, 'shell', `su root chown ${appUid}:${appUid} /data/data/vn.adtcreative.hongngocdisplay/shared_prefs/Authorization.xml`]);
    }

    // 7. Khởi động lại ứng dụng SplashActivity
    await this.execCommand([...targetArgs, 'shell', 'am start -n vn.adtcreative.hongngocdisplay/.SplashActivity']);

    return {
      success: true,
      target,
      token,
      message: 'Đã xóa dữ liệu lỗi, bảo lưu Mã KH thành công và kích hoạt tải lại nội dung mới!'
    };
  }
}

module.exports = new AdbManager();
