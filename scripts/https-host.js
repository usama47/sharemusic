// Offline LAN HTTPS. Only the public CA certificate is exposed by the setup server.
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const http = require('http');
const { spawnSync } = require('child_process');
const { X509Certificate, randomBytes } = require('crypto');
const { createHost } = require('../server');

async function main() {
  process.umask(0o077);
  const port = Number(process.env.PORT || 3000);
  const setupPort = Number(process.env.SETUP_PORT || 3001);
  if (![port, setupPort].every(n => Number.isInteger(n) && n > 0 && n <= 65535) || port === setupPort) {
    throw new Error('PORT and SETUP_PORT must be different ports between 1 and 65535.');
  }
  const addresses = new Set(['127.0.0.1', 'localhost']);
  try {
    for (const entries of Object.values(os.networkInterfaces())) {
      for (const entry of entries || []) if (entry.family === 'IPv4' && !entry.internal) addresses.add(entry.address);
    }
  } catch (_) { console.log('Automatic address discovery unavailable; supply your Wi-Fi/hotspot IP after the command.'); }
  for (const value of [...process.argv.slice(2), ...(process.env.HTTPS_HOSTS || '').split(',')]) {
    const address = value.trim();
    if (!address) continue;
    if (net.isIP(address) === 6) throw new Error('Use the host’s IPv4 LAN address; this launcher listens on IPv4.');
    if (!net.isIP(address) && (address.length > 253 || !address.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)))) {
      throw new Error(`Invalid HTTPS hostname/IP: ${address}`);
    }
    addresses.add(address);
  }
  const openssl = process.env.OPENSSL || 'openssl';
  function run(args) {
    const result = spawnSync(openssl, args, { encoding: 'utf8', windowsHide: true, timeout: 60000 });
    if (result.error?.code === 'ETIMEDOUT') throw new Error('OpenSSL took too long. Retry certificate setup on this host.');
    if (result.error) throw new Error('OpenSSL is required. In Termux run: pkg install openssl-tool. On other hosts install OpenSSL or set OPENSSL to its executable path.');
    if (result.status !== 0) throw new Error(`Certificate generation failed: ${result.stderr.trim()}`);
  }
  run(['version']);
  const directory = path.resolve(__dirname, '../certs');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = name => path.join(directory, name);
  const caKey = file('root-key.pem'), caCert = file('root-cert.pem');
  if (fs.existsSync(caKey) !== fs.existsSync(caCert)) throw new Error('Incomplete certificate authority in certs/. Restore its matching root-key.pem and root-cert.pem from your backup.');
  if (!fs.existsSync(caCert)) {
    console.log('Creating this host’s local certificate authority (kept in certs/).');
    run(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '3650',
      '-subj', '/CN=ShareMusic Local CA', '-addext', 'basicConstraints=critical,CA:TRUE,pathlen:0',
      '-addext', 'keyUsage=critical,keyCertSign,cRLSign', '-keyout', file('root-key.pending.pem'), '-out', file('root-cert.pending.pem')]);
    fs.chmodSync(file('root-key.pending.pem'), 0o600);
    fs.renameSync(file('root-key.pending.pem'), caKey);
    fs.renameSync(file('root-cert.pending.pem'), caCert);
  }
  const root = new X509Certificate(fs.readFileSync(caCert));
  if (!root.ca || Date.parse(root.validTo) < Date.now() + 86400000 || Date.parse(root.validFrom) > Date.now()) {
    throw new Error('Local CA is expired, not yet valid, or invalid. Check the host clock; replacing the CA requires trusting it again on each phone.');
  }
  // Reissue the leaf on launch to cover changing hotspot addresses; preserve phone trust.
  const extensions = ['basicConstraints=critical,CA:FALSE', 'keyUsage=critical,digitalSignature,keyEncipherment',
    'extendedKeyUsage=serverAuth', 'subjectAltName=' + [...addresses].map(a => `${net.isIP(a) ? 'IP' : 'DNS'}:${a}`).join(',')];
  fs.writeFileSync(file('server.ext'), extensions.join('\n'));
  run(['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-subj', '/CN=ShareMusic',
    '-keyout', file('server-key.pending.pem'), '-out', file('server.csr')]);
  fs.chmodSync(file('server-key.pending.pem'), 0o600);
  run(['x509', '-req', '-in', file('server.csr'), '-CA', caCert, '-CAkey', caKey,
    '-set_serial', `0x${randomBytes(16).toString('hex')}`, '-days', '365', '-sha256',
    '-extfile', file('server.ext'), '-out', file('server-cert.pending.pem')]);
  run(['verify', '-CAfile', caCert, file('server-cert.pending.pem')]);
  fs.renameSync(file('server-key.pending.pem'), file('server-key.pem'));
  fs.renameSync(file('server-cert.pending.pem'), file('server-cert.pem'));
  const authority = a => net.isIP(a) === 6 ? `[${a}]` : a;
  const links = [...addresses].map(a => `<li><strong>${a}</strong>: <a href="https://${authority(a)}:${port}/floor">Music</a> · <a href="https://${authority(a)}:${port}/voice">Voice</a> · <a href="https://${authority(a)}:${port}/admin">Admin</a></li>`).join('');
  const page = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>ShareMusic phone setup</title><style>body{font:18px system-ui;max-width:760px;margin:40px auto;padding:0 22px;background:#092719;color:#fff;line-height:1.6}a{color:#e9ca81}code{overflow-wrap:anywhere}li{margin:12px 0}</style>
    <h1>Connect your phone</h1><p>One-time setup for music and voice on this host. Stay on the same Wi-Fi or hotspot.</p>
    <ol><li><a href="/sharemusic-ca.crt">Download ShareMusic’s public certificate</a>. Only trust it if this is your host. Compare its SHA-256 fingerprint with the host’s terminal:<br><code>${root.fingerprint256}</code></li>
    <li><strong>Android:</strong> In Settings, search for “Install a certificate”, choose <strong>CA certificate</strong>, and select the downloaded file. Menu names vary by phone. This is a CA certificate, not a Wi-Fi or client certificate.</li>
    <li><strong>iPhone/iPad:</strong> Download in Safari, then install the downloaded profile in Settings → General → VPN &amp; Device Management. Next open General → About → Certificate Trust Settings and enable full trust for ShareMusic Local CA.</li>
    <li>Open a matching HTTPS link below, then tap Join voice and allow the microphone. Use the same host IP you used for this setup page; localhost and 127.0.0.1 work only on the host.</li></ol>
    <ul>${links}</ul><p>If HTTPS still shows a certificate error, finish the trust steps and confirm the address and phone clock. If the host IP changed, restart the HTTPS command with the new IP. Do not bypass the certificate error.</p>
    <p>Trusting this CA lets this host issue certificates your phone accepts. Keep its private key private. You can remove ShareMusic Local CA from your phone’s certificate/profile settings after the project. No internet is required after setup.</p></html>`;
  const setup = http.createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); return res.end(); }
    const route = req.url.split('?')[0];
    if (route === '/sharemusic-ca.crt') {
      res.setHeader('Content-Type', 'application/x-x509-ca-cert');
      res.setHeader('Content-Disposition', 'attachment; filename="sharemusic-ca.crt"');
      return res.end(root.raw);
    }
    if (!['/', '/voice', '/floor', '/admin'].includes(route)) { res.writeHead(404); return res.end('Not found'); }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    let selected;
    try { selected = new URL(`http://${req.headers.host}`).hostname; } catch (_) {}
    // Only a certificate-covered address may become the suggested destination.
    const quickLinks = addresses.has(selected) ? `<h2>Open on this phone</h2><p><a href="https://${authority(selected)}:${port}/voice">Open Voice</a> · <a href="https://${authority(selected)}:${port}/floor">Open Music</a></p>` : '';
    res.end(page.replace(`<ul>${links}</ul>`, `${quickLinks}<details><summary>All host addresses</summary><ul>${links}</ul></details>`));
  });
  const host = createHost({ tls: { key: fs.readFileSync(file('server-key.pem')), cert: fs.readFileSync(file('server-cert.pem')) } });
  const listen = (server, number) => new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(number, '0.0.0.0', () => { server.removeListener('error', reject); resolve(); });
  });
  try { await listen(host.server, port); await listen(setup, setupPort); }
  catch (error) { await host.close(); if (setup.listening) setup.close(); throw error; }
  console.log(`\nShareMusic HTTPS is running. Certificate SHA-256:\n${root.fingerprint256}\n`);
  for (const address of addresses) {
    console.log(`Phone setup: http://${authority(address)}:${setupPort}\nVoice: https://${authority(address)}:${port}/voice\nAdmin: https://${authority(address)}:${port}/admin\nListener: https://${authority(address)}:${port}/floor\n`);
  }
  if (addresses.size === 2) console.log('For other phones, restart with your host IP, for example: npm run local-host:https -- 192.168.43.1');
  console.log('Keep certs/ on this host so phones retain trust. Never share root-key.pem or server-key.pem. Ctrl+C stops both servers.');
  let stopping = false;
  async function stop() {
    if (stopping) return;
    stopping = true;
    setup.close(); setup.closeIdleConnections?.();
    await host.close();
  }
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
main().catch(error => { console.error(`HTTPS startup failed: ${error.message}`); process.exitCode = 1; });
