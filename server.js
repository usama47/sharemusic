const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const http = require('http');
const { Server } = require('socket.io');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const PUBLIC_DIR = path.join(ROOT, 'public');
const UPLOADS_DIR = path.join(PUBLIC_DIR, 'uploads');
const MEDIA_FILE = path.join(DATA_DIR, 'media.json');
const PORT = process.env.PORT || 3000;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'sharemusic';
const SESSION_COOKIE = 'sharemusic_admin';

for (const directory of [DATA_DIR, UPLOADS_DIR]) fs.mkdirSync(directory, { recursive: true });

function loadJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; }
}
function saveJSON(file, value) { fs.writeFileSync(file, JSON.stringify(value, null, 2)); }

let mediaLibrary = loadJSON(MEDIA_FILE, []);
if (!Array.isArray(mediaLibrary)) mediaLibrary = [];
if (!fs.existsSync(MEDIA_FILE)) saveJSON(MEDIA_FILE, mediaLibrary);

const sessions = new Set();
const devices = new Map();
let endTimer = null;
let runToken = 0;
const state = { status: 'idle', track: null, startAt: null, pausedAtMs: null };

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map(part => {
    const index = part.indexOf('=');
    return index < 0 ? [part.trim(), ''] : [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }).filter(([key]) => key));
}
function isAdminRequest(req) { return sessions.has(parseCookies(req.headers.cookie)[SESSION_COOKIE]); }
function requireAdmin(req, res, next) {
  if (!isAdminRequest(req)) return res.status(401).json({ error: 'Admin login required' });
  next();
}
function publicTrack(track) { return track ? { id: track.id, name: track.name, url: track.url, size: track.size, durationMs: track.durationMs } : null; }
function safeTrack(item) { return item && item.kind === 'audio' && typeof item.url === 'string' && (/^\/uploads\//.test(item.url) || /^\/media\/[^/]+\/(?!historical)/.test(item.url)); }
function elapsedMs() {
  if (state.status === 'running' && state.startAt) return Math.max(0, Date.now() - state.startAt);
  return state.status === 'paused' ? state.pausedAtMs || 0 : 0;
}
function publicState() {
  return { status: state.status, track: publicTrack(state.track), startAt: state.startAt, pausedAtMs: state.pausedAtMs, elapsedMs: elapsedMs(), serverNow: Date.now() };
}
function broadcastState() { io.emit('player:state', publicState()); }
function clearEndTimer() { if (endTimer) clearTimeout(endTimer); endTimer = null; }
function scheduleEnd(token, startAt, durationMs) {
  clearEndTimer();
  endTimer = setTimeout(() => {
    if (token !== runToken || state.status !== 'running' || state.startAt !== startAt) return;
    state.status = 'ended'; state.pausedAtMs = durationMs; broadcastState();
  }, Math.max(0, startAt + durationMs - Date.now()) + 25);
}
function startPlayback() {
  if (!state.track || !Number.isFinite(state.track.durationMs) || state.track.durationMs <= 0) return false;
  clearEndTimer();
  const token = ++runToken;
  state.status = 'counting'; state.startAt = Date.now() + 3000; state.pausedAtMs = null; broadcastState();
  setTimeout(() => {
    if (token !== runToken || state.status !== 'counting') return;
    state.status = 'running'; scheduleEnd(token, state.startAt, state.track.durationMs); broadcastState();
  }, 3000);
  return true;
}

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.json({ limit: '32kb' }));
app.use(express.static(PUBLIC_DIR, { etag: true }));
app.get('/admin', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));
app.get('/floor', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'floor.html')));

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Invalid admin credentials' });
  const token = crypto.randomBytes(32).toString('hex'); sessions.add(token);
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/`);
  res.json({ ok: true });
});
app.get('/api/auth/session', (req, res) => res.json({ authenticated: isAdminRequest(req) }));
app.post('/api/auth/logout', requireAdmin, (req, res) => {
  sessions.delete(parseCookies(req.headers.cookie)[SESSION_COOKIE]);
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Max-Age=0; HttpOnly; SameSite=Strict; Path=/`);
  res.json({ ok: true });
});

app.get('/api/player', (req, res) => res.json(publicState()));
app.get('/api/tracks', requireAdmin, (req, res) => res.json(mediaLibrary.filter(safeTrack)));

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`)
  }),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, file.mimetype.startsWith('audio/') || /\.(mp3|m4a|ogg|oga|wav|webm)$/i.test(file.originalname))
});
app.post('/api/tracks', requireAdmin, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose a supported audio file' });
  const track = { id: `track-${Date.now()}`, name: req.file.originalname, url: `/uploads/${req.file.filename}`, kind: 'audio', size: req.file.size, durationMs: 0 };
  mediaLibrary = mediaLibrary.filter(safeTrack); mediaLibrary.push(track); saveJSON(MEDIA_FILE, mediaLibrary);
  res.json({ ok: true, track });
});
app.post('/api/player/track', requireAdmin, (req, res) => {
  if (['running', 'counting', 'paused'].includes(state.status)) return res.status(409).json({ error: 'Stop playback before changing the track' });
  const track = mediaLibrary.find(item => item.id === req.body?.trackId && safeTrack(item));
  const durationMs = Number(req.body?.durationMs);
  if (!track) return res.status(404).json({ error: 'Track not found' });
  if (!Number.isFinite(durationMs) || durationMs <= 0) return res.status(400).json({ error: 'The browser must report a valid track duration' });
  track.durationMs = Math.round(durationMs); state.track = track; saveJSON(MEDIA_FILE, mediaLibrary); broadcastState();
  res.json({ ok: true, state: publicState() });
});
app.delete('/api/tracks/:id', requireAdmin, (req, res) => {
  const track = mediaLibrary.find(item => item.id === req.params.id && safeTrack(item));
  if (!track) return res.status(404).json({ error: 'Track not found' });
  if (state.track?.id === track.id) return res.status(409).json({ error: 'Stop and choose another track first' });
  mediaLibrary = mediaLibrary.filter(item => item.id !== track.id); saveJSON(MEDIA_FILE, mediaLibrary);
  if (track.url.startsWith('/uploads/')) {
    try { fs.unlinkSync(path.join(PUBLIC_DIR, track.url.replace(/^\//, ''))); } catch (_) {}
  }
  res.json({ ok: true });
});

io.use((socket, next) => { socket.isAdmin = sessions.has(parseCookies(socket.handshake.headers.cookie)[SESSION_COOKIE]); next(); });
io.on('connection', socket => {
  socket.on('register', ({ role, label } = {}) => {
    if (role === 'admin') {
      if (!socket.isAdmin) return socket.emit('admin:auth-required');
      socket.join('admins'); socket.emit('player:state', publicState()); broadcastDevices(); return;
    }
    devices.set(socket.id, { label: label || `Mobile-${socket.id.slice(0, 4)}`, ready: false, lastSeen: Date.now() });
    socket.emit('player:state', publicState()); broadcastDevices();
  });
  socket.on('floor:ready', ready => { const device = devices.get(socket.id); if (device) { device.ready = !!ready; device.lastSeen = Date.now(); broadcastDevices(); } });
  socket.on('clock:sync', t0 => socket.emit('clock:sync:reply', { t0, serverTime: Date.now() }));
  socket.on('clock:report', ({ offsetMs, rttMs } = {}) => { const device = devices.get(socket.id); if (device) { device.offsetMs = Number(offsetMs) || 0; device.rttMs = Number(rttMs) || 0; device.lastSeen = Date.now(); } });
  socket.on('admin:start', () => { if (socket.isAdmin && ['idle', 'ended'].includes(state.status)) startPlayback(); });
  socket.on('admin:pause', () => { if (!socket.isAdmin || state.status !== 'running') return; state.pausedAtMs = elapsedMs(); state.status = 'paused'; clearEndTimer(); ++runToken; broadcastState(); });
  socket.on('admin:resume', () => { if (!socket.isAdmin || state.status !== 'paused' || !state.track) return; state.startAt = Date.now() - state.pausedAtMs; state.status = 'running'; scheduleEnd(++runToken, state.startAt, state.track.durationMs); broadcastState(); });
  socket.on('admin:stop', () => { if (!socket.isAdmin) return; clearEndTimer(); ++runToken; state.status = 'idle'; state.startAt = null; state.pausedAtMs = null; broadcastState(); });
  socket.on('disconnect', () => { if (devices.delete(socket.id)) broadcastDevices(); });
});

function broadcastDevices() {
  const list = [...devices.values()];
  io.to('admins').emit('devices:update', { connected: list.length, ready: list.filter(device => device.ready).length, devices: list.map(device => ({ label: device.label, ready: device.ready, offsetMs: Math.round(device.offsetMs || 0), rttMs: Math.round(device.rttMs || 0) })) });
}
setInterval(() => { const now = Date.now(); for (const [id, device] of devices) if (now - device.lastSeen > 15000) devices.delete(id); broadcastDevices(); }, 3000);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\nShareMusic running on port ${PORT}`);
  console.log(`Admin: http://<server-ip>:${PORT}/admin`);
  console.log(`Mobile: http://<server-ip>:${PORT}/floor`);
  console.log(`Admin username: ${ADMIN_USERNAME}`);
  console.log('Set ADMIN_PASSWORD before launch for a private event.\n');
});
