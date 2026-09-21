(() => {
  const $ = id => document.getElementById(id);
  if (/(?:^|[?&])from=admin(?:&|$)/.test(location.search || '')) {
    $('voice-back').setAttribute('href', '/admin');
    $('voice-back').textContent = 'Back to dashboard';
    $('voice-help').setAttribute('href', '/help.html?from=admin');
  }
  let room, voice, holding = false, openMic = false;
  const rows = new Map();
  const embedded = /(?:^|[?&])embedded=1(?:&|$)/.test(location.search || '');
  if (embedded) document.body?.classList.add('voice-embedded');
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
    $('voice-reconnect').disabled = !supported || !state.connected || state.joining;
    $('voice-mic').textContent = state.micOn ? 'Microphone ON — friends can hear you' : 'Microphone off';
    $('voice-hold').classList.toggle('is-talking', holding && state.micOn);
    $('voice-open').setAttribute('aria-pressed', String(openMic));
    $('voice-open').textContent = openMic ? 'Turn off open mic' : 'Turn on open mic';
    $('voice-count').textContent = state.peers.length;
    for (const [id, row] of rows) if (!state.peers.some(peer => peer.id === id)) { row.item.remove(); rows.delete(id); }
    if (state.peers.length && !rows.size) $('voice-peers').replaceChildren();
    for (const peer of state.peers) {
      let row = rows.get(peer.id);
      if (!row) {
        const item = document.createElement('li'), title = document.createElement('span'); item.appendChild(title);
        row = { item, title };
        if (!peer.self) {
          const label = document.createElement('label'), slider = document.createElement('input');
          label.textContent = `Volume for ${peer.name}`;
          slider.type = 'range'; slider.min = '0'; slider.max = '100'; slider.step = '5'; slider.value = String(Math.round(peer.volume * 100));
          slider.oninput = () => voice.setVolume(peer.id, Number(slider.value) / 100);
          label.appendChild(slider); item.appendChild(label); row.slider = slider;
        }
        rows.set(peer.id, row); $('voice-peers').appendChild(item);
      }
      row.title.textContent = `${peer.name}${peer.self ? ' (you)' : ''} · ${peer.speaking ? 'speaking' : peer.micOn ? 'mic on' : 'muted'} · ${peer.connection}`;
      row.item.classList.toggle('is-speaking', peer.speaking);
      if (row.slider && document.activeElement !== row.slider) row.slider.value = String(Math.round(peer.volume * 100));
    }
    if (!state.peers.length) { const item = document.createElement('li'); item.textContent = 'No one joined yet.'; $('voice-peers').replaceChildren(item); }
    if (embedded) window.parent.postMessage({ type: 'sharemusic:voice', joined: state.joined, speaking: !!state.speaking, message: state.message }, location.origin);
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
  $('voice-reconnect').onclick = () => { voice.leave(); return voice.join($('voice-name').value); };
  $('voice-listen').onclick = () => voice.enableAudio();
  $('voice-open').onclick = () => {
    if (!voice.snapshot().joined) return;
    holding = false; openMic = !openMic; voice.setMic(openMic);
  };
  function hold(event) {
    if (openMic || !voice.snapshot().joined || event.button > 0) return;
    event.preventDefault(); holding = true;
    if (event.pointerId != null) {
      try { $('voice-hold').setPointerCapture(event.pointerId); }
      catch (_) { holding = false; return; }
    }
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
