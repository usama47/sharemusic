function voiceMocks() {
  const calls = { capture: [], streams: [], contexts: [], pcs: [] };
  class Stream {
    constructor(tracks = [{ kind: 'audio', enabled: true, stopped: false, stop() { this.stopped = true; } }]) { this.tracks = tracks; }
    getTracks() { return this.tracks; }
    getAudioTracks() { return this.tracks.filter(track => track.kind === 'audio'); }
  }
  class AudioContext {
    constructor() { this.state = 'suspended'; this.sources = []; this.analysers = []; this.gains = []; calls.contexts.push(this); }
    async resume() { this.state = 'running'; }
    async close() { this.state = 'closed'; }
    createMediaStreamSource(stream) { const source = { stream, connected: false, connect() { this.connected = true; }, disconnect() { this.connected = false; } }; this.sources.push(source); return source; }
    createAnalyser() { const analyser = { fftSize: 512, level: 0, connect() {}, disconnect() {}, getFloatTimeDomainData(samples) { samples.fill(this.level); } }; this.analysers.push(analyser); return analyser; }
    createGain() { const gain = { gain: { value: 1 }, connect() {}, disconnect() {} }; this.gains.push(gain); return gain; }
  }
  class PC {
    constructor(options) { this.options = options; this.connectionState = 'new'; this.candidates = []; this.tracks = []; calls.pcs.push(this); }
    addTrack(track) { this.tracks.push(track); }
    async createOffer() { return { type: 'offer', sdp: 'test-offer' }; }
    async createAnswer() { return { type: 'answer', sdp: 'test-answer' }; }
    async setLocalDescription(value) { this.localDescription = value; }
    async setRemoteDescription(value) { this.remoteDescription = value; }
    async addIceCandidate(value) { this.candidates.push(value); }
    close() { this.connectionState = 'closed'; }
  }
  const prepare = ({ context, window }) => {
    context.MediaStream = Stream;
    window.AudioContext = AudioContext; window.RTCPeerConnection = PC;
    window.navigator.mediaDevices = { getUserMedia: async constraints => {
      calls.capture.push(constraints);
      const stream = new Stream(); calls.streams.push(stream); return stream;
    } };
  };
  return { prepare, calls, Stream };
}
module.exports = { voiceMocks };
