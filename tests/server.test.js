const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const WebSocket = require('ws');
const { createHost } = require('../server');

async function fixture(t, options = {}) {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sharemusic-test-'));
  const hosts = [];
  async function launch() {
    const host = createHost({ storageRoot, startDelayMs: 200, ...options }); hosts.push(host);
    host.server.listen(0, '127.0.0.1'); await once(host.server, 'listening');
    return { host, url: `http://127.0.0.1:${host.server.address().port}` };
  }
  t.after(async () => {
    for (const host of hosts) await host.close();
    const target = path.resolve(storageRoot);
    assert.equal(path.dirname(target), path.resolve(os.tmpdir()));
    assert(path.basename(target).startsWith('sharemusic-test-'));
    fs.rmSync(target, { recursive: true, force: true });
  });
  return { storageRoot, launch, ...await launch() };
}
async function peer(url, role = 'admin') {
  const socket = new WebSocket(url.replace('http:', 'ws:') + '/local-ws');
  const inbox = [];
  socket.on('message', raw => inbox.push(JSON.parse(raw)));
  await once(socket, 'open');
  function wait(type, predicate = () => true, after = inbox.length) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { cleanup(); reject(Error(`Timed out: ${type}`)); }, 2500);
      function cleanup() { clearTimeout(timeout); socket.off('message', check); }
      function check() { const match = inbox.slice(after).find(message => message.type === type && predicate(message)); if (match) { cleanup(); resolve(match); } }
      socket.on('message', check); check();
    });
  }
  async function command(message) { const response = wait('state'); socket.send(JSON.stringify(message)); return (await response).state; }
  const registration = wait('state'); socket.send(JSON.stringify({ type: 'register', role })); await registration;
  return { socket, inbox, wait, command, send: message => socket.send(JSON.stringify(message)) };
}
async function upload(url, duration = 60000, name = 'test.wav') {
  const body = new FormData(); body.append('file', new Blob(['RIFFtest audio bytes'], { type: 'audio/wav' }), name); body.append('durationMs', String(duration));
  return fetch(url + '/local/tracks', { method: 'POST', body });
}

test('direct routes, upload, Range delivery, unique files, deletion and persisted library', async t => {
  const f = await fixture(t);
  const admin = await fetch(f.url + '/admin'); assert.equal(admin.status, 200); assert.match(admin.headers.get('cache-control'), /no-store/); assert.doesNotMatch(await admin.text(), /login-panel/);
  assert.equal((await fetch(f.url + '/floor')).status, 200);
  assert.equal((await fetch(f.url + '/', { redirect: 'manual' })).headers.get('location'), '/floor');
  const track = (await (await upload(f.url)).json()).track;
  const other = (await (await upload(f.url)).json()).track;
  assert.notEqual(track.id, other.id); assert.notEqual(track.file, other.file);
  const range = await fetch(f.url + track.url, { headers: { Range: 'bytes=0-3' } });
  assert.equal(range.status, 206); assert.equal(await range.text(), 'RIFF');
  assert.equal((await (await fetch(f.url + '/local/state')).json()).track.id, track.id);
  await f.host.close(); const restarted = await f.launch();
  assert.equal((await (await fetch(restarted.url + '/local/tracks')).json()).length, 2);
  assert.equal((await (await fetch(restarted.url + '/local/state')).json()).status, 'idle');
  for (const item of [other, track]) assert.equal((await fetch(restarted.url + `/local/tracks/${item.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await (await fetch(restarted.url + '/local/state')).json()).track, null);
  assert.deepEqual(fs.readdirSync(path.join(f.storageRoot, 'local-media')), []);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.storageRoot, 'data/local-tracks.json'))), []);
});

test('invalid uploads clean up disk and return JSON errors', async t => {
  const f = await fixture(t);
  for (const duration of [0, -1, 'Infinity', 'NaN', 0.1]) {
    const response = await upload(f.url, duration); assert.equal(response.status, 400); assert.match((await response.json()).error, /duration/);
  }
  assert.equal((await upload(f.url, 1000, 'wrong.html')).status, 400);
  assert.deepEqual(fs.readdirSync(path.join(f.storageRoot, 'local-media')), []);
});

test('state contract preserves position/rate/countdown through seek, pause, resume, stop and end', async t => {
  const f = await fixture(t); const track = (await (await upload(f.url)).json()).track; const p = await peer(f.url);
  let s = await p.command({ type: 'seek', positionMs: 10000 }); assert.equal(s.positionMs, 10000);
  s = await p.command({ type: 'speed', playbackRate: 2 }); assert.equal(s.playbackRate, 2);
  s = await p.command({ type: 'start' }); assert(s.startAt > s.serverNow); const start = s.startAt; assert.equal(s.elapsedMs, 10000);
  s = await p.command({ type: 'speed', playbackRate: 1.5 }); assert.equal(s.startAt, start); assert.equal(s.positionMs, 10000);
  s = await p.command({ type: 'seek', positionMs: 15000 }); assert.equal(s.startAt, start); assert.equal(s.positionMs, 15000);
  assert.equal((await fetch(f.url + `/local/tracks/${track.id}`, { method: 'DELETE' })).status, 409);
  s = await p.command({ type: 'pause' }); assert.equal(s.status, 'paused'); assert.equal(s.positionMs, 15000);
  s = await p.command({ type: 'seek', positionMs: 20000 }); assert.equal(s.positionMs, 20000);
  s = await p.command({ type: 'resume' }); assert(s.startAt > s.serverNow); assert.equal(s.positionMs, 20000);
  s = await p.command({ type: 'stop' }); assert.equal(s.positionMs, 0); assert.equal(s.startAt, null);
  s = await p.command({ type: 'seek', positionMs: 59980 });
  const ended = p.wait('state', message => message.state.status === 'ended');
  await p.command({ type: 'start' }); s = (await ended).state; assert.equal(s.positionMs, 60000); assert.equal(s.startAt, null);
  s = await p.command({ type: 'start' }); assert.equal(s.positionMs, 0);
  await p.command({ type: 'stop' });
});

test('malformed WS data cannot crash host; listeners can start tracks; readiness is scoped', async t => {
  const f = await fixture(t); const track = (await (await upload(f.url)).json()).track;
  const p = await peer(f.url), listener = await peer(f.url, 'listener');
  for (const raw of ['null', '[]', '12', '"hello"', '{', '{}', '{"type":null}']) p.socket.send(raw);
  for (const command of [{ type: 'seek', positionMs: 'oops' }, { type: 'speed', playbackRate: 50 }]) p.send(command);
  const clock = p.wait('clock:sync'); p.send({ type: 'clock:sync', t0: 42 }); assert.equal((await clock).t0, 42);
  listener.send({ type: 'start' }); const barrier = listener.wait('clock:sync'); listener.send({ type: 'clock:sync', t0: 43 }); await barrier;
  assert.equal((await (await fetch(f.url + '/local/state')).json()).status, 'running');
  let ready = p.wait('devices', m => m.devices.some(d => d.ready));
  listener.send({ type: 'listener:status', joined: true, ready: true, trackId: track.id, status: 'ready' }); assert.equal((await ready).devices[0].ready, true);
  ready = p.wait('devices'); listener.send({ type: 'listener:status', joined: true, ready: true, trackId: 'old', status: 'ready' }); assert.equal((await ready).devices[0].ready, false);
  ready = p.wait('devices'); listener.send({ type: 'listener:status', joined: true, ready: true, trackId: track.id, status: 'blocked' }); assert.equal((await ready).devices[0].ready, false);
  const gone = p.wait('devices', m => m.count === 0); listener.socket.close(); await gone;
});

test('a listener can pause/resume for admin and all peers, but cannot stop, seek or change speed', async t => {
  const f = await fixture(t); await upload(f.url);
  const admin = await peer(f.url), first = await peer(f.url, 'listener'), second = await peer(f.url, 'listener');
  await admin.command({ type: 'start' });
  const adminPause = admin.wait('state', m => m.state.status === 'paused');
  const secondPause = second.wait('state', m => m.state.status === 'paused');
  const firstPause = first.wait('state', m => m.state.status === 'paused');
  first.send({ type: 'pause' });
  const paused = (await firstPause).state;
  assert.deepEqual((await adminPause).state, paused); assert.deepEqual((await secondPause).state, paused);
  const adminResume = admin.wait('state', m => m.state.status === 'running');
  const firstResume = first.wait('state', m => m.state.status === 'running');
  const secondResume = second.wait('state', m => m.state.status === 'running');
  second.send({ type: 'resume' });
  const resumed = (await secondResume).state;
  assert.deepEqual((await adminResume).state, resumed); assert.deepEqual((await firstResume).state, resumed);
  assert(resumed.startAt > resumed.serverNow); assert.equal(resumed.positionMs, paused.positionMs);
  for (const command of [{ type: 'stop' }, { type: 'seek', positionMs: 30000 }, { type: 'speed', playbackRate: 2 }, { type: 'resume' }]) first.send(command);
  const barrier = first.wait('clock:sync'); first.send({ type: 'clock:sync', t0: 99 }); await barrier;
  const current = await (await fetch(f.url + '/local/state')).json();
  assert.equal(current.status, 'running'); assert.equal(current.playbackRate, 1); assert.equal(current.startAt, resumed.startAt); assert.equal(current.positionMs, resumed.positionMs);
  await admin.command({ type: 'stop' });
});

test('voice signaling routes only joined members, preserves sender identity, and leaves music presence separate', async t => {
  const f = await fixture(t);
  assert.equal((await fetch(f.url + '/voice')).status, 200);
  assert.equal((await fetch(f.url + '/js/local-voice.js')).status, 200);
  const admin = await peer(f.url), first = await peer(f.url, 'voice'), second = await peer(f.url, 'voice');
  const firstRoster = first.wait('voice:peers'); first.send({ type: 'voice:join', name: 'One' }); const firstId = (await firstRoster).selfId;
  const secondRoster = second.wait('voice:peers'); second.send({ type: 'voice:join', name: 'Two' }); const secondId = (await secondRoster).selfId;
  const signal = second.wait('voice:signal'); first.send({ type: 'voice:signal', to: secondId, from: 'spoof', description: { type: 'offer', sdp: 'audio sdp' } });
  assert.equal((await signal).from, firstId);
  const mic = second.wait('voice:peers', m => m.peers.some(p => p.id === firstId && p.micOn)); first.send({ type: 'voice:mic', micOn: true }); await mic;
  await upload(f.url); await admin.command({ type: 'start' });
  first.send({ type: 'pause' }); const barrier = first.wait('clock:sync'); first.send({ type: 'clock:sync', t0: 5 }); await barrier;
  assert.equal((await (await fetch(f.url + '/local/state')).json()).status, 'running');
  const remaining = second.wait('voice:peers', m => m.peers.length === 1); first.socket.close(); await remaining;
  await admin.command({ type: 'stop' });
});

test('queue supports duplicates, ordering, removal, deletion cleanup and automatic next with countdown', async t => {
  const f = await fixture(t, { startDelayMs: 20 });
  const first = (await (await upload(f.url, 100)).json()).track;
  const second = (await (await upload(f.url, 60000)).json()).track;
  const admin = await peer(f.url), listener = await peer(f.url, 'listener');
  assert.deepEqual((await admin.command({ type: 'queue:add', trackId: second.id })).queue, [second.id]);
  await admin.command({ type: 'queue:add', trackId: first.id });
  assert.deepEqual((await admin.command({ type: 'queue:move', index: 1, direction: -1 })).queue, [first.id, second.id]);
  assert.deepEqual((await admin.command({ type: 'queue:remove', index: 0 })).queue, [second.id]);
  listener.send({ type: 'queue:add', trackId: first.id });
  const barrier = listener.wait('clock:sync'); listener.send({ type: 'clock:sync', t0: 10 }); await barrier;
  assert.deepEqual((await (await fetch(f.url + '/local/state')).json()).queue, [second.id]);
  await admin.command({ type: 'room:options', autoNext: true });
  const advance = admin.wait('state', packet => packet.state.status === 'running' && packet.state.track.id === second.id);
  await admin.command({ type: 'start' });
  const next = (await advance).state;
  assert.equal(next.positionMs, 0); assert(next.startAt > next.serverNow); assert.deepEqual(next.queue, []);
  await admin.command({ type: 'stop' });
  await admin.command({ type: 'queue:add', trackId: first.id });
  await admin.command({ type: 'queue:add', trackId: first.id });
  assert.equal((await fetch(f.url + `/local/tracks/${first.id}`, { method: 'DELETE' })).status, 200);
  assert.deepEqual((await (await fetch(f.url + '/local/state')).json()).queue, []);
});

test('buffer wait rejects stale or short reports, starts on readiness, supports override and cancellation', async t => {
  const f = await fixture(t);
  const track = (await (await upload(f.url)).json()).track;
  const admin = await peer(f.url), listener = await peer(f.url, 'listener');
  await admin.command({ type: 'room:options', waitForBuffers: true, syncMode: 'tight' });
  const pending = await admin.command({ type: 'start' }); assert.equal(pending.status, 'buffering'); assert.equal(pending.syncMode, 'tight');
  const report = { type: 'listener:status', joined: true, ready: true, status: 'ready', trackId: track.id, bufferPositionMs: 0, bufferedMs: 5000 };
  for (const invalid of [{ ...report, bufferRequestId: 0 }, { ...report, bufferRequestId: pending.bufferRequestId, bufferedMs: 1000 }]) {
    listener.send(invalid);
    const barrier = listener.wait('clock:sync'); listener.send({ type: 'clock:sync', t0: 20 }); await barrier;
    assert.equal((await (await fetch(f.url + '/local/state')).json()).status, 'buffering');
  }
  const started = admin.wait('state', packet => packet.state.status === 'running');
  listener.send({ ...report, bufferRequestId: pending.bufferRequestId }); await started;
  await admin.command({ type: 'stop' });
  assert.equal((await admin.command({ type: 'start' })).status, 'buffering');
  assert.equal((await admin.command({ type: 'start-now' })).status, 'running');
  await admin.command({ type: 'stop' });
  assert.equal((await admin.command({ type: 'start' })).status, 'buffering');
  const paused = admin.wait('state', packet => packet.state.status === 'paused'); listener.send({ type: 'pause' }); await paused;
  await admin.command({ type: 'stop' });
  assert.equal((await admin.command({ type: 'start' })).status, 'buffering');
  const disconnected = admin.wait('state', packet => packet.state.status === 'running'); listener.socket.close(); await disconnected;
});

test('buffer wait times out without silently starting and can be stopped', async t => {
  const f = await fixture(t, { bufferWaitMs: 100 }); await upload(f.url);
  const admin = await peer(f.url); await peer(f.url, 'listener');
  await admin.command({ type: 'room:options', waitForBuffers: true });
  const expired = admin.wait('state', packet => packet.state.status === 'paused' && packet.state.bufferNotice);
  await admin.command({ type: 'start' }); assert.match((await expired).state.bufferNotice, /not ready/);
  assert.equal((await admin.command({ type: 'resume' })).status, 'buffering');
  await admin.command({ type: 'stop' });
  await new Promise(resolve => setTimeout(resolve, 130));
  assert.equal((await (await fetch(f.url + '/local/state')).json()).status, 'idle');
});

test('QR invitations use LAN listener URLs and reject arbitrary destinations', async t => {
  const f = await fixture(t, { inviteHosts: ['192.168.43.1', 'localhost', '127.0.0.1'] });
  const config = await (await fetch(f.url + '/local/features')).json();
  assert.equal(config.secureOrigin, null);
  const invitation = config.invitations.find(url => url.startsWith('http://192.168.43.1:'));
  assert(invitation.endsWith('/floor')); assert(!config.invitations.some(url => /localhost|127\.0\.0\.1/.test(url)));
  const qr = await fetch(f.url + '/local/invite.svg?url=' + encodeURIComponent(invitation));
  assert.equal(qr.status, 200); assert.match(qr.headers.get('content-type'), /image\/svg\+xml/);
  assert.match(await qr.text(), /<svg.*viewBox=/);
  assert.equal((await fetch(f.url + '/local/invite.svg?url=https://example.com')).status, 400);
});

test('live selection and Previous/Next/Shuffle change the whole room without losing paused state', async t => {
  const f = await fixture(t, { startDelayMs: 20 });
  const a = (await (await upload(f.url, 150, 'a.wav')).json()).track;
  const b = (await (await upload(f.url, 60000, 'b.wav')).json()).track;
  const c = (await (await upload(f.url, 60000, 'c.wav')).json()).track;
  const admin = await peer(f.url), listener = await peer(f.url, 'listener');
  await admin.command({ type: 'queue:add', trackId: a.id });
  await admin.command({ type: 'start' });
  const observed = listener.wait('state', packet => packet.state.track.id === b.id && packet.state.status === 'running');
  let state = await admin.command({ type: 'select-track', trackId: b.id });
  assert.equal(state.status, 'running'); assert.equal(state.positionMs, 0); assert(state.startAt > state.serverNow);
  assert.equal((await observed).state.startAt, state.startAt);
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.equal((await (await fetch(f.url + '/local/state')).json()).status, 'running', 'old song end timer must not end the new song');
  state = await admin.command({ type: 'previous-track' }); assert.equal(state.track.id, c.id);
  state = await admin.command({ type: 'next-track' }); assert.equal(state.track.id, b.id);
  state = await admin.command({ type: 'shuffle-track' }); assert.notEqual(state.track.id, b.id); assert.equal(state.status, 'running');
  assert.deepEqual(state.queue, [a.id], 'manual navigation leaves the planned queue intact');
  await admin.command({ type: 'pause' });
  state = await admin.command({ type: 'select-track', trackId: c.id });
  assert.equal(state.status, 'paused'); assert.equal(state.positionMs, 0); assert.equal(state.startAt, null);
  state = await admin.command({ type: 'previous-track' }); assert.equal(state.track.id, a.id); assert.equal(state.status, 'paused');
  state = await admin.command({ type: 'next-track' }); assert.equal(state.track.id, c.id);
  for (const type of ['next-track', 'previous-track', 'shuffle-track', 'select-track']) {
    const changed = admin.wait('state');
    listener.send({ type, trackId: b.id });
    const shared = (await changed).state;
    assert.equal(shared.status, 'paused');
    if (type === 'select-track') assert.equal(shared.track.id, b.id);
  }
  await admin.command({ type: 'room:options', waitForBuffers: true });
  assert.equal((await admin.command({ type: 'resume' })).status, 'buffering');
  state = await admin.command({ type: 'select-track', trackId: b.id }); assert.equal(state.status, 'buffering'); assert.equal(state.track.id, b.id);
  await admin.command({ type: 'stop' });
});
