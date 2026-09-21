// Optional UI panels: playback stays mounted while friends talk or check the room.
(() => {
  const mount = document.getElementById('room-tools');
  if (!mount) return;
  const admin = mount.getAttribute('data-role') === 'admin';
  mount.innerHTML = `<dialog class="room-tools-dialog" aria-labelledby="tools-title">
    <header><h2 id="tools-title">Room tools</h2><button type="button" class="tools-close">Hide panel</button></header>
    <p class="tools-hint">Music keeps playing. Hiding this panel keeps joined voice active; use End voice to leave.</p>
    <section><h3>Connection check</h3><dl class="tools-checks">
      <dt>Host</dt><dd class="check-host">Connecting…</dd><dt>Music</dt><dd class="check-music">Join to enable audio</dd>
      <dt>Voice security</dt><dd class="check-secure"></dd><dt>Microphone</dt><dd class="check-mic">Not requested</dd>
    </dl></section>
    <section><h3>Music + voice</h3><p class="tools-voice-status" role="status">Join voice to talk while listening.</p>
      <div class="tools-actions"><button type="button" class="tools-join">Open voice panel</button><button type="button" class="tools-end" hidden>End voice</button></div>
      <p class="tools-setup" hidden>Voice needs this phone’s trusted HTTPS link. <a class="tools-secure-link">Open secure music + voice</a> or <a class="tools-setup-link">follow phone setup</a>. Switching pages releases this device’s current player.</p>
      <label class="tools-duck-label"><input class="tools-duck" type="checkbox"> Lower my music while someone speaks</label>
      <p class="tools-duck-note tools-hint">Optional; only affects this device. Headphones help prevent music being picked up as speech.</p>
      <div class="tools-frame-mount"></div>
    </section>
    <section><h3>Invite friends</h3><p class="tools-hint">Same Wi-Fi or hotspot. This QR code is generated locally.</p>
      <label>Network link <select class="tools-address" aria-label="Invitation address"></select></label>
      <img class="tools-qr" width="240" height="240" alt="Scan to open the listener page" hidden>
      <input class="tools-link" aria-label="Music invitation link" readonly>
      <button type="button" class="tools-copy">Copy invitation</button><p class="tools-invite-status" role="status"></p>
    </section>
  </dialog>`;
  const $ = selector => mount.querySelector(selector);
  const dialog = $('.room-tools-dialog');
  const launch = document.getElementById('room-tools-open');
  let frame, latest, config, activeVoice = false, originalVolume = null, speaking = false, permission = 'Not requested';
  const music = () => document.getElementById(admin ? 'room-audio' : 'audio');
  function restoreVolume() {
    if (originalVolume !== null && music()) music().volume = originalVolume;
    originalVolume = null;
  }
  function duck() {
    const audio = music();
    if (!audio || !$('.tools-duck').checked || !activeVoice) { restoreVolume(); return; }
    if (originalVolume === null) originalVolume = audio.volume;
    audio.volume = speaking ? originalVolume * 0.25 : originalVolume;
    if (speaking && Math.abs(audio.volume - originalVolume * 0.25) > 0.01) {
      $('.tools-duck').checked = false; restoreVolume();
      $('.tools-duck-note').textContent = 'This browser controls volume through the phone buttons. Automatic lowering is unavailable here.';
    }
  }
  function update(value) {
    latest = value;
    $('.check-host').textContent = value.connected ? 'Connected' : 'Reconnecting — check Wi-Fi and the host';
    $('.check-music').textContent = value.sound.message || (!value.sound.enabled ? 'Tap Join / Enable audio first' : `${value.sound.status} · ${Math.floor((value.sound.bufferedMs || 0) / 1000)}s buffered`);
    $('.check-secure').textContent = window.isSecureContext ? 'Secure context available' : 'One-time HTTPS setup needed';
    $('.check-mic').textContent = activeVoice ? 'Allowed — voice joined' : permission;
  }
  async function loadConfig() {
    try {
      const response = await fetch('/local/features');
      if (!response.ok) throw new Error('Could not load invitation links. Check the host connection.');
      config = await response.json();
      const select = $('.tools-address'); select.replaceChildren();
      for (const link of config.invitations || []) {
        const option = document.createElement('option'); option.value = link; option.textContent = link; select.appendChild(option);
      }
      if (config.invitations?.length) { select.value = config.invitations.includes(`${location.origin}/floor`) ? `${location.origin}/floor` : config.invitations[0]; showInvite(); }
      else { $('.tools-invite-status').textContent = 'No network address detected. Open the host’s Wi-Fi address, then reopen this panel.'; $('.tools-qr').hidden = true; $('.tools-link').value = ''; }
      const returnPath = `/${admin ? 'admin' : 'floor'}?voice=1`;
      $('.tools-secure-link').href = config.secureOrigin ? config.secureOrigin + returnPath : '/help.html';
      $('.tools-setup-link').href = `/setup?music=1${admin ? '&from=admin' : ''}`;
    } catch (error) { $('.tools-invite-status').textContent = error.message; }
  }
  function showInvite() {
    const link = $('.tools-address').value;
    $('.tools-link').value = link;
    $('.tools-qr').src = `/local/invite.svg?url=${encodeURIComponent(link)}`; $('.tools-qr').hidden = false;
    $('.tools-invite-status').textContent = 'Friends scan this code or open this link. If unreachable, try another listed address.';
  }
  function open() {
    if (!dialog.open) dialog.showModal();
    if (latest) update(latest);
    loadConfig();
    navigator.permissions?.query({ name: 'microphone' }).then(result => {
      permission = result.state === 'granted' ? 'Allowed' : result.state === 'denied' ? 'Blocked — allow Microphone in site settings' : 'Not requested — join voice to allow';
      if (latest) update(latest);
    }).catch(() => {});
  }
  function openVoice() {
    open();
    if (!window.isSecureContext) { $('.tools-setup').hidden = false; return; }
    if (frame) return;
    frame = document.createElement('iframe'); frame.title = 'Voice chat controls'; frame.className = 'tools-voice-frame';
    frame.allow = 'microphone; autoplay'; frame.src = `/voice?embedded=1${admin ? '&from=admin' : ''}`;
    $('.tools-frame-mount').appendChild(frame);
    $('.tools-join').hidden = true; $('.tools-end').hidden = false;
  }
  function endVoice() {
    frame?.remove(); frame = null; activeVoice = false; speaking = false; restoreVolume();
    launch.textContent = 'Room tools'; $('.tools-join').hidden = false; $('.tools-end').hidden = true;
    $('.tools-voice-status').textContent = 'Voice ended. Music is unchanged.';
    if (latest) update(latest);
  }
  launch.onclick = open;
  $('.tools-close').onclick = () => dialog.close();
  $('.tools-join').onclick = openVoice;
  $('.tools-end').onclick = endVoice;
  $('.tools-duck').onchange = duck;
  $('.tools-address').onchange = showInvite;
  $('.tools-qr').onerror = () => { $('.tools-qr').hidden = true; $('.tools-invite-status').textContent = 'QR unavailable. Copy the invitation link instead.'; };
  $('.tools-copy').onclick = async () => {
    const input = $('.tools-link');
    if (!input.value) return;
    input.focus(); input.select();
    try { if (!navigator.clipboard?.writeText) throw new Error('Manual copy'); await navigator.clipboard.writeText(input.value); $('.tools-invite-status').textContent = 'Copied.'; }
    catch (_) { $('.tools-invite-status').textContent = 'Link selected. Use Copy from the phone’s selection menu, or Ctrl+C.'; }
  };
  for (const link of document.querySelectorAll?.('a[href^="/voice"]') || []) link.addEventListener('click', event => { event.preventDefault(); openVoice(); });
  window.addEventListener('message', event => {
    if (!frame || event.origin !== location.origin || event.source !== frame.contentWindow || event.data?.type !== 'sharemusic:voice') return;
    activeVoice = event.data.joined === true; speaking = event.data.speaking === true;
    $('.tools-voice-status').textContent = event.data.message || 'Voice panel open.';
    launch.textContent = activeVoice ? 'Voice on · Tools' : 'Room tools';
    if (latest) update(latest);
    duck();
  });
  window.addEventListener('pagehide', restoreVolume);
  window.ShareMusicTools = { update };
  if (/(?:[?&])voice=1(?:&|$)/.test(location.search || '')) openVoice();
})();
