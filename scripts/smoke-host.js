// Disposable local browser-test host; never uses the project's music library.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createHost } = require('../server');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sharemusic-smoke-'));
const samples = 8000 * 60;
const wav = Buffer.alloc(44 + samples * 2);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
// Quiet generated tone, not user media.
for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(200 * Math.sin(i * Math.PI * 2 * 220 / 8000)), 44 + i * 2);
fs.writeFileSync(path.join(root, 'smoke.wav'), wav);
const host = createHost({ storageRoot: root });
if (process.argv.includes('--voice-test')) {
  const handler = host.server.listeners('request')[0];
  host.server.removeListener('request', handler);
  host.server.on('request', (req, res) => {
    if (req.url === '/voice-test') {
      res.setHeader('Content-Type', 'text/html');
      const html = fs.readFileSync(path.join(__dirname, '../public/voice.html'), 'utf8');
      return res.end(html.replace('<script src="/js/room-client.js">', '<script src="/voice-test-media.js"></script><script src="/js/room-client.js">'));
    }
    if (req.url === '/voice-test-media.js') {
      res.setHeader('Content-Type', 'text/javascript');
      return res.end(fs.readFileSync(path.join(__dirname, '../tests/voice-test-media.js')));
    }
    handler(req, res);
  });
}
host.server.listen(0, '127.0.0.1', () => console.log(JSON.stringify({ url: `http://127.0.0.1:${host.server.address().port}`, file: path.join(root, 'smoke.wav') })));
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await host.close();
  const target = path.resolve(root);
  if (path.dirname(target) !== path.resolve(os.tmpdir()) || !path.basename(target).startsWith('sharemusic-smoke-')) throw Error('Unexpected test storage path');
  fs.rmSync(target, { recursive: true, force: true });
  process.stdin.pause();
  console.log('Smoke host stopped and temporary media removed.');
}
process.stdin.on('data', data => { if (data.toString().trim() === 'stop') stop(); });
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
