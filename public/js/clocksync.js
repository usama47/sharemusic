/** Reliable server-clock estimate using Date.now() on both ends. */
class ClockSync {
  constructor(socket) {
    this.socket = socket;
    this.offsetMs = 0;
    this.rttMs = 0;
    this.samples = [];
    socket.on('clock:sync:reply', ({ t0, serverTime }) => {
      const t3 = Date.now();
      const rtt = t3 - t0;
      const offset = serverTime - ((t0 + t3) / 2);
      this.samples.push({ offset, rtt });
      if (this.samples.length > 30) this.samples.shift();
      const best = [...this.samples].sort((a,b) => a.rtt-b.rtt).slice(0, Math.max(3, Math.ceil(this.samples.length/2)));
      this.offsetMs = best.reduce((a,x) => a + x.offset, 0) / best.length;
      this.rttMs = best.reduce((a,x) => a + x.rtt, 0) / best.length;
      this.socket.emit('clock:report', { offsetMs: this.offsetMs, rttMs: this.rttMs });
    });
  }
  ping() { this.socket.emit('clock:sync', Date.now()); }
  start({ burstCount=20, burstIntervalMs=200, idleIntervalMs=3000 }={}) {
    this.stop();
    this.ping();
    let sent = 0;
    const burst = setInterval(() => {
      this.ping(); sent++;
      if (sent >= burstCount) {
        clearInterval(burst);
        this._idle = setInterval(() => this.ping(), idleIntervalMs);
      }
    }, burstIntervalMs);
    this._burst = burst;
  }
  now() { return Date.now() + this.offsetMs; }
  stop() { if (this._burst) clearInterval(this._burst); if (this._idle) clearInterval(this._idle); }
}
