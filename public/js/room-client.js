// Shared transport and server-clock estimate used by both screens.
window.ShareMusicRoom = (() => {
  const epoch = Date.now();
  const monotonicStart = performance.now();
  const localNow = () => epoch + performance.now() - monotonicStart;
  function connect({ role, label, onMessage, onConnection = () => {}, onClock = () => {} }) {
    let socket, retry, clockTimer, closed = false, offset = 0, samples = [];
    const pending = new Set();
    const send = message => {
      if (socket?.readyState !== WebSocket.OPEN) return false;
      socket.send(JSON.stringify(message)); return true;
    };
    function ping() {
      const t0 = localNow();
      pending.add(t0);
      if (pending.size > 10) pending.delete(pending.values().next().value);
      send({ type: 'clock:sync', t0 });
    }
    function open() {
      socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/local-ws`);
      socket.onopen = () => {
        samples = []; pending.clear();
        send({ type: 'register', role, label });
        ping(); clockTimer = setInterval(ping, 2000);
        onConnection(true);
      };
      socket.onmessage = event => {
        let message;
        try { message = JSON.parse(event.data); } catch (_) { return; }
        if (!message || typeof message !== 'object') return;
        if (message.type === 'clock:sync' && pending.delete(message.t0) && Number.isFinite(message.serverTime)) {
          const now = localNow(), rtt = now - message.t0;
          if (rtt < 0 || rtt > 10000) return;
          samples.push({ rtt, offset: message.serverTime - (message.t0 + now) / 2 });
          samples = samples.slice(-8);
          offset = samples.reduce((best, item) => item.rtt < best.rtt ? item : best).offset;
          onClock(); return;
        }
        if (message.type === 'state' && Number.isFinite(message.state?.serverNow) && !samples.length) offset = message.state.serverNow - localNow();
        onMessage(message);
      };
      socket.onclose = () => {
        clearInterval(clockTimer); pending.clear(); onConnection(false);
        if (!closed) retry = setTimeout(open, 1500);
      };
      socket.onerror = () => socket.close();
    }
    open();
    return { send, now: () => localNow() + offset, close() { closed = true; clearTimeout(retry); clearInterval(clockTimer); socket.close(); } };
  }
  function elapsed(state, now) {
    const position = Number(state.positionMs ?? state.pausedAtMs ?? 0);
    const delta = state.status === 'running' && state.startAt != null ? Math.max(0, now - state.startAt) * (state.playbackRate || 1) : 0;
    return Math.min(state.track?.durationMs || 0, Math.max(0, position + delta));
  }
  const format = ms => { const seconds = Math.max(0, Math.floor(ms / 1000)); return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; };
  return { connect, elapsed, format };
})();
