const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const WebSocket = require('ws');
const { createHost } = require('../server');

async function fixture(t) {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sharemusic-test-'));
  const hosts = [];
  async function launch() {
    const host = createHost({ storageRoot, startDelayMs: 200 }); hosts.push(host);
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

test('malformed WS data cannot crash host; listeners cannot start tracks; readiness is scoped', async t => {
  const f = await fixture(t); const track = (await (await upload(f.url)).json()).track;
  const p = await peer(f.url), listener = await peer(f.url, 'listener');
  for (const raw of ['null', '[]', '12', '"hello"', '{', '{}', '{"type":null}']) p.socket.send(raw);
  for (const command of [{ type: 'seek', positionMs: 'oops' }, { type: 'speed', playbackRate: 50 }]) p.send(command);
  const clock = p.wait('clock:sync'); p.send({ type: 'clock:sync', t0: 42 }); assert.equal((await clock).t0, 42);
  listener.send({ type: 'start' }); const barrier = listener.wait('clock:sync'); listener.send({ type: 'clock:sync', t0: 43 }); await barrier;
  assert.equal((await (await fetch(f.url + '/local/state')).json()).status, 'idle');
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
