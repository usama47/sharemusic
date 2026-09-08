(() => {
  const el = {
    connDot: document.getElementById('admin-conn-dot'),
    connLabel: document.getElementById('admin-conn-label'),
    statConnected: document.getElementById('stat-connected'),
    statReady: document.getElementById('stat-ready'),
    statSynced: document.getElementById('stat-synced'),
    statOffline: document.getElementById('stat-offline'),
    deviceList: document.getElementById('device-list'),
    btnStart: document.getElementById('btn-start'),
    btnPause: document.getElementById('btn-pause'),
    btnStop: document.getElementById('btn-stop'),
    btnRestart: document.getElementById('btn-restart'),
    clockReadout: document.getElementById('clock-readout'),
    statusPill: document.getElementById('status-pill'),
    currentDisplayLabel: document.getElementById('current-display-label'),
    prevFlagMount: document.getElementById('prev-flag-mount'),
    prevFlagImage: document.getElementById('prev-flag-image'),
    prevPhoto: document.getElementById('prev-photo'),
    prevName: document.getElementById('prev-name'),
    prevTitle: document.getElementById('prev-title'),
    uploadDrop: document.getElementById('upload-drop'),
    fileInput: document.getElementById('file-input'),
    uploadProgress: document.getElementById('upload-progress'),
    mediaList: document.getElementById('media-list'),
    timelineRows: document.getElementById('timeline-rows'),
    settingCountdown: document.getElementById('setting-countdown'),
    settingFinal: document.getElementById('setting-final'),
    btnAddPhoto: document.getElementById('btn-add-photo'),
    btnSaveTimeline: document.getElementById('btn-save-timeline'),
    timelineSaveNote: document.getElementById('timeline-save-note'),
    sourcesList: document.getElementById('sources-list')
  };

  const socket = io();
  const clock = new ClockSync(socket);
  let timeline = null;
  let mediaLibrary = [];
  let status = 'idle';
  let startAt = null;
  let lastPhotoId = null;

  socket.on('connect', () => {
    el.connDot.className = 'dot dot--ok';
    el.connLabel.textContent = 'Connected';
    socket.emit('register', { role: 'admin' });
    clock.start();
  });
  socket.on('disconnect', () => {
    el.connDot.className = 'dot dot--bad';
    el.connLabel.textContent = 'Disconnected — retrying…';
  });

  socket.on('presentation:state', (state) => {
    timeline = state.timeline;
    status = state.status;
    startAt = state.startAt;
    if (timeline) timeline.pausedAtMs = Number(state.elapsedMs || 0);
    renderTimelineEditor();
    renderIdlePreview();
  });
  socket.on('timeline:updated', (tl) => { timeline = tl; renderTimelineEditor(); renderIdlePreview(); });
  socket.on('presentation:start', ({ startAt: sa, timeline: tl }) => { timeline = tl; startAt = sa; status = 'counting'; setTimeout(() => { if (status === 'counting') status = 'running'; }, tl.countdownMs || 5000); });
  socket.on('presentation:pause', ({ pausedAtMs: p } = {}) => { status = 'paused'; timeline = timeline || {}; timeline.pausedAtMs = Number(p || 0); });
  socket.on('presentation:resume', ({ startAt: sa }) => { startAt = sa; status = 'running'; if (timeline) delete timeline.pausedAtMs; });
  socket.on('presentation:stop', () => { status = 'idle'; startAt = null; lastPhotoId = null; if (timeline) delete timeline.pausedAtMs; el.currentDisplayLabel.textContent = '—'; });
  socket.on('presentation:end', () => { status = 'ended'; startAt = null; lastPhotoId = null; });

  socket.on('devices:update', (payload) => {
    el.statConnected.textContent = payload.connected;
    el.statReady.textContent = payload.ready;
    el.statSynced.textContent = payload.synced;
    el.statOffline.textContent = payload.offline;
    renderDeviceList(payload.devices);
  });

  socket.on('media:updated', (list) => { mediaLibrary = list; renderMediaList(); renderTimelineEditor(); });

  function renderDeviceList(devices) {
    if (!devices.length) { el.deviceList.innerHTML = '<div class="device-empty">No laptops connected yet.</div>'; return; }
    el.deviceList.innerHTML = devices.map(d => `
      <div class="device-row">
        <span class="dot ${d.ready ? 'dot--ok' : 'dot--pending'}"></span>
        <span class="device-label">${escapeHtml(d.label)}</span>
        <span class="device-screen">${d.screen}</span>
        <span class="device-sync">${d.offsetMs}ms offset</span>
      </div>`).join('');
  }

  // ---------------- Transport ----------------
  el.btnStart.addEventListener('click', () => {
    // START is the only way a fresh idle presentation begins. The server owns
    // the exact start timestamp, so all clients begin from t=0 together.
    if (status === 'idle' || status === 'ended') socket.emit('admin:start');
  });
  el.btnStop.addEventListener('click', () => socket.emit('admin:stop'));
  el.btnRestart.addEventListener('click', () => {
    // RESET is deliberately a one-click fresh start from 00:00.
    socket.emit('admin:reset');
  });
  el.btnPause.addEventListener('click', () => {
    if (status === 'paused') { socket.emit('admin:resume'); }
    else { socket.emit('admin:pause'); }
  });

  const STATUS_LABEL = { idle: 'Idle', counting: 'Starting…', running: 'Running', paused: 'Paused', ended: 'Ended' };

  const scheduler = new TimelineScheduler({
    getElapsedMs: () => status === 'paused' ? (timeline?.pausedAtMs ?? 0) : (startAt ? Math.max(0, clock.now() - startAt) : 0),
    getTimeline: () => timeline,
    onTick: (state) => {
      
      if (state.ended) {
        el.currentDisplayLabel.textContent = 'Final tribute';
      } else if (state.currentPhoto) {
        el.currentDisplayLabel.textContent = state.currentPhoto.name;
      } else if (state.flagOn) {
        el.currentDisplayLabel.textContent = 'Flag & Anthem';
      } else {
        el.currentDisplayLabel.textContent = '—';
      }
      if (state.currentPhoto && state.currentPhoto.id !== lastPhotoId) {
        lastPhotoId = state.currentPhoto.id;
        el.prevPhoto.style.backgroundImage = state.currentPhoto.image ? `url("${state.currentPhoto.image}")` : 'none';
        el.prevName.textContent = state.currentPhoto.name || '';
        el.prevTitle.textContent = state.currentPhoto.title || '';
      }
      if (!state.currentPhoto && !state.ended) { el.prevName.textContent = '—'; el.prevTitle.textContent = ''; }
    },
    onFrame: (state) => {
      el.statusPill.textContent = STATUS_LABEL[status] || status;
      el.btnPause.textContent = status === 'paused' ? '▶ Resume' : '⏸ Pause';
      el.btnStart.disabled = !(status === 'idle' || status === 'ended');
      el.btnRestart.disabled = false;
      const total = (timeline && (timeline.totalMs || (timeline.events.find(e => e.type === 'final') || {}).time)) || 0;
      el.clockReadout.textContent = `${fmt(Math.max(0, state.elapsedMs))} / ${fmt(total)}`;
    }
  });
  scheduler.start();

  function fmt(ms) {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  }

  // While idle, the preview panels would otherwise stay blank (nothing has
  // "played" yet), which looks broken. Show the flag + the first scheduled
  // photo instead, so an admin can visually confirm every image actually
  // loaded before pressing Start.
  function renderIdlePreview() {
    if (status !== 'idle' || !timeline) return;
    
    const firstPhoto = [...timeline.events].filter(e => e.type === 'photo').sort((a, b) => a.time - b.time)[0];
    if (firstPhoto) {
      el.prevPhoto.style.backgroundImage = firstPhoto.image ? `url("${firstPhoto.image}")` : 'none';
      el.prevName.textContent = firstPhoto.name || '';
      el.prevTitle.textContent = (firstPhoto.title || '') + '  ·  up next';
    }
  }

  function parseMMSS(str) {
    const m = /^(\d{1,2}):(\d{2})$/.exec((str || '').trim());
    if (!m) return null;
    return (parseInt(m[1], 10) * 60 + parseInt(m[2], 10)) * 1000;
  }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  // ---------------- Media library ----------------
  el.uploadDrop.addEventListener('click', () => el.fileInput.click());
  el.fileInput.addEventListener('change', () => uploadFiles(el.fileInput.files));
  ['dragover', 'dragleave', 'drop'].forEach(evt => {
    el.uploadDrop.addEventListener(evt, (e) => { e.preventDefault(); });
  });
  el.uploadDrop.addEventListener('drop', (e) => { if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files); });

  async function uploadFiles(fileList) {
    el.uploadProgress.classList.remove('hidden');
    for (const file of fileList) {
      const fd = new FormData();
      fd.append('file', file);
      try {
        const res = await fetch('/api/media', { method: 'POST', body: fd });
        const data = await res.json();
        if (data.ok) { mediaLibrary.push(data.item); }
      } catch (e) { console.error('Upload failed', e); }
    }
    el.uploadProgress.classList.add('hidden');
    el.fileInput.value = '';
    renderMediaList();
    renderTimelineEditor();
  }

  function renderMediaList() {
    if (!mediaLibrary.length) { el.mediaList.innerHTML = ''; return; }
    el.mediaList.innerHTML = mediaLibrary.map(m => `
      <div class="media-item" data-id="${m.id}">
        <div class="media-thumb" style="${m.kind === 'image' ? `background-image:url('${m.url}')` : ''}">${m.kind === 'audio' ? '♪ AUDIO' : ''}</div>
        <div class="media-name">${escapeHtml(m.originalName)}</div>
        <button class="media-remove" data-remove="${m.id}">Remove</button>
      </div>`).join('');
    el.mediaList.querySelectorAll('[data-remove]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-remove');
        await fetch('/api/media/' + id, { method: 'DELETE' });
        mediaLibrary = mediaLibrary.filter(m => m.id !== id);
        renderMediaList();
        renderTimelineEditor();
      });
    });
  }

  // Initial load (in case sockets are slower than the REST round trip)
  fetch('/api/media').then(r => r.json()).then(list => { mediaLibrary = list; renderMediaList(); renderTimelineEditor(); });

  // ---------------- Media Sources & Attribution ----------------
  fetch('/api/media-sources').then(r => r.json()).then(renderSources).catch(() => {
    el.sourcesList.innerHTML = '<div class="source-empty">Could not load media-sources.json.</div>';
  });

  function renderSources(sources) {
    if (!sources || !sources.length) { el.sourcesList.innerHTML = '<div class="source-empty">No sourcing records found.</div>'; return; }
    el.sourcesList.innerHTML = sources.map(s => {
      const needsAsset = s.status === 'needs-licensed-asset';
      const ready = s.fileExists;
      const statusLabel = needsAsset ? 'Needs Licensed Asset' : ready ? 'Downloaded' : 'Not yet downloaded (placeholder in use)';
      const statusClass = needsAsset ? 'source-status--warn' : ready ? 'source-status--ok' : 'source-status--pending';
      return `
      <div class="source-row">
        <div class="source-row-main">
          <div class="source-title">${escapeHtml(s.title)}</div>
          <div class="source-meta">
            ${s.source ? `Source: ${escapeHtml(s.source)}` : 'Source: not yet identified'}
            ${s.license ? ` · License: ${escapeHtml(s.license)}` : ''}
            ${s.creator ? ` · ${escapeHtml(s.creator)}` : ''}
          </div>
          ${needsAsset ? `<div class="source-warning">${escapeHtml(s.notes || '')}</div>` : ''}
        </div>
        <div class="source-row-side">
          <span class="source-status ${statusClass}">${statusLabel}</span>
          ${s.sourceUrl ? `<a href="${s.sourceUrl}" target="_blank" rel="noopener" class="source-link">VIEW SOURCE</a>` : ''}
        </div>
      </div>`;
    }).join('');
  }

  // ---------------- Timeline editor ----------------
  function renderTimelineEditor() {
    if (!timeline) return;
    el.settingCountdown.value = Math.round((timeline.countdownMs || 5000) / 1000);
    const finalEvt = timeline.events.find(e => e.type === 'final');
    el.settingFinal.value = fmt(finalEvt ? finalEvt.time : (timeline.totalMs || 0));

    const imageOptions = mediaLibrary.filter(m => m.kind === 'image');
    const sorted = [...timeline.events].sort((a, b) => a.time - b.time);

    el.timelineRows.innerHTML = sorted.map((ev, i) => {
      const isPhoto = ev.type === 'photo';
      const isFixed = ev.type === 'flag-start' || ev.type === 'anthem-start' || ev.type === 'final';
      const badge = { 'flag-start': 'Flag starts', 'anthem-start': 'Anthem starts', 'photo': 'Photo', 'final': 'Ceremony ends' }[ev.type] || ev.type;
      const imgOpts = `<option value="">— no image —</option>` + imageOptions.map(m => `<option value="${m.url}" ${m.url === ev.image ? 'selected' : ''}>${escapeHtml(m.originalName)}</option>`).join('');
      return `
      <div class="timeline-row" data-id="${ev.id}" data-type="${ev.type}">
        <input class="time-input" type="text" value="${fmt(ev.time)}" data-field="time" placeholder="mm:ss">
        <div class="timeline-type-badge">${badge}</div>
        ${isPhoto ? `<input type="text" value="${escapeHtml(ev.name || '')}" data-field="name" placeholder="Name">` : '<div></div>'}
        ${isPhoto
          ? `<div style="display:flex;gap:6px;">
               <input type="text" value="${escapeHtml(ev.title || '')}" data-field="title" placeholder="Title / role" style="flex:1;">
               <select data-field="image" style="flex:1;">${imgOpts}</select>
             </div>`
          : '<div></div>'}
        <button class="row-remove" data-remove-row="${ev.id}" ${isFixed ? 'disabled style="opacity:0.25;cursor:default;"' : ''}>✕</button>
      </div>`;
    }).join('');

    el.timelineRows.querySelectorAll('[data-remove-row]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-remove-row');
        timeline.events = timeline.events.filter(e => e.id !== id);
        renderTimelineEditor();
      });
    });
  }

  el.btnAddPhoto.addEventListener('click', () => {
    if (!timeline) return;
    const finalEvt = timeline.events.find(e => e.type === 'final');
    const lastTime = Math.max(0, ...timeline.events.filter(e => e.type !== 'final').map(e => e.time));
    const newTime = finalEvt ? Math.max(0, finalEvt.time - 20000) : lastTime + 30000;
    timeline.events.push({ id: 'e-' + Date.now(), time: newTime, type: 'photo', image: null, name: 'New Figure', title: '' });
    renderTimelineEditor();
  });

  el.btnSaveTimeline.addEventListener('click', async () => {
    if (!timeline) return;
    const rows = el.timelineRows.querySelectorAll('.timeline-row');
    rows.forEach(row => {
      const id = row.getAttribute('data-id');
      const ev = timeline.events.find(e => e.id === id);
      if (!ev) return;
      const timeVal = parseMMSS(row.querySelector('[data-field="time"]').value);
      if (timeVal != null) ev.time = timeVal;
      const nameInput = row.querySelector('[data-field="name"]');
      if (nameInput) ev.name = nameInput.value;
      const titleInput = row.querySelector('[data-field="title"]');
      if (titleInput) ev.title = titleInput.value;
      const imgSelect = row.querySelector('[data-field="image"]');
      if (imgSelect) ev.image = imgSelect.value || null;
    });
    const countdownSec = parseInt(el.settingCountdown.value, 10);
    if (!isNaN(countdownSec)) timeline.countdownMs = countdownSec * 1000;
    const finalMs = parseMMSS(el.settingFinal.value);
    if (finalMs != null) {
      timeline.totalMs = finalMs;
      const finalEvt = timeline.events.find(e => e.type === 'final');
      if (finalEvt) finalEvt.time = finalMs;
    }
    el.timelineSaveNote.textContent = 'Saving…';
    try {
      const res = await fetch('/api/timeline', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(timeline) });
      const data = await res.json();
      if (data.ok) { el.timelineSaveNote.textContent = 'Saved · every laptop will use this timeline on the next start.'; }
      else { el.timelineSaveNote.textContent = 'Save failed — check the server console.'; }
    } catch (e) {
      el.timelineSaveNote.textContent = 'Save failed — is the server reachable?';
    }
    setTimeout(() => { el.timelineSaveNote.textContent = ''; }, 4000);
  });
})();
