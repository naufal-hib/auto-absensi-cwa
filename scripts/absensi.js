// ============================================
// AUTO ABSENSI CWA - GitHub Actions Version
// Supports: Mode 5 Hari (Pusat) & Mode 6 Hari (Transit)
// ============================================

const http = require('http');
const fs   = require('fs');
const path = require('path');

const BASE_URL    = 'http://cwaabsen.weldon.co.id/absensi/absensi/';
const CHECKIN_URL = BASE_URL + 'checkin';
const CHECKOUT_URL= BASE_URL + 'checkout';
const NAMA_SERVER = 'cwaabsen.weldon.co.id';

// Config dari environment variables (GitHub Secrets)
const CONFIG = {
  nik        : process.env.ABSEN_NIK      || '',
  password   : process.env.ABSEN_PASSWORD || '',
  shift      : process.env.ABSEN_SHIFT    || '1',
  jamOverride: process.env.JAM_OVERRIDE   || '', // untuk manual absen
  manualMode : process.env.MANUAL_MODE    === 'true',
};

// ============================================
// BACA WORK MODE DARI config.json
// ============================================
function getWorkMode() {
  const cfgFile = path.join(__dirname, '..', 'config.json');
  if (!fs.existsSync(cfgFile)) return 6; // default 6 hari

  try {
    const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
    const mode = parseInt(cfg.workMode || '6');
    console.log(`📋 Work Mode: ${mode} Hari Kerja (${mode === 5 ? 'Pusat' : 'Transit'})`);
    return mode;
  } catch (e) {
    console.log('⚠️ Gagal baca config.json, pakai default 6 hari');
    return 6;
  }
}

// ============================================
// GENERATE RANDOM TIME
// ============================================
function generateRandomTime(hourStart, minuteStart, hourEnd, minuteEnd) {
  const startMinutes = (hourStart * 60) + minuteStart;
  const endMinutes   = (hourEnd   * 60) + minuteEnd;
  const randomMinutes= Math.floor(Math.random() * (endMinutes - startMinutes + 1)) + startMinutes;

  const hour  = Math.floor(randomMinutes / 60);
  const minute= randomMinutes % 60;
  const second= Math.floor(Math.random() * 60);

  return [hour, minute, second].map(x => x.toString().padStart(2, '0')).join(':');
}

// ============================================
// GET TARGET TIME BASED ON MODE + CUSTOM SCHEDULE
// ============================================
function parseTM(timeStr) {
  // 'HH:MM' => [hour, minute]
  const [h, m] = timeStr.split(':').map(Number);
  return [h, m];
}

function getTargetTime(type, workMode) {
  const now     = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
  const day     = now.getDay(); // 0=Minggu, 6=Sabtu
  const dayKeys = ['minggu','senin','selasa','rabu','kamis','jumat','sabtu'];
  const dayKey  = dayKeys[day];

  // Coba baca custom schedule dari config.json
  const cfgFile = path.join(__dirname, '..', 'config.json');
  let sched = null;
  if (fs.existsSync(cfgFile)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
      if (cfg.customSchedule && cfg.customSchedule[workMode]) {
        sched = cfg.customSchedule[workMode];
        console.log(`📋 Pakai custom schedule mode ${workMode}`);
      }
    } catch(e) {}
  }

  // Jika ada custom schedule, gunakan itu
  if (sched && sched[dayKey]) {
    const s = sched[dayKey];
    if (s.libur) return null;
    if (type === 'checkin') {
      const [hs, ms] = parseTM(s.inStart);
      const [he, me] = parseTM(s.inEnd);
      return generateRandomTime(hs, ms, he, me);
    }
    if (type === 'checkout') {
      const [hs, ms] = parseTM(s.outStart);
      const [he, me] = parseTM(s.outEnd);
      return generateRandomTime(hs, ms, he, me);
    }
    return null;
  }

  // Fallback ke default hardcoded
  if (day === 0) return null;                        // Minggu libur
  if (workMode === 5 && day === 6) return null;      // Sabtu libur (mode 5)

  if (type === 'checkin') {
    if (day === 5) return generateRandomTime(6, 45, 7, 10);  // Jumat
    return generateRandomTime(7, 15, 7, 30);
  }
  if (type === 'checkout') {
    if (day === 6 && workMode === 6) return generateRandomTime(13, 20, 13, 50);
    if (workMode === 5)              return generateRandomTime(16, 20, 17,  0);
    return generateRandomTime(16, 20, 16, 45);
  }
  return null;
}

// ============================================
// CEK TANGGAL MERAH
// ============================================
function isTanggalMerah() {
  const merahFile = path.join(__dirname, '..', 'tanggal_merah.json');
  if (!fs.existsSync(merahFile)) return false;

  try {
    const data = JSON.parse(fs.readFileSync(merahFile, 'utf8'));
    const now  = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
    const todayStr = now.toISOString().split('T')[0];
    return data.tanggalMerah.some(t => t.tanggal === todayStr);
  } catch (e) {
    console.log('Error reading tanggal_merah.json:', e.message);
    return false;
  }
}

// ============================================
// HTTP POST REQUEST
// ============================================
function doPost(url, payload) {
  return new Promise((resolve, reject) => {
    const postData = new URLSearchParams(payload).toString();
    const urlObj   = new URL(url);

    const options = {
      method  : 'POST',
      hostname: urlObj.hostname,
      port    : urlObj.port || 80,
      path    : urlObj.pathname,
      headers : {
        'Content-Type'     : 'application/x-www-form-urlencoded; charset=UTF-8',
        'Content-Length'   : Buffer.byteLength(postData),
        'Accept'           : 'application/json, text/javascript, */*; q=0.01',
        'X-Requested-With' : 'XMLHttpRequest',
        'User-Agent'       : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer'          : 'http://cwaabsen.weldon.co.id/absensi/absensi',
        'Origin'           : 'http://cwaabsen.weldon.co.id'
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end',  () => resolve({ statusCode: res.statusCode, body: data.trim() }));
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// ============================================
// SAVE LOG
// ============================================
function saveLog(entry) {
  const logFile = path.join(__dirname, '..', 'log.json');
  let logs = [];

  if (fs.existsSync(logFile)) {
    try { logs = JSON.parse(fs.readFileSync(logFile, 'utf8')); }
    catch (e) { logs = []; }
  }

  logs.unshift(entry);
  if (logs.length > 100) logs = logs.slice(0, 100);

  fs.writeFileSync(logFile, JSON.stringify(logs, null, 2));
  console.log(`[LOG] ${entry.timestamp} | ${entry.type} | ${entry.status} | ${entry.message}`);
}

// ============================================
// MAIN
// ============================================
async function main() {
  const action = process.argv[2]; // 'checkin' atau 'checkout'

  if (!action || !['checkin', 'checkout'].includes(action)) {
    console.error('Usage: node absensi.js [checkin|checkout]');
    process.exit(1);
  }

  const workMode  = getWorkMode();
  const now       = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
  const day       = now.getDay();
  const todayStr  = now.toISOString().split('T')[0];
  const currentTime = now.toTimeString().split(' ')[0];
  const timestamp = now.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
  const dayNames  = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];

  console.log(`\n🚀 AUTO ABSENSI CWA`);
  console.log(`📅 Tanggal : ${todayStr} | Hari: ${dayNames[day]}`);
  console.log(`📋 Mode    : ${workMode} Hari Kerja (${workMode === 5 ? 'Pusat' : 'Transit'})`);
  console.log(`⏰ Waktu   : ${currentTime} WIB`);
  console.log(`🎯 Action  : ${action.toUpperCase()}`);
  console.log(`${'─'.repeat(50)}`);

  // Validasi config
  if (!CONFIG.nik || !CONFIG.password) {
    console.error('❌ ERROR: ABSEN_NIK atau ABSEN_PASSWORD tidak ada di GitHub Secrets!');
    saveLog({ timestamp, type: action.toUpperCase(), status: 'ERROR', message: 'NIK atau Password kosong di GitHub Secrets' });
    process.exit(1);
  }

  // ============================================
  // MANUAL MODE — bypass jadwal, pakai jam sekarang
  // ============================================
  if (CONFIG.manualMode) {
    console.log('👆 MANUAL MODE — bypass jadwal otomatis');
    const jamAbsen = CONFIG.jamOverride || currentTime;
    console.log(`⏰ Jam Manual: ${jamAbsen}`);
    await kirimAbsen(action, jamAbsen, workMode, timestamp, true);
    return;
  }

  // ============================================
  // AUTO MODE — cek jadwal seperti biasa
  // ============================================

  // Cek Minggu
  if (day === 0) {
    console.log('⏭️  SKIP: Hari Minggu (Libur)');
    saveLog({ timestamp, type: action.toUpperCase(), status: 'SKIP', message: 'Hari Minggu - Libur' });
    return;
  }

  // Cek Sabtu libur (mode 5 hari)
  if (workMode === 5 && day === 6) {
    console.log('⏭️  SKIP: Mode 5 Hari — Sabtu Libur');
    saveLog({ timestamp, type: action.toUpperCase(), status: 'SKIP', message: 'Mode 5 Hari Kerja — Sabtu Libur' });
    return;
  }

  // Cek tanggal merah
  if (isTanggalMerah()) {
    console.log('🔴 SKIP: Tanggal Merah / Hari Libur Nasional');
    saveLog({ timestamp, type: action.toUpperCase(), status: 'SKIP', message: 'Tanggal Merah / Hari Libur Nasional' });
    return;
  }

  // Generate jam random sesuai mode
  const jamAbsen = getTargetTime(action, workMode);
  if (!jamAbsen) {
    console.log('⏭️  SKIP: Tidak ada jadwal untuk hari ini');
    saveLog({ timestamp, type: action.toUpperCase(), status: 'SKIP', message: 'Tidak ada jadwal hari ini' });
    return;
  }

  console.log(`🎲 Jam ${action.toUpperCase()}: ${jamAbsen}`);
  await kirimAbsen(action, jamAbsen, workMode, timestamp, false);
}

// ============================================
// FUNGSI KIRIM ABSEN (dipakai auto & manual)
// ============================================
async function kirimAbsen(action, jamAbsen, workMode, timestamp, isManual) {

  const url        = action === 'checkin' ? CHECKIN_URL : CHECKOUT_URL;
  const absenLabel = action === 'checkin' ? 'Check In' : 'Check Out';

  // Baca departemen dari config.json jika ada
  let departemen = '';
  const cfgFileD = path.join(__dirname, '..', 'config.json');
  if (fs.existsSync(cfgFileD)) {
    try { departemen = JSON.parse(fs.readFileSync(cfgFileD,'utf8')).departemen || ''; } catch(e) {}
  }

  const payload = {
    nik         : CONFIG.nik,
    pswd        : CONFIG.password,
    jam         : jamAbsen,
    shift       : CONFIG.shift,
    absen       : absenLabel,
    nama_server : NAMA_SERVER,
    ...(departemen && { departemen })
  };

  const modeTag = isManual ? '[MANUAL]' : '[AUTO]';
  console.log(`📡 ${modeTag} Mengirim ${absenLabel} jam ${jamAbsen} ke server...`);

  try {
    const result = await doPost(url, payload);

    if (result.statusCode === 200) {
      const msg = `${modeTag} BERHASIL - Jam: ${jamAbsen} - Response: ${result.body}`;
      console.log(`✅ ${action.toUpperCase()} ${msg}`);
      saveLog({ timestamp, type: action.toUpperCase(), status: 'BERHASIL', jamAbsen, workMode, isManual, message: msg, response: result.body });
    } else {
      const msg = `${modeTag} Status ${result.statusCode} - Response: ${result.body}`;
      console.log(`⚠️  ${action.toUpperCase()} ${msg}`);
      saveLog({ timestamp, type: action.toUpperCase(), status: 'WARNING', jamAbsen, workMode, isManual, message: msg });
    }
  } catch (error) {
    const msg = `Error: ${error.message}`;
    console.error(`❌ ${msg}`);
    saveLog({ timestamp, type: action.toUpperCase(), status: 'ERROR', workMode, isManual, message: msg });
    process.exit(1);
  }
}

main();
