const test = require('node:test');
const assert = require('node:assert/strict');
const { browser, flush } = require('./browser-harness');

test('both actual HTML entrypoints initialize once and admin registers without login', async () => {
  for (const page of ['admin', 'floor']) {
    const h = browser(page); await flush();
    assert.equal(h.sockets.length, 1);
    h.window[page === 'admin' ? 'LocalShareMusicAdmin' : 'LocalShareMusicFloor'].start();
    assert.equal(h.sockets.length, 1);
    h.sockets[0].open();
    assert.equal(h.sockets[0].sent[0].role, page === 'admin' ? 'admin' : 'listener');
    if (page === 'admin') { assert.equal(h.e('connection').textContent, 'Room connected'); assert.equal(h.e('login-panel'), undefined); }
  }
});

test('countdown stays silent, changes screen at start, and stop immediately resets audio', async () => {
  const h = browser('floor'); h.sockets[0].open(); h.state({}); await h.e('join').onclick();
  h.state({ status: 'running', startAt: h.time() + 3000 });
  const plays = h.e('audio').playCalls;
  h.advance(2999); await flush(); assert.equal(h.e('audio').playCalls, plays); assert(h.e('audio').paused);
  assert(!h.e('countdown-screen').classList.contains('hidden'));
  h.advance(1); await flush(); assert(!h.e('audio').paused); assert(!h.e('playing-screen').classList.contains('hidden'));
  h.e('audio').currentTime = 10;
  h.state({ status: 'idle' });
  assert(h.e('audio').paused); assert.equal(h.e('audio').currentTime, 0);
  h.advance(1000); assert(h.e('audio').paused);
});

test('late join remains available; paused seek, resume rate and ended apply without frame callbacks', async () => {
  const h = browser('floor'); h.sockets[0].open();
  h.state({ status: 'running', startAt: h.time() - 10000, playbackRate: 2 });
  assert(!h.e('join-screen').classList.contains('hidden')); assert.equal(h.e('join').disabled, false);
  await h.e('join').onclick(); await flush(); assert(!h.e('audio').paused); assert.equal(h.e('audio').currentTime, 20); assert.equal(h.e('audio').playbackRate, 2);
  h.state({ status: 'paused', positionMs: 12000, playbackRate: 2 });
  assert(h.e('audio').paused); assert.equal(h.e('audio').currentTime, 12);
  h.state({ status: 'running', startAt: h.time() + 3000, positionMs: 12000, playbackRate: 2 });
  h.advance(3000, false); await flush(); assert(!h.e('audio').paused);
  h.state({ status: 'ended', positionMs: 60000 }); assert(h.e('audio').paused); assert(!h.e('ended-screen').classList.contains('hidden'));
});

test('Join rejection restores mute, reports blocked, and allows successful retry', async () => {
  const h = browser('floor'); h.sockets[0].open(); h.state({});
  h.e('audio').playImpl = () => Promise.reject(Object.assign(Error('blocked'), { name: 'NotAllowedError' }));
  await h.e('join').onclick();
  assert.equal(h.e('audio').muted, false); assert(!h.e('join-screen').classList.contains('hidden')); assert.equal(h.e('join').disabled, false);
  assert.equal(h.sockets[0].sent.at(-1).status, 'blocked'); assert.equal(h.sockets[0].sent.at(-1).ready, false);
  delete h.e('audio').playImpl; await h.e('join').onclick(); assert(h.e('join-screen').classList.contains('hidden'));
  assert.equal(h.sockets[0].sent.at(-1).ready, true);
});

test('stop wins over a pending play promise and pending audio-enable gesture', async () => {
  for (const enabling of [false, true]) {
    const h = browser('floor'); h.sockets[0].open(); h.state({});
    if (!enabling) await h.e('join').onclick();
    let resolve;
    h.e('audio').playImpl = () => new Promise(done => { resolve = () => { h.e('audio').paused = false; done(); }; });
    const promise = enabling ? h.e('join').onclick() : null;
    if (!enabling) h.state({ status: 'running', startAt: h.time() });
    h.state({ status: 'idle' }); assert(h.e('audio').paused);
    resolve(); await promise; await flush(); assert(h.e('audio').paused); assert.equal(h.e('audio').muted, false);
  }
});

test('readiness reflects actual loading/error signals; changing tracks loads new source', async () => {
  const h = browser('floor'); h.sockets[0].open(); h.state({}); await h.e('join').onclick();
  h.e('audio').readyState = 2; h.e('audio').emit('waiting'); assert.equal(h.sockets[0].sent.at(-1).ready, false);
  h.e('audio').readyState = 4; h.e('audio').emit('canplay'); assert.equal(h.sockets[0].sent.at(-1).ready, true);
  h.e('audio').error = {}; h.e('audio').emit('error'); assert.equal(h.sockets[0].sent.at(-1).status, 'error'); assert(!h.e('join-screen').classList.contains('hidden'));
  h.state({ track: { id: 'new', name: 'new.wav', url: '/local-media/new.wav', durationMs: 1000 } }); assert.equal(h.e('audio').src, '/local-media/new.wav');
});

test('both clients reconnect and register; listener clears banner and applies fresh state', async () => {
  for (const page of ['floor', 'admin']) {
    const h = browser(page); await flush(); h.sockets[0].open(); h.state({});
    h.sockets[0].close();
    if (page === 'floor') assert(!h.e('reconnect').classList.contains('hidden'));
    else { assert(h.e('start').disabled); h.e('start').onclick(); assert.match(h.e('admin-error').textContent, /Disconnected/); }
    h.advance(1500); assert.equal(h.sockets.length, 2); h.sockets[1].open(); h.state({ status: 'paused', positionMs: 5000 });
    assert.equal(h.sockets[1].sent[0].type, 'register');
    if (page === 'floor') { assert(h.e('reconnect').classList.contains('hidden')); assert.equal(h.e('audio').currentTime, 5); }
    else assert.equal(h.e('clock').textContent, '00:05 / 01:00');
  }
});

test('server offset uses lowest RTT and monotonic time despite local wall-clock jumps', () => {
  const h = browser('admin'); h.sockets[0].open();
  const ping = h.sockets[0].sent.find(m => m.type === 'clock:sync');
  h.move(20); h.sockets[0].receive({ type: 'clock:sync', t0: ping.t0, serverTime: ping.t0 + 5010 });
  h.state({ serverNow: h.time() + 5000, status: 'running', startAt: h.time() + 5000 - 1000, playbackRate: 2 });
  assert.equal(h.e('clock').textContent, '00:02 / 01:00');
  h.jumpWall(600000); h.advance(250); assert.equal(h.e('clock').textContent, '00:02 / 01:00');
  h.advance(1730); const next = h.sockets[0].sent.filter(m => m.type === 'clock:sync').at(-1);
  h.move(200); h.sockets[0].receive({ type: 'clock:sync', t0: next.t0, serverTime: next.t0 + 9000 });
  assert.equal(h.e('clock').textContent, '00:06 / 01:00');
});

test('preview is explicit, follows selection and pauses for room playback; readiness displayed', async () => {
  const h = browser('admin'); await flush(); h.sockets[0].open(); h.state({});
  assert.equal(h.e('preview').src, '/local-media/test.wav'); assert.equal(h.e('preview').hidden, false);
  await h.e('preview').play(); h.state({ status: 'running', startAt: h.time() + 3000 }); assert(h.e('preview').paused);
  h.e('preview').paused = false; h.e('preview').emit('play'); assert(h.e('preview').paused);
  h.sockets[0].receive({ type: 'devices', count: 2, devices: [{ label: 'A', ready: true, trackId: 'track', status: 'ready' }, { label: 'B', ready: false, status: 'blocked' }] });
  assert.equal(h.e('device-count').textContent, '1/2 ready'); assert.match(h.e('devices').innerHTML, /blocked/);
  h.state({ track: null }); assert.equal(h.e('preview').hidden, true); assert.equal(h.e('preview').src, '');
});
