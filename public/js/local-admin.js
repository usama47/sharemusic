window.LocalShareMusicAdmin = (() => {
  let started = false;
  function start() {
    if (started) return;
    started = true;
    const $ = id => document.getElementById(id);
    const { format, elapsed } = window.ShareMusicRoom;
    const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    let room, connected = false, tracks = [], previewId = null;
    let state = { status: 'idle', track: null, startAt: null, positionMs: 0, playbackRate: 1 };
    let uploadChain = Promise.resolve();
    const error = message => { $('admin-error').textContent = message; };
    function send(message) { if (!room.send(message)) error('Disconnected. Wait for the room to reconnect.'); }
    function render() {
      const duration = state.track?.durationMs || 0;
      const current = elapsed(state, room?.now() ?? Date.now());
      const countdown = state.status === 'running' && state.startAt > room.now();
      $('track-name').textContent = state.track?.name || 'No song selected';
      $('status').textContent = countdown ? 'Starting…' : state.status[0].toUpperCase() + state.status.slice(1);
      $('clock').textContent = `${format(current)} / ${format(duration)}`;
      $('progress-bar').style.width = `${duration ? current / duration * 100 : 0}%`;
      $('seek').max = duration;
      if (document.activeElement !== $('seek')) $('seek').value = current;
      $('speed').value = String(state.playbackRate);
      $('start').disabled = !connected || !state.track || !['idle', 'ended'].includes(state.status);
      $('pause').disabled = !connected || !['running', 'paused'].includes(state.status);
      $('pause').textContent = state.status === 'paused' ? 'Resume' : 'Pause';
      $('stop').disabled = !connected || !['running', 'paused'].includes(state.status);
      $('seek').disabled = !connected || !state.track;
      $('speed').disabled = !connected;
      $('message').textContent = !connected ? 'Reconnecting to the room…' : countdown ? 'Playback starts after the countdown.' : state.status === 'running' ? 'Playing for the room.' : state.status === 'paused' ? 'Playback is paused.' : state.track ? 'Review listener readiness, then press Start.' : 'Upload an audio file to begin.';
      $('preview').hidden = !state.track;
    }
    function renderTracks() {
      $('track-count').textContent = `${tracks.length} ${tracks.length === 1 ? 'track' : 'tracks'}`;
      const active = ['running', 'paused'].includes(state.status);
      $('tracks').innerHTML = tracks.length ? tracks.map(track => `<div class="track ${state.track?.id === track.id ? 'selected' : ''}"><button class="track-select" data-id="${escapeHtml(track.id)}" ${!connected || active ? 'disabled' : ''}><span>${escapeHtml(track.name)}</span><small>${format(track.durationMs)}</small></button><button class="delete-track" data-id="${escapeHtml(track.id)}" ${active && state.track?.id === track.id ? 'disabled' : ''} title="Delete ${escapeHtml(track.name)}">×</button></div>`).join('') : '<p class="muted">Add audio files from this device.</p>';
      $('tracks').querySelectorAll('.track-select').forEach(button => button.onclick = () => send({ type: 'select-track', trackId: button.dataset.id }));
      $('tracks').querySelectorAll('.delete-track').forEach(button => button.onclick = async () => {
        try {
          const response = await fetch(`/local/tracks/${encodeURIComponent(button.dataset.id)}`, { method: 'DELETE' });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || 'Delete failed');
          error(''); await loadTracks();
        } catch (failure) { error(failure.message); }
      });
    }
    function applyState(next) {
      state = next;
      if (previewId !== (state.track?.id || null)) {
        $('preview').pause(); previewId = state.track?.id || null;
        if (state.track) $('preview').src = state.track.url;
        else $('preview').removeAttribute('src');
        $('preview').load();
      }
      // Preview is an explicit local audition, not an extra synchronized player.
      if (state.status === 'running') $('preview').pause();
      render(); renderTracks();
    }
    function renderDevices(message) {
      const ready = message.devices.filter(device => device.ready && device.trackId === state.track?.id).length;
      $('device-count').textContent = `${ready}/${message.count} ready`;
      $('devices').innerHTML = message.count ? message.devices.map(device => `<div class="device"><span class="dot ${device.ready ? 'dot-ok' : ''}"></span><span>${escapeHtml(device.label)}</span><small>${escapeHtml(device.status)}</small></div>`).join('') : '<p class="muted">No listeners connected.</p>';
    }
    async function loadTracks() {
      try {
        const response = await fetch('/local/tracks');
        if (!response.ok) throw new Error('Could not load the library');
        tracks = await response.json(); renderTracks();
      } catch (failure) { error(failure.message); }
    }
    function addUploadItem(file) {
      const item = document.createElement('div'); item.className = 'upload-item';
      item.innerHTML = `<div class="upload-item-head"><span class="upload-item-name">${escapeHtml(file.name)}</span><span class="upload-item-status">Queued</span></div><div class="upload-meter"><div class="upload-meter-fill"></div></div>`;
      $('upload-queue').appendChild(item);
      return { item, status: item.querySelector('.upload-item-status'), fill: item.querySelector('.upload-meter-fill') };
    }
    function duration(file) {
      return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file), audio = new Audio();
        const timer = setTimeout(() => finish(new Error('Timed out reading audio duration')), 15000);
        function finish(failure) {
          clearTimeout(timer); audio.onloadedmetadata = null; audio.onerror = null;
          const ms = Math.round(audio.duration * 1000);
          audio.removeAttribute('src'); audio.load(); URL.revokeObjectURL(url);
          if (failure) reject(failure);
          else if (!Number.isFinite(ms) || ms <= 0) reject(new Error('Audio needs a finite positive duration'));
          else resolve(ms);
        }
        audio.preload = 'metadata';
        audio.onloadedmetadata = () => finish();
        audio.onerror = () => finish(new Error('This browser could not read the audio file'));
        audio.src = url;
      });
    }
    async function uploadFile(file, progress) {
      if (!/\.(mp3|m4a|ogg|oga|wav|webm)$/i.test(file.name)) throw new Error('Unsupported file extension');
      if (file.size > 150 * 1024 * 1024) throw new Error('Files must be 150 MB or smaller');
      const durationMs = await duration(file);
      return new Promise((resolve, reject) => {
        const body = new FormData(); body.append('file', file); body.append('durationMs', durationMs);
        const xhr = new XMLHttpRequest(); xhr.open('POST', '/local/tracks'); xhr.timeout = 300000;
        xhr.upload.onprogress = event => { if (event.lengthComputable) { const percent = Math.round(event.loaded / event.total * 100); progress.fill.style.width = `${percent}%`; progress.status.textContent = `${percent}%`; } };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) return resolve();
          let message = `Upload failed (${xhr.status})`;
          try { message = JSON.parse(xhr.responseText).error || message; } catch (_) {}
          reject(new Error(message));
        };
        xhr.onerror = () => reject(new Error('Upload connection failed'));
        xhr.ontimeout = () => reject(new Error('Upload timed out'));
        xhr.send(body);
      });
    }
    function queueFiles(fileList) {
      for (const file of [...fileList]) {
        const progress = addUploadItem(file);
        uploadChain = uploadChain.then(async () => {
          try { progress.status.textContent = 'Reading audio…'; await uploadFile(file, progress); progress.item.classList.add('upload-item--done'); progress.status.textContent = 'Ready'; progress.fill.style.width = '100%'; }
          catch (failure) { progress.item.classList.add('upload-item--error'); progress.status.textContent = failure.message; }
        });
      }
      uploadChain.then(loadTracks);
    }
    room = window.ShareMusicRoom.connect({ role: 'admin', label: 'Dashboard',
      onConnection(value) { connected = value; $('connection').textContent = value ? 'Room connected' : 'Reconnecting…'; render(); renderTracks(); if (value) error(''); },
      onMessage(message) {
        if (message.type === 'state') applyState(message.state);
        if (message.type === 'tracks') { tracks = message.tracks; renderTracks(); }
        if (message.type === 'devices') renderDevices(message);
      }, onClock: render
    });
    $('start').onclick = () => { $('preview').pause(); send({ type: 'start' }); };
    $('pause').onclick = () => send({ type: state.status === 'paused' ? 'resume' : 'pause' });
    $('stop').onclick = () => send({ type: 'stop' });
    $('seek').onchange = () => send({ type: 'seek', positionMs: Number($('seek').value) });
    $('speed').onchange = () => send({ type: 'speed', playbackRate: Number($('speed').value) });
    $('upload').onchange = () => { queueFiles($('upload').files); $('upload').value = ''; };
    for (const type of ['dragenter', 'dragover']) $('upload-drop').addEventListener(type, event => { event.preventDefault(); $('upload-drop').classList.add('is-dragging'); });
    for (const type of ['dragleave', 'drop']) $('upload-drop').addEventListener(type, event => { event.preventDefault(); $('upload-drop').classList.remove('is-dragging'); });
    $('upload-drop').addEventListener('drop', event => { if (event.dataTransfer.files.length) queueFiles(event.dataTransfer.files); });
    $('preview').addEventListener('play', () => { if (state.status === 'running') { $('preview').pause(); error('Stop or pause the room before previewing audio.'); } });
    $('preview').addEventListener('error', () => error('This browser could not load the preview.'));
    setInterval(render, 250); loadTracks(); render();
  }
  return { start };
})();
window.LocalShareMusicAdmin.start();
