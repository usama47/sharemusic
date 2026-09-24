const path = require('path');
const fs = require('fs');
const os = require('os');
const { randomUUID, randomInt } = require('crypto');
const express = require('express');
const multer = require('multer');
const http = require('http');
const https = require('https');
const { WebSocketServer } = require('ws');
const { createVoiceRoom } = require('./voice-room');
const QRCode = require('qrcode');
const net = require('net');

function createHost({ storageRoot = __dirname, startDelayMs = 3000, bufferWaitMs = 30000, tls, setupHandler, inviteHosts = [] } = {}) {
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
  const state = { status: 'idle', track: tracks[0] || null, startAt: null, positionMs: 0, playbackRate: 1, syncMode: 'smooth', waitForBuffers: false, autoNext: false, queue: [], bufferNotice: '', bufferRequestId: 0 };
  const devices = new Map();
  const app = express();
  const server = tls ? https.createServer(tls, app) : http.createServer(app);
  const httpServer = tls && setupHandler ? http.createServer(app) : null;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 32768 });
  let endTimer, bufferTimer, closing = false;
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
  function beginPlayback() {
    clearTimeout(bufferTimer);
    state.status = 'running'; state.startAt = Date.now() + startDelayMs; state.bufferNotice = '';
    scheduleEnd(); broadcastState();
  }
  function buffersReady() {
    return [...devices.values()].filter(device => device.role === 'listener').every(device =>
      device.joined && device.ready && device.trackId === state.track?.id &&
      device.bufferRequestId === state.bufferRequestId && device.bufferPositionMs === state.positionMs && device.bufferedMs >= Math.min(3000, state.track.durationMs - state.positionMs));
  }
  function checkBuffers() { if (!closing && state.status === 'buffering' && buffersReady()) beginPlayback(); }
  function requestPlayback() {
    clearTimeout(bufferTimer);
    if (!state.waitForBuffers) return beginPlayback();
    state.status = 'buffering'; state.startAt = null; state.bufferNotice = '';
    state.bufferRequestId++;
    // Require a fresh readiness report for this anchor, including after a seek.
    for (const device of devices.values()) device.bufferPositionMs = null;
    broadcastState();
    bufferTimer = setTimeout(() => {
      if (state.status !== 'buffering') return;
      state.status = 'paused'; state.bufferNotice = 'Some listeners are not ready. Resume to wait again, or turn off buffer waiting.';
      broadcastState();
    }, bufferWaitMs);
    checkBuffers();
  }
  function scheduleEnd() {
    clearTimeout(endTimer);
    if (state.status !== 'running' || !state.track) return;
    const delay = Math.max(0, state.startAt - Date.now()) + (state.track.durationMs - elapsedMs()) / state.playbackRate;
    endTimer = setTimeout(() => {
      if (elapsedMs() < state.track.durationMs) return scheduleEnd();
      state.positionMs = state.track.durationMs; state.status = 'ended'; state.startAt = null;
      if (state.autoNext && state.queue.length) {
        const next = tracks.find(track => track.id === state.queue.shift());
        if (next) { selectTrack(next); requestPlayback(); return; }
      }
      broadcastState();
    }, Math.min(2147483647, delay + 10));
  }
  function selectTrack(track, status = 'idle', publish = true) {
    clearTimeout(endTimer); clearTimeout(bufferTimer);
    Object.assign(state, { track, status, startAt: null, positionMs: 0, bufferNotice: '' });
    resetReadiness(); if (publish) broadcastState();
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
  if (setupHandler) {
    app.all(['/setup', '/sharemusic-ca.crt'], setupHandler);
    app.get('/voice', (req, res, next) => {
      if (!req.socket.encrypted) return res.redirect(req.query.from === 'admin' ? '/setup?from=admin' : '/setup');
      next();
    });
  }
  app.get('/', (req, res) => res.redirect('/floor'));
  app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public/admin.html')));
  app.get('/floor', (req, res) => res.sendFile(path.join(__dirname, 'public/floor.html')));
  app.get('/voice', (req, res) => res.sendFile(path.join(__dirname, 'public/voice.html')));
  app.use(express.static(path.join(__dirname, 'public'), { etag: true }));
  app.get('/local/state', (req, res) => res.json(publicState()));
  app.get('/local/tracks', (req, res) => res.json(tracks));
  function inviteLinks(req) {
    const hosts = new Set(inviteHosts);
    try { for (const entries of Object.values(os.networkInterfaces())) for (const item of entries || []) if (item.family === 'IPv4' && !item.internal) hosts.add(item.address); } catch (_) {}
    // Include the address this browser actually reached (important on Termux).
    if (net.isIP(req.hostname) === 4) hosts.add(req.hostname);
    const usable = [...hosts].filter(host => typeof host === 'string' && host !== 'localhost' && !host.startsWith('127.') &&
      (net.isIP(host) === 4 || host.length <= 253 && host.split('.').every(part => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(part))));
    return usable.map(host => `${req.socket.encrypted ? 'https' : 'http'}://${host}:${req.socket.localPort}/floor`);
  }
  app.get('/local/features', (req, res) => {
    const hostname = req.hostname;
    const valid = net.isIP(hostname) === 4 || /^[a-z0-9.-]+$/i.test(hostname);
    res.json({ invitations: inviteLinks(req), secureOrigin: tls && server.listening && valid ? `https://${hostname}:${server.address().port}` : null });
  });
  app.get('/local/invite.svg', async (req, res, next) => {
    const links = inviteLinks(req);
    const link = links.find(item => item === req.query.url);
    if (!link) return res.status(400).json({ error: 'Choose one of this host’s network invitation links.' });
    try { res.type('image/svg+xml').send(await QRCode.toString(link, { type: 'svg', margin: 4, errorCorrectionLevel: 'M', width: 240 })); }
    catch (error) { next(error); }
  });
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
    if (selected && ['running', 'paused', 'buffering'].includes(state.status)) return res.status(409).json({ error: 'Stop playback before deleting this track' });
    const previous = tracks;
    saveTracks(tracks.filter(item => item.id !== track.id));
    try { fs.rmSync(path.join(mediaDir, track.file), { force: true }); }
    catch (error) { saveTracks(previous); throw error; }
    state.queue = state.queue.filter(id => id !== track.id);
    broadcast({ type: 'tracks', tracks });
    if (selected) selectTrack(tracks[0] || null);
    else broadcastState();
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
        device.bufferedMs = Number.isFinite(message.bufferedMs) ? Math.max(0, Math.min(message.bufferedMs, state.track?.durationMs || 0)) : 0;
        device.bufferPositionMs = Number.isFinite(message.bufferPositionMs) ? message.bufferPositionMs : null;
        device.bufferRequestId = message.bufferRequestId;
        broadcastDevices();
        checkBuffers();
      }
      // Direct admin access is intentional: roles route commands, not authenticate users.
      // Listeners share song selection and play/pause; library management and
      // advanced room settings remain dashboard controls.
      if (!device || (device.role !== 'admin' && !(device.role === 'listener' && ['start', 'pause', 'resume', 'select-track', 'previous-track', 'next-track', 'shuffle-track'].includes(message.type)))) return;
      if (message.type === 'room:options') {
        if (['smooth', 'tight'].includes(message.syncMode)) state.syncMode = message.syncMode;
        if (typeof message.waitForBuffers === 'boolean') state.waitForBuffers = message.waitForBuffers;
        if (typeof message.autoNext === 'boolean') state.autoNext = message.autoNext;
        if (state.status === 'buffering' && !state.waitForBuffers) beginPlayback();
        else broadcastState();
        return;
      }
      if (message.type === 'queue:add') {
        if (state.queue.length < 100 && tracks.some(track => track.id === message.trackId)) state.queue.push(message.trackId);
        broadcastState(); return;
      }
      if (message.type === 'queue:remove' || message.type === 'queue:move') {
        const index = message.index;
        if (!Number.isInteger(index) || index < 0 || index >= state.queue.length) return;
        if (message.type === 'queue:remove') state.queue.splice(index, 1);
        else if ([-1, 1].includes(message.direction)) {
          const target = index + message.direction;
          if (target >= 0 && target < state.queue.length) [state.queue[index], state.queue[target]] = [state.queue[target], state.queue[index]];
        }
        broadcastState(); return;
      }
      if (message.type === 'start-now' && state.status === 'buffering') { beginPlayback(); return; }
      if (['select-track', 'next-track', 'previous-track', 'shuffle-track'].includes(message.type)) {
        let track;
        if (message.type === 'select-track') track = tracks.find(item => item.id === message.trackId);
        else if (tracks.length) {
          const index = tracks.findIndex(item => item.id === state.track?.id);
          if (message.type === 'shuffle-track') {
            const choices = tracks.filter(item => item.id !== state.track?.id);
            track = choices.length ? choices[randomInt(choices.length)] : tracks[0];
          } else {
            const step = message.type === 'next-track' ? 1 : -1;
            track = tracks[index < 0 ? 0 : (index + step + tracks.length) % tracks.length];
          }
        }
        if (!track) return;
        const continuePlaying = ['running', 'buffering'].includes(state.status);
        selectTrack(track, state.status === 'paused' ? 'paused' : 'idle', !continuePlaying);
        if (continuePlaying) requestPlayback();
        return;
      }
      if (message.type === 'start' && state.track && ['idle', 'ended'].includes(state.status)) {
        if (state.status === 'ended' || state.positionMs >= state.track.durationMs) state.positionMs = 0;
        requestPlayback(); return;
      } else if (message.type === 'pause' && ['running', 'buffering'].includes(state.status)) {
        clearTimeout(bufferTimer);
        state.positionMs = elapsedMs(); state.status = 'paused'; state.startAt = null;
      } else if (message.type === 'resume' && state.status === 'paused') {
        requestPlayback(); return;
      } else if (message.type === 'stop') {
        clearTimeout(bufferTimer); state.bufferNotice = '';
        state.status = 'idle'; state.startAt = null; state.positionMs = 0;
      } else if (message.type === 'seek' && state.track && Number.isFinite(message.positionMs)) {
        state.positionMs = Math.max(0, Math.min(state.track.durationMs, message.positionMs));
        if (state.status === 'ended') state.status = 'idle';
        if (state.status === 'running') state.startAt = Math.max(Date.now(), state.startAt);
        if (state.status === 'buffering') { requestPlayback(); return; }
      } else if (message.type === 'speed' && Number.isFinite(message.playbackRate) && message.playbackRate >= 0.5 && message.playbackRate <= 2) {
        state.positionMs = elapsedMs();
        if (state.status === 'running') state.startAt = Math.max(Date.now(), state.startAt);
        state.playbackRate = message.playbackRate;
      } else return;
      scheduleEnd(); broadcastState();
    });
    socket.on('close', () => { voiceRoom.leave(socket); devices.delete(socket); broadcastDevices(); checkBuffers(); });
  });
  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (!socket.isAlive) { socket.terminate(); continue; }
      socket.isAlive = false; socket.ping();
    }
  }, 15000);
  heartbeat.unref();
  const upgrade = (request, socket, head) => {
    if (request.url !== '/local-ws') return socket.destroy();
    wss.handleUpgrade(request, socket, head, client => wss.emit('connection', client, request));
  };
  server.on('upgrade', upgrade);
  httpServer?.on('upgrade', upgrade);
  async function close() {
    closing = true;
    clearInterval(heartbeat); clearTimeout(endTimer); clearTimeout(bufferTimer);
    for (const socket of wss.clients) socket.terminate();
    await new Promise(resolve => wss.close(resolve));
    if (server.listening) await new Promise(resolve => server.close(resolve));
    if (httpServer?.listening) await new Promise(resolve => httpServer.close(resolve));
  }
  return { server, httpServer, close };
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
