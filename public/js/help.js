(() => {
  const $ = id => document.getElementById(id);
  const admin = new URLSearchParams(location.search).get('from') === 'admin';
  if (admin) {
    $('help-back').href = '/admin'; $('help-back').textContent = 'Back to dashboard';
    $('help-voice').href = '/voice?from=admin'; $('help-setup').href = '/setup?from=admin';
    $('music-help').textContent = 'Add audio files on the dashboard, select a song, then press Start. Start enables your audio too. Friends open the listener page and tap Join. Everyone can pause or resume; track selection stays on your dashboard.';
    $('help-music').href = '/admin'; $('help-music').textContent = 'Open dashboard';
  }
  $('room-link').value = new URL('/floor', location.href).href;
  if (['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) {
    $('share-note').textContent = 'This address works only on the host. Open the network Music link printed by npm start, then copy the link here for friends.';
    $('copy-link').disabled = true;
  }
  $('copy-link').onclick = async () => {
    $('room-link').focus(); $('room-link').select();
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Manual copy needed');
      await navigator.clipboard.writeText($('room-link').value);
      $('share-note').textContent = 'Copied. Share it with friends on this network.';
    } catch (_) { $('share-note').textContent = 'Link selected. Press and hold it and choose Copy, or use Ctrl+C.'; }
  };
})();
