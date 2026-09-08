const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function browser(page, { epoch = 100000, prepare = () => {} } = {}) {
  let time = 0, wallJump = 0, timerId = 0;
  const timers = new Map(), sockets = [], elements = new Map();
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', `${page}.html`), 'utf8');
  class Element {
    constructor(id) { this.id = id; this.handlers = {}; this.textContent = ''; this.innerHTML = ''; this.style = {}; this.value = 0; this.src = ''; this.readyState = 4; this.paused = true; this.currentTime = 0; this.playbackRate = 1; this.muted = false; this.playCalls = 0; this.loadCalls = 0; this.children = []; const classes = new Set(); this.classList = { add: k => classes.add(k), remove: k => classes.delete(k), contains: k => classes.has(k), toggle: (k, on) => on ? classes.add(k) : classes.delete(k) }; }
    addEventListener(name, fn) { (this.handlers[name] ||= []).push(fn); }
    emit(name, event = {}) { for (const fn of this.handlers[name] || []) fn(event); }
    setAttribute(name, value) { (this.attributes ||= {})[name] = value; }
    replaceChildren(...items) { this.children = items; }
    setPointerCapture(id) { this.captured = id; }
    pause() { this.paused = true; }
    play() { this.playCalls++; if (this.playImpl) return this.playImpl(); this.paused = false; return Promise.resolve(); }
    load() { this.loadCalls++; }
    removeAttribute(name) { this[name] = ''; }
    querySelectorAll() { return []; }
    querySelector(name) { return this.parts?.[name] || (this.parts ||= {}, this.parts[name] = new Element(name)); }
    appendChild(item) { this.children.push(item); }
  }
  for (const [, id] of html.matchAll(/id="([^"]+)"/g)) elements.set(id, new Element(id));
  const document = { getElementById: id => elements.get(id) || null, createElement: () => new Element('created'), handlers: {}, addEventListener(name, fn) { this.handlers[name] = fn; } };
  class WS {
    static OPEN = 1;
    constructor() { this.readyState = 0; this.sent = []; sockets.push(this); }
    send(raw) { if (this.readyState !== 1) throw Error('closed socket send'); this.sent.push(JSON.parse(raw)); }
    open() { this.readyState = 1; this.onopen(); }
    close() { this.readyState = 3; this.onclose(); }
    receive(message) { this.onmessage({ data: typeof message === 'string' ? message : JSON.stringify(message) }); }
  }
  const addTimer = (fn, delay, repeat) => { const id = ++timerId; timers.set(id, { fn, due: time + delay, repeat }); return id; };
  const window = { navigator: {}, handlers: {}, isSecureContext: true, matchMedia: () => ({ matches: false }), addEventListener(name, fn) { this.handlers[name] = fn; } };
  const context = { window, document, navigator: window.navigator, location: { protocol: 'http:', host: 'localhost' }, WebSocket: WS, Date: { now: () => epoch + time + wallJump }, performance: { now: () => time }, console,
    setTimeout: (fn, delay) => addTimer(fn, delay, 0), clearTimeout: id => timers.delete(id), setInterval: (fn, delay) => addTimer(fn, delay, delay), clearInterval: id => timers.delete(id),
    fetch: async () => ({ ok: true, json: async () => [] }), Audio: Element, URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} }
  };
  prepare({ context, window, document, Element });
  vm.createContext(context);
  for (const [, src] of html.matchAll(/<script src="([^"]+)"/g)) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', src), 'utf8'), context, { filename: src });
  return { context, window, document, elements, sockets, timers, e: id => elements.get(id), time: () => epoch + time,
    jumpWall(ms) { wallJump += ms; }, move(ms) { time += ms; },
    advance(ms, intervals = true) {
      const end = time + ms;
      for (;;) {
        const next = [...timers].filter(([, t]) => t.due <= end && (intervals || !t.repeat)).sort((a, b) => a[1].due - b[1].due)[0];
        if (!next) break;
        const [id, timer] = next; time = Math.max(time, timer.due);
        if (timer.repeat) timer.due = time + timer.repeat; else timers.delete(id);
        timer.fn();
      }
      time = end;
    },
    state(values) { sockets.at(-1).receive({ type: 'state', state: { status: 'idle', track: { id: 'track', name: 'test.wav', url: '/local-media/test.wav', durationMs: 60000 }, startAt: null, positionMs: 0, playbackRate: 1, serverNow: epoch + time, ...values } }); }
  };
}
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
module.exports = { browser, flush };
