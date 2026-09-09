// The same synchronized player powers the dashboard and listener page.
window.ShareMusicAudio = ({ audio, now, onChange = () => {} }) => {
  let state = { status: 'idle', track: null, positionMs: 0, playbackRate: 1 };
  let connected = false, enabled = false, enabling = false, playPending = false;
  let trackId = null, generation = 0, startTimer, status = 'not joined', message = '';
  const current = () => window.ShareMusicRoom.elapsed(state, now());
  const snapshot = () => ({ enabled, enabling, trackId, status, message,
    ready: connected && enabled && audio.readyState >= 3 && !audio.error && ['ready', 'playing', 'paused'].includes(status) });
  let lastNotice = '';
  const notify = () => {
    const sound = snapshot(), key = JSON.stringify(sound);
    if (key !== lastNotice) { lastNotice = key; onChange(sound); }
  };
  function seek(seconds, force = false) {
    if (audio.readyState < 1) return;
    // Correct perceptible drift promptly; do not let devices diverge by 350 ms.
    // Only explicit state changes force small seeks, avoiding canplay/seek loops.
    if (!audio.seeking && Math.abs(audio.currentTime - seconds) > (force ? 0.005 : 0.08)) {
      try { audio.currentTime = seconds; } catch (_) { /* Retry after metadata loads. */ }
    }
  }
  async function sync(force = false) {
    if (enabling) return;
    const seconds = current() / 1000;
    const shouldPlay = connected && enabled && state.track && state.status === 'running' && state.startAt <= now() && current() < state.track.durationMs;
    if (!shouldPlay) {
      audio.pause(); seek(seconds, force);
      if (enabled) status = !connected ? 'loading' : state.status === 'ended' ? 'ended' : state.status === 'paused' ? 'paused' : audio.readyState >= 3 ? 'ready' : 'loading';
      notify(); return;
    }
    seek(seconds, force);
    const difference = seconds - audio.currentTime;
    const correction = Math.abs(difference) > 0.012 ? Math.max(-0.03, Math.min(0.03, difference * 0.5)) : 0;
    audio.playbackRate = state.playbackRate * (1 + correction);
    if (!audio.paused) status = audio.readyState >= 3 ? 'playing' : 'loading';
    if (audio.paused && !playPending && audio.readyState >= 2) {
      playPending = true;
      const attempt = generation;
      try {
        await audio.play();
        if (attempt !== generation || !connected || !enabled || state.status !== 'running' || state.startAt > now()) audio.pause();
        else status = 'playing';
      } catch (error) {
        if (attempt !== generation || error.name === 'AbortError') return;
        enabled = false; status = error.name === 'NotAllowedError' ? 'blocked' : 'error';
        message = 'Audio could not start. Enable audio on this device to try again.';
      } finally { playPending = false; notify(); }
    }
    notify();
  }
  function schedule() {
    clearTimeout(startTimer);
    if (connected && state.status === 'running' && state.startAt > now()) startTimer = setTimeout(() => sync(true), state.startAt - now());
  }
  function setState(next) {
    generation++; state = next;
    if (enabling) audio.pause();
    if (trackId !== (state.track?.id || null)) {
      audio.pause(); trackId = state.track?.id || null; status = 'loading'; message = '';
      if (state.track) audio.src = state.track.url;
      else audio.removeAttribute('src');
      audio.load();
    }
    sync(true); schedule();
  }
  async function enable() {
    if (!connected || !state.track || enabling) return false;
    if (enabled) return true;
    const attempt = generation;
    enabling = true; message = ''; notify();
    let timeout;
    try {
      // Called directly from Start/Resume/Enable/Join gestures to unlock mobile audio.
      audio.muted = true;
      if (audio.error) audio.load();
      await Promise.race([audio.play(), new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Audio enable timed out')), 5000); })]);
      if (attempt === generation) { enabled = true; status = 'ready'; }
    } catch (_) {
      enabled = false; status = 'blocked'; message = 'Audio was blocked or could not load. Enable audio to try again.';
    } finally {
      clearTimeout(timeout); audio.pause(); audio.muted = false; enabling = false;
      sync(true); notify();
    }
    return enabled;
  }
  for (const event of ['loadedmetadata', 'canplay', 'playing', 'waiting', 'stalled', 'error', 'ended']) audio.addEventListener(event, () => {
    status = event === 'error' ? 'error' : event === 'ended' ? 'ended' : event === 'playing' ? 'playing' : ['waiting', 'stalled'].includes(event) ? 'loading' : enabled ? 'ready' : 'not joined';
    if (event === 'error') { enabled = false; message = 'This audio could not be loaded or decoded. Choose another file or retry audio.'; }
    // Stop also wins if a delayed native play event arrives after an enable timeout.
    if (event === 'playing' && !enabling && (!enabled || !connected || state.status !== 'running' || state.startAt > now())) audio.pause();
    if (event === 'loadedmetadata') sync(true);
    else if (event === 'canplay') sync();
    notify();
  });
  function refresh(force = false) { sync(force); schedule(); }
  // UI rendering stays at 250 ms; media alignment needs a finer foreground loop.
  setInterval(() => sync(), 50);
  document.addEventListener('visibilitychange', () => refresh(true));
  window.addEventListener('pageshow', () => refresh(true));
  return { snapshot, enable, setState, refresh,
    setConnected(value) {
      connected = value;
      if (!value) { generation++; audio.pause(); clearTimeout(startTimer); }
      sync(true); schedule(); notify();
    }
  };
};
