#!/usr/bin/env node
/**
 * Generates tasteful, entirely original SVG placeholder portrait cards
 * (initials + name on a Pakistan-flag-green field) for each tribute
 * figure. These are NOT stand-ins for real photographs pulled from the
 * internet — they are locally generated vector art — so the demo has
 * something dignified on screen immediately, and each one is silently
 * swapped for the verified archival photo (see media-sources.json) the
 * moment `npm run fetch-media` downloads it or an admin uploads one.
 */
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'public', 'media', 'historical', 'placeholders');
fs.mkdirSync(OUT_DIR, { recursive: true });

const PEOPLE = [
  { slug: 'muhammad-ali-jinnah', name: 'Muhammad Ali Jinnah', initials: 'MAJ', title: 'Founder of Pakistan' },
  { slug: 'allama-iqbal', name: 'Allama Muhammad Iqbal', initials: 'AI', title: 'Poet-philosopher of the Pakistan Movement' },
  { slug: 'fatima-jinnah', name: 'Fatima Jinnah', initials: 'FJ', title: 'Mother of the Nation' },
  { slug: 'liaquat-ali-khan', name: 'Liaquat Ali Khan', initials: 'LAK', title: 'First Prime Minister of Pakistan' }
];

function card({ initials, name }) {
  const W = 1200, H = 1500;
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escapeXml(name)} — photograph pending">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0a5a30"/>
      <stop offset="55%" stop-color="#01411C"/>
      <stop offset="100%" stop-color="#012a12"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="38%" r="60%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.10"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
  <rect x="40" y="40" width="${W - 80}" height="${H - 80}" fill="none" stroke="#ffffff" stroke-opacity="0.18" stroke-width="2"/>
  <circle cx="${W / 2}" cy="${H * 0.40}" r="230" fill="none" stroke="#ffffff" stroke-opacity="0.35" stroke-width="3"/>
  <text x="50%" y="${H * 0.40 + 46}" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="150" fill="#ffffff" fill-opacity="0.92">${escapeXml(initials)}</text>
  <text x="50%" y="${H * 0.72}" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="58" fill="#ffffff">${escapeXml(name)}</text>
  <text x="50%" y="${H * 0.72 + 54}" text-anchor="middle" font-family="Arial, sans-serif" font-size="26" letter-spacing="2" fill="#ffffff" fill-opacity="0.65">PHOTOGRAPH PENDING · SEE MEDIA SOURCES</text>
</svg>`;
}

function escapeXml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

for (const person of PEOPLE) {
  const file = path.join(OUT_DIR, `${person.slug}.svg`);
  fs.writeFileSync(file, card(person));
  console.log('Generated', path.relative(process.cwd(), file));
}
