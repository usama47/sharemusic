(() => {
  if (window.SHAREMUSIC_RUNTIME?.mode === 'local') { window.LocalShareMusicAdmin.start(); return; }
  const el = {
    loginPanel: document.querySelector('#login-panel'), dashboard: document.querySelector('#dashboard'), loginForm: document.querySelector('#login-form'), loginError: document.querySelector('#login-error'),
    logout: document.querySelector('#logout'), uploadDrop: document.querySelector('#upload-drop'), upload: document.querySelector('#upload'), uploadQueue: document.querySelector('#upload-queue'), tracks: document.querySelector('#tracks'), trackCount: document.querySelector('#track-count'), preview: document.querySelector('#preview'),
    trackName: document.querySelector('#track-name'), status: document.querySelector('#status'), clock: document.querySelector('#clock'), connection: document.querySelector('#connection'), progress: document.querySelector('#progress-bar'),
    start: document.querySelector('#start'), pause: document.querySelector('#pause'), stop: document.querySelector('#stop'), message: document.querySelector('#message'), deviceCount: document.querySelector('#device-count'), devices: document.querySelector('#devices')
  };
  const config = window.SHAREMUSIC_SUPABASE || {};
  if (!config.url || !config.anonKey) { el.loginError.textContent = 'Add your Supabase URL and anon key to public/js/supabase-config.js.'; return; }
  const supabase = window.supabase.createClient(config.url, config.anonKey);
  let channel;
  let tracks = [];
  let state = { status: 'idle', track: null, startAt: null, elapsedMs: 0 };

  async function request(action) { const result = await action; if (result.error) throw result.error; return result.data; }
  async function showDashboard() { el.loginPanel.classList.add('hidden'); el.dashboard.classList.remove('hidden'); await loadTracks(); await connectRoom(); }
  function fmt(ms) { const seconds = Math.max(0, Math.floor(ms / 1000)); return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; }
  function elapsed() { return state.status === 'paused' ? state.elapsedMs : state.startAt ? Math.max(0, Date.now() - state.startAt) : 0; }
  function render() {
    const duration = Number(state.track?.duration_ms || 0);
    const current = Math.min(duration || Infinity, elapsed());
    el.trackName.textContent = state.track?.name || 'No song selected';
    el.status.textContent = state.status === 'running' && state.startAt > Date.now() ? 'Starting…' : state.status[0].toUpperCase() + state.status.slice(1);
    el.clock.textContent = `${fmt(current)} / ${fmt(duration)}`;
    el.progress.style.width = duration ? `${Math.min(100, current / duration * 100)}%` : '0%';
    el.start.disabled = !state.track || !['idle', 'ended'].includes(state.status);
    el.pause.disabled = !['running', 'paused'].includes(state.status);
    el.pause.textContent = state.status === 'paused' ? 'Resume' : 'Pause';
    el.stop.disabled = !['counting', 'running', 'paused'].includes(state.status);
    if (state.status === 'running' && state.startAt > Date.now()) el.message.textContent = 'Starting for everyone in a moment…';
    else if (state.status === 'running') el.message.textContent = 'Everyone is listening to the same server-timed playback.';
    else if (state.status === 'paused') el.message.textContent = 'Playback is paused for everyone.';
    else el.message.textContent = state.track ? 'Ready to play for the room.' : 'Choose a song, then press Start.';
  }
  function applyRoom(row) {
    if (!row) return;
    const track = tracks.find(item => item.id === row.track_id) || null;
    state = { status: row.status, track, startAt: row.start_at ? new Date(row.start_at).getTime() : null, elapsedMs: row.paused_at_ms || 0 };
    render(); renderTracks();
  }
  async function connectRoom() {
    const roomId = config.roomId || 'main';
    const row = await request(supabase.from('rooms').select('*').eq('id', roomId).single());
    applyRoom(row);
    channel = supabase.channel(`room:${roomId}`, { config: { presence: { key: 'admin' } } });
    channel.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` }, payload => applyRoom(payload.new));
    channel.on('presence', { event: 'sync' }, () => renderDevices(channel.presenceState()));
    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'tracks' }, loadTracks);
    await channel.subscribe(async status => { if (status === 'SUBSCRIBED') { await channel.track({ role: 'admin', label: 'Admin' }); el.connection.textContent = 'Supabase connected'; } });
    setInterval(render, 250);
  }
  async function loadTracks() { try { tracks = await request(supabase.from('tracks').select('*').order('created_at', { ascending: false })); el.trackCount.textContent = `${tracks.length} ${tracks.length === 1 ? 'track' : 'tracks'}`; renderTracks(); render(); } catch (error) { el.message.textContent = error.message; } }
  function renderDevices(presence) {
    const listeners = Object.values(presence).flat().filter(item => item.role === 'listener');
    el.deviceCount.textContent = listeners.length;
    el.devices.innerHTML = listeners.length ? listeners.map(device => `<div class="device"><span class="dot dot-ok"></span><span>${escapeHtml(device.label || 'Listener')}</span><small>ready</small></div>`).join('') : '<p class="muted">No listeners yet.</p>';
  }
  function renderTracks() {
    el.tracks.innerHTML = tracks.length ? tracks.map(track => `<div class="track ${state.track?.id === track.id ? 'selected' : ''}"><button class="track-select" data-id="${track.id}"><span>${escapeHtml(track.name)}</span><small>${track.duration_ms ? fmt(track.duration_ms) : 'Duration loading'}</small></button><button class="delete-track" data-id="${track.id}" title="Delete">×</button></div>`).join('') : '<p class="muted">Upload an MP3 or another supported audio file.</p>';
    el.tracks.querySelectorAll('.track-select').forEach(button => button.addEventListener('click', () => selectTrack(button.dataset.id)));
    el.tracks.querySelectorAll('.delete-track').forEach(button => button.addEventListener('click', () => deleteTrack(button.dataset.id)));
  }
  async function selectTrack(id) {
    const track = tracks.find(item => item.id === id); if (!track) return;
    el.preview.src = track.public_url; el.preview.onloadedmetadata = async () => {
      try {
        if (state.status !== 'idle' && state.status !== 'ended') throw new Error('Stop playback before changing the track');
        await request(supabase.from('tracks').update({ duration_ms: Math.round(el.preview.duration * 1000) }).eq('id', id));
        await request(supabase.from('rooms').update({ track_id: id, updated_at: new Date().toISOString() }).eq('id', config.roomId || 'main'));
        await loadTracks();
      } catch (error) { el.message.textContent = error.message; }
    }; el.preview.load();
  }
  async function deleteTrack(id) {
    if (state.track?.id === id) { el.message.textContent = 'Stop playback and choose another track first.'; return; }
    const track = tracks.find(item => item.id === id); if (!track) return;
    try { await request(supabase.storage.from('tracks').remove([track.storage_path])); await request(supabase.from('tracks').delete().eq('id', id)); await loadTracks(); } catch (error) { el.message.textContent = error.message; }
  }
  function addUploadItem(file) {
    const item = document.createElement('div');
    item.className = 'upload-item';
    item.innerHTML = `<div class="upload-item-head"><span class="upload-item-name">${escapeHtml(file.name)}</span><span class="upload-item-status">Queued</span></div><div class="upload-meter"><div class="upload-meter-fill"></div></div>`;
    el.uploadQueue.appendChild(item);
    return { item, status: item.querySelector('.upload-item-status'), fill: item.querySelector('.upload-meter-fill') };
  }
  function uploadToStorage(file, storagePath, progress) {
    return new Promise(async (resolve, reject) => {
      const sessionResult = await supabase.auth.getSession();
      const token = sessionResult.data.session?.access_token;
      if (!token) { reject(new Error('Your admin session expired. Please sign in again.')); return; }
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${config.url}/storage/v1/object/tracks/${encodeURIComponent(storagePath)}`);
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.setRequestHeader('apikey', config.anonKey);
      xhr.setRequestHeader('Content-Type', file.type || 'audio/mpeg');
      xhr.upload.onprogress = event => { if (event.lengthComputable) { const percent = Math.round(event.loaded / event.total * 100); progress.fill.style.width = `${percent}%`; progress.status.textContent = `${percent}%`; } };
      xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`));
      xhr.onerror = () => reject(new Error('Network error during upload'));
      xhr.send(file);
    });
  }
  async function uploadTrack(file, progress) {
    const storagePath = `${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    try {
      progress.status.textContent = 'Uploading';
      await uploadToStorage(file, storagePath, progress);
      progress.status.textContent = 'Reading duration';
      const previewUrl = URL.createObjectURL(file);
      const durationMs = await new Promise((resolve, reject) => { const audio = new Audio(); audio.onloadedmetadata = () => { URL.revokeObjectURL(previewUrl); resolve(Math.round(audio.duration * 1000)); }; audio.onerror = () => { URL.revokeObjectURL(previewUrl); reject(new Error('Could not read audio duration')); }; audio.src = previewUrl; });
      const publicUrl = `${config.url}/storage/v1/object/public/tracks/${storagePath}`;
      await request(supabase.from('tracks').insert({ name: file.name, storage_path: storagePath, public_url: publicUrl, size_bytes: file.size, duration_ms: durationMs }));
      progress.item.classList.add('upload-item--done'); progress.status.textContent = 'Ready'; progress.fill.style.width = '100%';
    } catch (error) { progress.item.classList.add('upload-item--error'); progress.status.textContent = error.message; el.message.textContent = error.message; }
  }
  function escapeHtml(value) { return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); }
  async function mutateRoom(values) { try { await request(supabase.from('rooms').update({ ...values, updated_at: new Date().toISOString() }).eq('id', config.roomId || 'main')); } catch (error) { el.message.textContent = error.message; } }

  el.loginForm.addEventListener('submit', async event => { event.preventDefault(); el.loginError.textContent = ''; const { error } = await supabase.auth.signInWithPassword({ email: document.querySelector('#username').value, password: document.querySelector('#password').value }); if (error) el.loginError.textContent = error.message; else showDashboard(); });
  el.logout.addEventListener('click', async () => { await supabase.auth.signOut(); location.reload(); });
  async function queueFiles(fileList) { const files = [...fileList]; for (const file of files) await uploadTrack(file, addUploadItem(file)); await loadTracks(); }
  el.upload.addEventListener('change', () => { queueFiles(el.upload.files); el.upload.value = ''; });
  ['dragenter', 'dragover'].forEach(type => el.uploadDrop.addEventListener(type, event => { event.preventDefault(); el.uploadDrop.classList.add('is-dragging'); }));
  ['dragleave', 'drop'].forEach(type => el.uploadDrop.addEventListener(type, event => { event.preventDefault(); el.uploadDrop.classList.remove('is-dragging'); }));
  el.uploadDrop.addEventListener('drop', event => { if (event.dataTransfer.files.length) queueFiles(event.dataTransfer.files); });
  el.start.addEventListener('click', () => mutateRoom({ status: 'running', start_at: new Date(Date.now() + 3000).toISOString(), paused_at_ms: null }));
  el.pause.addEventListener('click', () => state.status === 'paused' ? mutateRoom({ status: 'running', start_at: new Date(Date.now() - state.elapsedMs).toISOString() }) : mutateRoom({ status: 'paused', paused_at_ms: elapsed() }));
  el.stop.addEventListener('click', () => mutateRoom({ status: 'idle', start_at: null, paused_at_ms: null }));
  supabase.auth.getSession().then(({ data }) => { if (data.session) showDashboard(); });
})();
