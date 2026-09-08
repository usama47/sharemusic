/**
 * Given a timeline definition and an elapsed-ms value, resolves exactly
 * what should be on screen right now. Kept pure/stateless so both the
 * main (flag) screen and extended (tribute) screen derive identical
 * results from the same inputs — that identity is what "synchronized"
 * actually means here, rather than each screen guessing independently.
 */
function resolveTimelineState(timeline, elapsedMs) {
  const events = [...(timeline.events || [])].sort((a, b) => a.time - b.time);
  const photos = events.filter(e => e.type === 'photo');
  const finalEvent = events.find(e => e.type === 'final');
  const flagStart = events.find(e => e.type === 'flag-start');
  const anthemStart = events.find(e => e.type === 'anthem-start');

  const ended = finalEvent ? elapsedMs >= finalEvent.time : elapsedMs >= (timeline.totalMs || Infinity);

  let currentPhoto = null;
  for (const p of photos) {
    if (elapsedMs >= p.time) currentPhoto = p;
    else break;
  }
  // Progress (0..1) of the current photo's dwell time, for Ken Burns pacing.
  let photoProgress = 0;
  if (currentPhoto) {
    const idx = photos.indexOf(currentPhoto);
    const next = photos[idx + 1];
    const segEnd = next ? next.time : (finalEvent ? finalEvent.time : (timeline.totalMs || currentPhoto.time + 30000));
    const segStart = currentPhoto.time;
    photoProgress = Math.min(1, Math.max(0, (elapsedMs - segStart) / Math.max(1, segEnd - segStart)));
  }

  return {
    ended,
    flagOn: flagStart ? elapsedMs >= flagStart.time : true,
    anthemOn: anthemStart ? (elapsedMs >= anthemStart.time && !ended) : false,
    currentPhoto: ended ? null : currentPhoto,
    photoProgress,
    elapsedMs
  };
}

/**
 * Drives a requestAnimationFrame loop, calling onTick(state) whenever the
 * resolved visual state changes meaningfully (photo change / ended flag),
 * and onFrame(elapsedMs) every frame for smooth things like progress bars.
 */
class TimelineScheduler {
  constructor({ getElapsedMs, getTimeline, onTick, onFrame }) {
    this.getElapsedMs = getElapsedMs;
    this.getTimeline = getTimeline;
    this.onTick = onTick;
    this.onFrame = onFrame;
    this._lastKey = null;
    this._raf = null;
  }
  start() {
    const loop = () => {
      const elapsed = this.getElapsedMs();
      const tl = this.getTimeline();
      if (tl) {
        const s = resolveTimelineState(tl, elapsed);
        const key = `${s.flagOn}|${s.anthemOn}|${s.currentPhoto ? s.currentPhoto.id : 'none'}|${s.ended}`;
        if (key !== this._lastKey) {
          this._lastKey = key;
          this.onTick(s);
        }
        if (this.onFrame) this.onFrame(s);
      }
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }
  stop() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._lastKey = null;
  }
}
