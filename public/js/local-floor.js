window.LocalShareMusicFloor = (() => {
  let started = false;
  function start() {
    if (started) return;
    started = true;
    const $ = id => document.getElementById(id);
    const screens = ['join-screen', 'waiting-screen', 'countdown-screen', 'playing-screen', 'ended-screen'];
    const show = id => screens.forEach(screen => $(screen).classList.toggle('hidden', screen !== id));
    const { format, elapsed } = window.ShareMusicRoom;
    let room, player, connected = false, lastReport = '';
    let state = { status: 'idle', track: null, positionMs: 0, playbackRate: 1 };
    const now = () => room?.now() ?? Date.now();
    function render() {
      const sound = player.snapshot();
      const current = elapsed(state, now());
      $('playing-screen').classList.toggle('is-paused', state.status !== 'running' || !connected);
      $('waiting-track').textContent = state.track?.name || 'Waiting for a song';
      $('waiting-status').textContent = state.track ? 'The host will start playback soon.' : 'The host will choose a song soon.';
      $('playing-track').textContent = state.track?.name || 'ShareMusic';
      $('playing-duration').textContent = format(state.track?.durationMs || 0);
      $('playing-time').textContent = format(current);
      $('listener-progress-bar').style.width = `${state.track ? current / state.track.durationMs * 100 : 0}%`;
      $('join').disabled = sound.enabling || !connected || !state.track;
      const controllable = ['running', 'paused'].includes(state.status);
      $('room-controls').classList.toggle('hidden', !sound.enabled || !controllable);
      $('room-toggle').disabled = !connected || !sound.enabled || !controllable;
      $('room-toggle').textContent = state.status === 'paused' ? 'Resume for everyone' : 'Pause for everyone';
      if (!sound.enabled) return show('join-screen');
      if (state.status === 'idle') return show('waiting-screen');
      if (state.status === 'ended') return show('ended-screen');
      if (state.status === 'running' && state.startAt > now()) {
        $('countdown').textContent = Math.max(1, Math.ceil((state.startAt - now()) / 1000));
        return show('countdown-screen');
      }
      show('playing-screen');
      $('playing-status').textContent = !connected ? 'Audio paused while reconnecting…' : state.status === 'paused' ? 'Room playback is paused.' : sound.status === 'loading' ? 'Buffering audio…' : `Playing with the room · ${state.playbackRate}×`;
    }
    player = window.ShareMusicAudio({ audio: $('audio'), now, onChange(sound) {
      const payload = { type: 'listener:status', trackId: sound.trackId, joined: sound.enabled, ready: sound.ready, status: sound.status };
      const key = JSON.stringify(payload);
      if (key !== lastReport && room?.send(payload)) lastReport = key;
      if (sound.message) $('join-status').textContent = sound.message;
      render();
    } });
    $('join').onclick = () => player.enable();
    $('room-toggle').onclick = () => {
      if (!connected || !player.snapshot().enabled || !['running', 'paused'].includes(state.status)) return;
      room.send({ type: state.status === 'paused' ? 'resume' : 'pause' });
    };
    room = window.ShareMusicRoom.connect({ role: 'listener', label: `Listener-${Math.random().toString(36).slice(2, 6)}`,
      onConnection(value) {
        connected = value; lastReport = '';
        $('reconnect').classList.toggle('hidden', value);
        player.setConnected(value); render();
      },
      onMessage(message) {
        if (message.type !== 'state') return;
        state = message.state;
        $('join-status').textContent = state.track ? 'Tap Join to enable this device’s audio.' : 'Waiting for the host to choose a song.';
        player.setState(state); render();
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
