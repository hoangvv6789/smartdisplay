const net = require('net');
const { exec } = require('child_process');

function checkPort(host, port = 5555, timeout = 1000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();

    socket.setTimeout(timeout);
    socket.on('connect', () => {
      socket.destroy();
      resolve({ host, port, open: true });
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve({ host, port, open: false, error: 'timeout' });
    });
    socket.on('error', (err) => {
      socket.destroy();
      resolve({ host, port, open: false, error: err.message });
    });
    socket.connect(port, host);
  });
}

function pingHost(host, timeout = 1000) {
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    const winTimeout = Math.max(1, Math.ceil(timeout));
    const linuxTimeout = Math.max(1, Math.ceil(timeout / 1000));
    const cmd = isWin ? `ping -n 1 -w ${winTimeout} ${host}` : `ping -c 1 -W ${linuxTimeout} ${host}`;
    
    exec(cmd, { windowsHide: true, timeout: timeout + 500 }, (err, stdout) => {
      if (err) {
        resolve({ host, alive: false, time: null });
        return;
      }
      let timeMatch = stdout.match(/time[=<](\d+ms|\d+\.\d+ms)/i) || stdout.match(/Thời gian[=<](\d+ms)/i);
      const time = timeMatch ? timeMatch[1] : 'OK';
      resolve({ host, alive: true, time });
    });
  });
}

// Fast scanner for an IP range (e.g. "172.18.15.1" to "172.18.15.254")
async function scanSubnet(subnetPrefix, start = 1, end = 254, port = 5555, concurrency = 40) {
  const ips = [];
  for (let i = start; i <= end; i++) {
    ips.push(`${subnetPrefix}.${i}`);
  }

  const found = [];
  for (let i = 0; i < ips.length; i += concurrency) {
    const chunk = ips.slice(i, i + concurrency);
    const results = await Promise.all(chunk.map(ip => checkPort(ip, port, 1200)));
    for (const r of results) {
      if (r.open) {
        found.push(r.host);
      }
    }
  }

  return found;
}

module.exports = { checkPort, pingHost, scanSubnet };
