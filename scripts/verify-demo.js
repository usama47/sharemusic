const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const tl = JSON.parse(fs.readFileSync(path.join(root, 'data/timeline.json')));
let ok = true;
function check(label, p) { const exists = fs.existsSync(path.join(root, p)); console.log(`${exists ? '✓' : '✕'} ${label}: ${p}`); if (!exists) ok = false; }
check('Anthem MP3', 'public/media/anthem/pakistan-national-anthem.mp3');
for (const e of tl.events.filter(e => e.type === 'photo')) check(e.name, 'public' + e.image);
console.log(`Timeline: ${tl.totalMs}ms`);
console.log(`Anthem URL: ${tl.anthemUrl}`);
process.exit(ok ? 0 : 1);
