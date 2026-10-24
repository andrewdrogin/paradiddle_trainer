import { listSamples, addSample, deleteSample } from './db.js';

const $ = id => document.getElementById(id);
const toDb = v => 20 * Math.log10(Math.max(v, 1e-6));

// ---------- settings ----------

const SETTINGS_KEY = 'pt.settings';
const LATENCY_KEY = 'pt.latency';
const settings = { sensDb: 18, guardMs: 60, bpm: 80, reps: 2, deviceId: '' };
try { Object.assign(settings, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); } catch {}
const saveSettings = () => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {} };

// ?demo feeds synthetic hits instead of the mic (for testing without a pad)
const DEMO = new URLSearchParams(location.search).has('demo');

// ---------- audio state ----------

let ctx = null;
let node = null;
let stream = null;
let source = null;
let wakeLock = null;

const levels = [];              // { t, db, thrDb } for the timeline
const hits = [];                // { t, db } every detected hit
let hitCount = 0;
let captureKind = null;         // 'soft' | 'accent' while waiting for a sample hit
let lastLevelT = 0;
let lastLevelPerf = 0;
let meterDb = -100;

async function ensureCtx() {
  if (!ctx) {
    ctx = new AudioContext({ latencyHint: 'interactive' });
    await ctx.audioWorklet.addModule('onset-worklet.js');
  }
  if (ctx.state !== 'running') await ctx.resume();
  return ctx;
}

async function start() {
  await ensureCtx();
  node = new AudioWorkletNode(ctx, 'onset', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    processorOptions: { sensDb: settings.sensDb, guardMs: settings.guardMs },
  });
  node.port.onmessage = onWorkletMessage;
  // keep the node pulled by the graph without making it audible
  const sink = ctx.createGain();
  sink.gain.value = 0;
  node.connect(sink).connect(ctx.destination);

  if (DEMO) {
    source = makeDemoSource(ctx);
    source.start();
  } else {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: settings.deviceId ? { exact: settings.deviceId } : undefined,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
    });
    source = ctx.createMediaStreamSource(stream);
  }
  source.connect(node);

  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch {}
  showDeviceInfo();
  fillDeviceList();
  $('startBtn').textContent = '■ Стоп';
  $('status').textContent = 'Слухаю…';
}

function stop() {
  stream?.getTracks().forEach(t => t.stop());
  if (DEMO) source?.stop();
  source?.disconnect();
  node?.disconnect();
  stream = source = node = null;
  wakeLock?.release().catch(() => {});
  wakeLock = null;
  endSeries();
  $('startBtn').textContent = '▶ Старт';
  $('status').textContent = 'Мікрофон вимкнено';
}

const running = () => !!node;

$('startBtn').onclick = async () => {
  if (running()) { stop(); return; }
  try {
    await start();
  } catch (e) {
    stop();
    $('status').textContent = 'Помилка: ' + (e.message || e.name);
  }
};

function onWorkletMessage(e) {
  const m = e.data;
  if (m.type === 'level') {
    levels.push({ t: m.time, db: m.db, thrDb: m.thrDb });
    while (levels.length && levels[0].t < m.time - TIMELINE_SEC - 1) levels.shift();
    lastLevelT = m.time;
    lastLevelPerf = performance.now();
    meterDb = Math.max(m.db, meterDb - 1.5);
    $('levelDb').textContent = m.db.toFixed(0);
    $('floorDb').textContent = m.floorDb.toFixed(0);
    $('thrDb').textContent = m.thrDb.toFixed(0);
    $('meterThr').style.left = dbToPct(m.thrDb) + '%';
  } else if (m.type === 'hit') {
    hits.push({ t: m.time, db: m.db });
    if (hits.length > 2000) hits.splice(0, 1000);
    hitCount++;
    $('hitCount').textContent = hitCount;
    drawBars();
    onCalibrationHit(m.time);
  } else if (m.type === 'capture') {
    onCapture(m);
  }
}

// ---------- device info ----------

function showDeviceInfo() {
  const info = { context: { sampleRate: ctx.sampleRate, baseLatency: ctx.baseLatency, outputLatency: ctx.outputLatency } };
  if (stream) {
    const track = stream.getAudioTracks()[0];
    $('deviceLabel').textContent = track.label || 'мікрофон';
    info.track = track.label;
    info.settings = track.getSettings();
  } else {
    $('deviceLabel').textContent = DEMO ? 'демо-сигнал (без мікрофона)' : '';
  }
  $('deviceInfo').textContent = JSON.stringify(info, null, 2);
}

async function fillDeviceList() {
  const sel = $('deviceSelect');
  const devices = (await navigator.mediaDevices?.enumerateDevices?.()) || [];
  sel.length = 1;
  for (const d of devices.filter(d => d.kind === 'audioinput')) {
    sel.add(new Option(d.label || d.deviceId.slice(0, 8), d.deviceId));
  }
  sel.value = settings.deviceId;
}

$('deviceSelect').onchange = async e => {
  settings.deviceId = e.target.value;
  saveSettings();
  if (running()) { stop(); await start(); }
};

// ---------- sliders ----------

function bindSlider(id, key, onChange) {
  const input = $(id);
  input.value = settings[key];
  $(id + 'Val').textContent = settings[key];
  input.oninput = () => {
    settings[key] = Number(input.value);
    $(id + 'Val').textContent = settings[key];
    saveSettings();
    onChange?.(settings[key]);
  };
}
bindSlider('sens', 'sensDb', v => node?.port.postMessage({ sensDb: v }));
bindSlider('guard', 'guardMs', v => node?.port.postMessage({ guardMs: v }));
bindSlider('bpm', 'bpm');
$('reps').value = settings.reps;
$('reps').onchange = e => { settings.reps = Number(e.target.value); saveSettings(); };

// ---------- counter ----------

$('resetBtn').onclick = () => {
  hitCount = 0;
  $('hitCount').textContent = 0;
  $('checkResult').textContent = '';
};

$('checkBtn').onclick = () => {
  const n = Number($('playedN').value);
  const d = hitCount - n;
  const el = $('checkResult');
  if (d === 0) el.innerHTML = `<span class="ok">✓ Усі ${n} ударів виявлено</span>`;
  else if (d < 0) el.innerHTML = `<span class="bad">Пропущено ${-d} з ${n}</span>`;
  else el.innerHTML = `<span class="bad">Зайвих спрацювань: ${d}</span> (виявлено ${hitCount} на ${n})`;
};

// ---------- timeline + meter ----------

const TIMELINE_SEC = 6;
const DB_MIN = -80;
const dbToPct = db => Math.min(100, Math.max(0, (db - DB_MIN) / -DB_MIN * 100));

function fitCanvas(c) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(c.clientWidth * dpr);
  const h = Math.round(c.clientHeight * dpr);
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  const g = c.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0);
  return { g, w, h, dpr };
}

function drawTimeline() {
  const { g, w, h, dpr } = fitCanvas($('timeline'));
  g.clearRect(0, 0, w, h);
  const now = lastLevelT + (performance.now() - lastLevelPerf) / 1000;
  const x = t => w - (now - t) / TIMELINE_SEC * w;
  const y = db => h - dbToPct(db) / 100 * h;

  g.strokeStyle = '#222a33';
  g.fillStyle = '#5b6573';
  g.font = `${11 * dpr}px system-ui`;
  g.lineWidth = 1;
  for (let db = -60; db < 0; db += 20) {
    g.beginPath(); g.moveTo(0, y(db)); g.lineTo(w, y(db)); g.stroke();
    g.fillText(db + ' дБ', 4 * dpr, y(db) - 3 * dpr);
  }

  if (levels.length) {
    g.beginPath();
    g.moveTo(x(levels[0].t), h);
    for (const l of levels) g.lineTo(x(l.t), y(l.db));
    g.lineTo(x(levels[levels.length - 1].t), h);
    g.closePath();
    g.fillStyle = 'rgba(79,195,247,.35)';
    g.fill();

    g.beginPath();
    levels.forEach((l, i) => i ? g.lineTo(x(l.t), y(l.thrDb)) : g.moveTo(x(l.t), y(l.thrDb)));
    g.strokeStyle = 'rgba(255,107,107,.8)';
    g.lineWidth = 1.5 * dpr;
    g.stroke();
  }

  g.fillStyle = '#ffd166';
  g.textAlign = 'center';
  let labelX = Infinity;
  for (let i = hits.length - 1; i >= 0 && hits[i].t > now - TIMELINE_SEC; i--) {
    const hx = x(hits[i].t), hy = y(hits[i].db);
    g.beginPath(); g.arc(hx, hy, 5 * dpr, 0, Math.PI * 2); g.fill();
    if (labelX - hx > 22 * dpr) {
      g.fillText(hits[i].db.toFixed(0), hx, hy - 8 * dpr);
      labelX = hx;
    }
  }
  g.textAlign = 'start';

  meterDb -= 0.3;
  $('meterFill').style.width = dbToPct(meterDb) + '%';
}

function frame() {
  drawTimeline();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------- accent bars ----------

const BAR_COUNT = 24;

// best split of sorted values into two groups (1-D 2-means)
function splitTwo(sorted) {
  let best = null;
  for (let k = 1; k < sorted.length; k++) {
    const a = sorted.slice(0, k), b = sorted.slice(k);
    const ma = mean(a), mb = mean(b);
    const cost = a.reduce((s, v) => s + (v - ma) ** 2, 0) + b.reduce((s, v) => s + (v - mb) ** 2, 0);
    if (!best || cost < best.cost) best = { cost, cut: (sorted[k - 1] + sorted[k]) / 2, ma, mb, gap: sorted[k] - sorted[k - 1] };
  }
  return best;
}
const mean = a => a.reduce((s, v) => s + v, 0) / a.length;

function drawBars() {
  const { g, w, h, dpr } = fitCanvas($('bars'));
  g.clearRect(0, 0, w, h);
  const recent = hits.slice(-BAR_COUNT);
  if (!recent.length) return;

  const dbs = recent.map(r => r.db);
  const split = recent.length >= 4 ? splitTwo([...dbs].sort((a, b) => a - b)) : null;
  const twoGroups = split && split.mb - split.ma >= 4;
  const top = Math.max(...dbs) + 3;
  const bottom = Math.min(Math.min(...dbs) - 10, top - 30);
  const y = db => h - (db - bottom) / (top - bottom) * (h - 16 * dpr);
  const bw = w / BAR_COUNT;

  g.font = `${10 * dpr}px system-ui`;
  g.textAlign = 'center';
  recent.forEach((r, i) => {
    const loud = twoGroups && r.db > split.cut;
    g.fillStyle = loud ? '#ff9f43' : '#4fc3f7';
    g.fillRect(i * bw + bw * 0.15, y(r.db), bw * 0.7, h - y(r.db));
    g.fillStyle = '#e6e9ee';
    g.fillText(r.db.toFixed(0), i * bw + bw / 2, y(r.db) - 3 * dpr);
  });

  const el = $('accentStats');
  if (twoGroups) {
    g.strokeStyle = 'rgba(255,255,255,.4)';
    g.setLineDash([4 * dpr, 4 * dpr]);
    g.beginPath(); g.moveTo(0, y(split.cut)); g.lineTo(w, y(split.cut)); g.stroke();
    g.setLineDash([]);
    const cls = split.gap >= 4 ? 'ok' : 'bad';
    el.innerHTML = `Тихі ≈ <b>${split.ma.toFixed(0)}</b> дБ, акценти ≈ <b>${split.mb.toFixed(0)}</b> дБ, різниця <b>${(split.mb - split.ma).toFixed(0)}</b> дБ. ` +
      `<span class="${cls}">Розрив між групами: ${split.gap.toFixed(1)} дБ ${split.gap >= 4 ? '— розділяються чітко' : '— групи майже зливаються'}</span>`;
  } else {
    el.textContent = recent.length >= 4 ? 'Поки що всі удари схожої гучності (одна група).' : '';
  }
}

// ---------- clicks ----------

function click(t, freq, gain) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.frequency.value = freq;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.002);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + 0.06);
}

// ---------- latency calibration ----------

const CAL_BEAT = 60 / 80;
const CAL_COUNT_IN = 4;
const CAL_CLICKS = 8;
let cal = null;   // { clicks: [t], hits: [t], timer }

function showSavedLatency() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(LATENCY_KEY)); } catch {}
  if (saved) $('calResult').innerHTML = `Збережена затримка: <b>${saved.offsetMs} мс</b> (розкид ±${saved.spreadMs} мс, ${new Date(saved.date).toLocaleString('uk')})`;
}
showSavedLatency();

$('calBtn').onclick = () => {
  if (!running()) { $('calResult').textContent = 'Спочатку натисни «Старт».'; return; }
  if (cal) return;
  const t0 = ctx.currentTime + 0.6;
  const clicks = [];
  for (let i = 0; i < CAL_COUNT_IN + CAL_CLICKS; i++) {
    const t = t0 + i * CAL_BEAT;
    const counting = i < CAL_COUNT_IN;
    click(t, counting ? 1760 : 880, counting ? 0.25 : 0.35);
    if (!counting) clicks.push(t);
  }
  const dots = $('calDots');
  dots.innerHTML = '';
  for (let i = 0; i < CAL_COUNT_IN + CAL_CLICKS; i++) {
    const s = document.createElement('span');
    if (i < CAL_COUNT_IN) s.className = 'count';
    dots.append(s);
  }
  $('calBtn').disabled = true;
  $('calResult').textContent = 'Слухай відлік…';
  cal = { t0, clicks, hits: [] };
  cal.timer = setInterval(() => {
    const now = ctx.currentTime - (ctx.outputLatency || 0);
    const idx = Math.floor((now - t0) / CAL_BEAT);
    [...dots.children].forEach((s, i) => s.classList.toggle('now', i === idx));
    if (idx === CAL_COUNT_IN) $('calResult').textContent = 'Бий разом з клацаннями!';
    if (now > clicks[clicks.length - 1] + 0.8) finishCalibration();
  }, 30);
};

function onCalibrationHit(t) {
  if (cal) cal.hits.push(t);
}

// each click owns the window [click - 0.2 s, click + 0.55 s); the first hit inside it counts
function finishCalibration() {
  clearInterval(cal.timer);
  const offsets = [];
  const dots = [...$('calDots').children];
  cal.clicks.forEach((c, i) => {
    const h = cal.hits.find(t => t >= c - 0.2 && t < c + 0.55);
    dots[CAL_COUNT_IN + i].classList.remove('now');
    dots[CAL_COUNT_IN + i].classList.add(h === undefined ? 'miss' : 'hit');
    if (h !== undefined) offsets.push((h - c) * 1000);
  });
  cal = null;
  $('calBtn').disabled = false;

  if (offsets.length < 5) {
    $('calResult').innerHTML = `<span class="bad">Зловлено лише ${offsets.length} з ${CAL_CLICKS} ударів — спробуй ще раз.</span>`;
    return;
  }
  const sorted = [...offsets].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const kept = offsets.filter(o => Math.abs(o - median) <= 80);
  const avg = mean(kept);
  const spread = Math.sqrt(mean(kept.map(o => (o - avg) ** 2)));
  const saved = { offsetMs: Math.round(avg), spreadMs: Math.round(spread), date: Date.now() };
  try { localStorage.setItem(LATENCY_KEY, JSON.stringify(saved)); } catch {}
  $('calResult').innerHTML = `<span class="ok">Затримка: <b>${saved.offsetMs} мс</b></span> (розкид ±${saved.spreadMs} мс, медіана ${Math.round(median)} мс)<br>` +
    `<span class="muted small">Окремі удари: ${offsets.map(o => Math.round(o)).join(', ')} мс</span>`;
}

// ---------- pad samples ----------

let samples = [];          // records from IndexedDB
const buffers = new Map(); // id -> AudioBuffer

// A series: press → short countdown (the click is ignored) → play hits → it finishes by itself
// after a pause, keeps the hits that sound alike and replaces the old samples of that kind.
const SERIES_COUNTDOWN = 2;    // seconds before recording starts
const SERIES_END_SILENCE = 2;  // seconds without hits that finish the series
const SERIES_MAX = 16;         // hard stop
const SERIES_KEEP = 8;         // samples kept per kind
const OUTLIER_DB = 6;          // hits further than this from the series median are dropped
let series = [];               // trimmed captures of the current series
let seriesTimer = null;
let countdownTimer = null;

function updateRecButtons() {
  $('recSoftBtn').classList.toggle('armed', captureKind === 'soft');
  $('recAccentBtn').classList.toggle('armed', captureKind === 'accent');
  $('recSoftBtn').textContent = captureKind === 'soft' ? '✕ Скасувати' : '● Серія тихих';
  $('recAccentBtn').textContent = captureKind === 'accent' ? '✕ Скасувати' : '● Серія акцентів';
}

function seriesStatus() {
  const what = captureKind === 'soft' ? 'ТИХІ удари' : 'АКЦЕНТИ';
  const tail = series.length ? `Записано: ${series.length}. Зупинись, і за ${SERIES_END_SILENCE} с запис завершиться.` : '';
  return `Грай ${what} по одному, приблизно раз на секунду. ${tail}`;
}

function endSeries() {
  clearTimeout(seriesTimer);
  clearInterval(countdownTimer);
  seriesTimer = countdownTimer = null;
  captureKind = null;
  node?.port.postMessage({ capture: false });
  updateRecButtons();
}

function armCapture(kind) {
  if (!running()) { $('recStatus').textContent = 'Спочатку натисни «Старт».'; return; }
  if (captureKind) {                       // pressing again cancels; old samples stay
    endSeries();
    $('recStatus').textContent = 'Скасовано, старі записи лишились.';
    return;
  }
  captureKind = kind;
  series = [];
  node.port.postMessage({ capture: true, armDelay: SERIES_COUNTDOWN });
  updateRecButtons();
  let left = SERIES_COUNTDOWN;
  $('recStatus').textContent = `Приготуйся… ${left}`;
  countdownTimer = setInterval(() => {
    if (--left > 0) { $('recStatus').textContent = `Приготуйся… ${left}`; return; }
    clearInterval(countdownTimer);
    countdownTimer = null;
    $('recStatus').textContent = seriesStatus();
  }, 1000);
}

// keep the hits closest to the series median loudness, so a stray rimshot or a too-soft tap doesn't get in
function pickConsistent(items) {
  const dbs = items.map(s => toDb(s.peak)).sort((a, b) => a - b);
  const median = dbs[dbs.length >> 1];
  const dist = s => Math.abs(toDb(s.peak) - median);
  let kept = items.filter(s => dist(s) <= OUTLIER_DB);
  if (kept.length < Math.min(3, items.length)) kept = items;
  return kept.sort((a, b) => dist(a) - dist(b)).slice(0, SERIES_KEEP);
}

async function finishSeries() {
  const kind = captureKind;
  endSeries();
  if (!series.length) { $('recStatus').textContent = 'Не почув жодного удару, старі записи лишились.'; return; }
  const kept = pickConsistent(series);
  for (const s of samples.filter(s => s.kind === kind)) { await deleteSample(s.id); buffers.delete(s.id); }
  for (const s of kept) await addSample({ kind, ...s, created: Date.now() });
  await refreshSamples();
  const dropped = series.length - kept.length;
  $('recStatus').innerHTML = `<span class="ok">Все, записано! ${kept.length} ${kind === 'soft' ? 'тихих' : 'акцентів'} у бібліотеці.</span>` +
    (dropped ? ` <span class="muted small">${dropped} відкинув: випадали за гучністю або зайві.</span>` : '');
  series = [];
}
$('recSoftBtn').onclick = () => armCapture('soft');
$('recAccentBtn').onclick = () => armCapture('accent');

// cut the capture to [just before onset, tail down to -40 dB or the next hit], with short fades
function trimCapture(data, onsetIndex, sr) {
  const maxAbs = (a, b) => { let m = 0; for (let i = a; i < b; i++) m = Math.max(m, Math.abs(data[i])); return m; };
  const peak = maxAbs(onsetIndex, Math.min(data.length, onsetIndex + Math.round(0.02 * sr)));
  let start = onsetIndex;
  for (let i = 0; i < onsetIndex; i++) if (Math.abs(data[i]) > peak * 0.1) { start = i; break; }
  start = Math.max(0, start - Math.round(0.001 * sr));

  const win = Math.round(0.002 * sr);
  let end = data.length;
  let prev = peak;
  for (let i = onsetIndex + Math.round(0.02 * sr); i + win <= data.length; i += win) {
    const m = maxAbs(i, i + win);
    if (m < peak * 0.01 || (m > prev * 2 && m > peak * 0.05)) { end = i; break; }
    prev = Math.min(prev, m);
  }
  end = Math.min(data.length, Math.max(end + Math.round(0.01 * sr), start + Math.round(0.05 * sr)));
  const out = data.slice(start, end);
  const fadeIn = Math.round(0.0005 * sr), fadeOut = Math.min(Math.round(0.005 * sr), out.length >> 1);
  for (let i = 0; i < fadeIn; i++) out[i] *= i / fadeIn;
  for (let i = 0; i < fadeOut; i++) out[out.length - 1 - i] *= i / fadeOut;
  return { data: out, peak };
}

function onCapture(m) {
  if (!captureKind) return;
  const { data, peak } = trimCapture(m.data, m.onsetIndex, m.sampleRate);
  series.push({ sampleRate: m.sampleRate, data, peak });
  clearTimeout(seriesTimer);
  if (series.length >= SERIES_MAX) { finishSeries(); return; }
  seriesTimer = setTimeout(finishSeries, SERIES_END_SILENCE * 1000);
  $('recStatus').textContent = seriesStatus();
}

async function refreshSamples() {
  samples = await listSamples();
  const list = $('sampleList');
  list.innerHTML = '';
  for (const s of samples) {
    const row = document.createElement('div');
    row.className = 'sample';
    const tag = document.createElement('span');
    tag.className = 'tag ' + s.kind;
    tag.textContent = s.kind === 'soft' ? 'тихий' : 'акцент';
    const c = document.createElement('canvas');
    const info = document.createElement('span');
    info.className = 'grow muted small';
    info.textContent = `${toDb(s.peak).toFixed(0)} дБ · ${(s.data.length / s.sampleRate * 1000).toFixed(0)} мс`;
    const play = document.createElement('button');
    play.textContent = '▶';
    play.onclick = async () => { await ensureCtx(); playSample(s, ctx.currentTime + 0.02); };
    const del = document.createElement('button');
    del.textContent = '✕';
    del.onclick = async () => { await deleteSample(s.id); buffers.delete(s.id); refreshSamples(); };
    row.append(tag, c, info, play, del);
    list.append(row);
    drawWave(c, s.data);
  }
  const soft = samples.filter(s => s.kind === 'soft').length;
  const acc = samples.filter(s => s.kind === 'accent').length;
  $('playPhraseBtn').disabled = !(soft && acc);
  if (!samples.length) list.innerHTML = '<span class="muted small">Ще немає записів. Потрібен хоча б один тихий і один акцент.</span>';
}

function drawWave(c, data) {
  const { g, w, h } = fitCanvas(c);
  let peak = 1e-6;
  for (const v of data) peak = Math.max(peak, Math.abs(v));
  g.fillStyle = '#4fc3f7';
  const step = data.length / w;
  for (let x = 0; x < w; x++) {
    let m = 0;
    for (let i = Math.floor(x * step); i < Math.floor((x + 1) * step); i++) m = Math.max(m, Math.abs(data[i]));
    const bh = m / peak * h * 0.9;
    g.fillRect(x, (h - bh) / 2, 1, Math.max(1, bh));
  }
}

// all samples share one gain so soft/accent keep their real loudness ratio
function playbackGain() {
  const maxPeak = Math.max(1e-4, ...samples.map(s => s.peak));
  return Math.min(0.8 / maxPeak, 100);
}

// random round-robin: never the same take twice in a row, so repeated notes don't sound like a machine gun
const lastPicked = new Map();  // kind -> sample id
function pickSample(pool) {
  const kind = pool[0].kind;
  const choices = pool.length > 1 ? pool.filter(s => s.id !== lastPicked.get(kind)) : pool;
  const s = choices[Math.floor(Math.random() * choices.length)];
  lastPicked.set(kind, s.id);
  return s;
}

function playSample(s, t) {
  let buf = buffers.get(s.id);
  if (!buf) {
    buf = ctx.createBuffer(1, s.data.length, s.sampleRate);
    buf.copyToChannel(s.data, 0);
    buffers.set(s.id, buf);
  }
  const src = ctx.createBufferSource();
  const g = ctx.createGain();
  src.buffer = buf;
  g.gain.value = playbackGain();
  src.connect(g).connect(ctx.destination);
  src.start(t);
}

// ---------- test phrase ----------

const STICKING = 'RLRRLRLL';
const ACCENTS = [0, 4];

function renderPhrase() {
  $('phrase').innerHTML = [...STICKING].map((s, i) => `<span class="${ACCENTS.includes(i) ? 'acc' : ''}">${s}</span>`).join('');
}
renderPhrase();

$('playPhraseBtn').onclick = async () => {
  await ensureCtx();
  const soft = samples.filter(s => s.kind === 'soft');
  const acc = samples.filter(s => s.kind === 'accent');
  if (!soft.length || !acc.length) return;
  const step = 60 / settings.bpm / 4;
  const t0 = ctx.currentTime + 0.15;
  const spans = $('phrase').children;
  let n = 0;
  for (let r = 0; r < settings.reps; r++) {
    for (let i = 0; i < STICKING.length; i++, n++) {
      const pool = ACCENTS.includes(i) ? acc : soft;
      const t = t0 + n * step;
      playSample(pickSample(pool), t);
      const delay = (t - ctx.currentTime + (ctx.outputLatency || 0)) * 1000;
      setTimeout(() => {
        [...spans].forEach((s, k) => s.classList.toggle('now', k === i));
      }, delay);
    }
  }
  setTimeout(() => [...spans].forEach(s => s.classList.remove('now')),
    (t0 + n * step - ctx.currentTime + (ctx.outputLatency || 0)) * 1000 + 100);
};

refreshSamples();

// ---------- demo source ----------

// 4-bar loop of paradiddle 16ths at 100 BPM with accents, over faint noise
function makeDemoSource(ac) {
  const sr = ac.sampleRate;
  const step = 60 / 100 / 4;
  const len = Math.round(step * 32 * sr);
  const buf = ac.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * 0.001;
  for (let k = 0; k < 32; k++) {
    const amp = k % 4 === 0 ? 0.3 : 0.05;
    const s = Math.round((k * step + 0.01) * sr);
    for (let i = 0; i < 0.1 * sr && s + i < len; i++) d[s + i] += amp * Math.exp(-i / (0.015 * sr)) * (Math.random() * 2 - 1);
  }
  const src = ac.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  return src;
}
