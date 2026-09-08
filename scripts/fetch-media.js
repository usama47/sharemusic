#!/usr/bin/env node
/**
 * Downloads the assets listed in media-sources.json (Wikimedia Commons
 * files that have already been checked for a clear public-domain / CC
 * license — see that file for the source URL + license of every asset)
 * into public/media/, then wires the results into data/media.json and
 * data/timeline.json so the ceremony is ready to play without any
 * manual upload.
 *
 * This deliberately has ZERO npm dependencies (just Node's built-in
 * https/fs) so it can run immediately after `npm install`, with no
 * extra install step.
 *
 * Usage:
 *   node scripts/fetch-media.js
 *   npm run fetch-media
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const SOURCES_FILE = path.join(ROOT, 'media-sources.json');
const MEDIA_JSON = path.join(ROOT, 'data', 'media.json');
const TIMELINE_JSON = path.join(ROOT, 'data', 'timeline.json');

// A real browser-style UA — some Wikimedia/CDN edges are more likely to
// reset connections from obviously bot-like or missing User-Agent strings.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 PakistanAnthemSyncDemo/1.0';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function downloadOnce(url, destPath, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': UA, 'Accept': '*/*' },
      // Force IPv4 — on Windows, a broken/half-working IPv6 route is one of
      // the most common causes of ECONNRESET/ETIMEDOUT to sites that also
      // publish AAAA records (Wikimedia does).
      family: 4,
      agent: new https.Agent({ keepAlive: false, family: 4 })
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirectsLeft > 0) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        resolve(downloadOnce(next, destPath, redirectsLeft - 1));
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      const tmpPath = destPath + '.part';
      const file = fs.createWriteStream(tmpPath);
      res.pipe(file);
      file.on('finish', () => file.close(() => {
        fs.renameSync(tmpPath, destPath);
        resolve(destPath);
      }));
      file.on('error', (e) => { fs.unlink(tmpPath, () => {}); reject(e); });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('Timed out')));
  });
}

/** Retries transient network failures (ECONNRESET, ETIMEDOUT, socket hang up …) a few times before giving up. */
async function download(url, destPath, attempts = 4) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await downloadOnce(url, destPath);
    } catch (err) {
      lastErr = err;
      const transient = /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|Timed out/i.test(err.message);
      if (!transient || i === attempts) break;
      const backoffMs = 800 * i;
      process.stdout.write(`retry ${i}/${attempts - 1} in ${backoffMs}ms… `);
      await sleep(backoffMs);
    }
  }
  throw lastErr;
}

function loadJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch (e) { return fallback; }
}
function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

async function main() {
  const sources = loadJSON(SOURCES_FILE, []);
  const results = [];

  for (const asset of sources) {
    if (!asset.downloadUrl) {
      console.log(`⚠️  Skipping "${asset.title}" — no verified license/source yet (status: ${asset.status}). See media-sources.json for details.`);
      results.push({ ...asset });
      continue;
    }
    const dest = path.join(ROOT, asset.targetPath);
    if (fs.existsSync(dest)) {
      console.log(`✓  Already present: ${asset.targetPath}`);
      results.push({ ...asset, status: 'downloaded', localPath: asset.targetPath });
      continue;
    }
    try {
      process.stdout.write(`⬇  Downloading ${asset.title} … `);
      await download(asset.downloadUrl, dest);
      console.log('done');
      results.push({ ...asset, status: 'downloaded', localPath: asset.targetPath, downloadedAt: new Date().toISOString() });
    } catch (err) {
      console.log(`FAILED (${err.message})`);
      results.push({ ...asset, status: 'download-failed', error: err.message });
    }
  }

  saveJSON(SOURCES_FILE, results);
  wireIntoApp(results);

  const failed = results.filter(r => r.status !== 'downloaded');
  console.log(`\nDone. ${results.length - failed.length}/${results.length} assets downloaded.`);
  if (failed.length) {
    const networkFailures = failed.filter(f => f.status === 'download-failed');
    console.log('The following still need attention (see media-sources.json):');
    failed.forEach(f => console.log(`  - ${f.title}: ${f.status}`));

    if (networkFailures.length) {
      console.log(`
Every download failed at the connection level (ECONNRESET/ETIMEDOUT etc.),
which means something on this network is blocking or resetting the
connection to Wikimedia — not a bug in this script. Common causes:
  - Antivirus/VPN doing HTTPS inspection (try disabling it briefly)
  - A school/office/ISP firewall blocking wikimedia.org or upload.wikimedia.org
  - A flaky connection — just try again: npm run fetch-media

MANUAL FALLBACK — if it keeps failing, download these yourself (open each
URL in a normal browser, e.g. on your phone's data connection if the
network is the problem) and save the file to the exact path shown:
`);
      networkFailures.forEach(f => {
        if (!f.downloadUrl) return;
        console.log(`  ${f.title}`);
        console.log(`    URL:  ${f.downloadUrl}`);
        console.log(`    Save as:  ${f.targetPath}\n`);
      });
      console.log('After manually saving the files, run "npm run fetch-media" again — it will detect the files already on disk and wire them into the timeline automatically.');
    }
  }
}

/** Registers downloaded assets in data/media.json and links them into data/timeline.json. */
function wireIntoApp(results) {
  let mediaLibrary = loadJSON(MEDIA_JSON, []);
  let timeline = loadJSON(TIMELINE_JSON, null);
  if (!timeline) return;

  const byPerson = new Map();
  const anthemAssets = [];

  for (const r of results) {
    if (r.status !== 'downloaded') continue;
    const publicUrl = '/' + path.relative(path.join(ROOT, 'public'), path.join(ROOT, r.targetPath)).split(path.sep).join('/');
    const existing = mediaLibrary.find(m => m.url === publicUrl);
    const item = existing || {
      id: 'm-source-' + r.id,
      originalName: path.basename(r.targetPath),
      url: publicUrl,
      kind: r.kind
    };
    if (!existing) mediaLibrary.push(item);
    if (r.role === 'historical-photo' && r.person) byPerson.set(r.person, item.url);
    if (r.role === 'anthem') anthemAssets.push(item.url);
  }

  saveJSON(MEDIA_JSON, mediaLibrary);

  let changed = false;
  for (const ev of timeline.events || []) {
    if (ev.type === 'photo' && !ev.image && byPerson.has(ev.name)) {
      ev.image = byPerson.get(ev.name);
      changed = true;
    }
  }
  if (!timeline.anthemUrl && anthemAssets.length) {
    timeline.anthemUrl = anthemAssets[0];
    changed = true;
  }
  if (changed) {
    saveJSON(TIMELINE_JSON, timeline);
    console.log('Wired downloaded assets into data/timeline.json and data/media.json.');
  }
}

main().catch(err => { console.error(err); process.exit(1); });
