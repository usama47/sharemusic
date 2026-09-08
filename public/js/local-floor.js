window.LocalShareMusicFloor = (() => {
  let started = false;
  function start() {
    if (started) return;
    started = true;
    const $ = id => document.getElementById(id);
    const audio = $('audio');
    const screens = ['join-screen', 'waiting-screen', 'countdown-screen', 'playing-screen', 'ended-screen'];
    const show = id => screens.forEach(screen => $(screen).classList.toggle('hidden', screen !== id));
    const { format, elapsed } = window.ShareMusicRoom;
    let room, connected = false, joined = false, state = { status: 'idle', track: null, positionMs: 0, playbackRate: 1 };
    let trackId = null, startTimer, playPending = false, enabling = false, generation = 0, lastReport = '';
    let mediaStatus = 'not joined';
    const now = () => room?.now() ?? Date.now();
    const current = () => elapsed(state, now());
    function report() {
      const payload = { type: 'listener:status', trackId, joined, ready: connected && joined && audio.readyState >= 3 && !audio.error && ['ready', 'playing', 'paused'].includes(mediaStatus), status: mediaStatus };
      const key = JSON.stringify(payload);
      if (key !== lastReport && room?.send(payload)) lastReport = key;
    }
    function render() {
      $('waiting-track').textContent = state.track?.name || 'Waiting for a song';
      $('waiting-status').textContent = state.track ? 'The host will start playback soon.' : 'The host will choose a song soon.';
      $('playing-track').textContent = state.track?.name || 'ShareMusic';
      $('playing-duration').textContent = format(state.track?.durationMs || 0);
      $('playing-time').textContent = format(current());
      $('listener-progress-bar').style.width = `${state.track ? current() / state.track.durationMs * 100 : 0}%`;
      $('join').disabled = enabling || !connected || !state.track;
      if (!joined) return show('join-screen');
      if (state.status === 'idle') return show('waiting-screen');
      if (state.status === 'ended') return show('ended-screen');
      if (state.status === 'running' && state.startAt > now()) {
        $('countdown').textContent = Math.max(1, Math.ceil((state.startAt - now()) / 1000));
        return show('countdown-screen');
      }
      show('playing-screen');
      $('playing-status').textContent = state.status === 'paused' ? 'Paused by the host.' : mediaStatus === 'loading' ? 'Buffering audio…' : `Playing with the room · ${state.playbackRate}×`;
    }
    function seek(seconds, force = false) {
      if (audio.readyState < 1) return;
      if (Math.abs(audio.currentTime - seconds) > (force ? 0.03 : 0.35)) {
        try { audio.currentTime = seconds; } catch (_) { /* Retry when media metadata arrives. */ }
      }
    }
    async function syncAudio(force = false) {
      if (enabling) return;
      const seconds = current() / 1000;
      const shouldPlay = connected && joined && state.track && state.status === 'running' && state.startAt <= now() && current() < state.track.durationMs;
      if (!shouldPlay) {
        audio.pause(); seek(seconds, force);
        mediaStatus = !joined ? mediaStatus : state.status === 'ended' ? 'ended' : state.status === 'paused' ? 'paused' : audio.readyState >= 3 ? 'ready' : 'loading';
        report(); return;
      }
      seek(seconds, force);
      const difference = seconds - audio.currentTime;
      audio.playbackRate = state.playbackRate * (Math.abs(difference) > 0.08 ? difference > 0 ? 1.02 : 0.98 : 1);
      if (audio.paused && !playPending && audio.readyState >= 2) {
        playPending = true;
        const attempt = generation;
        try {
          await audio.play();
          if (attempt !== generation || !connected || !joined || state.status !== 'running' || state.startAt > now()) audio.pause();
          else mediaStatus = 'playing';
        } catch (error) {
          if (attempt !== generation || error.name === 'AbortError') return;
          joined = false; mediaStatus = error.name === 'NotAllowedError' ? 'blocked' : 'error';
          $('join-status').textContent = 'Audio could not start. Tap Join to try again.';
        } finally { playPending = false; report(); render(); }
      }
      report();
    }
    function schedule() {
      clearTimeout(startTimer);
      if (connected && state.status === 'running' && state.startAt > now()) startTimer = setTimeout(() => { syncAudio(true); render(); }, state.startAt - now());
    }
    function applyState(next) {
      generation++;
      state = next;
      // A pending gesture play must not defer a newly received pause or stop.
      if (enabling) audio.pause();
      if (trackId !== (state.track?.id || null)) {
        audio.pause(); trackId = state.track?.id || null; mediaStatus = 'loading';
        if (state.track) audio.src = state.track.url;
        else audio.removeAttribute('src');
        audio.load();
      }
      if (!joined && mediaStatus !== 'blocked' && mediaStatus !== 'error') $('join-status').textContent = state.track ? 'Tap Join to enable this device’s audio.' : 'Waiting for the host to choose a song.';
      // Apply commands immediately, including while animation frames are suspended.
      syncAudio(true); schedule(); render();
    }
    for (const event of ['loadedmetadata', 'canplay', 'playing', 'waiting', 'stalled', 'error', 'ended']) audio.addEventListener(event, () => {
      mediaStatus = event === 'error' ? 'error' : event === 'ended' ? 'ended' : event === 'playing' ? 'playing' : ['waiting', 'stalled'].includes(event) ? 'loading' : joined ? 'ready' : 'not joined';
      if (event === 'error') { joined = false; $('join-status').textContent = 'This audio could not be loaded or decoded. Ask the host to choose another file.'; }
      report();
      if (event === 'loadedmetadata' || event === 'canplay') syncAudio(true);
      render();
    });
    $('join').onclick = async () => {
      if (!connected || !state.track || enabling) return;
      const attempt = generation;
      enabling = true; render();
      try {
        audio.muted = true;
        await audio.play();
        if (attempt === generation) { joined = true; mediaStatus = 'ready'; }
      } catch (_) {
        joined = false; mediaStatus = 'blocked';
        $('join-status').textContent = 'Audio was blocked. Tap Join to try again.';
      } finally {
        audio.pause(); audio.muted = false; enabling = false;
        syncAudio(true); report(); render();
      }
    };
    room = window.ShareMusicRoom.connect({ role: 'listener', label: `Listener-${Math.random().toString(36).slice(2, 6)}`,
      onConnection(value) {
        connected = value; lastReport = '';
        $('reconnect').classList.toggle('hidden', value);
        if (!value) { generation++; audio.pause(); clearTimeout(startTimer); }
        report(); render();
      },
      onMessage(message) { if (message.type === 'state') applyState(message.state); },
      onClock() { syncAudio(); schedule(); render(); }
    });
    // This loop is independent of painting. OS suspension can still stop JavaScript.
    setInterval(() => { syncAudio(); render(); }, 250);
    document.addEventListener('visibilitychange', () => { syncAudio(true); schedule(); render(); });
    window.addEventListener('pageshow', () => { syncAudio(true); schedule(); });
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
