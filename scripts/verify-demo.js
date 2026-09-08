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
check('Supabase config template', 'public/js/supabase-config.example.js');
check('Generated Supabase config', 'public/js/supabase-config.js');
check('Runtime config', 'public/js/runtime-config.js');
check('Local admin client', 'public/js/local-admin.js');
check('Local listener client', 'public/js/local-floor.js');
check('PWA manifest', 'public/manifest.webmanifest');
check('PWA service worker', 'public/sw.js');
check('PWA icon', 'public/icons/icon.svg');
check('Netlify routes', 'public/_redirects');
check('Vercel routes', 'vercel.json');
for (const file of fs.readdirSync(path.join(root, 'public', 'media', 'anthem'))) {
	if (/\.(mp3|m4a|ogg|oga|wav|webm)$/i.test(file)) check('Bundled audio', `public/media/anthem/${file}`);
}

console.log(ok ? 'ShareMusic preflight passed.' : 'ShareMusic preflight failed.');
process.exit(ok ? 0 : 1);
