const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.join(__dirname, '..');
const required = ['server.js', 'voice-room.js', 'public/admin.html', 'public/floor.html', 'public/voice.html', 'public/js/room-client.js', 'public/js/room-audio.js', 'public/js/voice-client.js', 'public/js/local-voice.js', 'public/js/local-admin.js', 'public/js/local-floor.js', 'public/manifest.webmanifest', 'public/sw.js', 'public/icons/icon.svg'];
for (const file of required) {
  if (!fs.existsSync(path.join(root, file))) { console.error(`Missing: ${file}`); process.exit(1); }
}
for (const page of ['admin', 'floor', 'voice']) {
  const html = fs.readFileSync(path.join(root, 'public', `${page}.html`), 'utf8');
  for (const [, src] of html.matchAll(/(?:src|href)="(\/(?:js|css|icons)\/[^\"]+)"/g)) {
    if (!fs.existsSync(path.join(root, 'public', src))) { console.error(`Missing page asset: ${src}`); process.exit(1); }
  }
}
console.log('Assets present; running behavioral regression tests.');
const result = spawnSync(process.execPath, ['--test'], { cwd: root, stdio: 'inherit' });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
