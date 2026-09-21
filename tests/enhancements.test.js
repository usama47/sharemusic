const test = require('node:test');
const assert = require('node:assert/strict');
const { browser, flush } = require('./browser-harness');
const { voiceMocks } = require('./voice-mocks');

test('normal drift does not seek; tight mode changes rate without interrupting playback', async () => {
  const h = browser('floor'); h.sockets[0].open(); h.state({}); await h.e('join').onclick();
  const startAt = h.time(); h.state({ status: 'running', startAt }); await flush();
  h.move(1000); h.e('audio').currentTime = 0.8;
  h.advance(250); await flush();
  assert.equal(h.e('audio').currentTime, 0.8); assert(!h.e('audio').paused);
  const smoothRate = h.e('audio').playbackRate;
  h.state({ status: 'running', startAt, syncMode: 'tight', queue: ['other'] });
  assert.equal(h.e('audio').currentTime, 0.8); assert(!h.e('audio').paused);
  assert(h.e('audio').playbackRate > smoothRate); assert(h.e('audio').playbackRate <= 1.03);
});

test('buffering does not chase the clock; recovered large drift seeks once with cooldown', async () => {
  const h = browser('floor'); h.sockets[0].open(); h.state({}); await h.e('join').onclick();
  const startAt = h.time(); h.state({ status: 'running', startAt }); await flush();
  h.e('audio').readyState = 2;
  h.advance(4000); await flush(); assert.equal(h.e('audio').currentTime, 0);
  h.e('audio').readyState = 4;
  h.advance(2250); await flush(); const aligned = h.e('audio').currentTime; assert(aligned >= 6);
  h.advance(2250); await flush(); assert.equal(h.e('audio').currentTime, aligned);
});

test('buffer reports carry fresh request IDs even when media status remains ready', async () => {
  const h = browser('floor'); h.sockets[0].open(); h.state({}); await h.e('join').onclick();
  h.state({ status: 'buffering', bufferRequestId: 1 });
  let report = h.sockets[0].sent.filter(packet => packet.type === 'listener:status').at(-1);
  assert.equal(report.bufferRequestId, 1); assert(report.bufferedMs >= 3000);
  h.state({ status: 'buffering', bufferRequestId: 2 });
  report = h.sockets[0].sent.filter(packet => packet.type === 'listener:status').at(-1);
  assert.equal(report.bufferRequestId, 2);
  assert(!h.e('waiting-screen').classList.contains('hidden'));
});

test('voice activity uses audio levels, friend volume is local, reconnect releases old resources', async () => {
  const mocks = voiceMocks(); const h = browser('voice', { prepare: mocks.prepare });
  h.sockets[0].open(); h.state({}); await h.e('voice-join').onclick();
  h.sockets[0].receive({ type: 'voice:peers', selfId: 'self', peers: [{ id: 'self', name: 'Me', micOn: false }, { id: 'other', name: 'Friend', micOn: true }] });
  mocks.calls.pcs[0].ontrack({ track: { kind: 'audio' } });
  const context = mocks.calls.contexts[0];
  context.analysers[1].level = 0.1; h.advance(100);
  const peer = h.e('voice-peers').children[1]; assert(peer.classList.contains('is-speaking'));
  const volume = peer.children[1].children[0]; volume.value = '25'; volume.oninput();
  assert.equal(context.gains[1].gain.value, 0.25); assert.equal(context.gains[0].gain.value, 0);
  context.analysers[1].level = 0; h.advance(500); assert(!peer.classList.contains('is-speaking'));
  await h.e('voice-reconnect').onclick();
  assert(mocks.calls.streams[0].getTracks()[0].stopped); assert.equal(mocks.calls.pcs[0].connectionState, 'closed');
  assert.equal(mocks.calls.capture.length, 2); assert.equal(mocks.calls.streams[1].getAudioTracks()[0].enabled, false);
});

test('embedded voice panel keeps music playing, validates activity messages and restores ducked volume', async () => {
  const h = browser('floor'); h.sockets[0].open(); h.state({}); await h.e('join').onclick();
  h.state({ status: 'running', startAt: h.time() }); await flush();
  const mount = h.e('room-tools'), control = selector => mount.querySelector(selector);
  control('.tools-join').onclick();
  const frame = control('.tools-frame-mount').children[0]; frame.contentWindow = {};
  assert(!h.e('audio').paused); control('.tools-duck').checked = true;
  const message = { origin: 'http://localhost', source: frame.contentWindow, data: { type: 'sharemusic:voice', joined: true, speaking: true, message: 'Speaking' } };
  h.window.handlers.message({ ...message, origin: 'https://other.example' }); assert.equal(h.e('audio').volume, 1);
  h.window.handlers.message(message); assert.equal(h.e('audio').volume, 0.25);
  control('.tools-close').onclick(); assert(!h.e('audio').paused); assert.equal(control('.tools-frame-mount').children.length, 1);
  control('.tools-end').onclick(); assert.equal(h.e('audio').volume, 1); assert(!h.e('audio').paused);
  assert.equal(control('.tools-frame-mount').children.length, 0);
});
