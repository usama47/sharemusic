const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const envFile = path.join(root, '.env');
const outputFile = path.join(root, 'public', 'js', 'supabase-config.js');
const values = {};

if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*["']?(.*?)?["']?\s*$/.exec(line);
    if (match) values[match[1]] = match[2];
  }
}

const url = process.env.SB_PROJECT_URL || values.SB_PROJECT_URL || '';
const anonKey = process.env.SB_PUBLISHABLE_KEY || values.SB_PUBLISHABLE_KEY || '';
const roomId = process.env.SHAREMUSIC_ROOM_ID || values.SHAREMUSIC_ROOM_ID || 'main';

if (!url || !anonKey) {
  console.error('Missing SB_PROJECT_URL or SB_PUBLISHABLE_KEY. Configure .env or deployment environment variables.');
  process.exit(1);
}

const config = `window.SHAREMUSIC_SUPABASE = ${JSON.stringify({ url, anonKey, roomId }, null, 2)};\n`;
fs.writeFileSync(outputFile, config);
console.log('Generated public/js/supabase-config.js from environment variables.');
