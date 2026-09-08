const test = require('node:test');
const assert = require('node:assert/strict');
const { browser, flush } = require('./browser-harness');
const { voiceMocks } = require('./voice-mocks');

function fixture() {
  const mocks = voiceMocks();
  const h = browser('voice', { prepare: mocks.prepare });
  h.sockets[0].open();
  const roster = peers => h.sockets.at(-1).receive({ type: 'voice:peers', selfId: 'b', peers: [{ id: 'b', name: 'Me', micOn: false }, ...peers] });
  return { h, ...mocks, roster };
}

test('voice HTML starts, registers its own role, and HTTP explains HTTPS instead of Connecting', () => {
  const h = browser('voice', { prepare: ({ window }) => { window.isSecureContext = false; } });
  assert.equal(h.sockets.length, 1); h.sockets[0].open();
  assert.equal(h.sockets[0].sent[0].role, 'voice');
  assert.match(h.e('voice-status').textContent, /HTTPS/);
  assert.equal(h.e('voice-requirement').hidden, false); assert(h.e('voice-join').disabled);
});

test('voice captures only after Join; mic begins muted; open mic and hold/cancel release correctly', async () => {
  const { h, calls, roster } = fixture();
  assert.equal(calls.capture.length, 0); assert.equal(h.e('voice-join').disabled, false);
  await h.e('voice-join').onclick(); roster([]);
  assert.equal(calls.capture[0].video, false); const track = calls.streams[0].getAudioTracks()[0]; assert.equal(track.enabled, false);
  h.e('voice-open').onclick(); assert(track.enabled); assert.match(h.e('voice-mic').textContent, /ON/);
  h.e('voice-open').onclick(); assert.equal(track.enabled, false);
  h.e('voice-hold').emit('pointerdown', { button: 0, pointerId: 1, preventDefault() {} }); assert(track.enabled);
  h.e('voice-hold').emit('pointercancel'); assert.equal(track.enabled, false);
  h.e('voice-hold').emit('keydown', { key: ' ', repeat: false, preventDefault() {} }); assert(track.enabled);
  h.e('voice-hold').emit('keyup', { key: ' ', preventDefault() {} }); assert.equal(track.enabled, false);
  h.e('voice-open').onclick(); h.document.hidden = true; h.document.handlers.visibilitychange(); assert.equal(track.enabled, false);
  h.e('voice-leave').onclick(); assert(track.stopped); assert.equal(calls.contexts[0].state, 'closed');
});

test('denied microphone, canceled capture, capacity rejection and disconnect all release resources', async () => {
  const denied = fixture();
  denied.h.window.navigator.mediaDevices.getUserMedia = async () => { throw Object.assign(Error('no'), { name: 'NotAllowedError' }); };
  await denied.h.e('voice-join').onclick(); assert.match(denied.h.e('voice-status').textContent, /denied/); assert.equal(denied.calls.contexts[0].state, 'closed');
  const canceled = fixture(); let resolve;
  const late = new canceled.Stream();
  canceled.h.window.navigator.mediaDevices.getUserMedia = () => new Promise(done => { resolve = done; });
  const pending = canceled.h.e('voice-join').onclick(); canceled.h.e('voice-leave').onclick(); resolve(late); await pending;
  assert(late.getTracks()[0].stopped); assert.equal(canceled.h.sockets[0].sent.filter(m => m.type === 'voice:join').length, 0);
  for (const reason of ['capacity', 'disconnect']) {
    const f = fixture(); await f.h.e('voice-join').onclick(); f.roster([{ id: 'a', name: 'Peer', micOn: false }]);
    if (reason === 'capacity') f.h.sockets[0].receive({ type: 'voice:error', error: 'Voice is full' });
    else f.h.sockets[0].close();
    assert(f.calls.streams[0].getTracks()[0].stopped); assert.equal(f.calls.pcs[0].connectionState, 'closed');
    if (reason === 'disconnect') {
      f.h.advance(1500); f.h.sockets[1].open();
      assert.equal(f.h.sockets[1].sent.filter(m => m.type === 'voice:join').length, 0);
      assert.equal(f.calls.capture.length, 1);
    }
  }
});

test('voice offers one side per pair, queues early ICE, attaches remote audio and cleans departed peers', async () => {
  const { h, calls, roster } = fixture(); await h.e('voice-join').onclick();
  roster([{ id: 'a', name: 'Answer to a', micOn: false }, { id: 'c', name: '<script>', micOn: true }]); await flush();
  assert.equal(calls.pcs.length, 2); assert.equal(calls.pcs[0].options.iceServers.length, 0);
  assert.equal(h.sockets[0].sent.filter(m => m.description?.type === 'offer').length, 1);
  assert.equal(h.sockets[0].sent.find(m => m.description?.type === 'offer').to, 'c');
  const candidate = { candidate: 'candidate:test', sdpMid: '0', sdpMLineIndex: 0 };
  h.sockets[0].receive({ type: 'voice:signal', from: 'a', candidate }); await flush(); assert.equal(calls.pcs[0].candidates.length, 0);
  h.sockets[0].receive({ type: 'voice:signal', from: 'a', description: { type: 'offer', sdp: 'sdp' } }); await flush();
  assert.equal(calls.pcs[0].candidates.length, 1); assert.equal(calls.pcs[0].localDescription.type, 'answer');
  calls.pcs[0].ontrack({ track: { kind: 'audio' } }); assert(calls.contexts[0].sources[0].connected);
  roster([{ id: 'c', name: '<script>', micOn: true }]); assert.equal(calls.pcs[0].connectionState, 'closed'); assert.equal(calls.contexts[0].sources[0].connected, false);
  assert(h.e('voice-peers').children.some(item => item.textContent.includes('<script>')));
});
