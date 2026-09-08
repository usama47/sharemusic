// Small-group LAN voice. The server relays signaling; no recording or public ICE service.
window.ShareMusicVoice = ({ send, onChange = () => {} }) => {
  let connected = false, joined = false, joining = false, micOn = false;
  let stream, context, selfId, session = 0, joinTimer, message = 'Join to hear your friends.';
  const members = new Map(), peers = new Map();
  const snapshot = () => ({ connected, joined, joining, micOn, message,
    needsAudio: joined && context?.state !== 'running',
    peers: [...members.values()].map(member => ({ ...member, self: member.id === selfId, connection: member.id === selfId ? 'you' : peers.get(member.id)?.pc.connectionState || 'connecting' })) });
  const notify = () => onChange(snapshot());
  function closePeer(id) {
    const peer = peers.get(id);
    if (!peer) return;
    peers.delete(id); peer.source?.disconnect(); peer.pc.close();
  }
  function leave(tellServer = true) {
    session++; clearTimeout(joinTimer);
    if (tellServer && connected && (joined || joining)) send({ type: 'voice:leave' });
    joined = false; joining = false; micOn = false; selfId = null;
    for (const track of stream?.getTracks() || []) track.stop();
    stream = null;
    for (const id of [...peers.keys()]) closePeer(id);
    members.clear();
    if (context) { context.onstatechange = null; context.close().catch(() => {}); context = null; }
    message = 'You left voice. Microphone released.'; notify();
  }
  async function join(name) {
    if (!connected || joining || joined) return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      message = 'Microphone access needs trusted HTTPS on this device. Ask the host for the HTTPS voice link.'; notify(); return;
    }
    if (!window.RTCPeerConnection || !(window.AudioContext || window.webkitAudioContext)) {
      message = 'This browser does not support live voice. Try a current browser.'; notify(); return;
    }
    const attempt = ++session;
    joining = true; message = 'Allow microphone access to join. Your mic starts muted.'; notify();
    try {
      context = new (window.AudioContext || window.webkitAudioContext)();
      context.onstatechange = notify;
      // Resume within the Join gesture; permission can resolve later.
      const audioReady = context.resume().then(() => true, () => false);
      const acquired = await navigator.mediaDevices.getUserMedia({ video: false, audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (attempt !== session) { acquired.getTracks().forEach(track => track.stop()); return; }
      stream = acquired;
      stream.getAudioTracks().forEach(track => {
        track.enabled = false;
        track.onended = () => { if (stream === acquired) { leave(); message = 'Microphone disconnected. Join again when ready.'; notify(); } };
      });
      await audioReady;
      if (attempt !== session) return;
      if (!send({ type: 'voice:join', name })) throw new Error('Connection lost');
      joinTimer = setTimeout(() => { leave(); message = 'Voice join timed out. Try joining again.'; notify(); }, 10000);
    } catch (error) {
      if (attempt !== session) return;
      leave();
      message = error.name === 'NotAllowedError' ? 'Microphone permission was denied. Allow it in your browser, then join again.' : 'Microphone could not start. Check the device and join again.';
      notify();
    }
  }
  function setMic(value) {
    const next = joined && connected && value === true;
    for (const track of stream?.getAudioTracks() || []) track.enabled = next;
    if (micOn !== next) { micOn = next; send({ type: 'voice:mic', micOn }); }
    notify();
  }
  function queue(peer, action) {
    peer.work = peer.work.then(async () => { if (peers.get(peer.id) === peer) await action(); }).catch(() => {
      if (peers.get(peer.id) !== peer) return;
      message = 'A voice connection failed. Check Wi-Fi, then leave and rejoin voice.'; notify();
    });
  }
  function createPeer(id) {
    const pc = new window.RTCPeerConnection({ iceServers: [] });
    const peer = { id, pc, work: Promise.resolve(), candidates: [], source: null };
    peers.set(id, peer);
    for (const track of stream.getAudioTracks()) pc.addTrack(track, stream);
    pc.onicecandidate = event => {
      if (event.candidate && peers.get(id) === peer) send({ type: 'voice:signal', to: id, candidate: event.candidate.toJSON() });
    };
    pc.ontrack = event => {
      if (!context || peers.get(id) !== peer || event.track.kind !== 'audio') return;
      peer.source?.disconnect();
      peer.source = context.createMediaStreamSource(new MediaStream([event.track]));
      peer.source.connect(context.destination); notify();
    };
    pc.onconnectionstatechange = () => {
      if (peers.get(id) !== peer) return;
      if (['failed', 'disconnected'].includes(pc.connectionState)) message = 'A friend’s voice connection dropped. Check Wi-Fi; rejoin if it does not recover.';
      notify();
    };
    return peer;
  }
  function receive(packet) {
    if (packet.type === 'voice:error') { leave(); message = packet.error; notify(); return; }
    if (packet.type === 'voice:peers' && stream && (joining || joined)) {
      clearTimeout(joinTimer); joining = false; joined = true; selfId = packet.selfId;
      members.clear(); for (const member of packet.peers) members.set(member.id, member);
      for (const id of [...peers.keys()]) if (!members.has(id)) closePeer(id);
      for (const member of members.values()) {
        if (member.id === selfId || peers.has(member.id)) continue;
        const peer = createPeer(member.id);
        // One deterministic offerer per pair avoids glare when several people join.
        if (selfId < member.id) queue(peer, async () => {
          await peer.pc.setLocalDescription(await peer.pc.createOffer());
          if (peers.get(peer.id) === peer) send({ type: 'voice:signal', to: peer.id, description: { type: peer.pc.localDescription.type, sdp: peer.pc.localDescription.sdp } });
        });
      }
      message = members.size === 1 ? 'You’re in. Waiting for friends to join voice.' : 'Voice joined. Use headphones to reduce echo.';
      notify();
    } else if (packet.type === 'voice:signal' && joined) {
      const peer = peers.get(packet.from);
      if (!peer) return;
      queue(peer, async () => {
        if (packet.description) {
          await peer.pc.setRemoteDescription(packet.description);
          for (const candidate of peer.candidates.splice(0)) await peer.pc.addIceCandidate(candidate);
          if (packet.description.type === 'offer') {
            await peer.pc.setLocalDescription(await peer.pc.createAnswer());
            if (peers.get(peer.id) === peer) send({ type: 'voice:signal', to: peer.id, description: { type: peer.pc.localDescription.type, sdp: peer.pc.localDescription.sdp } });
          }
        } else if (packet.candidate) {
          if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(packet.candidate);
          else if (peer.candidates.length < 100) peer.candidates.push(packet.candidate);
        }
      });
    }
  }
  return { snapshot, join, leave, setMic, receive,
    setConnected(value) {
      connected = value;
      if (!value && (joined || joining)) { leave(false); message = 'Connection lost. Microphone released. Rejoin when connected.'; }
      notify();
    },
    async enableAudio() { try { await context?.resume(); } catch (_) { message = 'Audio output was blocked. Try Enable sound again.'; } notify(); }
  };
};
