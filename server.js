const path = require('path');
const fs = require('fs');
const os = require('os');
const { randomUUID } = require('crypto');
const express = require('express');
const multer = require('multer');
const http = require('http');
const https = require('https');
const { WebSocketServer } = require('ws');
const { createVoiceRoom } = require('./voice-room');

function createHost({ storageRoot = __dirname, startDelayMs = 3000, tls } = {}) {
  const dataDir = path.join(storageRoot, 'data');
  const mediaDir = path.join(storageRoot, 'local-media');
  const tracksFile = path.join(dataDir, 'local-tracks.json');
  for (const directory of [dataDir, mediaDir]) fs.mkdirSync(directory, { recursive: true });
  let tracks = [];
  try { tracks = JSON.parse(fs.readFileSync(tracksFile, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error(`Cannot read track library: ${error.message}`); }
  if (!Array.isArray(tracks)) throw new Error('Track library must be an array');
  tracks = tracks.filter(track => track && typeof track.file === 'string' && path.basename(track.file) === track.file && Number.isFinite(track.durationMs) && track.durationMs > 0 && fs.existsSync(path.join(mediaDir, track.file)));
  function saveTracks(next) {
    fs.writeFileSync(`${tracksFile}.tmp`, JSON.stringify(next, null, 2));
    fs.renameSync(`${tracksFile}.tmp`, tracksFile);
    tracks = next;
  }
  const state = { status: 'idle', track: tracks[0] || null, startAt: null, positionMs: 0, playbackRate: 1 };
  const devices = new Map();
  const app = express();
  const server = tls ? https.createServer(tls, app) : http.createServer(app);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 32768 });
  let endTimer;
  function elapsedMs() {
    const delta = state.status === 'running' ? Math.max(0, Date.now() - state.startAt) * state.playbackRate : 0;
    return Math.min(state.track?.durationMs || 0, state.positionMs + delta);
  }
  const publicState = () => ({ ...state, pausedAtMs: state.positionMs, elapsedMs: elapsedMs(), serverNow: Date.now() });
  const send = (socket, message) => { if (socket.readyState === 1) socket.send(JSON.stringify(message)); };
  const voiceRoom = createVoiceRoom({ send });
  const broadcast = message => { for (const socket of wss.clients) send(socket, message); };
  const broadcastState = () => broadcast({ type: 'state', state: publicState() });
  function broadcastDevices() {
    const listeners = [...devices.values()].filter(device => device.role === 'listener');
    broadcast({ type: 'devices', count: listeners.length, devices: listeners });
  }
  function resetReadiness() {
    for (const device of devices.values()) { device.ready = false; device.trackId = null; device.status = 'loading'; }
    broadcastDevices();
  }
  function scheduleEnd() {
    clearTimeout(endTimer);
    if (state.status !== 'running' || !state.track) return;
    const delay = Math.max(0, state.startAt - Date.now()) + (state.track.durationMs - elapsedMs()) / state.playbackRate;
    endTimer = setTimeout(() => {
      if (elapsedMs() < state.track.durationMs) return scheduleEnd();
      state.positionMs = state.track.durationMs; state.status = 'ended'; state.startAt = null;
      broadcastState();
    }, Math.min(2147483647, delay + 10));
  }
  function selectTrack(track) {
    clearTimeout(endTimer);
    Object.assign(state, { track, status: 'idle', startAt: null, positionMs: 0 });
    resetReadiness(); broadcastState();
  }
  const upload = multer({
    storage: multer.diskStorage({ destination: mediaDir, filename: (req, file, done) => done(null, `${randomUUID()}${path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '')}`) }),
    limits: { fileSize: 150 * 1024 * 1024, files: 1, fields: 1 },
    fileFilter: (req, file, done) => done(null, /\.(mp3|m4a|ogg|oga|wav|webm)$/i.test(file.originalname))
  });
  app.use(express.json({ limit: '32kb' }));
  app.use('/local-media', express.static(mediaDir, { maxAge: '1h' }));
  // Keep code fresh, as requested by the direct-dashboard baseline commit.
  app.use((req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  app.get('/', (req, res) => res.redirect('/floor'));
  app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public/admin.html')));
  app.get('/floor', (req, res) => res.sendFile(path.join(__dirname, 'public/floor.html')));
  app.get('/voice', (req, res) => res.sendFile(path.join(__dirname, 'public/voice.html')));
  app.use(express.static(path.join(__dirname, 'public'), { etag: true }));
  app.get('/local/state', (req, res) => res.json(publicState()));
  app.get('/local/tracks', (req, res) => res.json(tracks));
  app.post('/local/tracks', upload.single('file'), (req, res, next) => {
    if (!req.file) return res.status(400).json({ error: 'Choose an MP3, M4A, OGG, OGA, WAV, or WebM file' });
    const durationMs = Math.round(Number(req.body.durationMs));
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'A finite positive audio duration is required' });
    }
    const track = { id: `local-${randomUUID()}`, name: req.file.originalname, url: `/local-media/${req.file.filename}`, file: req.file.filename, size: req.file.size, durationMs };
    try { saveTracks([track, ...tracks]); }
    catch (error) { fs.unlinkSync(req.file.path); return next(error); }
    broadcast({ type: 'tracks', tracks });
    if (!state.track) selectTrack(track);
    res.json({ ok: true, track });
  });
  app.delete('/local/tracks/:id', (req, res) => {
    const track = tracks.find(item => item.id === req.params.id);
    if (!track) return res.status(404).json({ error: 'Track not found' });
    const selected = state.track?.id === track.id;
    if (selected && ['running', 'paused'].includes(state.status)) return res.status(409).json({ error: 'Stop playback before deleting this track' });
    const previous = tracks;
    saveTracks(tracks.filter(item => item.id !== track.id));
    try { fs.rmSync(path.join(mediaDir, track.file), { force: true }); }
    catch (error) { saveTracks(previous); throw error; }
    broadcast({ type: 'tracks', tracks });
    if (selected) selectTrack(tracks[0] || null);
    res.json({ ok: true });
  });
  app.use((error, req, res, next) => {
    const status = error instanceof multer.MulterError ? 400 : error.status || 500;
    res.status(status).json({ error: status < 500 ? error.message : 'The server could not save this change' });
  });
  wss.on('connection', socket => {
    socket.isAlive = true;
    socket.on('pong', () => { socket.isAlive = true; });
    socket.on('error', () => {});
    socket.on('message', raw => {
      let message;
      try { message = JSON.parse(raw.toString()); } catch (_) { return; }
      if (!message || typeof message !== 'object' || Array.isArray(message) || typeof message.type !== 'string') return;
      if (message.type === 'register') {
        voiceRoom.leave(socket);
        devices.set(socket, { role: ['admin', 'voice'].includes(message.role) ? message.role : 'listener', label: typeof message.label === 'string' ? message.label.slice(0, 80) : 'Listener', joined: false, ready: false, trackId: null, status: 'not joined' });
        send(socket, { type: 'state', state: publicState() });
        send(socket, { type: 'tracks', tracks }); broadcastDevices();
      }
      if (message.type === 'clock:sync' && Number.isFinite(message.t0)) send(socket, { type: 'clock:sync', t0: message.t0, serverTime: Date.now() });
      const device = devices.get(socket);
      if (voiceRoom.handle(socket, message, device)) return;
      if (message.type === 'listener:status' && device?.role === 'listener') {
        if (!['not joined', 'loading', 'ready', 'playing', 'paused', 'blocked', 'error', 'ended'].includes(message.status)) return;
        Object.assign(device, { joined: message.joined === true, trackId: message.trackId === state.track?.id ? message.trackId : null, status: message.status });
        device.ready = device.joined && !!device.trackId && message.ready === true && ['ready', 'playing', 'paused'].includes(message.status);
        broadcastDevices();
      }
      // Direct admin access is intentional: roles route commands, not authenticate users.
      // Every registered listener may pause/resume the shared room. Other
      // controls remain on the dashboard; commands are explicit, not toggles.
      if (!device || (device.role !== 'admin' && !(device.role === 'listener' && ['pause', 'resume'].includes(message.type)))) return;
      if (message.type === 'start' && state.track && ['idle', 'ended'].includes(state.status)) {
        if (state.status === 'ended' || state.positionMs >= state.track.durationMs) state.positionMs = 0;
        state.status = 'running'; state.startAt = Date.now() + startDelayMs;
      } else if (message.type === 'pause' && state.status === 'running') {
        state.positionMs = elapsedMs(); state.status = 'paused'; state.startAt = null;
      } else if (message.type === 'resume' && state.status === 'paused') {
        state.status = 'running'; state.startAt = Date.now() + startDelayMs;
      } else if (message.type === 'stop') {
        state.status = 'idle'; state.startAt = null; state.positionMs = 0;
      } else if (message.type === 'select-track' && ['idle', 'ended'].includes(state.status)) {
        const track = tracks.find(item => item.id === message.trackId);
        if (track) selectTrack(track);
        return;
      } else if (message.type === 'seek' && state.track && Number.isFinite(message.positionMs)) {
        state.positionMs = Math.max(0, Math.min(state.track.durationMs, message.positionMs));
        if (state.status === 'ended') state.status = 'idle';
        if (state.status === 'running') state.startAt = Math.max(Date.now(), state.startAt);
      } else if (message.type === 'speed' && Number.isFinite(message.playbackRate) && message.playbackRate >= 0.5 && message.playbackRate <= 2) {
        state.positionMs = elapsedMs();
        if (state.status === 'running') state.startAt = Math.max(Date.now(), state.startAt);
        state.playbackRate = message.playbackRate;
      } else return;
      scheduleEnd(); broadcastState();
    });
    socket.on('close', () => { voiceRoom.leave(socket); devices.delete(socket); broadcastDevices(); });
  });
  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (!socket.isAlive) { socket.terminate(); continue; }
      socket.isAlive = false; socket.ping();
    }
  }, 15000);
  heartbeat.unref();
  server.on('upgrade', (request, socket, head) => {
    if (request.url !== '/local-ws') return socket.destroy();
    wss.handleUpgrade(request, socket, head, client => wss.emit('connection', client, request));
  });
  async function close() {
    clearInterval(heartbeat); clearTimeout(endTimer);
    for (const socket of wss.clients) socket.terminate();
    await new Promise(resolve => wss.close(resolve));
    if (server.listening) await new Promise(resolve => server.close(resolve));
  }
  return { server, close };
}
if (require.main === module) {
  if (!!process.env.TLS_KEY !== !!process.env.TLS_CERT) throw new Error('Set both TLS_KEY and TLS_CERT to enable HTTPS');
  const tls = process.env.TLS_KEY ? { key: fs.readFileSync(process.env.TLS_KEY), cert: fs.readFileSync(process.env.TLS_CERT) } : undefined;
  const host = createHost({ tls });
  const protocol = tls ? 'https' : 'http';
  const port = process.env.PORT || 3000;
  host.server.listen(port, '0.0.0.0', () => {
    const addresses = new Set(['127.0.0.1']);
    try {
      for (const entries of Object.values(os.networkInterfaces())) for (const entry of entries || []) if (entry.family === 'IPv4' && !entry.internal) addresses.add(entry.address);
    } catch (_) { console.log('Address discovery is unavailable. Use the Wi-Fi/hotspot IP shown in your device settings.'); }
    console.log('ShareMusic running. Use an address reachable from the other devices:');
    for (const address of addresses) console.log(`Admin: ${protocol}://${address}:${host.server.address().port}/admin\nListener: ${protocol}://${address}:${host.server.address().port}/floor\nVoice: ${protocol}://${address}:${host.server.address().port}/voice`);
    if (!tls) console.log('For music + microphone on other phones, stop this server and run: npm run local-host:https (then open the printed Phone setup link).');
  });
}
module.exports = { createHost };
