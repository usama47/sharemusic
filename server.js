const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const http = require('http');
const { WebSocketServer } = require('ws');

const root = __dirname;
const publicDir = path.join(root, 'public');
const dataDir = path.join(root, 'data');
const localMediaDir = path.join(root, 'local-media');
const tracksFile = path.join(dataDir, 'local-tracks.json');
const port = process.env.PORT || 3000;
const START_DELAY_MS = 3000;

for (const directory of [dataDir, localMediaDir]) fs.mkdirSync(directory, { recursive: true });
function loadJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; } }
function saveJson(file, value) { fs.writeFileSync(file, JSON.stringify(value, null, 2)); }
function elapsedMs() { if (state.status === 'running' && state.startAt) return Math.max(0, (Date.now() - state.startAt) * state.playbackRate); return state.status === 'paused' ? state.pausedAtMs || 0 : 0; }
function publicState() { return { status: state.status, track: state.track, startAt: state.startAt, pausedAtMs: state.pausedAtMs, elapsedMs: elapsedMs(), serverNow: Date.now() }; }
function broadcast(message) { const payload = JSON.stringify(message); for (const client of clients) if (client.readyState === 1) client.send(payload); }
function broadcastState() { broadcast({ type: 'state', state: publicState() }); }
function clearEndTimer() { if (endTimer) clearTimeout(endTimer); endTimer = null; }
function scheduleEnd(token, startAt, durationMs) { clearEndTimer(); endTimer = setTimeout(() => { if (token !== runToken || state.status !== 'running' || state.startAt !== startAt) return; state.status = 'ended'; state.pausedAtMs = durationMs; broadcastState(); }, Math.max(0, startAt + durationMs / state.playbackRate - Date.now()) + 50); }

let tracks = loadJson(tracksFile, []);
if (!Array.isArray(tracks)) tracks = [];
let state = { status: 'idle', track: tracks[0] || null, startAt: null, pausedAtMs: null, playbackRate: 1 };
let endTimer = null;
let runToken = 0;
const clients = new Set();
const devices = new Map();
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });
const upload = multer({
  storage: multer.diskStorage({ destination: localMediaDir, filename: (req, file, callback) => callback(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`) }),
  limits: { fileSize: 150 * 1024 * 1024 },
  fileFilter: (req, file, callback) => callback(null, file.mimetype.startsWith('audio/') || /\.(mp3|m4a|ogg|oga|wav|webm)$/i.test(file.originalname))
});

app.use('/local-media', express.static(localMediaDir, { maxAge: '1h' }));
app.use(express.json({ limit: '32kb' }));
app.use((req, res, next) => {
  if (req.path === '/admin' || req.path === '/floor' || req.path.endsWith('.html') || req.path.startsWith('/js/') || req.path.startsWith('/css/')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});
app.use(express.static(publicDir, { etag: true }));
app.get('/admin', (req, res) => res.sendFile(path.join(publicDir, 'admin.html')));
app.get('/floor', (req, res) => res.sendFile(path.join(publicDir, 'floor.html')));
app.get('/local/state', (req, res) => res.json(publicState()));
app.get('/local/tracks', (req, res) => res.json(tracks));
app.post('/local/tracks', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose a supported audio file' });
  const durationMs = Number(req.body.durationMs);
  if (!Number.isFinite(durationMs) || durationMs <= 0) { fs.unlinkSync(req.file.path); return res.status(400).json({ error: 'Audio duration is required' }); }
  const track = { id: `local-${Date.now()}`, name: req.file.originalname, url: `/local-media/${req.file.filename}`, file: req.file.filename, size: req.file.size, durationMs: Math.round(durationMs) };
  tracks.unshift(track); saveJson(tracksFile, tracks); broadcast({ type: 'tracks', tracks }); res.json({ ok: true, track });
});
app.delete('/local/tracks/:id', (req, res) => {
  const track = tracks.find(item => item.id === req.params.id);
  if (!track) return res.status(404).json({ error: 'Track not found' });
  if (state.track?.id === track.id) return res.status(409).json({ error: 'Stop playback and choose another track first' });
  tracks = tracks.filter(item => item.id !== track.id); saveJson(tracksFile, tracks); try { fs.unlinkSync(path.join(localMediaDir, track.file)); } catch (_) {}
  broadcast({ type: 'tracks', tracks }); res.json({ ok: true });
});

function startPlayback() {
  if (!state.track?.durationMs) return;
  const token = ++runToken; clearEndTimer(); state.status = 'running'; state.startAt = Date.now() + START_DELAY_MS; state.pausedAtMs = null; broadcastState();
  setTimeout(() => { if (token === runToken && state.status === 'running') scheduleEnd(token, state.startAt, state.track.durationMs); }, START_DELAY_MS);
}
function broadcastDevices() { const listeners = [...devices.values()].filter(device => device.role === 'listener'); broadcast({ type: 'devices', count: listeners.length, devices: listeners }); }

wss.on('connection', socket => {
  clients.add(socket);
  socket.on('message', raw => {
    let message; try { message = JSON.parse(raw.toString()); } catch (_) { return; }
    if (message.type === 'register') { devices.set(socket, { role: message.role === 'admin' ? 'admin' : 'listener', label: message.label || 'Listener' }); socket.send(JSON.stringify({ type: 'state', state: publicState() })); socket.send(JSON.stringify({ type: 'tracks', tracks })); broadcastDevices(); }
    if (devices.get(socket)?.role === 'admin') {
      if (message.type === 'start' && ['idle', 'ended'].includes(state.status)) startPlayback();
      if (message.type === 'pause' && state.status === 'running') { state.pausedAtMs = elapsedMs(); state.status = 'paused'; clearEndTimer(); ++runToken; broadcastState(); }
      if (message.type === 'resume' && state.status === 'paused') { state.startAt = Date.now() - state.pausedAtMs / state.playbackRate; state.status = 'running'; scheduleEnd(++runToken, state.startAt, state.track.durationMs); broadcastState(); }
      if (message.type === 'stop') { clearEndTimer(); ++runToken; state.status = 'idle'; state.startAt = null; state.pausedAtMs = null; broadcastState(); }
      if (message.type === 'select-track') { const track = tracks.find(item => item.id === message.trackId); if (track && ['idle', 'ended'].includes(state.status)) { state.track = track; broadcastState(); } }
      if (message.type === 'seek' && state.track) { const position = Math.max(0, Math.min(state.track.durationMs, Number(message.positionMs) || 0)); if (state.status === 'paused') state.pausedAtMs = position; else if (state.status === 'running') state.startAt = Date.now() - position / state.playbackRate; broadcastState(); if (state.status === 'running') scheduleEnd(++runToken, state.startAt, state.track.durationMs); }
      if (message.type === 'speed' && state.track) { const speed = Number(message.playbackRate); if (Number.isFinite(speed) && speed >= 0.5 && speed <= 2) { const position = elapsedMs(); state.playbackRate = speed; if (state.status === 'running') state.startAt = Date.now() - position / speed; broadcastState(); if (state.status === 'running') scheduleEnd(++runToken, state.startAt, state.track.durationMs); } }
    }
    if (message.type === 'clock:sync') socket.send(JSON.stringify({ type: 'clock:sync', t0: message.t0, serverTime: Date.now() }));
  });
  socket.on('close', () => { clients.delete(socket); devices.delete(socket); broadcastDevices(); });
});
server.on('upgrade', (request, socket, head) => { if (request.url !== '/local-ws') { socket.destroy(); return; } wss.handleUpgrade(request, socket, head, client => wss.emit('connection', client, request)); });
server.listen(port, '0.0.0.0', () => { console.log(`ShareMusic local host running on port ${port}`); console.log(`Open admin at http://<host-hotspot-ip>:${port}/admin`); console.log(`Share listener link: http://<host-hotspot-ip>:${port}/floor`); });
