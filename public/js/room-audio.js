// The same synchronized player powers the dashboard and listener page.
window.ShareMusicAudio = ({ audio, now, onChange = () => {} }) => {
  let state = { status: 'idle', track: null, positionMs: 0, playbackRate: 1 };
  let connected = false, enabled = false, enabling = false, playPending = false;
  let trackId = null, generation = 0, startTimer, status = 'not joined', message = '';
  let lastHardSeek = -Infinity, largeDriftSince = null, pendingAlignment = false;
  const current = () => window.ShareMusicRoom.elapsed(state, now());
  function bufferedMs() {
    const position = state.status === 'running' ? audio.currentTime : (state.positionMs || 0) / 1000;
    const remaining = Math.max(0, (state.track?.durationMs || 0) - position * 1000);
    for (let i = 0; i < (audio.buffered?.length || 0); i++) {
      if (audio.buffered.start(i) <= position && audio.buffered.end(i) >= position) {
        const ahead = Math.min(remaining, (audio.buffered.end(i) - position) * 1000);
        return ahead >= remaining - 50 ? Math.ceil(remaining) : Math.floor(ahead / 1000) * 1000;
      }
    }
    return 0;
  }
  const snapshot = () => ({ enabled, enabling, trackId, status, message, bufferedMs: bufferedMs(),
    bufferPositionMs: state.positionMs || 0, bufferRequestId: state.bufferRequestId || 0,
    ready: connected && enabled && audio.readyState >= 3 && !audio.error && ['ready', 'playing', 'paused'].includes(status) });
  let lastNotice = '';
  const notify = () => {
    const sound = snapshot(), key = JSON.stringify(sound);
    if (key !== lastNotice) { lastNotice = key; onChange(sound); }
  };
  function seek(seconds) {
    if (audio.readyState < 1 || audio.seeking) return false;
    if (Math.abs(audio.currentTime - seconds) <= 0.05) return true;
    try {
      audio.currentTime = seconds;
      lastHardSeek = performance.now(); largeDriftSince = null;
      return true;
    } catch (_) { return false; /* Retry explicit alignment after metadata loads. */ }
  }
  function bufferedAt(seconds) {
    // A recovery seek must not discard playable audio for an unbuffered target.
    const end = Math.min(seconds + 0.5, state.track.durationMs / 1000);
    for (let i = 0; i < audio.buffered.length; i++) {
      if (audio.buffered.start(i) <= seconds && audio.buffered.end(i) >= end) return true;
    }
    return false;
  }
  function setRate(rate) {
    if (Math.abs(audio.playbackRate - rate) > 0.001) audio.playbackRate = rate;
  }
  async function sync(force = false) {
    if (force) pendingAlignment = true;
    if (enabling) return;
    const seconds = current() / 1000;
    const shouldPlay = connected && enabled && state.track && state.status === 'running' && state.startAt <= now() && current() < state.track.durationMs;
    if (!shouldPlay) {
      if (!audio.paused) audio.pause();
      if (pendingAlignment && seek(seconds)) pendingAlignment = false;
      largeDriftSince = null; setRate(state.playbackRate);
      if (enabled) status = !connected ? 'loading' : state.status === 'ended' ? 'ended' : state.status === 'paused' ? 'paused' : audio.readyState >= 3 ? 'ready' : 'loading';
      notify(); return;
    }
    // Explicit room changes and joining align once; routine checks never force it.
    if (pendingAlignment && seek(seconds)) pendingAlignment = false;
    const difference = seconds - audio.currentTime;
    const stable = !audio.seeking && audio.readyState >= 3 && !playPending;
    const tick = performance.now();
    if (stable && !audio.paused && Math.abs(difference) > 1.5) {
      if (largeDriftSince === null) largeDriftSince = tick;
      if (tick - largeDriftSince >= 2000 && tick - lastHardSeek >= 8000 && bufferedAt(seconds)) seek(seconds);
    } else largeDriftSince = null;
    // Ignore clock/media precision noise. Correct gently without pausing or seeking.
    const tight = state.syncMode === 'tight';
    const limit = tight ? 0.03 : 0.02;
    const correction = stable && !audio.seeking && Math.abs(difference) > (tight ? 0.04 : 0.08) ? Math.max(-limit, Math.min(limit, difference * (tight ? 0.08 : 0.04))) : 0;
    setRate(state.playbackRate * (1 + correction));
    if (!audio.paused) status = audio.readyState >= 3 ? 'playing' : 'loading';
    if (audio.paused && !audio.seeking && !playPending && audio.readyState >= 2) {
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
    const anchor = value => JSON.stringify([value.status, value.track?.id, value.startAt, value.positionMs, value.playbackRate]);
    const changed = anchor(state) !== anchor(next);
    if (changed) generation++;
    state = next;
    if (enabling && changed) audio.pause();
    if (trackId !== (state.track?.id || null)) {
      lastHardSeek = -Infinity; largeDriftSince = null;
      audio.pause(); trackId = state.track?.id || null; status = 'loading'; message = '';
      if (state.track) audio.src = state.track.url;
      else audio.removeAttribute('src');
      audio.load();
    }
    sync(changed); schedule();
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
  for (const event of ['loadedmetadata', 'canplay', 'seeked', 'playing', 'waiting', 'stalled', 'error', 'ended']) audio.addEventListener(event, () => {
    status = event === 'error' ? 'error' : event === 'ended' ? 'ended' : event === 'playing' ? 'playing' : ['waiting', 'stalled'].includes(event) ? 'loading' : enabled ? 'ready' : 'not joined';
    if (event === 'error') { enabled = false; message = 'This audio could not be loaded or decoded. Choose another file or retry audio.'; }
    // Stop also wins if a delayed native play event arrives after an enable timeout.
    if (event === 'playing' && !enabling && (!enabled || !connected || state.status !== 'running' || state.startAt > now())) audio.pause();
    if (event === 'loadedmetadata') sync(true);
    else if (event === 'canplay' || event === 'seeked') sync();
    notify();
  });
  function refresh(force = false) { sync(force); schedule(); }
  // The scheduled start timer stays precise; steady playback needs no seek loop.
  setInterval(() => sync(), 250);
  document.addEventListener('visibilitychange', () => refresh());
  window.addEventListener('pageshow', () => refresh());
  return { snapshot, enable, setState, refresh,
    setConnected(value) {
      connected = value;
      if (!value) { generation++; audio.pause(); clearTimeout(startTimer); }
      sync(true); schedule(); notify();
    }
  };
};
