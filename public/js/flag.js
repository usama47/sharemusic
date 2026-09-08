/** Smooth, lightweight canvas fabric flag. No SVG filters/SMIL required. */
function buildFlagCanvas(mount, { animate = true } = {}) {
  mount.innerHTML = '';
  const canvas = document.createElement('canvas');
  canvas.className = 'pk-flag-canvas';
  canvas.setAttribute('aria-label', 'Flag of Pakistan');
  mount.appendChild(canvas);
  const ctx = canvas.getContext('2d', { alpha: false });
  let raf = 0;
  let running = true;
  const DPR = Math.min(window.devicePixelRatio || 1, 2);

  function resize() {
    const w = Math.max(1, mount.clientWidth);
    const h = Math.max(1, mount.clientHeight);
    canvas.width = Math.floor(w * DPR);
    canvas.height = Math.floor(h * DPR);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  window.addEventListener('resize', resize, { passive: true });
  const resizeObserver = typeof ResizeObserver !== 'undefined'
    ? new ResizeObserver(() => resize())
    : null;
  if (resizeObserver) resizeObserver.observe(mount);
  resize();

  function draw(t) {
    if (!running) return;
    const w = mount.clientWidth || 1, h = mount.clientHeight || 1;
    // Preserve the 3:2 flag ratio, filling the screen without stretching.
    const flagRatio = 3 / 2;
    let fw = w, fh = w / flagRatio;
    if (fh < h) { fh = h; fw = h * flagRatio; }
    const x0 = (w - fw) / 2, y0 = (h - fh) / 2;
    const amp = Math.min(fw * 0.018, 28);
    const period = Math.max(220, fw / 3.2);
    const speed = 0.00045;

    ctx.fillStyle = '#06140d';
    ctx.fillRect(0, 0, w, h);

    // Draw a grid of narrow vertical fabric strips. Each strip is displaced
    // slightly in Y and receives a gentle light/shadow band.
    const strips = Math.max(100, Math.floor(fw / 8));
    const stripW = fw / strips;
    for (let i = 0; i < strips; i++) {
      const u = i / (strips - 1);
      const px = x0 + i * stripW;
      const wave = Math.sin(i / (period / stripW) + t * speed) * amp * (0.25 + 0.75 * u);
      const wave2 = Math.sin(i / (period / stripW) * 0.52 + t * speed * 0.62) * amp * 0.35 * u;
      const py = y0 + wave + wave2;
      const scaleX = 1 + Math.sin(i / (period / stripW) + t * speed) * 0.012;
      const sw = stripW * scaleX + 1;

      ctx.save();
      ctx.translate(px, py);
      const isWhite = u < 0.25;
      ctx.fillStyle = isWhite ? '#f7f7f2' : '#01411c';
      ctx.fillRect(0, 0, sw, fh);
      // Low-amplitude fabric lighting, strongest toward the fly edge.
      const shade = 0.055 + 0.045 * Math.sin(i / (period / stripW) + t * speed * 1.2);
      const grad = ctx.createLinearGradient(0, 0, sw, 0);
      grad.addColorStop(0, `rgba(0,0,0,${shade})`);
      grad.addColorStop(0.5, `rgba(255,255,255,${shade * 0.35})`);
      grad.addColorStop(1, `rgba(0,0,0,${shade})`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, sw, fh);
      ctx.restore();
    }

    // Draw the crescent and star once on the same wave field, using a gentle
    // global offset so they feel printed onto cloth without becoming warped.
    const dx = x0 + fw * 0.25, fieldW = fw * 0.75;
    const cx = dx + fieldW * 0.50 + Math.sin(t * speed) * amp * 0.20;
    const cy = y0 + fh * 0.50;
    const R = fh * 0.235;
    const crescent = ctx.createRadialGradient(cx - R * 0.22, cy - R * 0.08, R * 0.08, cx, cy, R);
    crescent.addColorStop(0, '#fff'); crescent.addColorStop(1, '#e9eee9');
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fillStyle = crescent; ctx.fill();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath(); ctx.arc(cx + R * 0.34, cy - R * 0.16, R * 0.92, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    const sx = cx + R * 0.90, sy = cy - R * 0.08, outer = R * 0.39, inner = R * 0.16;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5;
      const r = i % 2 ? inner : outer;
      const x = sx + Math.cos(a) * r, y = sy + Math.sin(a) * r;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath(); ctx.fillStyle = '#fff'; ctx.fill();

    // Soft vignette for depth.
    const vignette = ctx.createRadialGradient(w/2, h/2, Math.min(w,h)*0.18, w/2, h/2, Math.max(w,h)*0.72);
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(0,0,0,0.28)');
    ctx.fillStyle = vignette; ctx.fillRect(0, 0, w, h);

    if (animate) raf = requestAnimationFrame(draw);
  }
  draw(performance.now());
  return { destroy() {
    running = false;
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', resize);
    if (resizeObserver) resizeObserver.disconnect();
  } };
}
