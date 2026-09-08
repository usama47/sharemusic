const { randomUUID } = require('crypto');

// Signaling only. Microphone audio travels directly between joined browsers.
function createVoiceRoom({ send, maxPeers = 8 }) {
  const members = new Map();
  function publish() {
    const peers = [...members.values()];
    for (const [socket, member] of members) send(socket, { type: 'voice:peers', selfId: member.id, peers });
  }
  function leave(socket) { if (members.delete(socket)) publish(); }
  function handle(socket, message, device) {
    if (!message.type.startsWith('voice:')) return false;
    if (!device) return true;
    if (message.type === 'voice:join') {
      if (members.has(socket)) { publish(); return true; }
      if (members.size >= maxPeers) { send(socket, { type: 'voice:error', error: `Voice is full (${maxPeers} people maximum).` }); return true; }
      const name = typeof message.name === 'string' ? message.name.trim().slice(0, 40) : '';
      members.set(socket, { id: randomUUID(), name: name || 'Friend', micOn: false });
      publish();
    } else if (message.type === 'voice:leave') leave(socket);
    else if (message.type === 'voice:mic' && members.has(socket) && typeof message.micOn === 'boolean') {
      const member = members.get(socket);
      if (member.micOn !== message.micOn) { member.micOn = message.micOn; publish(); }
    } else if (message.type === 'voice:signal' && members.has(socket)) {
      const target = [...members].find(([, member]) => member.id === message.to);
      if (!target || target[0] === socket) return true;
      let payload;
      const description = message.description;
      const candidate = message.candidate;
      if (description && !candidate && ['offer', 'answer'].includes(description.type) && typeof description.sdp === 'string' && description.sdp.length <= 20000) {
        payload = { description: { type: description.type, sdp: description.sdp } };
      } else if (!description && candidate && typeof candidate.candidate === 'string' && candidate.candidate.length <= 4096 &&
        (candidate.sdpMid == null || typeof candidate.sdpMid === 'string' && candidate.sdpMid.length < 100) &&
        (candidate.sdpMLineIndex == null || Number.isInteger(candidate.sdpMLineIndex) && candidate.sdpMLineIndex >= 0 && candidate.sdpMLineIndex < 20)) {
        payload = { candidate: { candidate: candidate.candidate, sdpMid: candidate.sdpMid ?? null, sdpMLineIndex: candidate.sdpMLineIndex ?? null } };
      }
      if (payload) send(target[0], { type: 'voice:signal', from: members.get(socket).id, ...payload });
    }
    return true;
  }
  return { handle, leave };
}
module.exports = { createVoiceRoom };
