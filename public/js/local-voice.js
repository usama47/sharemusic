(() => {
  const $ = id => document.getElementById(id);
  if (/(?:^|[?&])from=admin(?:&|$)/.test(location.search || '')) {
    $('voice-back').setAttribute('href', '/admin');
    $('voice-back').textContent = 'Back to dashboard';
  }
  let room, voice, holding = false, openMic = false;
  const supported = window.isSecureContext && navigator.mediaDevices?.getUserMedia && window.RTCPeerConnection && (window.AudioContext || window.webkitAudioContext);
  function render(state) {
    $('voice-requirement').hidden = !!window.isSecureContext;
    $('voice-status').textContent = !window.isSecureContext ? 'Voice needs an HTTPS link on this device.' : !supported ? 'This browser does not support live voice.' : !state.connected ? 'Reconnecting to the room…' : state.message;
    $('voice-join').disabled = !supported || !state.connected || state.joined || state.joining;
    $('voice-leave').disabled = !state.joined && !state.joining;
    $('voice-name').disabled = state.joined || state.joining;
    $('voice-hold').disabled = !state.joined || !state.connected || openMic;
    $('voice-open').disabled = !state.joined || !state.connected;
    $('voice-listen').hidden = !state.needsAudio;
    $('voice-mic').textContent = state.micOn ? 'Microphone ON — friends can hear you' : 'Microphone off';
    $('voice-hold').classList.toggle('is-talking', holding && state.micOn);
    $('voice-open').setAttribute('aria-pressed', String(openMic));
    $('voice-open').textContent = openMic ? 'Turn off open mic' : 'Turn on open mic';
    $('voice-count').textContent = state.peers.length;
    $('voice-peers').replaceChildren();
    for (const peer of state.peers) {
      const item = document.createElement('li');
      item.textContent = `${peer.name}${peer.self ? ' (you)' : ''} · ${peer.micOn ? 'mic on' : 'muted'} · ${peer.connection}`;
      $('voice-peers').appendChild(item);
    }
    if (!state.peers.length) { const item = document.createElement('li'); item.textContent = 'No one joined yet.'; $('voice-peers').appendChild(item); }
  }
  voice = window.ShareMusicVoice({ send: packet => room?.send(packet) || false, onChange(state) {
    if (!state.joined) { holding = false; openMic = false; }
    render(state);
  } });
  room = window.ShareMusicRoom.connect({ role: 'voice', label: 'Voice',
    onConnection: value => voice.setConnected(value), onMessage: packet => voice.receive(packet)
  });
  $('voice-join').onclick = () => voice.join($('voice-name').value);
  $('voice-leave').onclick = () => voice.leave();
  $('voice-listen').onclick = () => voice.enableAudio();
  $('voice-open').onclick = () => {
    if (!voice.snapshot().joined) return;
    holding = false; openMic = !openMic; voice.setMic(openMic);
  };
  function hold(event) {
    if (openMic || !voice.snapshot().joined || event.button > 0) return;
    event.preventDefault(); holding = true;
    if (event.pointerId != null) $('voice-hold').setPointerCapture(event.pointerId);
    voice.setMic(true);
  }
  function release() { if (holding) { holding = false; voice.setMic(openMic); } }
  $('voice-hold').addEventListener('pointerdown', hold);
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) $('voice-hold').addEventListener(event, release);
  $('voice-hold').addEventListener('contextmenu', event => event.preventDefault());
  $('voice-hold').addEventListener('keydown', event => { if ([' ', 'Enter'].includes(event.key) && !event.repeat) hold(event); });
  $('voice-hold').addEventListener('keyup', event => { if ([' ', 'Enter'].includes(event.key)) { event.preventDefault(); release(); } });
  $('voice-hold').addEventListener('blur', release);
  window.addEventListener('blur', release);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { holding = false; openMic = false; voice.setMic(false); }
  });
  window.addEventListener('pagehide', () => voice.leave());
  render(voice.snapshot());
})();
