// Echo trainer: the app plays a phrase, waits patiently, you echo it on the pad, it shows how it went.
// Session: sound check → warm-up (soft judging) → review of passed steps → the current new step.
// Visual support in the spirit of Patapon: the screen frame pulses on every beat and every hit pops
// right away, brighter the closer it is to the beat.

import * as E from './engine.js';
import {
  STEPS, WARMUP, STRICTNESS, TEMPOS, notesOf, stepPhrase, noteGap, grade, handBalance,
  loadProgress, saveProgress, recordAttempt, reviewSteps,
} from './course.js';

const $ = id => document.getElementById(id);
// ?demo: no mic, a simulated player echoes each phrase (for testing without a pad);
// ?demo=struggle: in "new" the player rushes until it has worked through the trouble spot
const DEMO = new URLSearchParams(location.search).has('demo');
const DEMO_STRUGGLE = new URLSearchParams(location.search).get('demo') === 'struggle';
let demoLearned = false;

const PREFS_KEY = 'pt.trainer';
const prefs = { strict: 'soft', metro: 30, blink: true, replay: false, leftTop: false };
try { Object.assign(prefs, JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')); } catch {}
const savePrefs = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch {} };

const LISTEN_LEAD = 0.35;   // seconds from "listen" to the first note
const NEXT_PAUSE = 1800;    // ms between a result and the next phrase
const STAGE_PAUSE = 2800;   // ms to read a stage summary
const REVIEW_CLEAN = 2;     // clean echoes per step in review
const PERFECT = 0.07;       // share of the note gap for a "perfect" pop

const progress = loadProgress();
let kit = null;
let running = false;
let sessionStarted = false;

let stage = null;           // 'check' | 'warmup' | 'review' | 'new'
let warmIdx = 0;
let warmTakes = [];
let reviewQueue = [];
let reviewClean = 0;
let streak = 0;             // clean phrases in tempo in a row; a miss just resets it quietly

let base = null;            // the phrase as the course wants it: { title, notes: [{ hand, accent }], bpm }
let phrase = null;          // what is played now: base, or base slower, or its trouble spot
let phase = 'idle';         // idle | check | listen | wait | play | result
let hits = [];

let timers = [];
const later = (fn, ms) => timers.push(setTimeout(fn, Math.max(0, ms)));
const clearTimers = () => { timers.forEach(clearTimeout); timers = []; };
// ms until a ctx-clock time is heard
const msUntil = t => (t - E.ctx.currentTime + (E.ctx.outputLatency || 0)) * 1000;

// ---------- help ladder ----------

// For a phrase that doesn't come out, like a teacher would: again → a tempo step slower →
// (still not) only the trouble spot, slow, in a loop → the whole phrase slow → back in tempo.
// Nothing moves on until the phrase comes out in tempo, unless skipped by hand.
let help = null;            // { key, mode: normal | slow | part, fails, slowFails, partClean, part }
const resetHelp = key => { help = { key, mode: 'normal', fails: 0, slowFails: 0, partClean: 0, part: null }; };
const slower = bpm => (TEMPOS.indexOf(bpm) > 0 ? TEMPOS[TEMPOS.indexOf(bpm) - 1] : Math.round(bpm * 0.9));
const PART_LEN = 4;         // notes in a trouble spot; played twice in a row

function helpPhrase() {
  if (help.mode === 'slow') return { ...base, bpm: slower(base.bpm) };
  if (help.mode === 'part') {
    const frag = base.notes.slice(help.part, help.part + PART_LEN);
    return { title: base.title, notes: [...frag, ...frag], bpm: slower(base.bpm) };
  }
  return base;
}

// where to start the trouble spot: the note before the first bad one
function troubleSpot(r) {
  const bad = r.notes.findIndex(n => n.status !== 'ok');
  return Math.max(0, Math.min(base.notes.length - PART_LEN, bad - 1));
}

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
  $('skipBtn').textContent = name === 'new' ? 'Пропустити вправу' : name === 'check' ? 'Пропустити перевірку' : 'Пропустити';
}

function showStreak() {
  $('streak').textContent = streak >= 2 ? `🔥 ${streak} поспіль` : '';
  document.body.classList.toggle('fever', streak >= 4);
}

const COUNTS = ['1', 'і', '2', 'і', '3', 'і', '4', 'і'];

// two rows of dots, one per hand (right on top unless swapped), each hand in its own colour with its
// letter inside, so tired eyes don't mix them up; accents are big. Below: loudness bars, marks, count.
function renderGrid() {
  const g = $('grid');
  g.style.setProperty('--n', phrase.notes.length);
  g.innerHTML = '';
  const cell = (cls, html = '', i) => {
    const d = document.createElement('div');
    d.className = cls;
    d.innerHTML = html;
    if (i !== undefined) d.dataset.i = i;
    g.append(d);
  };
  const row = hand => {
    const letter = hand === 'R' ? 'П' : 'Л';
    cell(`hand ${hand}`, letter);
    phrase.notes.forEach((nt, i) => cell(`slot ${hand}`, nt.hand === hand
      ? `<span class="note ${hand}${nt.accent ? ' acc' : ''}" data-i="${i}">${letter}</span>` : ''));
  };
  for (const hand of prefs.leftTop ? ['L', 'R'] : ['R', 'L']) row(hand);
  cell('hand', '');
  phrase.notes.forEach((_, i) => cell('vel', '<i></i>', i));
  cell('hand', '');
  phrase.notes.forEach((_, i) => cell('mark', '', i));
  cell('hand', '');
  phrase.notes.forEach((_, i) => cell('count muted small', COUNTS[i % 8], i));
}

const noteEl = i => $('grid').querySelector(`.note[data-i="${i}"]`);
const markEl = i => $('grid').querySelector(`.mark[data-i="${i}"]`);
const velEl = i => $('grid').querySelector(`.vel[data-i="${i}"] i`);
const countEl = i => $('grid').querySelector(`.count[data-i="${i}"]`);

function flash(i, cls, ms = 160) {
  const el = noteEl(i);
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth;   // restart the animation when the same class comes again
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), ms);
}

function clearMarks() {
  $('grid').querySelectorAll('.note').forEach(el => el.classList.remove('ok', 'early', 'late', 'miss', 'weak', 'heard'));
  $('grid').querySelectorAll('.mark').forEach(el => { el.textContent = ''; el.className = 'mark'; });
  $('grid').querySelectorAll('.vel i').forEach(el => { el.style.height = '0'; el.className = ''; });
}

const MARKS = { ok: '✓', early: '‹', late: '›', miss: '✕', weak: '!' };
const loudPct = db => Math.min(1, Math.max(0.04, (db + 60) / 60));   // -60..0 dB

function showResult(r) {
  r.notes.forEach((res, i) => {
    noteEl(i)?.classList.remove('heard');
    noteEl(i)?.classList.add(res.status);
    const m = markEl(i);
    m.textContent = MARKS[res.status];
    m.className = 'mark ' + res.status;
    // how loud each note came out: accents should stand clearly above the taps
    if (res.db !== undefined) {
      velEl(i).style.height = Math.round(loudPct(res.db) * 100) + '%';
      velEl(i).className = phrase.notes[i].accent ? 'acc' : '';
    }
  });
}

function showHeader() {
  const names = { warmup: 'Розминка', review: 'Повторення', new: 'Нове' };
  $('phraseTitle').textContent = `${names[stage]}: ${base.title}` + (help.mode === 'part' ? ' — шматок' : '');
  if (help.mode === 'slow') {
    $('phraseSub').textContent = `${phrase.bpm} BPM, повільніше · потім у темпі ${base.bpm}`;
    return;
  }
  if (help.mode === 'part') {
    $('phraseSub').textContent = `Розбираємо шматок · ${phrase.bpm} BPM · потім уся фраза`;
    return;
  }
  let sub = `${phrase.bpm} BPM`;
  if (stage === 'warmup') sub += ` · фраза ${warmIdx + 1} з ${WARMUP.length} · м'яко`;
  if (stage === 'new') {
    const st = progress.steps[STEPS[progress.current].id];
    sub += ` · чистих ${st.hist.filter(Boolean).length} з ${st.len === 'short' ? 2 : 3} до наступного`;
  }
  if (stage === 'review') sub += ` · ще ${reviewQueue.length} ${reviewQueue.length === 1 ? 'вправа' : 'вправи'}`;
  $('phraseSub').textContent = sub;
}

// ---------- beat pulse ----------

// The frame pulses on every beat (a quarter = two eighth notes), brighter on "1". It keeps going
// from "listen" into "your turn", so you can come in on any pulse; your first hit re-syncs it to you.
let beat = null;            // { t0, period } on the heard timeline (ctx time of the sound)
let lastBeat = -1;

function startBeat(t0, period) { beat = { t0, period }; lastBeat = -1; }
function stopBeat() { beat = null; }

(function beatLoop() {
  if (beat && E.ctx && prefs.blink) {
    const heard = E.ctx.currentTime - (E.ctx.outputLatency || 0);
    const k = Math.floor((heard - beat.t0) / beat.period + 0.001);
    if (k >= 0 && k !== lastBeat) {
      lastBeat = k;
      const frame = $('beatFrame');
      frame.className = '';
      void frame.offsetWidth;
      frame.className = k % 4 === 0 ? 'pulse strong' : 'pulse';
      const c = countEl((k % 4) * 2);
      if (c && phase !== 'result') {
        $('grid').querySelectorAll('.count.on').forEach(el => el.classList.remove('on'));
        c.classList.add('on');
      }
    }
  }
  requestAnimationFrame(beatLoop);
})();

// ---------- sound check ----------

// Quick start-of-session check: silence (no false hits), soft hits (all heard), accents (not
// clipping). Sensitivity adapts by itself; Gain advice is shown at the end.
const CHECK_HITS = 4;
let check = null;           // { step: silence | soft | accent, rounds, got: [db], soft, timer }

function startCheck() {
  setStage('check');
  $('phraseTitle').textContent = 'Перевірка звуку';
  $('phraseSub').textContent = '15 секунд, щоб мікрофон чув тебе правильно';
  $('grid').innerHTML = '';
  check = { step: 'silence', rounds: 0, got: [] };
  phase = 'check';
  checkSilence();
}

function checkSilence() {
  check.step = 'silence';
  check.got = [];
  setPlate('listen', 'Тиша: не грай 3 секунди', 'Слухаю кімнату…');
  later(() => {
    if (check.got.length >= 2 && check.rounds < 3 && E.settings.sensDb < 34) {
      check.rounds++;
      E.setSensitivity(E.settings.sensDb + 4);
      showSens();
      setPlate('wait', 'Чую зайві звуки', 'Роблю мікрофон трохи менш чутливим, ще раз тиша');
      later(checkSilence, 1500);
      return;
    }
    check.rounds = 0;
    checkHits('soft');
  }, 3000);
}

function checkHits(step) {
  check.step = step;
  check.got = [];
  setPlate('go', step === 'soft' ? `Зіграй ${CHECK_HITS} тихі удари` : `Тепер ${CHECK_HITS} гучні, як акценти`, 'По одному, спокійно');
  if (DEMO) simulateCheck(step);
  // nothing heard for long enough: more sensitive and again
  later(() => {
    if (check.got.length >= CHECK_HITS) return;
    if (step === 'soft' && check.rounds < 3 && E.settings.sensDb > 8) {
      check.rounds++;
      E.setSensitivity(E.settings.sensDb - 4);
      showSens();
      setPlate('wait', `Почув ${check.got.length} з ${CHECK_HITS}`, 'Роблю мікрофон чутливішим, ще раз');
      later(() => checkHits('soft'), 1500);
    } else {
      checkDone(step);
    }
  }, 9000);
}

function checkHit(h) {
  check.got.push(h.db);
  const el = $('plate').querySelector('span');
  if (check.step !== 'silence' && el) el.textContent = `Почув: ${'● '.repeat(Math.min(check.got.length, CHECK_HITS)).trim()}`;
  if (check.step !== 'silence' && check.got.length === CHECK_HITS) {
    clearTimers();
    later(() => checkDone(check.step), 700);
  }
}

function checkDone(step) {
  const med = a => [...a].sort((x, y) => x - y)[a.length >> 1];
  if (step === 'soft') {
    check.soft = check.got.length ? med(check.got) : null;
    check.rounds = 0;
    checkHits('accent');
    return;
  }
  const acc = check.got.length ? med(check.got) : null;
  const notes = [];
  if (check.soft !== null && check.soft < -50) notes.push('тихі удари ледь чути: додай Gain або постав мікрофон ближче');
  if (acc !== null && acc > -4) notes.push('акценти на межі перевантаження: зменш Gain');
  if (check.soft !== null && acc !== null) {
    const diff = Math.round(acc - check.soft);
    notes.push(`різниця тихий/акцент ${diff} дБ, ${diff >= 8 ? 'чути чітко' : 'можна сильніше розводити'}`);
  }
  check = null;
  warmIdx = 0;
  warmTakes = [];
  goStage('warmup', 'Звук перевірено 👍', notes.join(' · ') || 'Далі розминка');
}

function simulateCheck(step) {
  for (let i = 0; i < CHECK_HITS; i++) {
    later(() => onHit({ time: E.ctx.currentTime, db: (step === 'soft' ? -34 : -18) + Math.random() * 3 }), 700 + i * 700);
  }
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
    base = { title: w.title, notes: notesOf(w.sticking, w.accents), bpm: w.bpm };
  } else if (stage === 'review') {
    if (!reviewQueue.length) {
      goStage('new', progress.steps[STEPS[0].id].passed ? 'Повторення зроблено 👍' : 'Поки нічого повторювати, це нормально',
        `Далі нове: ${STEPS[progress.current].title}`);
      return;
    }
    const step = STEPS[reviewQueue[0]];
    base = stepPhrase(step, progress.steps[step.id]);
  } else {
    const step = STEPS[progress.current];
    base = stepPhrase(step, progress.steps[step.id]);
  }
  const key = [stage, warmIdx, base.title, base.bpm, base.notes.length].join('|');
  if (help?.key !== key) resetHelp(key);
  phrase = helpPhrase();
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
  startBeat(t0, 2 * gap);
  phrase.notes.forEach((nt, i) => {
    const t = t0 + i * gap;
    E.playNote(kit, nt.accent, t);
    if (i % 2 === 0) E.click(t, prefs.metro / 100, i === 0);
    later(() => flash(i, 'now'), msUntil(t));
  });
  later(waitTurn, msUntil(t0 + phrase.notes.length * gap));
}

// patient: nothing happens until the first hit; the pulse keeps going meanwhile
function waitTurn() {
  phase = 'wait';
  hits = [];
  setPlate('go', 'Твоя черга', 'Вступай на будь-який спалах рамки. Я почекаю.');
  $('againBtn').disabled = false;
  if (DEMO) simulatePlayer();
}

function onHit(h) {
  if (phase === 'check') { checkHit(h); return; }
  const n = phrase?.notes.length, gap = phrase && noteGap(phrase.bpm);
  if (phase === 'wait') {
    phase = 'play';
    hits = [h];
    $('againBtn').disabled = true;
    // the pulse and the soft click now follow the player's own first hit. A hit is stamped in+out
    // latency after the stroke on the timeline sounds are scheduled on, so that is taken off.
    const start = h.time - E.latencySec();
    startBeat(start, 2 * gap);
    for (let i = 2; i < n; i += 2) {
      const t = start + i * gap;
      if (t > E.ctx.currentTime) E.click(t, prefs.metro / 100);
    }
    const end = h.time + (n - 1) * gap + STRICTNESS[prefs.strict].window * gap + 0.3;
    later(finish, (end - E.ctx.currentTime) * 1000);
  } else if (phase === 'play') {
    hits.push(h);
  } else {
    return;
  }
  popHit(h);
}

// instant feedback on the note this hit belongs to: perfect / good / off
function popHit(h) {
  const gap = noteGap(phrase.bpm);
  const rel = (h.time - hits[0].time) / gap;
  const i = Math.round(rel);
  if (i < 0 || i >= phrase.notes.length) return;
  const dev = Math.abs(rel - i);
  const q = dev <= PERFECT ? 'pop-perfect' : dev <= STRICTNESS[prefs.strict].window / 2 ? 'pop-good' : 'pop-off';
  noteEl(i)?.classList.add('heard');
  flash(i, q, 450);
}

function finish() {
  phase = 'result';
  stopBeat();
  $('grid').querySelectorAll('.count.on').forEach(el => el.classList.remove('on'));
  // warm-up is always judged softly: "more or less" is enough there
  const r = grade(phrase, hits, stage === 'warmup' ? 'soft' : prefs.strict);
  showResult(r);
  const msg = stepHelp(r);
  showStreak();

  let wait = NEXT_PAUSE + (msg ? 1200 : 0);
  if (prefs.replay && hits.length) wait += replay(hits) * 1000;
  later(nextPhrase, wait);
}

// move along the help ladder; only a clean phrase in tempo counts for the course -> course message
function stepHelp(r) {
  if (help.mode === 'slow') {
    if (r.clean) {
      help.mode = 'normal';
      help.fails = 1;   // one more miss in tempo goes straight back to slow
      setPlate('done', 'Вийшло! 👍', `А тепер у темпі ${base.bpm}`);
    } else if (++help.slowFails >= 2) {
      help.mode = 'part';
      help.part = troubleSpot(r);
      help.partClean = 0;
      const frag = base.notes.slice(help.part, help.part + PART_LEN).map(n => (n.accent ? '>' : '') + n.hand).join(' ');
      setPlate('wait', 'Розберемо шматок', `${frag} — по колу, повільно`);
    } else {
      setPlate('wait', 'Ще раз, повільно 🙂', r.hint);
    }
    return null;
  }
  if (help.mode === 'part') {
    if (r.clean && ++help.partClean >= 2) {
      help.mode = 'slow';
      help.slowFails = 0;
      setPlate('done', 'Шматок вийшов 👍', 'Тепер уся фраза, повільно');
    } else if (r.clean) {
      setPlate('done', 'Добре, ще раз', 'Шматок двічі чисто, і йдемо далі');
    } else {
      setPlate('wait', 'Ще раз 🙂', r.hint);
    }
    return null;
  }

  // in tempo
  let msg = null;
  if (stage !== 'warmup') {
    const idx = stage === 'review' ? reviewQueue[0] : progress.current;
    msg = recordAttempt(progress, idx, r.clean);
    saveProgress(progress);
  }
  if (!r.clean) {
    streak = 0;
    if (++help.fails >= 2) {
      help.mode = 'slow';
      help.slowFails = 0;
      setPlate('wait', 'Повільніше, розберемося 🙂', `${r.hint}. Зіграємо на ${slower(base.bpm)} BPM`);
    } else {
      setPlate('wait', 'Ще раз 🙂', r.hint);
    }
    return msg;
  }
  streak++;
  if (stage === 'warmup') {
    warmTakes.push({ phrase, result: r });
    warmIdx++;
    setPlate('done', 'Добре 👍', r.tempoRatio < 0.94 ? 'Трохи поспішаєш, не жени 🙂' : r.tempoRatio > 1.06 ? 'Трохи тягнеш, можна живіше' : '');
  } else {
    if (stage === 'review' && ++reviewClean >= REVIEW_CLEAN) {
      reviewQueue.shift();
      reviewClean = 0;
    }
    setPlate('done', r.hint, msg || '');
  }
  return msg;
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
  if (help.mode === 'part') demoLearned = true;
  const struggling = DEMO_STRUGGLE && stage === 'new' && !demoLearned;
  const drift = struggling ? -0.15 : (Math.random() - 0.5) * 0.08;
  phrase.notes.forEach((nt, i) => {
    if (!DEMO_STRUGGLE && Math.random() < 0.05) return;
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
    later(startCheck, kit ? 300 : 2500);
  } else if (stage === 'check') {
    later(startCheck, 300);
  } else {
    later(nextPhrase, 300);   // resume: the same phrase again from "listen"
  }
}

function pause() {
  clearTimers();
  stopBeat();
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
  if (stage === 'check') {
    check = null;
    warmIdx = 0;
    warmTakes = [];
    goStage('warmup', 'Перевірку пропущено', 'Далі розминка');
    return;
  }
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

// sensitivity: slider right = lower threshold = more sensitive; the sound check moves it too
const SENS_TOP = 36;
function showSens() {
  const t = E.settings.sensDb;
  $('sens').value = SENS_TOP - t;
  $('sensVal').textContent = `${t <= 14 ? 'висока' : t <= 22 ? 'середня' : 'низька'} (поріг ${t} дБ над шумом)`;
}
showSens();
$('sens').oninput = () => { E.setSensitivity(SENS_TOP - Number($('sens').value)); showSens(); };

$('metro').value = prefs.metro;
const showMetro = () => { $('metroVal').textContent = prefs.metro ? prefs.metro + '%' : 'вимкнено'; };
showMetro();
$('metro').oninput = () => { prefs.metro = Number($('metro').value); savePrefs(); showMetro(); };
$('blinkCheck').checked = prefs.blink;
$('blinkCheck').onchange = () => { prefs.blink = $('blinkCheck').checked; savePrefs(); };
$('leftTopCheck').checked = prefs.leftTop;
$('leftTopCheck').onchange = () => { prefs.leftTop = $('leftTopCheck').checked; savePrefs(); if (phrase) { renderGrid(); } };
$('replayCheck').checked = prefs.replay;
$('replayCheck').onchange = () => { prefs.replay = $('replayCheck').checked; savePrefs(); };

setPlate('', 'Одягни навушники і натисни «Почати»',
  `Спочатку коротка перевірка звуку і розминка, потім повторення і нове. Зараз: ${STEPS[progress.current].title}, ${TEMPOS[progress.steps[STEPS[progress.current].id].t]} BPM.`);
