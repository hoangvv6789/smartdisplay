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

function writeJson(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('Error writing json', file, e);
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
    _cachedDevices = devices;
    writeJson(DEVICES_FILE, devices);
  }

  static upsertDevice(device) {
    const devices = this.getDevices();
    const index = devices.findIndex(d => (d.id && d.id === device.id) || (d.ip && device.ip && d.ip === device.ip));
    if (index >= 0) {
      devices[index] = { ...devices[index], ...device, updatedAt: new Date().toISOString() };
    } else {
      devices.push({ ...device, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    }
    this.saveDevices(devices);
    return device;
  }

  static updateDevice(id, updateData) {
    const devices = this.getDevices();
    const index = devices.findIndex(d => d.id === id || d.ip === id);
    if (index >= 0) {
      devices[index] = { ...devices[index], ...updateData, updatedAt: new Date().toISOString() };
      this.saveDevices(devices);
      return devices[index];
    }
    return null;
  }

  static deleteDevice(idOrIp) {
    let devices = this.getDevices();
    devices = devices.filter(d => d.id !== idOrIp && d.ip !== idOrIp);
    this.saveDevices(devices);
  }

  static getApks() {
    if (_cachedApks === null) {
      _cachedApks = readJson(APKS_FILE, [
        {
          id: 'smart-display',
          name: 'Smart Display Client APK',
          packageName: 'vn.hongngoc.smartdisplay',
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
    _cachedApks = apks;
    writeJson(APKS_FILE, apks);
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
    _cachedSettings = settings;
    writeJson(SETTINGS_FILE, settings);
  }
}

module.exports = DataStore;
