window.LocalShareMusicFloor = (() => {
  let started = false;
  function start() {
    if (started) return;
    started = true;
    const $ = id => document.getElementById(id);
    const screens = ['join-screen', 'waiting-screen', 'countdown-screen', 'playing-screen', 'ended-screen'];
    const show = id => screens.forEach(screen => $(screen).classList.toggle('hidden', screen !== id));
    const { format, elapsed } = window.ShareMusicRoom;
    let room, player, connected = false, lastReport = '', tracks = [];
    let state = { status: 'idle', track: null, positionMs: 0, playbackRate: 1 };
    const now = () => room?.now() ?? Date.now();
    function renderTracks() {
      $('songs-summary').textContent = `Songs in this room (${tracks.length})`;
      $('listener-tracks').replaceChildren();
      if (!tracks.length) $('listener-tracks').textContent = 'No songs uploaded yet.';
      for (const track of tracks) {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'listener-song';
        button.textContent = `${track.name} · ${format(track.durationMs)}`;
        button.setAttribute('aria-pressed', String(track.id === state.track?.id));
        button.disabled = !connected;
        button.onclick = () => { if (connected) room.send({ type: 'select-track', trackId: track.id }); };
        $('listener-tracks').appendChild(button);
      }
    }
    function render() {
      const sound = player.snapshot();
      window.ShareMusicTools?.update({ connected, state, sound });
      const current = elapsed(state, now());
      $('playing-screen').classList.toggle('is-paused', state.status !== 'running' || !connected);
      $('waiting-track').textContent = state.track?.name || 'Waiting for a song';
      $('waiting-status').textContent = state.status === 'buffering' ? 'Waiting for everyone to join and buffer audio…' : state.track ? 'Tap Play for everyone when ready.' : 'Waiting for uploaded songs.';
      $('playing-track').textContent = state.track?.name || 'ShareMusic';
      $('playing-duration').textContent = format(state.track?.durationMs || 0);
      $('playing-time').textContent = format(current);
      $('listener-progress-bar').style.width = `${state.track ? current / state.track.durationMs * 100 : 0}%`;
      $('join').disabled = sound.enabling || !connected || !state.track;
      const controllable = !!state.track;
      $('room-controls').classList.toggle('hidden', !sound.enabled);
      $('room-toggle').disabled = !connected || !sound.enabled || !controllable;
      $('room-toggle').textContent = state.status === 'paused' ? 'Resume for everyone' : ['idle', 'ended'].includes(state.status) ? 'Play for everyone' : 'Pause for everyone';
      for (const id of ['previous-track', 'next-track', 'shuffle-track']) $(id).disabled = !connected || tracks.length < 2;
      if (!sound.enabled) return show('join-screen');
      if (state.status === 'idle' || state.status === 'buffering') return show('waiting-screen');
      if (state.status === 'ended') return show('ended-screen');
      if (state.status === 'running' && state.startAt > now()) {
        $('countdown').textContent = Math.max(1, Math.ceil((state.startAt - now()) / 1000));
        return show('countdown-screen');
      }
      show('playing-screen');
      $('playing-status').textContent = !connected ? 'Audio paused while reconnecting…' : state.status === 'paused' ? 'Room playback is paused.' : sound.status === 'loading' ? 'Buffering audio…' : `Playing with the room · ${state.playbackRate}×`;
    }
    player = window.ShareMusicAudio({ audio: $('audio'), now, onChange(sound) {
      const payload = { type: 'listener:status', trackId: sound.trackId, joined: sound.enabled, ready: sound.ready, status: sound.status, bufferedMs: sound.bufferedMs, bufferPositionMs: sound.bufferPositionMs, bufferRequestId: sound.bufferRequestId };
      const key = JSON.stringify(payload);
      if (key !== lastReport && room?.send(payload)) lastReport = key;
      if (sound.message) $('join-status').textContent = sound.message;
      render();
    } });
    $('join').onclick = () => player.enable();
    $('room-toggle').onclick = () => {
      if (!connected || !player.snapshot().enabled || !state.track) return;
      room.send({ type: state.status === 'paused' ? 'resume' : ['idle', 'ended'].includes(state.status) ? 'start' : 'pause' });
    };
    for (const type of ['previous-track', 'next-track', 'shuffle-track']) $(type).onclick = () => { if (connected && tracks.length > 1) room.send({ type }); };
    room = window.ShareMusicRoom.connect({ role: 'listener', label: `Listener-${Math.random().toString(36).slice(2, 6)}`,
      onConnection(value) {
        connected = value; lastReport = '';
        $('reconnect').classList.toggle('hidden', value);
        player.setConnected(value); render(); renderTracks();
      },
      onMessage(message) {
        if (message.type === 'tracks') { tracks = message.tracks; renderTracks(); render(); return; }
        if (message.type !== 'state') return;
        state = message.state;
        $('join-status').textContent = state.track ? 'Tap Join to enable this device’s audio.' : 'Waiting for the host to choose a song.';
        player.setState(state); render(); renderTracks();
      },
      onClock() { player.refresh(); render(); }
    });
    setInterval(render, 250);
    let installPrompt;
    if (!(window.matchMedia('(display-mode: standalone)').matches || navigator.standalone)) {
      $('install').classList.remove('hidden');
      $('install').textContent = window.isSecureContext ? 'Install ShareMusic' : 'Add to Home screen';
    }
    $('install').onclick = async () => {
      if (installPrompt) { await installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; }
      else $('join-status').textContent = 'Use your browser’s menu or Share menu to add this page to your Home screen. Automatic installation requires HTTPS.';
    };
    window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; $('install').classList.remove('hidden'); });
    window.addEventListener('appinstalled', () => $('install').classList.add('hidden'));
    render();
  }
  return { start };
})();
window.LocalShareMusicFloor.start();
