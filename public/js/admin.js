(() => {
  const el = {
    loginPanel: document.querySelector('#login-panel'), dashboard: document.querySelector('#dashboard'), loginForm: document.querySelector('#login-form'), loginError: document.querySelector('#login-error'),
    logout: document.querySelector('#logout'), upload: document.querySelector('#upload'), tracks: document.querySelector('#tracks'), preview: document.querySelector('#preview'),
    trackName: document.querySelector('#track-name'), status: document.querySelector('#status'), clock: document.querySelector('#clock'), connection: document.querySelector('#connection'), progress: document.querySelector('#progress-bar'),
    start: document.querySelector('#start'), pause: document.querySelector('#pause'), stop: document.querySelector('#stop'), message: document.querySelector('#message'), deviceCount: document.querySelector('#device-count'), devices: document.querySelector('#devices')
  };
  let socket;
  let clockSync;
  let tracks = [];
  let state = { status: 'idle', track: null, startAt: null, elapsedMs: 0 };

  async function request(url, options = {}) {
    const response = await fetch(url, { ...options, credentials: 'same-origin' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
  }
  function showDashboard() { el.loginPanel.classList.add('hidden'); el.dashboard.classList.remove('hidden'); connect(); loadTracks(); }
  function fmt(ms) { const seconds = Math.max(0, Math.floor(ms / 1000)); return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; }
  function elapsed() { return state.status === 'paused' ? state.elapsedMs : state.startAt ? Math.max(0, clockSync.now() - state.startAt) : 0; }
  function render() {
    const duration = Number(state.track?.durationMs || 0);
    const current = Math.min(duration || Infinity, elapsed());
    el.trackName.textContent = state.track?.name || 'No song selected';
    el.status.textContent = state.status === 'counting' ? 'Starting…' : state.status[0].toUpperCase() + state.status.slice(1);
    el.clock.textContent = `${fmt(current)} / ${fmt(duration)}`;
    el.progress.style.width = duration ? `${Math.min(100, current / duration * 100)}%` : '0%';
    el.start.disabled = !state.track || !['idle', 'ended'].includes(state.status);
    el.pause.disabled = !['running', 'paused'].includes(state.status);
    el.pause.textContent = state.status === 'paused' ? 'Resume' : 'Pause';
    el.stop.disabled = !['counting', 'running', 'paused'].includes(state.status);
    if (state.status === 'counting') el.message.textContent = 'Starting for everyone in a moment…';
    else if (state.status === 'running') el.message.textContent = 'Everyone is listening to the same server-timed playback.';
    else if (state.status === 'paused') el.message.textContent = 'Playback is paused for everyone.';
    else el.message.textContent = state.track ? 'Ready to play for the room.' : 'Choose a song, then press Start.';
  }
  function connect() {
    socket = io({ transports: ['websocket', 'polling'] });
    clockSync = new ClockSync(socket);
    socket.on('connect', () => { el.connection.textContent = 'Host connected'; socket.emit('register', { role: 'admin' }); clockSync.start(); });
    socket.on('disconnect', () => { el.connection.textContent = 'Host disconnected'; });
    socket.on('admin:auth-required', () => { el.connection.textContent = 'Login expired'; });
    socket.on('player:state', next => { state = next; render(); });
    socket.on('devices:update', payload => { el.deviceCount.textContent = payload.connected; el.devices.innerHTML = payload.devices.length ? payload.devices.map(device => `<div class="device"><span class="dot ${device.ready ? 'dot-ok' : ''}"></span><span>${escapeHtml(device.label)}</span><small>${device.offsetMs || 0}ms</small></div>`).join('') : '<p class="muted">No listeners yet.</p>'; });
    setInterval(render, 250);
  }
  async function loadTracks() { try { tracks = await request('/api/tracks'); renderTracks(); } catch (error) { el.message.textContent = error.message; } }
  function renderTracks() {
    el.tracks.innerHTML = tracks.length ? tracks.map(track => `<div class="track ${state.track?.id === track.id ? 'selected' : ''}"><button class="track-select" data-id="${track.id}"><span>${escapeHtml(track.name)}</span><small>${track.durationMs ? fmt(track.durationMs) : 'Duration loading'}</small></button><button class="delete-track" data-id="${track.id}" title="Delete">×</button></div>`).join('') : '<p class="muted">Upload an MP3 or another supported audio file.</p>';
    el.tracks.querySelectorAll('.track-select').forEach(button => button.addEventListener('click', () => selectTrack(button.dataset.id)));
    el.tracks.querySelectorAll('.delete-track').forEach(button => button.addEventListener('click', () => deleteTrack(button.dataset.id)));
  }
  function selectTrack(id) {
    const track = tracks.find(item => item.id === id); if (!track) return;
    el.preview.src = track.url; el.preview.onloadedmetadata = async () => {
      try { const data = await request('/api/player/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trackId: id, durationMs: el.preview.duration * 1000 }) }); state = data.state; renderTracks(); render(); }
      catch (error) { el.message.textContent = error.message; }
    }; el.preview.load();
  }
  async function deleteTrack(id) { try { await request(`/api/tracks/${id}`, { method: 'DELETE' }); tracks = tracks.filter(track => track.id !== id); renderTracks(); } catch (error) { el.message.textContent = error.message; } }
  function escapeHtml(value) { return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); }

  el.loginForm.addEventListener('submit', async event => { event.preventDefault(); el.loginError.textContent = ''; try { await request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: document.querySelector('#username').value, password: document.querySelector('#password').value }) }); showDashboard(); } catch (error) { el.loginError.textContent = error.message; } });
  el.logout.addEventListener('click', async () => { await request('/api/auth/logout', { method: 'POST' }); location.reload(); });
  el.upload.addEventListener('change', async () => { const file = el.upload.files[0]; if (!file) return; const body = new FormData(); body.append('file', file); try { const data = await request('/api/tracks', { method: 'POST', body }); tracks.push(data.track); renderTracks(); selectTrack(data.track.id); } catch (error) { el.message.textContent = error.message; } el.upload.value = ''; });
  el.start.addEventListener('click', () => socket.emit('admin:start'));
  el.pause.addEventListener('click', () => socket.emit(state.status === 'paused' ? 'admin:resume' : 'admin:pause'));
  el.stop.addEventListener('click', () => socket.emit('admin:stop'));
  request('/api/auth/session').then(data => { if (data.authenticated) showDashboard(); });
})();
