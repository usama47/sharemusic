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
