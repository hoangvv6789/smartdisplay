const axios = require('axios');
const DataStore = require('../storage/data-store');

class SmartDisplayApi {
  constructor() {
    this.settings = DataStore.getSettings();
    this.baseUrl = (this.settings.apiDomain || 'http://api-smart-display.hongngochospital.vn/').replace(/\/+$/, '');
    this.token = null;
  }

  async login(username, password) {
    try {
      const url = `${this.baseUrl}/api/v1/customer/login`;
      const resp = await axios.post(url, {
        username,
        password
      }, {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/plain, */*'
        },
        timeout: 10000
      });

      if (resp.data && resp.data.error_code === 0 && resp.data.data) {
        this.token = resp.data.data.token || (typeof resp.data.data === 'string' ? resp.data.data : null);
        return { success: true, token: this.token, user: resp.data.data };
      } else if (resp.data && resp.data.token) {
        this.token = resp.data.token;
        return { success: true, token: this.token, user: resp.data };
      }

      return {
        success: false,
        message: resp.data.notification || resp.data.message || 'Đăng nhập không thành công'
      };
    } catch (e) {
      console.error('Login error:', e.message);
      return {
        success: false,
        message: e.response?.data?.notification || e.response?.data?.message || e.message
      };
    }
  }

  async fetchDevices(token) {
    let cleanToken = token || this.token;
    if (!cleanToken) {
      return { success: false, message: 'Chưa có Token xác thực. Vui lòng đăng nhập hoặc nhập Token.' };
    }

    if (cleanToken.startsWith('{')) {
      try {
        const parsed = JSON.parse(cleanToken);
        cleanToken = parsed.token || (parsed.data?.token) || cleanToken;
      } catch (e) {}
    }

    try {
      let allDevices = [];

      // 1. Fetch all groups (which contain 95%+ of hospital devices)
      let groupPage = 1;
      let hasMoreGroups = true;
      while (hasMoreGroups) {
        try {
          const url = `${this.baseUrl}/api/v1/customer/group/device?page=${groupPage}`;
          const resp = await axios.get(url, {
            headers: { 'authorization': cleanToken, 'Accept': 'application/json, text/plain, */*' },
            timeout: 15000
          });
          const groups = resp.data?.data?.data || resp.data?.data || [];
          for (const grp of groups) {
            if (Array.isArray(grp.device)) {
              for (const dev of grp.device) {
                dev._groupTitle = grp.title || grp.description || 'Nhóm chung';
                dev._groupDescription = grp.description || '';
                allDevices.push(dev);
              }
            }
          }
          if (!resp.data?.data?.next_page_url || groups.length === 0) {
            hasMoreGroups = false;
          } else {
            groupPage++;
          }
        } catch (err) {
          hasMoreGroups = false;
        }
      }

      // 2. Fetch unassigned devices
      try {
        const url = `${this.baseUrl}/api/v1/customer/device`;
        const resp = await axios.get(url, {
          headers: { 'authorization': cleanToken, 'Accept': 'application/json, text/plain, */*' },
          timeout: 15000
        });
        const unassigned = resp.data?.data?.data || resp.data?.data || [];
        for (const dev of unassigned) {
          dev._groupTitle = 'Chưa phân nhóm';
          allDevices.push(dev);
        }
      } catch (err) {}

      // Deduplicate
      const deviceMap = new Map();
      for (const d of allDevices) {
        const key = d.id || d.deviceId || d.ip_address || d.device_name;
        if (!deviceMap.has(key)) {
          deviceMap.set(key, d);
        }
      }

      const formatted = Array.from(deviceMap.values()).map(d => {
        const ip = d.ip_address || d.ip || '';
        return {
          id: 'dev_' + (d.id || (ip ? ip.replace(/\./g, '_') : Math.random().toString(36).substr(2, 8))),
          cloudId: d.id,
          name: d.device_name || d.name || (`Smart Display ${ip}`),
          ip: ip,
          mac: d.deviceId || d.mac || '',
          group: d._groupTitle || d.map || 'Mặc định',
          room: d.map || d.description || '',
          status: d.status === 1 ? (d.is_connected === 1 ? 'online' : 'offline') : 'offline',
          isConnected: d.is_connected === 1,
          model: d.model || 'AR BOX G1 / HIT-W183',
          os: d.os ? 'Android ' + d.os : '',
          resolution: (d.width && d.height) ? (`${d.width}x${d.height}`) : '',
          activeCode: d.active_code,
          updatedAt: d.updated_at || new Date().toISOString(),
          raw: d
        };
      });

      if (formatted.length > 0) {
        DataStore.saveDevices(formatted);
      }

      return { success: true, count: formatted.length, devices: formatted };
    } catch (e) {
      console.error('Fetch devices error:', e.message);
      return {
        success: false,
        message: e.response?.data?.notification || e.response?.data?.message || e.message
      };
    }
  }
}

module.exports = new SmartDisplayApi();
