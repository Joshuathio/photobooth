#!/usr/bin/env node
/**
 * Keeps the tablet's USB link up during an event. Every few seconds it checks
 * that the tablet is attached and that `adb reverse tcp:5173 tcp:5173` is in
 * place, and puts it back if the cable was wiggled, the tablet rebooted or adb
 * restarted. Leave it running in its own Terminal tab: `npm run tablet:watch`.
 */
import { execFile } from 'node:child_process';
import { request } from 'node:http';

const PORT = 5173;
const EVERY_MS = 3000;

const adb = (args) =>
  new Promise((resolve) => {
    execFile('adb', args, { timeout: 5000 }, (err, stdout) => resolve({ err, out: String(stdout ?? '') }));
  });

/** Is the booth server answering on this address? (adb may reach it over IPv4 or IPv6.) */
const serverAt = (host) =>
  new Promise((resolve) => {
    const req = request({ host, port: PORT, path: '/guest.html', method: 'HEAD', timeout: 1500 }, (res) => {
      res.resume();
      resolve(res.statusCode !== undefined && res.statusCode < 500);
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
    req.end();
  });

let last = '';
const say = (state, text) => {
  if (state === last) return;
  last = state;
  console.log(`[${new Date().toLocaleTimeString('id-ID')}] ${text}`);
};

async function check() {
  const [v4, v6] = await Promise.all([serverAt('127.0.0.1'), serverAt('::1')]);
  if (!v4 && !v6) {
    say('no-server', `Server booth tidak jalan di port ${PORT} — jalankan "npm run booth" (atau "npm run dev") di tab Terminal lain.`);
    return;
  }
  const devices = await adb(['devices']);
  if (devices.err) {
    say('no-adb', `adb tidak bisa dijalankan (${devices.err.code === 'ENOENT' ? 'belum terpasang?' : devices.err.message})`);
    return;
  }
  const lines = devices.out.split('\n').slice(1).map((l) => l.trim()).filter(Boolean);
  if (lines.some((l) => l.endsWith('\tunauthorized'))) {
    say('unauthorized', 'Tablet belum mengizinkan USB debugging — buka tablet dan tekan "Izinkan".');
    return;
  }
  if (!lines.some((l) => l.endsWith('\tdevice'))) {
    say('none', 'Tablet tidak terdeteksi — cek kabel USB.');
    return;
  }
  const list = await adb(['reverse', '--list']);
  if (list.out.includes(`tcp:${PORT} tcp:${PORT}`)) {
    say('ok', `Tablet tersambung (localhost:${PORT}).`);
    return;
  }
  const set = await adb(['reverse', `tcp:${PORT}`, `tcp:${PORT}`]);
  if (set.err) {
    say('fail', `Gagal adb reverse: ${set.err.message}`);
    return;
  }
  last = ''; // always report a repair
  say('ok', `Sambungan tablet dipasang (localhost:${PORT}).`);
}

console.log('Menjaga sambungan tablet… (Ctrl+C untuk berhenti)');
await check();
setInterval(check, EVERY_MS);
