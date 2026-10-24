// Echo trainer: the app plays a phrase, waits patiently, you echo it on the pad, it shows how it went.
// Session: warm-up (every phrase once, no judging) → review of passed steps → the current new step.

import * as E from './engine.js';
import {
  STEPS, WARMUP, STRICTNESS, TEMPOS, notesOf, stepPhrase, noteGap, grade, handBalance,
  loadProgress, saveProgress, recordAttempt, reviewSteps,
} from './course.js';

const $ = id => document.getElementById(id);
// ?demo: no mic, a simulated player echoes each phrase (for testing without a pad)
const DEMO = new URLSearchParams(location.search).has('demo');

const PREFS_KEY = 'pt.trainer';
const prefs = { strict: 'soft', metro: 30, replay: false };
try { Object.assign(prefs, JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')); } catch {}
const savePrefs = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch {} };

const LISTEN_LEAD = 0.35;   // seconds from "listen" to the first note
const NEXT_PAUSE = 1800;    // ms between a result and the next phrase
const STAGE_PAUSE = 2800;   // ms to read a stage summary
const REVIEW_CLEAN = 2;     // clean echoes per step in review

const progress = loadProgress();
let kit = null;
let running = false;
let sessionStarted = false;

let stage = null;           // 'warmup' | 'review' | 'new'
let warmIdx = 0;
let warmTakes = [];
let reviewQueue = [];
let reviewClean = 0;

let phrase = null;          // { title, notes: [{ hand, accent }], bpm }
let phase = 'idle';         // idle | listen | wait | play | result
let hits = [];

let timers = [];
const later = (fn, ms) => timers.push(setTimeout(fn, Math.max(0, ms)));
const clearTimers = () => { timers.forEach(clearTimeout); timers = []; };
// ms until a ctx-clock time is heard
const msUntil = t => (t - E.ctx.currentTime + (E.ctx.outputLatency || 0)) * 1000;

// ---------- UI pieces ----------

function setPlate(state, title, sub = '') {
  $('plate').className = 'result rec' + (state ? ' rec-' + state : '');
  $('plate').innerHTML = `<b>${title}</b>` + (sub ? `<span class="small">${sub}</span>` : '');
}

function setStage(name) {
  stage = name;
  const order = ['warmup', 'review', 'new'];
  for (const el of $('stages').children) {
    const k = order.indexOf(el.dataset.stage), cur = order.indexOf(name);
    el.className = k === cur ? 'active' : k < cur ? 'done' : '';
  }
  $('skipBtn').disabled = name === 'warmup';   // warm-up is mandatory
  $('skipBtn').textContent = name === 'new' ? 'Пропустити вправу' : 'Пропустити';
}

const COUNTS = ['1', 'і', '2', 'і', '3', 'і', '4', 'і'];

// two rows of dots: right hand on top, left below; accents are big. Marks row shows the result.
function renderGrid() {
  const g = $('grid');
  g.style.setProperty('--n', phrase.notes.length);
  g.innerHTML = '';
  const cell = (cls, html = '') => {
    const d = document.createElement('div');
    d.className = cls;
    d.innerHTML = html;
    g.append(d);
    return d;
  };
  cell('hand', 'П');
  phrase.notes.forEach((nt, i) => cell('slot', nt.hand === 'R' ? `<span class="note${nt.accent ? ' acc' : ''}" data-i="${i}"></span>` : ''));
  cell('hand', 'Л');
  phrase.notes.forEach((nt, i) => cell('slot', nt.hand === 'L' ? `<span class="note${nt.accent ? ' acc' : ''}" data-i="${i}"></span>` : ''));
  cell('hand', '');
  phrase.notes.forEach((_, i) => cell('mark', '').dataset.i = i);
  cell('hand', '');
  phrase.notes.forEach((_, i) => cell('count muted small', COUNTS[i % 8]));
}

const noteEl = i => $('grid').querySelector(`.note[data-i="${i}"]`);
const markEl = i => $('grid').querySelector(`.mark[data-i="${i}"]`);

function flash(i, cls) {
  const el = noteEl(i);
  if (!el) return;
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), 160);
}

function clearMarks() {
  $('grid').querySelectorAll('.note').forEach(el => el.classList.remove('ok', 'early', 'late', 'miss', 'weak', 'heard'));
  $('grid').querySelectorAll('.mark').forEach(el => { el.textContent = ''; el.className = 'mark'; });
}

const MARKS = { ok: '✓', early: '‹', late: '›', miss: '✕', weak: '!' };

function showResult(r) {
  r.notes.forEach((res, i) => {
    noteEl(i)?.classList.remove('heard');
    noteEl(i)?.classList.add(res.status);
    const m = markEl(i);
    m.textContent = MARKS[res.status];
    m.className = 'mark ' + res.status;
  });
}

function showHeader() {
  const names = { warmup: 'Розминка', review: 'Повторення', new: 'Нове' };
  $('phraseTitle').textContent = `${names[stage]}: ${phrase.title}`;
  let sub = `${phrase.bpm} BPM`;
  if (stage === 'warmup') sub += ` · фраза ${warmIdx + 1} з ${WARMUP.length} · без оцінок`;
  if (stage === 'new') {
    const st = progress.steps[STEPS[progress.current].id];
    sub += ` · чистих ${st.hist.filter(Boolean).length} з ${st.len === 'short' ? 2 : 3} до наступного`;
  }
  if (stage === 'review') sub += ` · ще ${reviewQueue.length} ${reviewQueue.length === 1 ? 'вправа' : 'вправи'}`;
  $('phraseSub').textContent = sub;
}

// ---------- session flow ----------

function goStage(name, title, sub) {
  setStage(name);
  setPlate('done', title, sub);
  later(nextPhrase, STAGE_PAUSE);
}

function nextPhrase() {
  if (stage === 'warmup') {
    if (warmIdx >= WARMUP.length) {
      const bal = handBalance(warmTakes);
      reviewQueue = reviewSteps(progress);
      reviewClean = 0;
      goStage('review', 'Розминку зроблено 👍', bal ? `Ліва рука ≈ ${bal}% від правої за силою удару` : '');
      return;
    }
    const w = WARMUP[warmIdx];
    phrase = { title: w.title, notes: notesOf(w.sticking, w.accents), bpm: w.bpm };
  } else if (stage === 'review') {
    if (!reviewQueue.length) {
      goStage('new', progress.steps[STEPS[0].id].passed ? 'Повторення зроблено 👍' : 'Поки нічого повторювати, це нормально',
        `Далі нове: ${STEPS[progress.current].title}`);
      return;
    }
    const step = STEPS[reviewQueue[0]];
    phrase = stepPhrase(step, progress.steps[step.id]);
  } else {
    const step = STEPS[progress.current];
    phrase = stepPhrase(step, progress.steps[step.id]);
  }
  renderGrid();
  showHeader();
  listen();
}

// the app plays the phrase with a soft click on every beat
function listen() {
  clearTimers();
  phase = 'listen';
  clearMarks();
  setPlate('listen', 'Слухай…');
  $('againBtn').disabled = true;
  const gap = noteGap(phrase.bpm);
  const t0 = E.ctx.currentTime + LISTEN_LEAD;
  phrase.notes.forEach((nt, i) => {
    const t = t0 + i * gap;
    E.playNote(kit, nt.accent, t);
    if (i % 2 === 0) E.click(t, prefs.metro / 100, i === 0);
    later(() => flash(i, 'now'), msUntil(t));
  });
  later(waitTurn, msUntil(t0 + phrase.notes.length * gap));
}

// patient: nothing happens until the first hit
function waitTurn() {
  phase = 'wait';
  hits = [];
  setPlate('go', 'Твоя черга', 'Грай, коли готовий. Я почекаю.');
  $('againBtn').disabled = false;
  if (DEMO) simulatePlayer();
}

function onHit(h) {
  if (phase === 'wait') {
    phase = 'play';
    hits = [h];
    $('againBtn').disabled = true;
    const n = phrase.notes.length, gap = noteGap(phrase.bpm);
    // keep the soft click going from the player's own first hit
    for (let i = 2; i < n; i += 2) {
      const t = h.time + i * gap - E.latencySec();
      if (t > E.ctx.currentTime) E.click(t, prefs.metro / 100);
    }
    const end = h.time + (n - 1) * gap + STRICTNESS[prefs.strict].window * gap + 0.3;
    later(finish, (end - E.ctx.currentTime) * 1000);
  } else if (phase === 'play') {
    hits.push(h);
  } else {
    return;
  }
  noteEl(Math.min(hits.length, phrase.notes.length) - 1)?.classList.add('heard');
}

function finish() {
  phase = 'result';
  const r = grade(phrase, hits, prefs.strict);
  showResult(r);
  let msg = null;

  if (stage === 'warmup') {
    warmTakes.push({ phrase, result: r });
    warmIdx++;
    // not judged: only a tempo nudge, never "wrong"
    setPlate('done', 'Добре 👍', r.tempoRatio < 0.94 ? 'Трохи поспішаєш, не жени 🙂' : r.tempoRatio > 1.06 ? 'Трохи тягнеш, можна живіше' : '');
  } else {
    const idx = stage === 'review' ? reviewQueue[0] : progress.current;
    msg = recordAttempt(progress, idx, r.clean);
    if (stage === 'review' && r.clean && ++reviewClean >= REVIEW_CLEAN) {
      reviewQueue.shift();
      reviewClean = 0;
    }
    saveProgress(progress);
    if (r.clean) setPlate('done', r.hint, msg || '');
    else setPlate('wait', 'Ще раз 🙂', r.hint);
  }

  let wait = NEXT_PAUSE + (msg ? 1200 : 0);
  if (prefs.replay && hits.length) wait += replay(hits) * 1000;
  later(nextPhrase, wait);
}

// "how you played": the take re-sounded with the kit, keeping its timing and dynamics -> seconds
function replay(take) {
  const dbs = take.map(h => h.db);
  const hi = Math.max(...dbs), lo = Math.min(...dbs);
  const split = hi - lo >= 4 ? (hi + lo) / 2 : Infinity;   // two loudness groups or one
  const med = a => [...a].sort((x, y) => x - y)[a.length >> 1];
  const ref = { true: med(dbs.filter(d => d >= split)), false: med(dbs.filter(d => d < split)) };
  const t0 = E.ctx.currentTime + 0.9;   // after the result has been seen
  take.forEach((h, i) => {
    const accent = h.db >= split;
    const level = Math.min(1.6, Math.max(0.5, 10 ** ((h.db - ref[accent]) / 20)));
    const t = t0 + h.time - take[0].time;
    E.playNote(kit, accent, t, level);
    if (i < phrase.notes.length) later(() => flash(i, 'now'), msUntil(t));
  });
  later(() => { if (phase === 'result') $('plate').insertAdjacentHTML('beforeend', '<span class="small">▶ Так ти зіграв</span>'); }, msUntil(t0));
  return 0.9 + take.at(-1).time - take[0].time + 0.5;
}

function simulatePlayer() {
  const gap = noteGap(phrase.bpm);
  const start = E.ctx.currentTime + 0.8;
  const drift = (Math.random() - 0.5) * 0.08;
  phrase.notes.forEach((nt, i) => {
    if (Math.random() < 0.05) return;
    const time = start + i * gap * (1 + drift) + (Math.random() - 0.5) * 0.1 * gap;
    const db = (nt.accent ? -20 : -32) + (Math.random() - 0.5) * 4;
    later(() => onHit({ time, db }), (time - E.ctx.currentTime) * 1000 + 25);
  });
}

// ---------- controls ----------

async function loadKit() {
  kit = await E.loadKit();
  if (kit) return;
  // no pad recordings yet: play the snare instead and say where to record
  const chosen = E.settings.kit;
  E.settings.kit = 'snare';
  kit = await E.loadKit();
  E.settings.kit = chosen;
  setPlate('warn', 'Записів пада ще немає, граю малим барабаном', 'Записати пад можна на сторінці тесту (посилання в налаштуваннях).');
}

async function start() {
  await E.ensureCtx();
  $('micLabel').textContent = DEMO ? 'демо: віртуальний барабанщик' : await E.startMic(onHit);
  await loadKit();
  running = true;
  $('goBtn').textContent = '⏸ Пауза';
  if (!sessionStarted) {
    sessionStarted = true;
    progress.session++;
    saveProgress(progress);
    warmIdx = 0;
    warmTakes = [];
    setStage('warmup');
    later(nextPhrase, kit ? 300 : 2500);
  } else {
    later(nextPhrase, 300);   // resume: the same phrase again from "listen"
  }
}

function pause() {
  clearTimers();
  E.stopMic();
  running = false;
  phase = 'idle';
  $('goBtn').textContent = '▶ Продовжити';
  $('againBtn').disabled = true;
  setPlate('', 'Пауза', 'Продовжимо з тієї ж фрази.');
}

$('goBtn').onclick = async () => {
  if (running) { pause(); return; }
  $('goBtn').disabled = true;
  try {
    await start();
  } catch (e) {
    pause();
    setPlate('warn', 'Не вдалося увімкнути мікрофон', e.message || e.name);
  } finally {
    $('goBtn').disabled = false;
  }
};

$('againBtn').onclick = () => { if (phase === 'wait') listen(); };

$('skipBtn').onclick = () => {
  if (!running || stage === 'warmup') return;
  clearTimers();
  if (stage === 'review') {
    reviewQueue.shift();
    reviewClean = 0;
    nextPhrase();
    return;
  }
  const st = progress.steps[STEPS[progress.current].id];
  st.passed = true;
  if (progress.current < STEPS.length - 1) progress.current++;
  saveProgress(progress);
  goStage('new', 'Пропущено', `Далі: ${STEPS[progress.current].title}`);
};

// settings
$('kitSelect').value = E.settings.kit;
$('kitSelect').onchange = async e => {
  E.settings.kit = e.target.value;
  E.saveSettings();
  if (E.ctx) await loadKit();
};
const strict = $('strictSelect');
for (const [k, v] of Object.entries(STRICTNESS)) strict.add(new Option(v.label, k));
strict.value = prefs.strict;
strict.onchange = () => { prefs.strict = strict.value; savePrefs(); };
$('metro').value = prefs.metro;
const showMetro = () => { $('metroVal').textContent = prefs.metro ? prefs.metro + '%' : 'вимкнено'; };
showMetro();
$('metro').oninput = () => { prefs.metro = Number($('metro').value); savePrefs(); showMetro(); };
$('replayCheck').checked = prefs.replay;
$('replayCheck').onchange = () => { prefs.replay = $('replayCheck').checked; savePrefs(); };

setPlate('', 'Одягни навушники і натисни «Почати»',
  `Спочатку розминка, потім повторення і нове. Зараз: ${STEPS[progress.current].title}, ${TEMPOS[progress.steps[STEPS[progress.current].id].t]} BPM.`);
