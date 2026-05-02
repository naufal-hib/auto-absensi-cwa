# 🤖 Auto Absensi CWA — GitHub Actions Version

Dashboard otomatis check-in & check-out ke sistem absensi CWA, berjalan via GitHub Actions.

## 📁 Struktur File

```
auto-absensi/
├── .github/
│   └── workflows/
│       ├── checkin.yml          # Trigger otomatis check-in
│       ├── checkout.yml         # Trigger otomatis check-out
│       └── deploy-pages.yml     # Deploy dashboard ke GitHub Pages
├── scripts/
│   └── absensi.js               # Script utama Node.js
├── index.html                   # Dashboard web mobile-friendly
├── log.json                     # Log riwayat absensi (auto-update)
├── tanggal_merah.json           # Daftar hari libur
└── README.md
```

## ⚡ Jadwal Otomatis

| Hari | Check In | Check Out |
|------|----------|-----------|
| Senin–Kamis | 07:15–07:30 (random) | 16:20–16:45 (random) |
| Jumat | 06:45–07:10 (random) | 16:20–16:45 (random) |
| Sabtu | 07:15–07:30 (random) | 13:20–13:50 (random) |
| Minggu | ❌ Libur | ❌ Libur |
