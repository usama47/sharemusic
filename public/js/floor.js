(() => {
  'use strict';

  const params = new URLSearchParams(location.search);
  const screenRole = params.get('screen') === 'extended' ? 'extended' : 'main';
  const DEFAULT_ANTHEM = '/media/anthem/pakistan-national-anthem.mp3';

  const el = {
    join: document.getElementById('screen-join'), waiting: document.getElementById('screen-waiting'),
    countdown: document.getElementById('countdown'), countdownNum: document.getElementById('countdown-num'),
    main: document.getElementById('screen-main'), extended: document.getElementById('screen-extended'), final: document.getElementById('screen-final'),
    btnJoin: document.getElementById('btn-join'), btnOpenExtended: document.getElementById('btn-open-extended'), btnFullscreen: document.getElementById('btn-fullscreen'),
    stageFullscreenMain: document.getElementById('stage-fullscreen-main'), stageFullscreenExtended: document.getElementById('stage-fullscreen-extended'),
    waitingTitle: document.getElementById('waiting-title'), waitingSub: document.getElementById('waiting-sub'),
    connDot: document.getElementById('conn-dot'), connLabel: document.getElementById('conn-label'), waitingMeta: document.getElementById('waiting-meta'),
    flagImage: document.getElementById('flag-image'), anthem: document.getElementById('anthem-audio'), secondary: document.getElementById('secondary-audio'),
    photoA: document.getElementById('photo-a'), photoB: document.getElementById('photo-b'), reconnectBanner: document.getElementById('reconnect-banner')
  };

  let timeline = null, joined = screenRole === 'extended', status = 'idle';
  let startAt = null, pausedAtMs = 0, raf = 0, countdownTimer = 0, countdownStartedFor = null;
  let lastPhotoId = null, photoToggle = false, audioUnlocked = false;
  let clientSeed = Math.floor(Math.random() * 0x7fffffff);
  let displaySequence = new Map();
  let lastAudioTry = { anthem: 0, secondary: 0 };

  function log(...args) { console.log(`[FLOOR:${screenRole}]`, ...args); }
  function warn(...args) { console.warn(`[FLOOR:${screenRole}]`, ...args); }

  function showOnly(section) {
    document.body.classList.toggle('presentation-mode', section === el.main || section === el.extended || section === el.final);
    [el.join, el.waiting, el.countdown, el.main, el.extended, el.final].forEach(s => {
      if (s) s.classList.toggle('hidden', s !== section);
    });
    if (section) {
      section.classList.remove('fade-in'); void section.offsetWidth; section.classList.add('fade-in');
    }
  }
  function setMeta(text) { if (el.waitingMeta) el.waitingMeta.textContent = text || ''; }

  function loadTimeline() {
    return fetch('/api/timeline?ts=' + Date.now(), { cache: 'no-store' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`Timeline HTTP ${r.status}`)))
      .then(t => {
        timeline = t;
        if (!timeline.anthemUrl) timeline.anthemUrl = DEFAULT_ANTHEM;
        buildDisplaySequence();
        return t;
      })
      .catch(err => {
        warn('timeline load failed', err);
        timeline = timeline || { countdownMs: 7000, totalMs: 600000, anthemUrl: DEFAULT_ANTHEM, events: [] };
        buildDisplaySequence();
        return timeline;
      });
  }
  const timelineReady = loadTimeline();

  function hashSeed(s) {
    let h = 2166136261 ^ clientSeed;
    for (let i=0; i<s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
  }
  function mulberry32(a) {
    return function() { let t = a += 0x6D2B79F5; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  function shuffle(arr, seed) {
    const a = arr.slice(), rnd = mulberry32(seed);
    for (let i=a.length-1;i>0;i--) { const j=Math.floor(rnd()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; }
    return a;
  }
  function buildDisplaySequence() {
    displaySequence = new Map();
    const groups = new Map();
    for (const ev of (timeline?.events || [])) {
      if (ev.type !== 'photo') continue;
      const key = ev.decade || 'timeline';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(ev);
    }
    for (const [key, events] of groups) {
      const pool = events.flatMap(e => Array.isArray(e.imagePool) ? e.imagePool : (e.image ? [e.image] : []));
      const unique = [...new Set(pool)];
      if (!unique.length) continue;
      const order = shuffle(unique, hashSeed(key));
      events.sort((a,b)=>a.time-b.time).forEach((ev,i) => {
        // Different laptops get a different image order, while the timing stays identical.
        displaySequence.set(ev.id, order[i % order.length]);
      });
    }
  }

  if (screenRole === 'extended') {
    el.btnOpenExtended?.classList.add('hidden');
    el.waitingTitle.textContent = 'Extended Display Ready';
    el.waitingSub.textContent = 'Waiting for the synchronized presentation';
    joined = true; showOnly(el.waiting);
  }

  async function enterFullscreen() {
    try { if (!document.fullscreenElement) await (document.documentElement.requestFullscreen?.() || Promise.resolve()); }
    catch (_) { setMeta('Fullscreen was blocked. Press F11 to fill the display.'); }
  }
  el.btnFullscreen?.addEventListener('click', enterFullscreen);
  el.stageFullscreenMain?.addEventListener('click', enterFullscreen);
  el.stageFullscreenExtended?.addEventListener('click', enterFullscreen);
  document.addEventListener('dblclick', () => {
    const visible = screenRole === 'main' ? !el.main.classList.contains('hidden') : !el.extended.classList.contains('hidden');
    if (visible) enterFullscreen();
  });

  const socket = io({ transports: ['websocket', 'polling'], reconnection: true, reconnectionAttempts: Infinity });
  const clock = new ClockSync(socket);

  socket.on('connect', () => {
    el.connDot.className = 'dot dot--ok'; el.connLabel.textContent = 'Connected'; el.reconnectBanner.classList.add('hidden');
    socket.emit('register', { role: 'floor', screen: screenRole, label: guessLabel() });
    clock.start();
    if (joined) socket.emit('floor:ready', true);
  });
  socket.on('disconnect', () => {
    el.connDot.className = 'dot dot--bad'; el.connLabel.textContent = 'Disconnected — retrying…'; el.reconnectBanner.classList.remove('hidden');
  });

  socket.on('presentation:state', state => {
    timeline = state.timeline || timeline;
    if (timeline && !timeline.anthemUrl) timeline.anthemUrl = DEFAULT_ANTHEM;
    status = state.status || 'idle'; startAt = state.startAt || null; pausedAtMs = Number(state.elapsedMs || 0);
    buildDisplaySequence();
    if (joined) reconcile();
  });
  socket.on('timeline:updated', tl => { timeline = tl; if (!timeline.anthemUrl) timeline.anthemUrl = DEFAULT_ANTHEM; buildDisplaySequence(); });

  socket.on('presentation:start', p => {
    resetRun();
    timeline = p.timeline || timeline; startAt = Number(p.startAt || 0); pausedAtMs = 0; status = 'counting';
    buildDisplaySequence();
    if (joined) beginCountdownThenRun();
  });
  socket.on('presentation:pause', p => {
    pausedAtMs = Number(p.pausedAtMs || elapsedMs()); status = 'paused'; stopLoop();
    pauseAudio(el.audio); pauseAudio(el.secondary);
  });
  socket.on('presentation:resume', p => {
    startAt = Number(p.startAt || 0); status = 'running';
    if (joined) { enterStage(); startLoop(); }
  });
  socket.on('presentation:stop', () => { status='idle'; startAt=null; pausedAtMs=0; resetRun(); if (joined) showOnly(el.waiting); });
  socket.on('presentation:end', () => { status='ended'; stopLoop(); pauseAudio(el.anthem); pauseAudio(el.secondary); showOnly(el.final); });

  function resetRun() {
    stopLoop(); clearInterval(countdownTimer); countdownStartedFor=null; lastPhotoId=null; photoToggle=false;
    for (const a of [el.anthem, el.secondary]) { if (!a) continue; a.pause(); try { a.currentTime=0; } catch(_){} a.playbackRate=1; }
  }
  function pauseAudio(a) { if (a) { try { a.pause(); } catch(_){} a.playbackRate=1; } }

  function guessLabel() { return (screenRole === 'extended' ? 'Extended-' : 'Main-') + Math.random().toString(36).slice(2, 7); }

  async function prepareAudioElement(a, src) {
    if (!a || !src) return false;
    a.src = new URL(src, location.href).href; a.preload='auto'; a.playsInline=true; a.load();
    try {
      a.muted=true; a.currentTime=0; const p=a.play(); if(p) await p; a.pause(); a.currentTime=0; a.muted=false; return true;
    } catch(e) { a.pause(); a.muted=false; warn('audio permission failed', e); return false; }
  }
  async function prepareAudio() {
    if (screenRole !== 'main') return;
    const a = timeline?.anthemUrl || DEFAULT_ANTHEM;
    const b = timeline?.secondaryAudioUrl || '/media/secondary/dil-say-pakistan.mp3';
    const ok1 = await prepareAudioElement(el.anthem, a);
    const ok2 = await prepareAudioElement(el.secondary, b);
    audioUnlocked = ok1 && ok2;
    setMeta(audioUnlocked ? 'Audio ready · synchronized playback armed' : 'Audio permission needs attention — use Join again.');
  }

  el.btnJoin?.addEventListener('click', async () => {
    joined=true;
    if(screenRole==='main') await prepareAudio();
    await timelineReady;
    socket.emit('floor:ready', true);
    showOnly(el.waiting); reconcile();
  });

  el.btnOpenExtended?.addEventListener('click', async () => {
    const win = window.open('/floor?screen=extended', 'pk-extended', 'popup,width=1280,height=720');
    if(!win){ alert('Allow pop-ups for this site, then click again.'); return; }
    try { win.focus(); } catch(_){}
    if(window.getScreenDetails){
      try {
        const details=await window.getScreenDetails(); const secondary=details.screens.find(s=>!s.isPrimary)||details.screens[1];
        if(secondary && !win.closed){ try{win.moveTo(secondary.availLeft,secondary.availTop); win.resizeTo(secondary.availWidth,secondary.availHeight);}catch(_){} }
      }catch(_){}
    }
  });

  function reconcile() {
    if(status==='idle'){showOnly(el.waiting);return;}
    if(status==='counting'){beginCountdownThenRun();return;}
    if(status==='paused'){enterStage();renderAtElapsed(pausedAtMs);syncAllAudio(pausedAtMs,true);return;}
    if(status==='running'){enterStage();startLoop();return;}
    if(status==='ended'){showOnly(el.final);}
  }
  function beginCountdownThenRun() {
    const target=Number(startAt||0); if(!target || countdownStartedFor===target)return;
    countdownStartedFor=target; clearInterval(countdownTimer);
    const tick=()=>{
      const remain=target-clock.now(); const sec=Math.max(1,Math.ceil(remain/1000));
      if(remain>0){showOnly(el.countdown);el.countdownNum.textContent=sec;}
      else{clearInterval(countdownTimer);countdownStartedFor=null;status='running';enterStage();startLoop();}
    };
    tick(); countdownTimer=setInterval(tick,50);
  }
  function enterStage(){ showOnly(screenRole==='extended'?el.extended:el.main); requestAnimationFrame(()=>renderAtElapsed(elapsedMs())); }
  function elapsedMs(){ if(status==='paused')return pausedAtMs; return startAt?Math.max(0,clock.now()-startAt):0; }

  function startLoop(){
    if(raf)return;
    const frame=()=>{
      raf=requestAnimationFrame(frame);
      if(!timeline)return;
      const e=elapsedMs();
      renderAtElapsed(e);
      if(screenRole==='main') syncAllAudio(e,false);
      if(Number(timeline.totalMs)&&e>=Number(timeline.totalMs)) finish();
    };
    raf=requestAnimationFrame(frame);
  }
  function stopLoop(){if(raf)cancelAnimationFrame(raf);raf=0;}

  function renderAtElapsed(e){
    if(!timeline)return;
    const final=timeline.events?.find(x=>x.type==='final');
    if(final && e>=final.time){finish();return;}
    if(screenRole!=='extended')return;
    let photo=null;
    for(const ev of timeline.events||[]) if(ev.type==='photo'&&e>=ev.time) photo=ev;
    if(photo)renderTributePhoto(photo);
  }
  function renderTributePhoto(photo){
    const chosen=displaySequence.get(photo.id)||photo.image;
    if(!chosen || photo.id===lastPhotoId)return;
    lastPhotoId=photo.id;
    const show=photoToggle?el.photoB:el.photoA, hide=photoToggle?el.photoA:el.photoB; photoToggle=!photoToggle;
    const img=show.querySelector('.poster-image'), backdrop=show.querySelector('.poster-backdrop');
    const url=new URL(chosen,location.href).href;
    show.classList.remove('is-visible'); hide.classList.remove('is-visible');
    const reveal=()=>{
      show.style.setProperty('--poster-bg',`url("${url}")`);
      if(backdrop)backdrop.style.backgroundImage=`url("${url}")`;
      show.classList.remove('is-kenburns-a','is-kenburns-b'); void show.offsetWidth;
      show.classList.add(photoToggle?'is-kenburns-b':'is-kenburns-a','is-visible');
      hide.classList.remove('is-visible');
    };
    img.onload=reveal; img.onerror=()=>warn('image failed',url); img.src=url+(url.includes('?')?'&':'?')+'v=final2';
    if(img.complete && img.naturalWidth) reveal();
  }

  function anthemStart(){return Number((timeline?.events||[]).find(e=>e.type==='anthem-start')?.time||0);}
  function secondaryStart(){
    const e=(timeline?.events||[]).find(x=>x.type==='secondary-audio-start');
    return Number(e?.time ?? timeline?.secondaryAudioStartMs ?? 142939);
  }

  async function syncOne(a, expected, key, force){
    if(!a)return;
    const now=performance.now();
    if(expected<0){pauseAudio(a);return;}
    if(Number.isFinite(a.duration)&&a.duration>0&&expected>=a.duration-0.10){ if(!a.paused)a.pause(); return; }
    if(force || Math.abs((a.currentTime||0)-expected)>0.30){try{a.currentTime=Math.max(0,expected);}catch(_){}}
    if(a.paused||a.ended){
      if(now-lastAudioTry[key]<300)return;
      lastAudioTry[key]=now;
      try{await a.play();audioUnlocked=true;}catch(e){warn(`${key} playback blocked`,e);}
    } else {
      const diff=expected-a.currentTime;
      a.playbackRate=Math.abs(diff)>0.06?(diff>0?1.02:0.98):1;
    }
  }
  async function syncAllAudio(e,force){
    if(screenRole!=='main'||!timeline)return;
    const aStart=anthemStart(), sStart=secondaryStart();
    if(e>=aStart && e<sStart) await syncOne(el.anthem,(e-aStart)/1000,'anthem',force); else pauseAudio(el.anthem);
    if(e>=sStart && e<(Number(timeline.totalMs)||600000)) await syncOne(el.secondary,(e-sStart)/1000,'secondary',force); else pauseAudio(el.secondary);
  }
  function finish(){if(status==='ended')return;status='ended';stopLoop();pauseAudio(el.anthem);pauseAudio(el.secondary);showOnly(el.final);}

  document.addEventListener('visibilitychange',()=>{if(!document.hidden){clock.ping();if(joined&&(status==='running'||status==='paused')){enterStage();startLoop();}}});
  window.addEventListener('error',e=>warn('window error',e.error||e.message));
  window.addEventListener('unhandledrejection',e=>warn('promise rejection',e.reason));
})();
