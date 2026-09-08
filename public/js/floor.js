(() => {
  const el = { join: document.querySelector('#join'), joinScreen: document.querySelector('#join-screen'), waiting: document.querySelector('#waiting-screen'), countdown: document.querySelector('#countdown-screen'), playing: document.querySelector('#playing-screen'), ended: document.querySelector('#ended-screen'), joinStatus: document.querySelector('#join-status'), waitingTrack: document.querySelector('#waiting-track'), waitingStatus: document.querySelector('#waiting-status'), playingTrack: document.querySelector('#playing-track'), playingTime: document.querySelector('#playing-time'), audio: document.querySelector('#audio'), reconnect: document.querySelector('#reconnect') };
  const socket = io({ transports: ['websocket', 'polling'] });
  const clock = new ClockSync(socket);
  let state = { status: 'idle', track: null, startAt: null, elapsedMs: 0 };
  let joined = false;
  let frame = 0;
  let lastPlayAttempt = 0;

  function show(screen) { [el.joinScreen, el.waiting, el.countdown, el.playing, el.ended].forEach(item => item.classList.toggle('hidden', item !== screen)); }
  function fmt(ms) { const seconds = Math.max(0, Math.floor(ms / 1000)); return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; }
  function elapsed() { return state.status === 'paused' ? state.elapsedMs : state.startAt ? Math.max(0, clock.now() - state.startAt) : 0; }
  function setTrack(track) {
    if (!track || el.audio.src.endsWith(track.url)) return;
    el.audio.src = new URL(track.url, location.href).href; el.audio.load();
  }
  function render() {
    if (state.track) setTrack(state.track);
    el.waitingTrack.textContent = state.track ? state.track.name : 'The host has not selected a song yet.';
    if (state.status === 'idle') { show(joined ? el.waiting : el.joinScreen); return; }
    if (state.status === 'ended') { show(el.ended); stopLoop(); return; }
    if (state.status === 'counting') { show(el.countdown); const remain = Math.max(0, state.startAt - clock.now()); el.countdown.textContent = Math.max(1, Math.ceil(remain / 1000)); startLoop(); return; }
    show(el.playing); el.playingTrack.textContent = state.track?.name || 'ShareMusic'; startLoop();
  }
  async function syncAudio() {
    if (!joined || !state.track || !['counting', 'running', 'paused'].includes(state.status)) return;
    const expected = state.status === 'counting' ? 0 : elapsed() / 1000;
    if (state.status === 'paused') { el.audio.pause(); return; }
    if (Math.abs(el.audio.currentTime - expected) > 0.35) el.audio.currentTime = Math.max(0, expected);
    if (el.audio.paused && performance.now() - lastPlayAttempt > 500) { lastPlayAttempt = performance.now(); try { await el.audio.play(); } catch (_) { el.joinStatus.textContent = 'Tap Join again to allow audio playback.'; } }
    const difference = expected - el.audio.currentTime;
    el.audio.playbackRate = Math.abs(difference) > 0.08 ? (difference > 0 ? 1.02 : 0.98) : 1;
  }
  function startLoop() { if (frame) return; const tick = () => { frame = requestAnimationFrame(tick); const current = elapsed(); el.playingTime.textContent = fmt(current); if (state.status === 'counting') { const remain = Math.max(0, state.startAt - clock.now()); el.countdown.textContent = Math.max(1, Math.ceil(remain / 1000)); } syncAudio(); }; frame = requestAnimationFrame(tick); }
  function stopLoop() { if (frame) cancelAnimationFrame(frame); frame = 0; }

  socket.on('connect', () => { el.joinStatus.textContent = joined ? 'Connected to the host.' : 'Connected. Tap Join to enable audio.'; clock.start(); if (joined) socket.emit('floor:ready', true); });
  socket.on('disconnect', () => { el.reconnect.classList.remove('hidden'); });
  socket.on('connect', () => el.reconnect.classList.add('hidden'));
  socket.on('player:state', next => { state = next; render(); });
  el.join.addEventListener('click', async () => { joined = true; try { el.audio.muted = true; await el.audio.play(); el.audio.pause(); el.audio.muted = false; } catch (_) {} socket.emit('floor:ready', true); el.joinStatus.textContent = 'Ready. Waiting for the host.'; render(); });
})();
