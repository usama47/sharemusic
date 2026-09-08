(() => {
  if (window.SHAREMUSIC_RUNTIME?.mode === 'local') { window.LocalShareMusicFloor.start(); return; }
  const el = { join: document.querySelector('#join'), install: document.querySelector('#install'), joinScreen: document.querySelector('#join-screen'), waiting: document.querySelector('#waiting-screen'), countdown: document.querySelector('#countdown-screen'), playing: document.querySelector('#playing-screen'), ended: document.querySelector('#ended-screen'), joinStatus: document.querySelector('#join-status'), waitingTrack: document.querySelector('#waiting-track'), waitingStatus: document.querySelector('#waiting-status'), playingTrack: document.querySelector('#playing-track'), playingTime: document.querySelector('#playing-time'), audio: document.querySelector('#audio'), reconnect: document.querySelector('#reconnect') };
  const config = window.SHAREMUSIC_SUPABASE || {};
  if (!config.url || !config.anonKey) { el.joinStatus.textContent = 'Supabase is not configured yet.'; return; }
  const supabase = window.supabase.createClient(config.url, config.anonKey);
  const roomId = config.roomId || 'main';
  let channel;
  let state = { status: 'idle', track: null, startAt: null, elapsedMs: 0 };
  let joined = false;
  let frame = 0;
  let lastPlayAttempt = 0;
  let installPrompt = null;

  function show(screen) { [el.joinScreen, el.waiting, el.countdown, el.playing, el.ended].forEach(item => item.classList.toggle('hidden', item !== screen)); }
  function fmt(ms) { const seconds = Math.max(0, Math.floor(ms / 1000)); return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; }
  function elapsed() { return state.status === 'paused' ? state.elapsedMs : state.startAt ? Math.max(0, Date.now() - state.startAt) : 0; }
  function setTrack(track) { if (!track || el.audio.src.endsWith(track.public_url)) return; el.audio.src = track.public_url; el.audio.load(); }
  async function applyRoom(row) {
    if (!row) return;
    let track = null;
    if (row.track_id) { const result = await supabase.from('tracks').select('*').eq('id', row.track_id).maybeSingle(); track = result.data; }
    state = { status: row.status, track, startAt: row.start_at ? new Date(row.start_at).getTime() : null, elapsedMs: row.paused_at_ms || 0 };
    if (state.track) setTrack(state.track);
    render();
  }
  function render() {
    el.waitingTrack.textContent = state.track ? state.track.name : 'The host has not selected a song yet.';
    if (state.status === 'idle') { show(joined ? el.waiting : el.joinScreen); return; }
    if (state.status === 'ended') { show(el.ended); stopLoop(); return; }
    if (state.status === 'running' && state.startAt > Date.now()) { show(el.countdown); startLoop(); return; }
    show(el.playing); el.playingTrack.textContent = state.track?.name || 'ShareMusic'; startLoop();
  }
  async function syncAudio() {
    if (!joined || !state.track || !['counting', 'running', 'paused'].includes(state.status)) return;
    const expected = state.startAt > Date.now() ? 0 : elapsed() / 1000;
    if (state.status === 'paused') { el.audio.pause(); return; }
    if (Math.abs(el.audio.currentTime - expected) > 0.35) el.audio.currentTime = Math.max(0, expected);
    if (el.audio.paused && performance.now() - lastPlayAttempt > 500) { lastPlayAttempt = performance.now(); try { await el.audio.play(); } catch (_) { el.joinStatus.textContent = 'Tap Join again to allow audio playback.'; } }
    const difference = expected - el.audio.currentTime;
    el.audio.playbackRate = Math.abs(difference) > 0.08 ? (difference > 0 ? 1.02 : 0.98) : 1;
  }
  function startLoop() { if (frame) return; const tick = () => { frame = requestAnimationFrame(tick); const current = elapsed(); el.playingTime.textContent = fmt(current); if (state.status === 'running' && state.startAt > Date.now()) { const remain = Math.max(0, state.startAt - Date.now()); el.countdown.textContent = Math.max(1, Math.ceil(remain / 1000)); render(); } syncAudio(); }; frame = requestAnimationFrame(tick); }
  function stopLoop() { if (frame) cancelAnimationFrame(frame); frame = 0; }
  async function connectRoom() {
    const result = await supabase.from('rooms').select('*').eq('id', roomId).single();
    if (!result.error) await applyRoom(result.data);
    channel = supabase.channel(`room:${roomId}`, { config: { presence: { key: `listener-${crypto.randomUUID()}` } } });
    channel.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` }, payload => applyRoom(payload.new));
    await channel.subscribe(async status => { if (status === 'SUBSCRIBED' && joined) await channel.track({ role: 'listener', label: `Mobile-${Math.random().toString(36).slice(2, 6)}` }); });
  }

  el.join.addEventListener('click', async () => { joined = true; try { el.audio.muted = true; await el.audio.play(); el.audio.pause(); el.audio.muted = false; } catch (_) {} if (!channel) await connectRoom(); await channel.track({ role: 'listener', label: `Mobile-${Math.random().toString(36).slice(2, 6)}` }); el.joinStatus.textContent = 'Ready. Waiting for the host.'; render(); });
  supabase.auth.getSession().then(() => connectRoom());
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; el.install.classList.remove('hidden'); });
  el.install.addEventListener('click', async () => { if (!installPrompt) return; installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; el.install.classList.add('hidden'); });
  window.addEventListener('appinstalled', () => { installPrompt = null; el.install.classList.add('hidden'); });
})();
