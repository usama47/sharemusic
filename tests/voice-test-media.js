// Loaded ONLY by the disposable smoke host with --voice-test, never by /voice.
(() => {
  const badge = document.createElement('p');
  badge.id = 'voice-test-stats'; badge.textContent = 'Synthetic microphone test. No real microphone used.';
  document.body.prepend(badge);
  const nativePC = window.RTCPeerConnection;
  const connections = new Set();
  window.RTCPeerConnection = class extends nativePC {
    constructor(options) { super(options); connections.add(this); }
    close() { connections.delete(this); super.close(); }
  };
  Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => {
    const sourceContext = new AudioContext();
    const oscillator = sourceContext.createOscillator();
    const gain = sourceContext.createGain(); gain.gain.value = 0.005;
    const destination = sourceContext.createMediaStreamDestination();
    oscillator.connect(gain).connect(destination); oscillator.start(); await sourceContext.resume();
    const track = destination.stream.getAudioTracks()[0], stop = track.stop.bind(track);
    track.stop = () => { stop(); oscillator.stop(); sourceContext.close(); };
    return destination.stream;
  } });
  setInterval(async () => {
    let bytes = 0, energy = 0, connected = 0;
    for (const pc of connections) {
      if (pc.connectionState === 'connected') connected++;
      const stats = await pc.getStats();
      stats.forEach(report => { if (report.type === 'inbound-rtp' && report.kind === 'audio') { bytes += report.bytesReceived || 0; energy += report.totalAudioEnergy || 0; } });
    }
    badge.textContent = `Synthetic microphone test (no real microphone). Connected: ${connected}; received audio bytes: ${bytes}; decoded energy: ${energy.toFixed(8)}`;
  }, 1000);
})();
