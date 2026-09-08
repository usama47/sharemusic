/**
 * Pakistan Independence Day — Synchronized Floor Presentation
 * Sync server: authoritative clock, device registry, timeline + media
 * persistence, and presentation state broadcast over WebSockets.
 */
const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const http = require('http');
const { Server } = require('socket.io');

const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');
const TIMELINE_FILE = path.join(DATA_DIR, 'timeline.json');
const MEDIA_FILE = path.join(DATA_DIR, 'media.json');
const SOURCES_FILE = path.join(__dirname, 'media-sources.json');
const HISTORICAL_DIR = path.join(__dirname, 'public', 'media', 'historical');
const PLACEHOLDER_DIR = path.join(HISTORICAL_DIR, 'placeholders');

for (const dir of [DATA_DIR, UPLOADS_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ---------- Default timeline (editable from the admin panel) ----------
const DEFAULT_TIMELINE = {
  countdownMs: 5000, // buffer between "START" press and t=0 for all laptops to prepare
  totalMs: 200000, // 3:20 — adjust to match the actual anthem recording length
  anthemUrl: null, // set once admin uploads Pakistan-National-Anthem.mp3
  events: [
    { id: 'e-flag', time: 0, type: 'flag-start' },
    { id: 'e-anthem', time: 0, type: 'anthem-start' },
    { id: 'e-p1', time: 15000, type: 'photo', image: null, name: 'Muhammad Ali Jinnah', title: 'Founder of Pakistan' },
    { id: 'e-p2', time: 45000, type: 'photo', image: null, name: 'Allama Muhammad Iqbal', title: 'Poet-philosopher and spiritual inspiration behind the Pakistan Movement' },
    { id: 'e-p3', time: 75000, type: 'photo', image: null, name: 'Fatima Jinnah', title: 'Mother of the Nation' },
    { id: 'e-p4', time: 105000, type: 'photo', image: null, name: 'Liaquat Ali Khan', title: 'First Prime Minister of Pakistan' },
    { id: 'e-p5', time: 135000, type: 'photo', image: null, name: 'Pakistan', title: 'Founded 14 August 1947' },
    { id: 'e-final', time: 195000, type: 'final' }
  ]
};

function loadJSON(file, fallback) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (e) {
    console.error('Failed to read', file, e.message);
  }
  return fallback;
}
function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

let timeline = loadJSON(TIMELINE_FILE, DEFAULT_TIMELINE);
let mediaLibrary = loadJSON(MEDIA_FILE, []);
if (!fs.existsSync(TIMELINE_FILE)) saveJSON(TIMELINE_FILE, timeline);
if (!fs.existsSync(MEDIA_FILE)) saveJSON(MEDIA_FILE, mediaLibrary);

// ---------- Auto-wire sourced/placeholder media so the demo is playable
// on first run. Never overwrites an event/URL an admin has already set —
// this only fills in blanks. Real archival photos (fetched via
// `npm run fetch-media`, see media-sources.json) always win over the
// generated placeholder art the moment they land on disk.
const SLUG_BY_NAME = {
  'Muhammad Ali Jinnah': 'muhammad-ali-jinnah',
  'Allama Muhammad Iqbal': 'allama-iqbal',
  'Fatima Jinnah': 'fatima-jinnah',
  'Liaquat Ali Khan': 'liaquat-ali-khan'
};
function resolvePersonImageUrl(name) {
  const slug = SLUG_BY_NAME[name];
  if (!slug) return null;
  const realFile = path.join(HISTORICAL_DIR, `${slug}.jpg`);
  if (fs.existsSync(realFile)) return `/media/historical/${slug}.jpg`;
  const placeholderFile = path.join(PLACEHOLDER_DIR, `${slug}.svg`);
  if (fs.existsSync(placeholderFile)) return `/media/historical/placeholders/${slug}.svg`;
  return null;
}
function resolveAnthemUrl() {
  const realMp3 = path.join(__dirname, 'public', 'media', 'anthem', 'pakistan-national-anthem.mp3');
  if (fs.existsSync(realMp3)) return '/media/anthem/pakistan-national-anthem.mp3';
  const realOgg = path.join(__dirname, 'public', 'media', 'anthem', 'pakistan-national-anthem-instrumental.oga');
  if (fs.existsSync(realOgg)) return '/media/anthem/pakistan-national-anthem-instrumental.oga';
  return null;
}
function autoWireDefaults() {
  let changed = false;
  for (const ev of timeline.events || []) {
    if (ev.type !== 'photo') continue;
    if (ev.image) continue; // admin already picked something — leave it alone
    const url = resolvePersonImageUrl(ev.name);
    if (url) {
      ev.image = url;
      changed = true;
      if (!mediaLibrary.some(m => m.url === url)) {
        mediaLibrary.push({ id: 'm-auto-' + SLUG_BY_NAME[ev.name], originalName: `${ev.name}.${url.endsWith('.svg') ? 'svg' : 'jpg'}`, url, kind: 'image' });
      }
    }
  }
  if (!timeline.anthemUrl) {
    const url = resolveAnthemUrl();
    if (url) {
      timeline.anthemUrl = url;
      changed = true;
      if (!mediaLibrary.some(m => m.url === url)) {
        mediaLibrary.push({ id: 'm-auto-anthem', originalName: 'Pakistan National Anthem (instrumental).oga', url, kind: 'audio' });
      }
    }
  }
  if (changed) { saveJSON(TIMELINE_FILE, timeline); saveJSON(MEDIA_FILE, mediaLibrary); }
}
autoWireDefaults();

// ---------- Presentation state ----------
// status: 'idle' | 'counting' | 'running' | 'paused' | 'ended'
let endTimer = null;

const state = {
  status: 'idle',
  startAt: null,      // server epoch ms when t=0 begins (after countdown)
  pausedAtMs: null,   // elapsed ms into the timeline when paused
  pauseWallClock: null
};

// ---------- App setup ----------
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.json());

// Presentation assets change during setup/development. Prevent browsers on other
// laptops from silently reusing an older cached floor.js/floor.css and showing
// the previous blank/static implementation. Media files remain cacheable.
app.use((req, res, next) => {
  if (req.path === '/floor.html' || req.path === '/admin.html' || req.path.startsWith('/js/') || req.path.startsWith('/css/')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => {
  const anthem = timeline.anthemUrl ? path.join(__dirname, 'public', timeline.anthemUrl.replace(/^\//, '')) : null;
  const media = (timeline.events || []).filter(e => e.type === 'photo').map(e => ({
    id: e.id, name: e.name, image: e.image, exists: !!e.image && fs.existsSync(path.join(__dirname, 'public', e.image.replace(/^\//, '')))
  }));
  res.json({
    ok: true,
    status: state.status,
    anthem: { url: timeline.anthemUrl, exists: !!anthem && fs.existsSync(anthem) },
    photos: media,
    clients: devices.size
  });
});

app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/floor', (req, res) => res.sendFile(path.join(__dirname, 'public', 'floor.html')));

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
      const safe = Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, safe);
    }
  }),
  limits: { fileSize: 60 * 1024 * 1024 } // 60MB — allows large ceremony photos / audio
});

// ---------- REST: media + timeline ----------
app.get('/api/timeline', (req, res) => res.json(timeline));

app.post('/api/timeline', (req, res) => {
  const incoming = req.body;
  if (!incoming || !Array.isArray(incoming.events)) {
    return res.status(400).json({ error: 'Malformed timeline payload' });
  }
  timeline = incoming;
  saveJSON(TIMELINE_FILE, timeline);
  io.emit('timeline:updated', timeline);
  res.json({ ok: true, timeline });
});

app.get('/api/media', (req, res) => res.json(mediaLibrary));

// Media provenance / attribution — powers the "Media Sources & Attribution"
// panel in the admin UI so every asset's source, license, and creator is
// transparent and easy to verify or replace.
app.get('/api/media-sources', (req, res) => {
  const sources = loadJSON(SOURCES_FILE, []);
  const withLiveStatus = sources.map(s => ({
    ...s,
    fileExists: s.targetPath ? fs.existsSync(path.join(__dirname, s.targetPath)) : false
  }));
  res.json(withLiveStatus);
});

app.post('/api/media', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const kind = req.file.mimetype.startsWith('audio') ? 'audio' : 'image';
  const item = {
    id: 'm-' + Date.now(),
    originalName: req.file.originalname,
    url: '/uploads/' + req.file.filename,
    kind
  };
  mediaLibrary.push(item);
  saveJSON(MEDIA_FILE, mediaLibrary);

  // Convenience: if this is the anthem audio, wire it straight into the timeline.
  if (kind === 'audio' && /anthem/i.test(req.file.originalname)) {
    timeline.anthemUrl = item.url;
    saveJSON(TIMELINE_FILE, timeline);
    io.emit('timeline:updated', timeline);
  }

  io.emit('media:updated', mediaLibrary);
  res.json({ ok: true, item });
});

app.delete('/api/media/:id', (req, res) => {
  const item = mediaLibrary.find(m => m.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  mediaLibrary = mediaLibrary.filter(m => m.id !== req.params.id);
  saveJSON(MEDIA_FILE, mediaLibrary);
  try {
    const filePath = path.join(__dirname, 'public', item.url.replace(/^\//, ''));
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (e) { /* non-fatal */ }
  io.emit('media:updated', mediaLibrary);
  res.json({ ok: true });
});

// ---------- Helpers ----------
function elapsedMs() {
  if (state.status === 'running' && state.startAt) return Date.now() - state.startAt;
  if (state.status === 'paused' && state.pausedAtMs != null) return state.pausedAtMs;
  return 0;
}

function publicState() {
  return {
    status: state.status,
    startAt: state.startAt,
    serverNow: Date.now(),
    elapsedMs: elapsedMs(),
    timeline
  };
}

// ---------- Device registry ----------
/** socketId -> { role, screen, ready, offsetMs, rttMs, lastSeen, label } */
const devices = new Map();

function broadcastDevices() {
  const list = Array.from(devices.entries()).map(([id, d]) => ({ id, ...d }));
  const floors = list.filter(d => d.role === 'floor');
  const connected = floors.length;
  const ready = floors.filter(d => d.ready).length;
  // "synchronized" = clock offset estimate is tight (< 120ms) and device has reported recently
  const now = Date.now();
  const synced = floors.filter(d => d.ready && Math.abs(d.offsetMs || 0) < 250 && now - d.lastSeen < 8000).length;
  const offline = floors.filter(d => now - d.lastSeen >= 8000).length;

  io.to('admins').emit('devices:update', {
    connected, ready, synced, offline,
    devices: floors.map(d => ({
      id: d.id, label: d.label, screen: d.screen, ready: d.ready,
      offsetMs: Math.round(d.offsetMs || 0), rttMs: Math.round(d.rttMs || 0),
      lastSeen: d.lastSeen
    }))
  });
}
setInterval(broadcastDevices, 1500);

// ---------- Socket.io ----------
io.on('connection', (socket) => {
  socket.on('register', ({ role, screen, label }) => {
    if (role === 'admin') {
      socket.join('admins');
      socket.emit('presentation:state', publicState());
      broadcastDevices();
      return;
    }
    devices.set(socket.id, {
      id: socket.id, role: 'floor', screen: screen || 'main',
      label: label || `Laptop-${socket.id.slice(0, 4)}`,
      ready: false, offsetMs: 0, rttMs: 0, lastSeen: Date.now()
    });
    socket.join('floor');
    socket.emit('presentation:state', publicState());
    broadcastDevices();
  });

  socket.on('floor:ready', (isReady) => {
    const d = devices.get(socket.id);
    if (d) { d.ready = !!isReady; d.lastSeen = Date.now(); }
    broadcastDevices();
  });

  // NTP-style clock sync: client sends its local send-time t0.
  // We reply immediately with our own timestamp; client computes RTT/offset.
  socket.on('clock:sync', (t0) => {
    socket.emit('clock:sync:reply', { t0, serverTime: Date.now() });
  });

  socket.on('clock:report', ({ offsetMs, rttMs }) => {
    const d = devices.get(socket.id);
    if (d) { d.offsetMs = offsetMs; d.rttMs = rttMs; d.lastSeen = Date.now(); }
  });

  // ---- Admin controls ----
  function clearEndTimer() {
    if (endTimer) { clearTimeout(endTimer); endTimer = null; }
  }

  function scheduleEnd(startAt) {
    clearEndTimer();
    const total = Number(timeline.totalMs || 0);
    if (!total) return;
    const delay = Math.max(0, (Number(startAt) + total) - Date.now());
    endTimer = setTimeout(() => {
      if (state.status === 'running' && state.startAt === startAt) {
        state.status = 'ended';
        state.pausedAtMs = total;
        io.emit('presentation:end', { elapsedMs: total });
        broadcastDevices();
      }
    }, delay + 20);
  }

  function scheduleFreshStart() {
    clearEndTimer();
    const countdown = Number(timeline.countdownMs || 5000);
    state.status = 'counting';
    state.startAt = Date.now() + countdown;
    state.pausedAtMs = null;
    // This event always means: throw away the previous run and prepare from 00:00.
    io.emit('presentation:start', { startAt: state.startAt, timeline, reset: true });
    setTimeout(() => {
      if (state.status === 'counting' && state.startAt) {
        state.status = 'running';
        scheduleEnd(state.startAt);
        broadcastDevices();
      }
    }, countdown);
    broadcastDevices();
  }

  socket.on('admin:start', () => {
    // A normal START never restarts a running/paused presentation.
    if (state.status !== 'idle' && state.status !== 'ended') return;
    scheduleFreshStart();
  });

  socket.on('admin:pause', () => {
    if (state.status !== 'running') return;
    state.pausedAtMs = elapsedMs();
    state.status = 'paused';
    clearEndTimer();
    io.emit('presentation:pause', { pausedAtMs: state.pausedAtMs });
    broadcastDevices();
  });

  socket.on('admin:resume', () => {
    if (state.status !== 'paused') return;
    state.startAt = Date.now() - state.pausedAtMs;
    state.status = 'running';
    scheduleEnd(state.startAt);
    io.emit('presentation:resume', { startAt: state.startAt });
    broadcastDevices();
  });

  socket.on('admin:stop', () => {
    clearEndTimer();
    state.status = 'idle';
    state.startAt = null;
    state.pausedAtMs = null;
    io.emit('presentation:stop');
    broadcastDevices();
  });

  // RESET means: discard the current position, reset every client to 00:00,
  // then start a completely new synchronized run after the countdown.
  socket.on('admin:reset', () => {
    scheduleFreshStart();
  });

  // Extended-display preview frames relayed to admin (for the live preview panel)
  socket.on('floor:preview', (payload) => {
    io.to('admins').emit('floor:preview', { id: socket.id, ...payload });
  });

  socket.on('disconnect', () => {
    if (devices.has(socket.id)) {
      devices.delete(socket.id);
      broadcastDevices();
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🇵🇰  Pakistan Anthem Sync server running`);
  console.log(`   Admin:  http://<this-computer-ip>:${PORT}/admin`);
  console.log(`   Floor:  http://<this-computer-ip>:${PORT}/floor\n`);
});
