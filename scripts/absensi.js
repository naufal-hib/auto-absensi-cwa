// ============================================
// AUTO ABSENSI CWA
// Semua config dibaca dari config.json
// ============================================

const http = require('http');
const fs   = require('fs');
const path = require('path');

const BASE_URL     = 'http://cwaabsen.weldon.co.id/absensi/absensi/';
const CHECKIN_URL  = BASE_URL + 'checkin';
const CHECKOUT_URL = BASE_URL + 'checkout';
const NAMA_SERVER  = 'cwaabsen.weldon.co.id';

// ============================================
// BACA SEMUA CONFIG DARI config.json
// ============================================
function loadConfig() {
  const cfgFile = path.join(__dirname, '..', 'config.json');

  if (!fs.existsSync(cfgFile)) {
    console.error('❌ ERROR: config.json tidak ditemukan!');
    console.error('   Pastikan kamu sudah simpan config di dashboard web.');
    process.exit(1);
  }

  try {
    const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));

    if (!cfg.nik || !cfg.password) {
      console.error('❌ ERROR: NIK atau Password kosong di config.json!');
      console.error('   Buka dashboard → Settings → Konfigurasi Absensi → Simpan Config');
      process.exit(1);
    }

    return cfg;
  } catch (e) {
    console.error('❌ ERROR: Gagal parse config.json:', e.message);
    process.exit(1);
  }
}

// ============================================
// GENERATE RANDOM TIME
// ============================================
function generateRandomTime(hourStart, minuteStart, hourEnd, minuteEnd) {
  const startMin  = (hourStart * 60) + minuteStart;
  const endMin    = (hourEnd   * 60) + minuteEnd;
  const randMin   = Math.floor(Math.random() * (endMin - startMin + 1)) + startMin;
  const hour      = Math.floor(randMin / 60);
  const minute    = randMin % 60;
  const second    = Math.floor(Math.random() * 60);
  return [hour, minute, second].map(x => x.toString().padStart(2, '0')).join(':');
}

// ============================================
// GET TARGET TIME (auto mode) — dari custom schedule atau default
// ============================================
function getTargetTime(type, cfg) {
  const workMode = parseInt(cfg.workMode || '6');
  const now      = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
  const day      = now.getDay();
  const dayKeys  = ['minggu','senin','selasa','rabu','kamis','jumat','sabtu'];
  const dayKey   = dayKeys[day];

  // Coba pakai custom schedule dari config.json
  if (cfg.customSchedule && cfg.customSchedule[workMode]) {
    const sched = cfg.customSchedule[workMode];
    const s = sched[dayKey];
    if (!s || s.libur) return null;

    const parse = str => str.split(':').map(Number);
    if (type === 'checkin') {
      const [hs,ms] = parse(s.inStart);
      const [he,me] = parse(s.inEnd);
      return generateRandomTime(hs, ms, he, me);
    }
    if (type === 'checkout') {
      const [hs,ms] = parse(s.outStart);
      const [he,me] = parse(s.outEnd);
      return generateRandomTime(hs, ms, he, me);
    }
    return null;
  }

  // Fallback default
  if (day === 0) return null;
  if (workMode === 5 && day === 6) return null;

  if (type === 'checkin') {
    if (day === 5) return generateRandomTime(6, 45, 7, 10);
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
  const f = path.join(__dirname, '..', 'tanggal_merah.json');
  if (!fs.existsSync(f)) return false;
  try {
    const data     = JSON.parse(fs.readFileSync(f, 'utf8'));
    const now      = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
    const todayStr = now.toISOString().split('T')[0];
    return data.tanggalMerah.some(t => t.tanggal === todayStr);
  } catch(e) { return false; }
}

// ============================================
// HTTP POST
// ============================================
function doPost(url, payload) {
  return new Promise((resolve, reject) => {
    const postData = new URLSearchParams(payload).toString();
    const urlObj   = new URL(url);
    const req = http.request({
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
    }, (res) => {
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
    catch(e) { logs = []; }
  }
  logs.unshift(entry);
  if (logs.length > 100) logs = logs.slice(0, 100);
  fs.writeFileSync(logFile, JSON.stringify(logs, null, 2));
  console.log(`[LOG] ${entry.timestamp} | ${entry.type} | ${entry.status} | ${entry.message}`);
}

// ============================================
// KIRIM ABSEN
// ============================================
async function kirimAbsen(action, jamAbsen, cfg, timestamp, isManual) {
  const url        = action === 'checkin' ? CHECKIN_URL : CHECKOUT_URL;
  const absenLabel = action === 'checkin' ? 'Check In' : 'Check Out';
  const workMode   = parseInt(cfg.workMode || '6');
  const modeTag    = isManual ? '[MANUAL]' : '[AUTO]';

  const payload = {
    nik         : cfg.nik,
    pswd        : cfg.password,
    jam         : jamAbsen,
    shift       : cfg.shift || '1',
    absen       : absenLabel,
    nama_server : NAMA_SERVER,
  };
  if (cfg.departemen) payload.departemen = cfg.departemen;

  console.log(`📡 ${modeTag} Kirim ${absenLabel} | NIK: ${cfg.nik} | Jam: ${jamAbsen} | Dept: ${cfg.departemen||'-'}`);

  try {
    const result = await doPost(url, payload);
    const msg = `${modeTag} Status ${result.statusCode} - Response: ${result.body}`;

    if (result.statusCode === 200) {
      console.log(`✅ BERHASIL: ${msg}`);
      saveLog({ timestamp, type: action.toUpperCase(), status: 'BERHASIL', jamAbsen, workMode, isManual, message: msg, response: result.body });
    } else {
      console.log(`⚠️  WARNING: ${msg}`);
      saveLog({ timestamp, type: action.toUpperCase(), status: 'WARNING', jamAbsen, workMode, isManual, message: msg });
    }
  } catch(error) {
    console.error(`❌ ERROR: ${error.message}`);
    saveLog({ timestamp, type: action.toUpperCase(), status: 'ERROR', workMode, isManual, message: `Error: ${error.message}` });
    process.exit(1);
  }
}

// ============================================
// MAIN
// ============================================
async function main() {
  const action = process.argv[2];
  if (!action || !['checkin','checkout'].includes(action)) {
    console.error('Usage: node absensi.js [checkin|checkout]');
    process.exit(1);
  }

  // Load semua config dari config.json
  const cfg       = loadConfig();
  const workMode  = parseInt(cfg.workMode || '6');
  const isManual  = process.env.MANUAL_MODE === 'true';
  const jamOverride = process.env.JAM_OVERRIDE || '';

  const now       = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
  const day       = now.getDay();
  const todayStr  = now.toISOString().split('T')[0];
  const currentTime = now.toTimeString().split(' ')[0];
  const timestamp = now.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
  const dayNames  = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];

  console.log(`\n🚀 AUTO ABSENSI CWA`);
  console.log(`📅 Tanggal  : ${todayStr} | ${dayNames[day]}`);
  console.log(`📋 Mode     : ${workMode} Hari (${workMode === 5 ? 'Pusat' : 'Transit'})`);
  console.log(`⏰ Waktu    : ${currentTime} WIB`);
  console.log(`🎯 Action   : ${action.toUpperCase()}`);
  console.log(`👤 NIK      : ${cfg.nik}`);
  console.log(`🏢 Dept     : ${cfg.departemen || '-'}`);
  console.log(`🔧 Mode     : ${isManual ? '👆 MANUAL' : '🤖 AUTO'}`);
  console.log('─'.repeat(50));

  // ── MANUAL MODE ─────────────────────────────
  if (isManual) {
    const jamAbsen = jamOverride || currentTime;
    console.log(`👆 MANUAL — pakai jam: ${jamAbsen}`);
    await kirimAbsen(action, jamAbsen, cfg, timestamp, true);
    return;
  }

  // ── AUTO MODE ───────────────────────────────

  // Minggu libur
  if (day === 0) {
    console.log('⏭️  SKIP: Hari Minggu');
    saveLog({ timestamp, type: action.toUpperCase(), status: 'SKIP', message: 'Hari Minggu - Libur' });
    return;
  }

  // Mode 5 hari: Sabtu libur
  if (workMode === 5 && day === 6) {
    console.log('⏭️  SKIP: Mode 5 Hari — Sabtu Libur');
    saveLog({ timestamp, type: action.toUpperCase(), status: 'SKIP', message: 'Mode 5 Hari — Sabtu Libur' });
    return;
  }

  // Tanggal merah
  if (isTanggalMerah()) {
    console.log('🔴 SKIP: Tanggal Merah');
    saveLog({ timestamp, type: action.toUpperCase(), status: 'SKIP', message: 'Tanggal Merah / Libur Nasional' });
    return;
  }

  // Generate jam
  const jamAbsen = getTargetTime(action, cfg);
  if (!jamAbsen) {
    console.log('⏭️  SKIP: Tidak ada jadwal hari ini');
    saveLog({ timestamp, type: action.toUpperCase(), status: 'SKIP', message: 'Tidak ada jadwal hari ini' });
    return;
  }

  console.log(`🎲 Jam random: ${jamAbsen}`);
  await kirimAbsen(action, jamAbsen, cfg, timestamp, false);
}

main();
