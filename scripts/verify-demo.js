const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
let ok = true;
function check(label, relativePath) {
	const exists = fs.existsSync(path.join(root, relativePath));
	console.log(`${exists ? 'OK' : 'MISSING'} ${label}: ${relativePath}`);
	if (!exists) ok = false;
}

check('Server', 'server.js');
check('Admin page', 'public/admin.html');
check('Listener page', 'public/floor.html');
check('Clock sync client', 'public/js/clocksync.js');
for (const file of fs.readdirSync(path.join(root, 'public', 'media', 'anthem'))) {
	if (/\.(mp3|m4a|ogg|oga|wav|webm)$/i.test(file)) check('Bundled audio', `public/media/anthem/${file}`);
}

console.log(ok ? 'ShareMusic preflight passed.' : 'ShareMusic preflight failed.');
process.exit(ok ? 0 : 1);
