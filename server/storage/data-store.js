const fs = require('fs');
const path = require('path');

const isPkg = typeof process.pkg !== 'undefined';
let ROOT_DIR = isPkg ? path.dirname(process.execPath) : path.join(__dirname, '../..');
if (path.basename(ROOT_DIR).toLowerCase() === 'dist' && fs.existsSync(path.join(ROOT_DIR, '..', 'data'))) {
  ROOT_DIR = path.join(ROOT_DIR, '..');
}

const DATA_DIR = path.join(ROOT_DIR, 'data');
const DEVICES_FILE = path.join(DATA_DIR, 'devices.json');
const APKS_FILE = path.join(DATA_DIR, 'apks.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// In-memory memory cache to eliminate redundant JSON.parse & file reads
let _cachedDevices = null;
let _cachedApks = null;
let _cachedSettings = null;

function readJson(file, defaultVal = []) {
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
  } catch (e) {
    console.error('Error reading json', file, e);
  }
  return defaultVal;
}

function writeJsonAtomic(file, data) {
  const content = JSON.stringify(data, null, 2);
  const tmpFile = `${file}.${Date.now()}.${Math.random().toString(36).substr(2, 6)}.tmp`;
  try {
    fs.writeFileSync(tmpFile, content, 'utf8');
    fs.renameSync(tmpFile, file);
  } catch (e) {
    try {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    } catch (_) {}
    console.error('Error writing json atomic', file, e);
    throw new Error(`Ghi file dữ liệu thất bại: ${e.message}`);
  }
}

class DataStore {
  static getDevices() {
    if (_cachedDevices === null) {
      _cachedDevices = readJson(DEVICES_FILE, []);
    }
    return _cachedDevices;
  }

  static saveDevices(devices) {
    writeJsonAtomic(DEVICES_FILE, devices);
    _cachedDevices = devices;
  }

  static upsertDevice(device) {
    const devices = [...this.getDevices()];
    const index = devices.findIndex(d => (d.id && d.id === device.id) || (d.ip && device.ip && d.ip === device.ip));
    let updated;
    if (index >= 0) {
      updated = { ...devices[index], ...device, updatedAt: new Date().toISOString() };
      devices[index] = updated;
    } else {
      updated = { ...device, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      devices.push(updated);
    }
    this.saveDevices(devices);
    return updated;
  }

  static updateDevice(id, updateData) {
    const devices = [...this.getDevices()];
    const index = devices.findIndex(d => d.id === id || d.ip === id);
    if (index >= 0) {
      const updated = { ...devices[index], ...updateData, updatedAt: new Date().toISOString() };
      devices[index] = updated;
      this.saveDevices(devices);
      return updated;
    }
    return null;
  }

  static deleteDevice(idOrIp) {
    let devices = this.getDevices();
    const filtered = devices.filter(d => d.id !== idOrIp && d.ip !== idOrIp);
    this.saveDevices(filtered);
  }

  static getApks() {
    if (_cachedApks === null) {
      _cachedApks = readJson(APKS_FILE, [
        {
          id: 'smart-display',
          name: 'Smart Display Client APK',
          packageName: 'vn.adtcreative.hongngocdisplay',
          fileName: 'smart-display.apk',
          description: 'Ứng dụng phát nội dung Smart Display Bệnh viện Hồng Ngọc',
          version: 'Mới nhất',
          isDefault: true
        }
      ]);
    }
    return _cachedApks;
  }

  static saveApks(apks) {
    writeJsonAtomic(APKS_FILE, apks);
    _cachedApks = apks;
  }

  static getSettings() {
    if (_cachedSettings === null) {
      _cachedSettings = readJson(SETTINGS_FILE, {
        apiDomain: 'http://api-smart-display.hongngochospital.vn/',
        adbPath: 'C:\\platform-tools\\adb.exe',
        defaultPort: 5555,
        autoRefreshInterval: 15000,
        smartDisplayPackage: 'vn.adtcreative.hongngocdisplay'
      });
    }
    return _cachedSettings;
  }

  static saveSettings(settings) {
    writeJsonAtomic(SETTINGS_FILE, settings);
    _cachedSettings = settings;
  }
}

module.exports = DataStore;
