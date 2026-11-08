const { createApp } = Vue;

createApp({
  data() {
    return {
      loading: false,
      viewMode: 'grid',
      currentPage: 1,
      pageSize: 48,
      pageSizeOptions: [24, 48, 96, 192, 'Tất cả'],
      searchQuery: '',
      selectedGroup: '',
      selectedStatus: 'all',
      selectedDeviceIds: [],
      scanningPorts: false,
      batchSyncingTime: false,
      batchRestoringLauncher: false,
      batchFixingWhiteScreen: false,

      // Watchdog state (4 hours cycle)
      watchdog: {
        enabled: false,
        intervalHours: 4,
        running: false,
        lastRun: null,
        nextRun: null,
        targetPackage: 'vn.adtcreative.hongngocdisplay',
        lastSummary: null
      },
      watchdogUpdating: false,

      // Data collections
      devices: [],
      apks: [],
      systemStatus: {
        adbAvailable: false,
        adbVersion: '',
        connectedDevicesCount: 0,
        connectedDevices: []
      },

      // Modals
      showCloudSyncModal: false,
      showAddDeviceModal: false,
      showEditDeviceModal: false,
      showBatchInstallModal: false,
      showApkStoreModal: false,
      activeDeviceModal: false,
      currentDevice: null,
      isGmsDisabled: false,
      openGAppsReady: false,
      openGAppsPath: '',
      uploadingZip: false,

      // Edit Form state
      editForm: {
        id: '',
        name: '',
        activeCode: '',
        ip: '',
        group: '',
        mac: '',
        model: ''
      },

      // App Presets for Quick Fix
      appPresets: [
        { name: 'Smart Display (Hồng Ngọc)', pkg: 'vn.adtcreative.hongngocdisplay', icon: 'fa-solid fa-tv text-emerald-400' },
        { name: 'Webview Hồng Ngọc', pkg: 'vn.adtcreative.webviewhongngoc', icon: 'fa-solid fa-globe text-teal-400' },
        { name: 'ITR Apps', pkg: 'com.hongngoc.itrapps', icon: 'fa-solid fa-hospital text-blue-400' },
        { name: 'YouTube', pkg: 'com.google.android.youtube', icon: 'fa-brands fa-youtube text-red-400' },
        { name: 'Chrome', pkg: 'com.android.chrome', icon: 'fa-brands fa-chrome text-blue-400' },
        { name: 'ON TV', pkg: 'com.vtvcab.onTV', icon: 'fa-solid fa-film text-amber-400' },
        { name: 'AnyDesk', pkg: 'com.anydesk.anydeskandroid', icon: 'fa-solid fa-desktop text-red-500' },
        { name: 'VLC Player', pkg: 'org.videolan.vlc.debug', icon: 'fa-solid fa-play text-orange-400' }
      ],

      // Sync modal settings
      syncMethod: 'login',
      directTokenInput: '',
      scanSubnetPrefix: '172.18.15',
      scanPort: 5555,
      scanningSubnet: false,

      // Modal Tabs & State (Live View is permanently pinned on the right)
      modalTabs: [
        { id: 'quick_fix', name: 'Sửa Lỗi & Điều Khiển', icon: 'fa-solid fa-screwdriver-wrench' },
        { id: 'apk_manager', name: 'Quản Lý APK', icon: 'fa-brands fa-android' },
        { id: 'logcat', name: 'Realtime Logcat', icon: 'fa-solid fa-terminal' },
        { id: 'shell', name: 'ADB Shell', icon: 'fa-solid fa-code' },
        { id: 'device_info', name: 'Thông Số Máy', icon: 'fa-solid fa-circle-info' }
      ],
      activeModalTab: 'quick_fix',
      actionLoading: false,
      screenZoomed: false,

      // Tab 1 controls
      inputText: '',
      customPackage: 'vn.adtcreative.hongngocdisplay',
      picoFolderPath: 'C:\\pico-8.1',

      // Tab 2 Screenshot & Vysor Interactive Stream
      screenshotUrl: null,
      screenLoading: false,
      autoRefreshScreen: true,
      showAdvancedTools: true,
      autoRefreshInterval: null,
      lastScreenTime: '',
      streamSpeed: 1000,
      streamSpeedOptions: [
        { label: '⚡ Siêu tốc (500ms)', value: 500 },
        { label: '🚀 Nhanh (1s)', value: 1000 },
        { label: '⏱️ Chuẩn (2s)', value: 2000 },
        { label: '⏸️ Tạm dừng', value: 0 }
      ],
      isDraggingScreen: false,
      dragStartX: 0,
      dragStartY: 0,
      dragStartTime: 0,
      keyboardCaptureEnabled: true,

      // Tab 3 APK
      installedPackages: [],
      loadingPackages: false,
      showAllSystemPackages: true,
      pkgSearchQuery: '',
      uploadingApk: false,
      selectedBatchApkId: null,
      batchInstalling: false,

      // Tab 4 Logcat
      ws: null,
      isLogcatActive: false,
      logLevel: '',
      logFilterText: '',
      logcatLines: [],

      // Tab 5 Shell
      shellCommand: '',
      shellHistory: [],

      // Tab 6 Device Info
      deviceInfo: null,

      // Cloud auth form
      cloudAuth: {
        username: 'admin',
        password: ''
      },
      syncingCloud: false,

      // Add device form
      newDevice: {
        name: '',
        activeCode: '',
        ip: '',
        group: '',
        mac: ''
      },

      // Toasts
      toasts: []
    };
  },

  computed: {
    connectedCount() {
      return this.devices.filter(d => d.ip && d.adbConnected).length;
    },
    lanOnlineCount() {
      return this.devices.filter(d => d.ip && d.adbPortOpen).length;
    },
    uniqueGroups() {
      const groups = this.devices.map(d => d.group || d.room).filter(Boolean);
      return [...new Set(groups)];
    },
    totalPages() {
      if (this.pageSize === 'Tất cả') return 1;
      const size = parseInt(this.pageSize, 10) || 48;
      const count = this.filteredDevices.length;
      return Math.max(1, Math.ceil(count / size));
    },

    paginatedDevices() {
      if (this.pageSize === 'Tất cả') return this.filteredDevices;
      const size = parseInt(this.pageSize, 10) || 48;
      const page = Math.max(1, Math.min(this.currentPage, this.totalPages));
      const start = (page - 1) * size;
      return this.filteredDevices.slice(start, start + size);
    },

    filteredDevices() {
      return this.devices.filter(d => {
        if (this.searchQuery) {
          const q = this.searchQuery.toLowerCase();
          const matchName = (d.name || '').toLowerCase().includes(q);
          const matchCode = (d.activeCode || d.active_code || '').toString().toLowerCase().includes(q);
          const matchIp = (d.ip || '').toLowerCase().includes(q);
          const matchMac = (d.mac || '').toLowerCase().includes(q);
          const matchGroup = (d.group || d.room || '').toLowerCase().includes(q);
          if (!matchName && !matchCode && !matchIp && !matchMac && !matchGroup) return false;
        }

        if (this.selectedGroup && (d.group || d.room) !== this.selectedGroup) {
          return false;
        }

        if (this.selectedStatus === 'connected' && !d.adbConnected) return false;
        if (this.selectedStatus === 'open_port' && !d.adbPortOpen) return false;
        if (this.selectedStatus === 'cloud_online' && d.status !== 'online' && !d.isConnected) return false;
        if (this.selectedStatus === 'offline') {
          const isOnline = d.adbConnected || d.adbPortOpen || d.status === 'online' || d.isConnected;
          if (isOnline) return false;
        }

        return true;
      });
    },
    filteredInstalledPackages() {
      if (!this.pkgSearchQuery) return this.installedPackages;
      const q = this.pkgSearchQuery.toLowerCase();
      return this.installedPackages.filter(p => p.toLowerCase().includes(q));
    },
    filteredLogcatLines() {
      if (!this.logFilterText) return this.logcatLines;
      const q = this.logFilterText.toLowerCase();
      return this.logcatLines.filter(l => l.toLowerCase().includes(q));
    }
  },

  watch: {
    searchQuery() { this.currentPage = 1; },
    statusFilter() { this.currentPage = 1; },
    groupFilter() { this.currentPage = 1; },
    roomFilter() { this.currentPage = 1; },
    pageSize() { this.currentPage = 1; },
    autoRefreshScreen() {
      this.restartStreamInterval();
    },
    streamSpeed() {
      this.restartStreamInterval();
    },
    activeModalTab(tab) {
      if (tab === 'live_screen' && !this.screenshotUrl) {
        this.takeScreenshot();
      } else if (tab === 'device_info' && !this.deviceInfo) {
        this.loadDeviceInfo();
      } else if (tab === 'apk_manager' || tab === 'quick_fix') {
        this.fetchInstalledPackages();
        this.checkGooglePlayStatus();
      }
    }
  },

  mounted() {
    this.initWebSocket();
    this.fetchAllData();
  },

  methods: {
    setPage(p) {
      if (p >= 1 && p <= this.totalPages) {
        this.currentPage = p;
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    },

    getPageNumbers() {
      const total = this.totalPages;
      const current = this.currentPage;
      if (total <= 7) {
        return Array.from({ length: total }, (_, i) => i + 1);
      }
      if (current <= 4) {
        return [1, 2, 3, 4, 5, '...', total];
      }
      if (current >= total - 3) {
        return [1, '...', total - 4, total - 3, total - 2, total - 1, total];
      }
      return [1, '...', current - 1, current, current + 1, '...', total];
    },

    toast(message, type = 'info') {
      const id = Date.now() + Math.random();
      this.toasts.push({ id, message, type });
      setTimeout(() => this.removeToast(id), 4500);
    },
    removeToast(id) {
      this.toasts = this.toasts.filter(t => t.id !== id);
    },

    copyText(text, successMsg = 'Đã copy!') {
      navigator.clipboard.writeText(text);
      this.toast(successMsg, 'success');
    },

    isHospitalPackage(pkg) {
      return pkg.includes('hongngoc') || pkg.includes('adtcreative') || pkg.includes('itrapps');
    },

    initWebSocket() {
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${location.host}`;
      this.ws = new WebSocket(wsUrl);

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'logcat' && msg.data) {
            const lines = msg.data.split('\n').filter(Boolean);
            this.logcatLines.push(...lines);
            if (this.logcatLines.length > 1500) {
              this.logcatLines = this.logcatLines.slice(-1000);
            }
            this.$nextTick(() => {
              const el = this.$refs.logcatContainer;
              if (el) el.scrollTop = el.scrollHeight;
            });
          }
        } catch (e) {}
      };
    },

    async fetchAllData() {
      this.loading = true;
      try {
        const [sysRes, devRes, apkRes] = await Promise.all([
          fetch('/api/system/status').then(r => r.json()),
          fetch('/api/devices').then(r => r.json()),
          fetch('/api/apks').then(r => r.json())
        ]);

        this.systemStatus = sysRes;
        if (sysRes.watchdog) {
          this.watchdog = { ...this.watchdog, ...sysRes.watchdog };
        }
        this.openGAppsReady = Boolean(sysRes.hasOpenGAppsPackage);
        this.openGAppsPath = sysRes.openGAppsPath || '';
        this.devices = devRes.devices || [];
        this.apks = apkRes.apks || [];
      } catch (e) {
        this.toast('Không thể tải dữ liệu: ' + e.message, 'error');
      } finally {
        this.loading = false;
      }
    },

    async scanLanPorts() {
      this.scanningPorts = true;
      try {
        const res = await fetch('/api/devices/ping-all', { method: 'POST' }).then(r => r.json());
        if (res.success && res.results) {
          const map = new Map(res.results.map(r => [r.ip, r.adbPortOpen]));
          this.devices = this.devices.map(d => ({
            ...d,
            adbPortOpen: map.get(d.ip) || false
          }));
          this.toast('Đã kiểm tra xong trạng thái cổng ADB (5555)!', 'success');
        }
      } catch (e) {
        this.toast('Lỗi quét mạng: ' + e.message, 'error');
      } finally {
        this.scanningPorts = false;
      }
    },

    async connectAdb(device) {
      if (!device.ip) return this.toast('Thiết bị không có IP', 'error');
      device._connecting = true;
      try {
        const res = await fetch('/api/adb/connect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ip: device.ip, port: 5555 })
        }).then(r => r.json());

        if (res.success) {
          device.adbConnected = true;
          this.toast(`Đã kết nối ADB tới ${device.ip}`, 'success');
          this.fetchAllData();
        } else {
          this.toast(`Kết nối thất bại: ${res.error || res.output}`, 'error');
        }
      } catch (e) {
        this.toast('Lỗi kết nối ADB: ' + e.message, 'error');
      } finally {
        device._connecting = false;
      }
    },

    async disconnectAdb(device) {
      device._disconnecting = true;
      try {
        await fetch('/api/adb/disconnect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ip: device.ip, port: 5555 })
        });
        device.adbConnected = false;
        this.toast(`Đã ngắt ADB ${device.ip}`, 'info');
        this.fetchAllData();
      } catch (e) {
        this.toast('Lỗi ngắt kết nối: ' + e.message, 'error');
      } finally {
        device._disconnecting = false;
      }
    },

    async pingDevice(device) {
      device._pinging = true;
      try {
        const res = await fetch('/api/devices/ping', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ip: device.ip })
        }).then(r => r.json());

        device.adbPortOpen = res.adbPortOpen;
        if (res.alive) {
          this.toast(`${device.ip} Online - Ping: ${res.pingTime} - ADB Port: ${res.adbPortOpen ? 'Mở' : 'Đóng'}`, 'success');
        } else {
          this.toast(`${device.ip} không phản hồi Ping trong mạng`, 'error');
        }
      } catch (e) {
        this.toast('Lỗi Ping: ' + e.message, 'error');
      } finally {
        device._pinging = false;
      }
    },

    // --- Device CRUD ---
    openEditDeviceModal(device) {
      this.editForm = {
        id: device.id,
        name: device.name || '',
        activeCode: device.activeCode || device.active_code || '',
        ip: device.ip || '',
        group: device.group || device.room || '',
        mac: device.mac || '',
        model: device.model || ''
      };
      this.showEditDeviceModal = true;
    },

    async saveEditDevice() {
      try {
        const res = await fetch(`/api/devices/${encodeURIComponent(this.editForm.id)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.editForm)
        }).then(r => r.json());

        if (res.success) {
          this.toast('Đã cập nhật thông tin thiết bị thành công!', 'success');
          this.showEditDeviceModal = false;
          this.fetchAllData();
        } else {
          this.toast('Lỗi cập nhật: ' + res.message, 'error');
        }
      } catch (e) {
        this.toast('Lỗi: ' + e.message, 'error');
      }
    },

    async deleteDevice(device) {
      if (!confirm(`Bạn có chắc chắn muốn XÓA thiết bị "${device.name || device.ip}" khỏi danh sách?`)) return;
      try {
        const res = await fetch(`/api/devices/${encodeURIComponent(device.id || device.ip)}`, {
          method: 'DELETE'
        }).then(r => r.json());

        if (res.success) {
          this.toast('Đã xóa thiết bị!', 'success');
          this.showEditDeviceModal = false;
          this.fetchAllData();
        }
      } catch (e) {
        this.toast('Lỗi xóa thiết bị: ' + e.message, 'error');
      }
    },

    async disconnectAllAdb() {
      if (!confirm('Bạn có chắc chắn muốn ngắt toàn bộ kết nối ADB?')) return;
      try {
        const res = await fetch('/api/adb/disconnect-all', { method: 'POST' }).then(r => r.json());
        this.toast(res.message || 'Đã ngắt tất cả kết nối ADB', 'success');
        this.fetchAllData();
      } catch (e) {
        this.toast('Lỗi: ' + e.message, 'error');
      }
    },

    openAddDeviceModal() {
      this.newDevice = { name: '', activeCode: '', ip: '', group: '', mac: '' };
      this.showAddDeviceModal = true;
    },

    async saveNewDevice() {
      try {
        const res = await fetch('/api/devices', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.newDevice)
        }).then(r => r.json());

        if (res.success) {
          this.toast('Đã thêm thiết bị mới thành công!', 'success');
          this.showAddDeviceModal = false;
          this.fetchAllData();
        } else {
          this.toast('Lỗi lưu thiết bị: ' + e.message, 'error');
        }
      } catch (e) {
        this.toast('Lỗi: ' + e.message, 'error');
      }
    },

    // Selection & Batch
    toggleSelectAll(e) {
      if (e.target.checked) {
        this.selectedDeviceIds = this.filteredDevices.map(d => d.id || d.ip);
      } else {
        this.selectedDeviceIds = [];
      }
    },

    async batchConnectAdb() {
      this.toast('Đang kết nối hàng loạt...', 'info');
      for (const id of this.selectedDeviceIds) {
        const dev = this.devices.find(d => (d.id || d.ip) === id);
        if (dev && !dev.adbConnected) {
          await this.connectAdb(dev);
        }
      }
      this.toast('Hoàn tất kết nối hàng loạt', 'success');
    },

    async batchReboot() {
      if (!confirm(`Bạn có chắc chắn muốn REBOOT ${this.selectedDeviceIds.length} thiết bị đã chọn?`)) return;
      for (const id of this.selectedDeviceIds) {
        const dev = this.devices.find(d => (d.id || d.ip) === id);
        if (dev && dev.ip) {
          await fetch('/api/adb/reboot', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ target: dev.ip })
          });
        }
      }
      this.toast('Đã gửi lệnh reboot tới các thiết bị', 'success');
    },

    async batchSyncTime() {
      const targets = [];
      for (const id of this.selectedDeviceIds) {
        const dev = this.devices.find(d => (d.id || d.ip) === id);
        if (dev && dev.ip) {
          targets.push(dev);
        }
      }

      if (targets.length === 0) {
        this.toast('Không tìm thấy địa chỉ IP hợp lệ trong danh sách đã chọn', 'error');
        return;
      }

      if (!confirm(`Bạn có chắc chắn muốn ĐỒNG BỘ GIỜ cho ${targets.length} thiết bị đã chọn theo thời gian chuẩn của máy tính?`)) return;

      this.batchSyncingTime = true;
      this.toast(`Bắt đầu đồng bộ giờ cho ${targets.length} thiết bị...`, 'info');

      // Chạy song song theo batch (chunk 10 thiết bị cùng lúc để tránh nghẽn socket/mạng)
      const chunkSize = 10;
      let successCount = 0;
      let failCount = 0;

      for (let i = 0; i < targets.length; i += chunkSize) {
        const chunk = targets.slice(i, i + chunkSize);
        await Promise.all(chunk.map(async (dev) => {
          try {
            const res = await fetch('/api/adb/sync-time', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ target: dev.ip })
            }).then(r => r.json());

            if (res && res.success) {
              successCount++;
            } else {
              failCount++;
            }
          } catch (e) {
            failCount++;
          }
        }));
      }

      this.batchSyncingTime = false;
      if (failCount === 0) {
        this.toast(`Đồng bộ giờ thành công cho toàn bộ ${successCount} thiết bị!`, 'success');
      } else {
        this.toast(`Đồng bộ giờ hoàn tất: ${successCount} thành công, ${failCount} không kết nối được hoặc lỗi quyền.`, 'info');
      }
    },

    async batchFixWhiteScreen() {
      const targets = [];
      for (const id of this.selectedDeviceIds) {
        const dev = this.devices.find(d => (d.id || d.ip) === id);
        if (dev && dev.ip) {
          targets.push({ ip: dev.ip, name: dev.name || dev.room || dev.ip });
        }
      }

      if (targets.length === 0) {
        this.toast('Không tìm thấy thiết bị hợp lệ trong danh sách đã chọn', 'error');
        return;
      }

      if (!confirm(`Sửa lỗi trắng màn hình / làm mới nội dung cho ${targets.length} thiết bị đã chọn?\n\nLưu ý: Quá trình này sẽ bảo lưu Mã Kích Hoạt (KH), xóa cache lỗi và kích hoạt app đồng bộ dữ liệu mới từ server.`)) return;

      this.batchFixingWhiteScreen = true;
      this.toast(`Đang xử lý sửa lỗi trắng màn hình cho ${targets.length} thiết bị...`, 'info');

      const chunkSize = 5;
      let successCount = 0;
      let failCount = 0;

      for (let i = 0; i < targets.length; i += chunkSize) {
        const chunk = targets.slice(i, i + chunkSize);
        await Promise.all(chunk.map(async (dev) => {
          try {
            const res = await fetch('/api/adb/fix-white-screen', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ target: dev.ip })
            }).then(r => r.json());

            if (res && res.success) {
              successCount++;
            } else {
              failCount++;
            }
          } catch (e) {
            failCount++;
          }
        }));
      }

      this.batchFixingWhiteScreen = false;
      if (failCount === 0) {
        this.toast(`Đã sửa lỗi trắng màn hình & bảo lưu mã KH thành công cho toàn bộ ${successCount} thiết bị!`, 'success');
      } else {
        this.toast(`Hoàn tất sửa lỗi trắng màn: ${successCount} thành công, ${failCount} thất bại.`, 'info');
      }
    },

    async batchRestoreLauncher() {
      const targets = [];
      for (const id of this.selectedDeviceIds) {
        const dev = this.devices.find(d => (d.id || d.ip) === id);
        if (dev && dev.ip) {
          targets.push({ ip: dev.ip, name: dev.name || dev.room || dev.ip });
        }
      }

      if (targets.length === 0) {
        this.toast('Không tìm thấy thiết bị hợp lệ trong danh sách đã chọn', 'error');
        return;
      }

      if (!confirm(`Quét & Tự Động Phục Hồi màn hình cho ${targets.length} thiết bị đã chọn?\n\n- Nếu máy bị văng app: Tự động mở lại Launcher SmartDisplay.\n- Nếu máy bị trắng màn hình (Day ngoài khoảng): Tự động sửa lỗi & tải lại nội dung (bảo lưu Mã KH).\n- Nếu máy bị ngủ màn hình: Tự động đánh thức & cài đặt không bao giờ tắt.`)) return;

      this.batchRestoringLauncher = true;
      this.toast(`Đang quét & tự sửa màn hình cho ${targets.length} thiết bị...`, 'info');

      try {
        const res = await fetch('/api/watchdog/scan-now', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targets })
        }).then(r => r.json());

        if (res.success) {
          let msgParts = [];
          if (res.restored > 0) msgParts.push(`Đã kéo về Launcher cho ${res.restored} máy`);
          if (res.fixedWhiteScreen > 0) msgParts.push(`Đã tự động sửa trắng màn (giữ mã KH) cho ${res.fixedWhiteScreen} máy`);
          if (res.ok > 0) msgParts.push(`${res.ok} máy đang phát bình thường`);
          if (res.offline > 0) msgParts.push(`${res.offline} máy offline`);

          const summaryMsg = msgParts.join(' | ') || 'Quét hoàn tất!';
          if (res.restored > 0 || res.fixedWhiteScreen > 0) {
            this.toast(summaryMsg, 'success');
          } else {
            this.toast(summaryMsg, 'info');
          }
        } else {
          this.toast('Lỗi kiểm tra màn hình: ' + res.message, 'error');
        }
      } catch (e) {
        this.toast('Lỗi kết nối kiểm tra màn hình: ' + e.message, 'error');
      } finally {
        this.batchRestoringLauncher = false;
      }
    },

    async toggleWatchdog() {
      const nextState = !this.watchdog.enabled;
      this.watchdogUpdating = true;
      try {
        const res = await fetch('/api/watchdog/toggle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: nextState, intervalHours: 4 })
        }).then(r => r.json());

        if (res.success) {
          this.watchdog = { ...this.watchdog, ...res };
          if (nextState) {
            this.toast('Đã BẬT tự động canh giữ Launcher SmartDisplay (định kỳ 4 tiếng quét tự phục hồi 1 lần)!', 'success');
          } else {
            this.toast('Đã TẮT tính năng tự động canh giữ Launcher.', 'info');
          }
        }
      } catch (e) {
        this.toast('Lỗi cập nhật cấu hình canh giữ: ' + e.message, 'error');
      } finally {
        this.watchdogUpdating = false;
      }
    },

    openBatchInstallModal() {
      this.showBatchInstallModal = true;
    },

    async executeBatchInstall() {
      if (!this.selectedBatchApkId) return;
      this.batchInstalling = true;
      let okCount = 0;

      for (const id of this.selectedDeviceIds) {
        const dev = this.devices.find(d => (d.id || d.ip) === id);
        if (dev && dev.ip) {
          try {
            const res = await fetch('/api/adb/install-apk', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ target: dev.ip, apkId: this.selectedBatchApkId, grantPermissions: true })
            }).then(r => r.json());
            if (res.success) okCount++;
          } catch (e) {}
        }
      }

      this.batchInstalling = false;
      this.showBatchInstallModal = false;
      this.toast(`Đã cài đặt thành công cho ${okCount}/${this.selectedDeviceIds.length} thiết bị`, 'success');
    },

    openControlModal(device) {
      this.currentDevice = device;
      this.activeDeviceModal = true;
      this.activeModalTab = 'quick_fix';
      this.screenshotUrl = null;
      this.deviceInfo = null;
      this.installedPackages = [];
      this.logcatLines = [];
      this.shellHistory = [];
      this.autoRefreshScreen = true;

      if (!device.adbConnected) {
        this.connectAdb(device);
      }
      this.fetchInstalledPackages();
      this.checkGooglePlayStatus();

      // Wakeup screen & start screenshot stream
      this.sendKey('KEYCODE_WAKEUP');
      this.restartStreamInterval();
      setTimeout(() => this.takeScreenshot(false), 350);
    },

    closeControlModal() {
      this.activeDeviceModal = false;
      if (this.autoRefreshInterval) {
        clearInterval(this.autoRefreshInterval);
        this.autoRefreshInterval = null;
      }
      if (this.isLogcatActive) {
        this.toggleLogcatStream();
      }
    },

    // --- Google Play Dynamic Toggle & Cache ---
    async checkGooglePlayStatus() {
      if (!this.currentDevice?.ip) return;
      try {
        const res = await fetch(`/api/adb/google-play-status?target=${encodeURIComponent(this.currentDevice.ip)}`).then(r => r.json());
        if (res.success) {
          this.isGmsDisabled = res.isGmsDisabled;
        }
      } catch (e) {}
    },

    async toggleGooglePlay(enable = false) {
      if (!this.currentDevice?.ip) return;
      if (!enable && !confirm('Vô hiệu hóa hoàn toàn Google Play Services? Điều này sẽ tắt triệt để 100% lỗi dừng ứng dụng trên màn hình.')) return;
      
      this.actionLoading = true;
      try {
        const res = await fetch('/api/adb/toggle-google-play', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ target: this.currentDevice.ip, enable })
        }).then(r => r.json());

        if (res.success) {
          this.isGmsDisabled = res.isGmsDisabled;
          this.toast(res.output, 'success');
        } else {
          this.toast('Thao tác thất bại', 'error');
        }
      } catch (e) {
        this.toast('Lỗi: ' + e.message, 'error');
      } finally {
        this.actionLoading = false;
      }
    },

    async clearGooglePlayCache() {
      if (!this.currentDevice?.ip) return;
      this.actionLoading = true;
      try {
        const res = await fetch('/api/adb/clear-google-play-cache', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ target: this.currentDevice.ip })
        }).then(r => r.json());

        if (res.success) {
          this.toast(res.output, 'success');
        } else {
          this.toast('Thao tác thất bại', 'error');
        }
      } catch (e) {
        this.toast('Lỗi: ' + e.message, 'error');
      } finally {
        this.actionLoading = false;
      }
    },

    // --- Precise Android 8 & 10 Factory Reset ---
    async actionFactoryReset(mode = 'android8') {
      if (!this.currentDevice?.ip) return;
      const modeLabel = mode === 'android8' ? 'Android 8 (Broadcast)' : 'Android 10+ (Recovery Wipe)';
      if (!confirm(`⚠️ CẢNH BÁO NGUY HIỂM: Bạn có chắc chắn muốn KHÔI PHỤC CÀI ĐẶT GỐC [${modeLabel}] thiết bị "${this.currentDevice.name || this.currentDevice.ip}"?\n\nToàn bộ dữ liệu sẽ bị xóa sạch!`)) return;

      this.actionLoading = true;
      try {
        const res = await fetch('/api/adb/factory-reset', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ target: this.currentDevice.ip, mode })
        }).then(r => r.json());

        if (res.success) {
          this.toast(res.output, 'success');
          this.closeControlModal();
        } else {
          this.toast('Lỗi Factory Reset: ' + res.output, 'error');
        }
      } catch (e) {
        this.toast('Lỗi: ' + e.message, 'error');
      } finally {
        this.actionLoading = false;
      }
    },

    async actionRemoveLockscreen() {
      if (!this.currentDevice?.ip) return;
      if (!confirm(`Phá pass / Xóa bỏ toàn bộ Mật khẩu, Mã PIN, Hình vẽ khóa màn hình của thiết bị "${this.currentDevice.name || this.currentDevice.ip}"?`)) return;

      this.actionLoading = true;
      try {
        const res = await fetch('/api/adb/remove-lockscreen', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ target: this.currentDevice.ip })
        }).then(r => r.json());

        if (res.success) {
          this.toast(res.output, 'success');
          this.triggerQuickRefresh();
        } else {
          this.toast('Lỗi phá pass: ' + (res.output || res.message), 'error');
        }
      } catch (e) {
        this.toast('Lỗi: ' + e.message, 'error');
      } finally {
        this.actionLoading = false;
      }
    },

    async actionInstallOpenGApps() {
      if (!this.currentDevice?.ip) return;
      const folder = this.picoFolderPath || 'C:\\pico-8.1';
      if (!confirm(`NẠP BỘ OPENGAPPS PICO TỪ "${folder}" SANG THIẾT BỊ "${this.currentDevice.name || this.currentDevice.ip}"?\n\nQuy trình:\n1. adb remount\n2. adb push ${folder}\\system /\n3. Tự động Factory Reset để hoàn tất cài đặt\n\nBạn có muốn tiếp tục?`)) return;

      this.actionLoading = true;
      this.toast('Đang remount và nạp dữ liệu OpenGApps Pico vào /system... (Có thể mất 1-2 phút)', 'info');
      try {
        const res = await fetch('/api/adb/install-opengapps', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ target: this.currentDevice.ip, picoPath: folder, autoReset: true })
        }).then(r => r.json());

        if (res.success) {
          this.toast(res.output, 'success');
          this.closeControlModal();
        } else {
          this.toast('Lỗi nạp GApps: ' + (res.error || res.message), 'error');
        }
      } catch (e) {
        this.toast('Lỗi: ' + e.message, 'error');
      } finally {
        this.actionLoading = false;
      }
    },

    async actionRestartApp() {
      if (!this.currentDevice?.ip) return;
      const targetPkg = this.customPackage || 'vn.adtcreative.hongngocdisplay';
      this.actionLoading = true;
      try {
        const res = await fetch('/api/adb/restart-app', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ target: this.currentDevice.ip, packageName: targetPkg })
        }).then(r => r.json());

        if (res.success) {
          this.toast(`Đã khởi động lại ứng dụng ${targetPkg}!`, 'success');
        } else {
          this.toast('Thao tác hoàn tất: ' + (res.output || ''), 'info');
        }
      } catch (e) {
        this.toast('Lỗi: ' + e.message, 'error');
      } finally {
        this.actionLoading = false;
      }
    },

    async actionSetAutoStartApp() {
      if (!this.currentDevice?.ip) return;
      const targetPkg = this.customPackage || 'vn.adtcreative.hongngocdisplay';
      if (!confirm(`Cài đặt ứng dụng "${targetPkg}" làm ứng dụng mặc định & tự động khởi chạy khi máy/Box bật lên (Auto-Start / Kiosk Launcher)?`)) return;

      this.actionLoading = true;
      try {
        const res = await fetch('/api/adb/set-autostart-app', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ target: this.currentDevice.ip, packageName: targetPkg })
        }).then(r => r.json());

        if (res.success) {
          this.toast(res.output, 'success');
          this.triggerQuickRefresh();
        } else {
          this.toast('Lỗi thiết lập chạy mặc định: ' + (res.message || res.error), 'error');
        }
      } catch (e) {
        this.toast('Lỗi: ' + e.message, 'error');
      } finally {
        this.actionLoading = false;
      }
    },

    async scanAllLaunchersNow() {
      if (this.watchdog.running || this.batchRestoringLauncher) return;
      if (!confirm('Bạn có muốn QUÉT VÀ TỰ ĐỘNG PHỤC HỒI LAUNCHER cho TOÀN BỘ danh sách thiết bị ngay bây giờ?\n\n- Tự động kéo mọi thiết bị bị văng app/youtube/desktop về lại SmartDisplay.\n- Tự động sửa lỗi trắng màn hình (bảo lưu Mã KH).\n- Tự động đánh thức màn hình đang ngủ.')) return;

      this.batchRestoringLauncher = true;
      this.toast('Đang bắt đầu quét & phục hồi toàn bộ thiết bị...', 'info');
      try {
        const res = await fetch('/api/watchdog/scan-now', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        }).then(r => r.json());

        if (res.success) {
          const parts = [];
          if (res.restored > 0) parts.push(`Kéo về Launcher: ${res.restored}`);
          if (res.fixedWhiteScreen > 0) parts.push(`Sửa trắng màn: ${res.fixedWhiteScreen}`);
          if (res.ok > 0) parts.push(`Bình thường: ${res.ok}`);
          if (res.offline > 0) parts.push(`Offline: ${res.offline}`);
          this.toast(parts.join(' | ') || 'Đã quét xong toàn bộ thiết bị!', 'success');
        } else {
          this.toast('Lỗi quét: ' + (res.message || 'Không thành công'), 'error');
        }
      } catch (e) {
        this.toast('Lỗi kết nối quét: ' + e.message, 'error');
      } finally {
        this.batchRestoringLauncher = false;
        // Cập nhật lại trạng thái watchdog
        fetch('/api/watchdog/status').then(r => r.json()).then(st => {
          if (st.success) this.watchdog = { ...this.watchdog, ...st };
        }).catch(() => {});
      }
    },


    async actionFixWhiteScreen() {
      if (!this.currentDevice || !this.currentDevice.ip) return;
      if (!confirm(`Sửa lỗi trắng màn hình cho thiết bị ${this.currentDevice.name || this.currentDevice.ip}?\n\nHệ thống sẽ bảo lưu Mã KH, xóa cache/lịch phát lỗi và tải lại nội dung mới từ server.`)) return;

      this.actionLoading = true;
      try {
        const res = await fetch('/api/adb/fix-white-screen', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ target: this.currentDevice.ip })
        }).then(r => r.json());

        if (res.success) {
          this.toast('Đã sửa lỗi trắng màn hình và kích hoạt tải nội dung mới thành công (Đã giữ Mã KH)!', 'success');
        } else {
          this.toast('Lỗi: ' + (res.message || 'Không thể xử lý'), 'error');
        }
      } catch (e) {
        this.toast('Lỗi: ' + e.message, 'error');
      } finally {
        this.actionLoading = false;
      }
    },

    async actionClearData() {
      const targetPkg = this.customPackage || 'vn.adtcreative.hongngocdisplay';
      if (!confirm(`Xóa toàn bộ Cache & Dữ liệu của ứng dụng "${targetPkg}"?`)) return;
      if (!this.currentDevice?.ip) return;
      this.actionLoading = true;
      try {
        const res = await fetch('/api/adb/clear-data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ target: this.currentDevice.ip, packageName: targetPkg })
        }).then(r => r.json());

        if (res.success) {
          this.toast(`Đã xóa sạch dữ liệu/cache của ${targetPkg} thành công!`, 'success');
        } else {
          this.toast('Kết quả: ' + res.output, 'info');
        }
      } catch (e) {
        this.toast('Lỗi: ' + e.message, 'error');
      } finally {
        this.actionLoading = false;
      }
    },

    async actionReboot() {
      if (!confirm('Khởi động lại (Reboot) thiết bị này?')) return;
      if (!this.currentDevice?.ip) return;
      try {
        await fetch('/api/adb/reboot', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ target: this.currentDevice.ip })
        });
        this.toast('Đã gửi lệnh Reboot thiết bị', 'success');
        this.closeControlModal();
      } catch (e) {
        this.toast('Lỗi Reboot: ' + e.message, 'error');
      }
    },

    async actionSyncTime() {
      if (!this.currentDevice?.ip) return;
      this.actionLoading = true;
      try {
        const res = await fetch('/api/adb/sync-time', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ target: this.currentDevice.ip })
        }).then(r => r.json());

        if (res.success) {
          this.toast('Đã đồng bộ giờ từ Server xuống thiết bị thành công!', 'success');
          if (this.activeModalTab === 'device_info') {
            this.loadDeviceInfo(); // refresh time
          }
        } else {
          this.toast('Lỗi đồng bộ giờ: ' + (res.output || 'Không có quyền Root'), 'error');
        }
      } catch (e) {
        this.toast('Lỗi: ' + e.message, 'error');
      } finally {
        this.actionLoading = false;
      }
    },

    async sendKey(keyName) {
      if (!this.currentDevice?.ip) return;
      try {
        const res = await fetch('/api/adb/keyevent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ target: this.currentDevice.ip, key: keyName })
        }).then(r => r.json());

        if (keyName === 'KEYCODE_SETTINGS' || keyName === 'ACTION_SETTINGS') {
          this.toast('Đã gửi lệnh mở Cài đặt Android', 'info');
        } else if (keyName === 'ACTION_WIFI') {
          this.toast('Đã gửi lệnh mở Cài đặt Wi-Fi', 'info');
        } else if (keyName === 'KEYCODE_WAKEUP') {
          this.toast('Đã gửi lệnh Đánh thức màn hình & mở khóa', 'info');
        }
      } catch (e) {
        this.toast('Lỗi gửi phím: ' + e.message, 'error');
      }
    },

    async sendInputText() {
      if (!this.inputText || !this.currentDevice?.ip) return;
      try {
        await fetch('/api/adb/input-text', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ target: this.currentDevice.ip, text: this.inputText })
        });
        this.toast('Đã gửi text sang thiết bị', 'success');
        this.inputText = '';
      } catch (e) {
        this.toast('Lỗi gửi text: ' + e.message, 'error');
      }
    },

    async takeScreenshot(silent = false) {
      if (!this.currentDevice?.ip) return;
      if (this.screenLoading) return; // NGĂN CHẶN SPAM LỆNH ADB
      
      this.screenLoading = true;
      try {
        const res = await fetch(`/api/adb/screenshot?target=${encodeURIComponent(this.currentDevice.ip)}`).then(r => r.json());
        if (res.success && res.image) {
          this.screenshotUrl = res.image;
          this.lastScreenTime = new Date().toLocaleTimeString();
        }
      } catch (e) {
        if (!silent) this.toast('Lỗi chụp màn hình: ' + e.message, 'error');
      } finally {
        this.screenLoading = false;
      }
    },


    stopStreamInterval() {
      this.streamActive = false;
      if (this.autoRefreshInterval) {
        clearTimeout(this.autoRefreshInterval);
        this.autoRefreshInterval = null;
      }
    },

    restartStreamInterval() {
      this.stopStreamInterval();
      if (this.autoRefreshScreen && this.streamSpeed > 0) {
        this.streamActive = true;
        this.streamLoop();
      }
    },

    async streamLoop() {
      if (!this.streamActive) return;
      if (this.activeDeviceModal && (this.activeModalTab === 'quick_fix' || this.activeModalTab === 'live_screen')) {
        await this.takeScreenshot(true);
      }
      if (this.streamActive) {
        this.autoRefreshInterval = setTimeout(() => this.streamLoop(), this.streamSpeed);
      }
    },

    triggerQuickRefresh() {
      setTimeout(() => {
        if (this.activeDeviceModal) {
          this.takeScreenshot(true);
        }
      }, 250);
    },

    getRealCoords(e, img) {
      const rect = img.getBoundingClientRect();
      const naturalWidth = img.naturalWidth || 1920;
      const naturalHeight = img.naturalHeight || 1080;
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;
      const realX = Math.round(Math.max(0, Math.min(naturalWidth, (clickX / rect.width) * naturalWidth)));
      const realY = Math.round(Math.max(0, Math.min(naturalHeight, (clickY / rect.height) * naturalHeight)));
      return { realX, realY, naturalWidth, naturalHeight };
    },

    onScreenMouseDown(e) {
      if (!this.currentDevice?.ip) return;
      const img = this.$refs.liveScreenImg || e.target;
      if (!img) return;

      // Right click = Android Back (Vysor style)
      if (e.button === 2) {
        e.preventDefault();
        this.sendKey('KEYCODE_BACK');
        this.triggerQuickRefresh();
        return;
      }

      // Middle click = Android Home (Vysor style)
      if (e.button === 1) {
        e.preventDefault();
        this.sendKey('KEYCODE_HOME');
        this.triggerQuickRefresh();
        return;
      }

      if (e.button === 0) {
        const coords = this.getRealCoords(e, img);
        this.isDraggingScreen = true;
        this.dragStartX = coords.realX;
        this.dragStartY = coords.realY;
        this.dragStartTime = Date.now();
      }
    },

    async onScreenMouseUp(e) {
      if (!this.isDraggingScreen || !this.currentDevice?.ip) return;
      this.isDraggingScreen = false;
      const img = this.$refs.liveScreenImg || e.target;
      if (!img) return;

      const coords = this.getRealCoords(e, img);
      const endX = coords.realX;
      const endY = coords.realY;
      const duration = Math.min(600, Math.max(100, Date.now() - this.dragStartTime));
      const dist = Math.sqrt(Math.pow(endX - this.dragStartX, 2) + Math.pow(endY - this.dragStartY, 2));

      if (dist <= 12) {
        try {
          await fetch('/api/adb/tap', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ target: this.currentDevice.ip, x: endX, y: endY })
          });
        } catch (e) {}
      } else {
        try {
          await fetch('/api/adb/swipe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              target: this.currentDevice.ip,
              x1: this.dragStartX,
              y1: this.dragStartY,
              x2: endX,
              y2: endY,
              duration: Math.max(150, duration)
            })
          });
        } catch (e) {}
      }

      this.triggerQuickRefresh();
    },

    async onScreenWheel(e) {
      if (!this.currentDevice?.ip) return;
      e.preventDefault();
      const img = this.$refs.liveScreenImg || e.target;
      if (!img) return;

      const coords = this.getRealCoords(e, img);
      const h = coords.naturalHeight;
      const midX = coords.realX;

      let y1, y2;
      if (e.deltaY > 0) {
        y1 = Math.round(h * 0.72);
        y2 = Math.round(h * 0.28);
      } else {
        y1 = Math.round(h * 0.28);
        y2 = Math.round(h * 0.72);
      }

      try {
        await fetch('/api/adb/swipe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            target: this.currentDevice.ip,
            x1: midX,
            y1: y1,
            x2: midX,
            y2: y2,
            duration: 250
          })
        });
      } catch (e) {}

      this.triggerQuickRefresh();
    },

    async onScreenKeyDown(e) {
      if (!this.keyboardCaptureEnabled || !this.currentDevice?.ip) return;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
        return;
      }

      const key = e.key;
      if (key === 'Backspace') {
        e.preventDefault();
        await this.sendKey('KEYCODE_DEL');
      } else if (key === 'Enter') {
        e.preventDefault();
        await this.sendKey('KEYCODE_ENTER');
      } else if (key === 'Escape') {
        e.preventDefault();
        await this.sendKey('KEYCODE_BACK');
      } else if (key === 'ArrowUp') {
        e.preventDefault();
        await this.sendKey('KEYCODE_DPAD_UP');
      } else if (key === 'ArrowDown') {
        e.preventDefault();
        await this.sendKey('KEYCODE_DPAD_DOWN');
      } else if (key === 'ArrowLeft') {
        e.preventDefault();
        await this.sendKey('KEYCODE_DPAD_LEFT');
      } else if (key === 'ArrowRight') {
        e.preventDefault();
        await this.sendKey('KEYCODE_DPAD_RIGHT');
      } else if (key === 'Tab') {
        e.preventDefault();
        await this.sendKey('KEYCODE_TAB');
      } else if (key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        try {
          await fetch('/api/adb/input-text', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ target: this.currentDevice.ip, text: key })
          });
        } catch (err) {}
      }

      this.triggerQuickRefresh();
    },

    
    exportDevicesCsv() {
      const list = this.filteredDevices;
      if (!list || list.length === 0) {
        return this.toast('Không có thiết bị nào để xuất file', 'warning');
      }

      const headers = ['STT', 'Ten_Thiet_Bi', 'Ma_Kich_Hoat', 'Dia_Chi_IP', 'Nhom_Khoa_Phong', 'Dia_Chi_MAC', 'Trang_Thai', 'ADB_Port_5555', 'ADB_Connected'];
      const rows = list.map((d, index) => {
        let statusText = 'Offline';
        if (d.adbConnected) statusText = 'ADB Online';
        else if (d.adbPortOpen) statusText = 'Cong 5555 Mo';
        else if (d.status === 'online' || d.isConnected) statusText = 'Online';

        return [
          index + 1,
          `"${(d.name || 'Smart Display').replace(/"/g, '""')}"`,
          `"${(d.activeCode || d.active_code || '').toString().replace(/"/g, '""')}"`,
          `"${(d.ip || '').replace(/"/g, '""')}"`,
          `"${(d.group || d.room || '').replace(/"/g, '""')}"`,
          `"${(d.mac || '').replace(/"/g, '""')}"`,
          `"${statusText}"`,
          d.adbPortOpen ? 'Mo' : 'Dong',
          d.adbConnected ? 'Da Ket Noi' : 'Chua Ket Noi'
        ].join(',');
      });

      // UTF-8 BOM for Excel Vietnamese support
      const csvContent = '\uFEFF' + headers.join(',') + '\n' + rows.join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const dateStr = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `Danh_sach_SmartDisplay_${dateStr}_${list.length}tb.csv`;
      a.click();
      URL.revokeObjectURL(url);
      this.toast(`Đã xuất file Excel (CSV) thành công cho ${list.length} thiết bị!`, 'success');
    },

    exportDevicesJson() {
      const list = this.filteredDevices;
      if (!list || list.length === 0) {
        return this.toast('Không có thiết bị nào để xuất file', 'warning');
      }

      const jsonStr = JSON.stringify(list, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const dateStr = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `Danh_sach_SmartDisplay_${dateStr}_${list.length}tb.json`;
      a.click();
      URL.revokeObjectURL(url);
      this.toast(`Đã xuất file JSON thành công cho ${list.length} thiết bị!`, 'success');
    },

    downloadScreenshot() {
      if (!this.screenshotUrl) return;
      const a = document.createElement('a');
      a.href = this.screenshotUrl;
      a.download = `screenshot_${this.currentDevice?.ip || 'device'}_${Date.now()}.png`;
      a.click();
    },

    handleScreenClick(e) {
      this.onScreenMouseUp(e);
    },

    async installApkToDevice(apk) {
      if (!this.currentDevice?.ip) return;
      apk._installing = true;
      try {
        const res = await fetch('/api/adb/install-apk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ target: this.currentDevice.ip, apkId: apk.id, grantPermissions: true })
        }).then(r => r.json());

        if (res.success) {
          this.toast(`Cài đặt ${apk.name} thành công!`, 'success');
          this.fetchInstalledPackages();
        } else {
          this.toast(`Cài đặt thất bại: ${res.error || res.output}`, 'error');
        }
      } catch (e) {
        this.toast('Lỗi cài đặt APK: ' + e.message, 'error');
      } finally {
        apk._installing = false;
      }
    },

    async deleteApk(apk) {
      if (!confirm(`Bạn có chắc chắn muốn XÓA file APK "${apk.name}" (${apk.fileName}) khỏi kho?`)) return;
      try {
        const res = await fetch(`/api/apks/${encodeURIComponent(apk.id)}`, {
          method: 'DELETE'
        }).then(r => r.json());

        if (res.success) {
          this.toast(`Đã xóa APK "${apk.name}"`, 'success');
          this.fetchAllData();
        } else {
          this.toast('Lỗi xóa APK: ' + res.message, 'error');
        }
      } catch (e) {
        this.toast('Lỗi xóa APK: ' + e.message, 'error');
      }
    },

    async uploadOpenGAppsZip() {
      const fileInput = this.$refs.openGAppsZipInput;
      if (!fileInput || !fileInput.files[0]) {
        return this.toast('Vui lòng chọn file .ZIP của gói OpenGApps Pico', 'error');
      }

      this.uploadingZip = true;
      const formData = new FormData();
      formData.append('packageZip', fileInput.files[0]);

      this.toast('Đang tải lên và giải nén gói OpenGApps trên server...', 'info');
      try {
        const res = await fetch('/api/system-packages/upload-opengapps', {
          method: 'POST',
          body: formData
        }).then(r => r.json());

        if (res.success) {
          this.toast(res.message, 'success');
          this.openGAppsReady = true;
          this.openGAppsPath = res.path;
          fileInput.value = '';
          this.fetchAllData();
        } else {
          this.toast('Lỗi nạp ZIP: ' + res.message, 'error');
        }
      } catch (e) {
        this.toast('Lỗi upload: ' + e.message, 'error');
      } finally {
        this.uploadingZip = false;
      }
    },

    async uploadApkGlobal() {
      const fileInput = this.$refs.globalApkFileInput;
      if (!fileInput || !fileInput.files[0]) {
        return this.toast('Vui lòng chọn file APK', 'error');
      }

      this.uploadingApk = true;
      const formData = new FormData();
      formData.append('apk', fileInput.files[0]);

      try {
        const res = await fetch('/api/apks/upload', {
          method: 'POST',
          body: formData
        }).then(r => r.json());

        if (res.success) {
          this.toast('Tải lên APK thành công!', 'success');
          fileInput.value = '';
          this.fetchAllData();
        } else {
          this.toast('Tải lên thất bại: ' + res.message, 'error');
        }
      } catch (e) {
        this.toast('Lỗi upload: ' + e.message, 'error');
      } finally {
        this.uploadingApk = false;
      }
    },

    async fetchInstalledPackages() {
      if (!this.currentDevice?.ip) return;
      this.loadingPackages = true;
      try {
        const url = `/api/adb/packages?target=${encodeURIComponent(this.currentDevice.ip)}&all=${this.showAllSystemPackages}`;
        const res = await fetch(url).then(r => r.json());
        if (res.success) {
          this.installedPackages = res.packages || [];
        }
      } catch (e) {
      } finally {
        this.loadingPackages = false;
      }
    },

    async uninstallPackage(pkg) {
      if (!confirm(`Gỡ cài đặt gói "${pkg}" khỏi thiết bị?`)) return;
      try {
        const res = await fetch('/api/adb/uninstall', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ target: this.currentDevice.ip, packageName: pkg })
        }).then(r => r.json());

        if (res.success) {
          this.toast(`Đã gỡ cài đặt ${pkg}`, 'success');
          this.fetchInstalledPackages();
        } else {
          this.toast('Gỡ thất bại: ' + res.output, 'error');
        }
      } catch (e) {
        this.toast('Lỗi gỡ app: ' + e.message, 'error');
      }
    },

    toggleLogcatStream() {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        this.initWebSocket();
      }

      if (this.isLogcatActive) {
        this.ws.send(JSON.stringify({ action: 'stop_logcat' }));
        this.isLogcatActive = false;
      } else {
        this.logcatLines = [];
        this.ws.send(JSON.stringify({
          action: 'start_logcat',
          target: this.currentDevice.ip,
          level: this.logLevel
        }));
        this.isLogcatActive = true;
      }
    },

    restartLogcatWithLevel() {
      if (this.isLogcatActive) {
        this.toggleLogcatStream();
        setTimeout(() => this.toggleLogcatStream(), 200);
      }
    },

    clearLogcat() {
      this.logcatLines = [];
    },

    downloadLogcat() {
      const blob = new Blob([this.logcatLines.join('\n')], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `logcat_${this.currentDevice?.ip}_${Date.now()}.txt`;
      a.click();
    },

    getLogLineClass(line) {
      if (line.includes(' E ') || line.includes('FATAL') || line.includes('Exception') || line.includes('Error')) return 'text-red-400 font-bold';
      if (line.includes(' W ')) return 'text-amber-400';
      if (line.includes(' I ')) return 'text-blue-300';
      return 'text-slate-300';
    },

    async execShellCommand() {
      if (!this.shellCommand || !this.currentDevice?.ip) return;
      const cmd = this.shellCommand;
      this.shellCommand = '';

      try {
        const res = await fetch('/api/adb/shell', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ target: this.currentDevice.ip, command: cmd })
        }).then(r => r.json());

        this.shellHistory.push({
          cmd,
          output: res.stdout || res.stderr || '(Lệnh thực thi không có output)'
        });
      } catch (e) {
        this.shellHistory.push({ cmd, output: 'Lỗi: ' + e.message });
      }
    },

    runQuickShell(cmd) {
      this.shellCommand = cmd;
      this.execShellCommand();
    },

    async loadDeviceInfo() {
      if (!this.currentDevice?.ip) return;
      try {
        const res = await fetch(`/api/adb/device-info?target=${encodeURIComponent(this.currentDevice.ip)}`).then(r => r.json());
        if (res.success) {
          this.deviceInfo = res.info;
        }
      } catch (e) {
        this.toast('Lỗi lấy thông số máy: ' + e.message, 'error');
      }
    },

    openCloudSyncModal() {
      this.showCloudSyncModal = true;
    },

    async syncWithDirectToken() {
      if (!this.directTokenInput) return;
      let text = this.directTokenInput.trim();
      
      if (text.startsWith('{') || text.startsWith('[')) {
        try {
          const parsed = JSON.parse(text);
          const res = await fetch('/api/devices/import-json', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(parsed)
          }).then(r => r.json());

          if (res.success) {
            this.toast(`Đã nạp thành công ${res.count} thiết bị!`, 'success');
            this.showCloudSyncModal = false;
            this.directTokenInput = '';
            this.fetchAllData();
            return;
          }
        } catch (e) {}
      }

      this.syncingCloud = true;
      try {
        const res = await fetch('/api/cloud/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: text })
        }).then(r => r.json());

        if (res.success) {
          this.toast(`Đã cào thành công ${res.count} thiết bị từ Cloud!`, 'success');
          this.showCloudSyncModal = false;
          this.directTokenInput = '';
          this.fetchAllData();
        } else {
          this.toast('Cào dữ liệu thất bại: ' + res.message, 'error');
        }
      } catch (e) {
        this.toast('Lỗi cào dữ liệu: ' + e.message, 'error');
      } finally {
        this.syncingCloud = false;
      }
    },

    async loginAndSyncCloud() {
      this.syncingCloud = true;
      try {
        const res = await fetch('/api/cloud/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.cloudAuth)
        }).then(r => r.json());

        if (res.success && res.token) {
          this.toast('Đăng nhập thành công! Đang cào toàn bộ 710+ thiết bị...', 'info');
          const syncRes = await fetch('/api/cloud/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: res.token })
          }).then(r => r.json());

          if (syncRes.success) {
            this.toast(`Đã cào thành công ${syncRes.count} thiết bị từ Cloud!`, 'success');
            this.showCloudSyncModal = false;
            this.fetchAllData();
          } else {
            this.toast('Cào dữ liệu thất bại: ' + syncRes.message, 'error');
          }
        } else {
          this.toast('Đăng nhập thất bại: ' + (res.message || 'Sai thông tin'), 'error');
        }
      } catch (e) {
        this.toast('Lỗi kết nối Cloud: ' + e.message, 'error');
      } finally {
        this.syncingCloud = false;
      }
    },

    async runSubnetScan() {
      this.scanningSubnet = true;
      this.toast(`Đang quét dải mạng ${this.scanSubnetPrefix}.1-254...`, 'info');
      try {
        const res = await fetch('/api/devices/scan-subnet', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subnet: this.scanSubnetPrefix,
            port: this.scanPort || 5555
          })
        }).then(r => r.json());

        if (res.success) {
          this.toast(`Đã tìm thấy ${res.foundCount} thiết bị trong dải ${this.scanSubnetPrefix}!`, 'success');
          this.showCloudSyncModal = false;
          this.fetchAllData();
        } else {
          this.toast('Lỗi quét dải IP: ' + res.message, 'error');
        }
      } catch (e) {
        this.toast('Lỗi quét dải IP: ' + e.message, 'error');
      } finally {
        this.scanningSubnet = false;
      }
    }
  }
}).mount('#app');
