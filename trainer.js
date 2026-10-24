// Echo trainer: the app plays a phrase, waits patiently, you echo it on the pad, it shows how it went.
// Session (short ~10 min by default, or full ~20): sound check once a day → warm-up → review of
// passed lessons → the current lesson, mixed with its mirror and a known phrase now and then →
// an easy final phrase and a summary. Visual support in the spirit of Patapon: the screen frame
// pulses on the beats and every hit pops right away, brighter the closer it is to the beat.

import * as E from './engine.js';
import { createCorgi } from './corgi.js';
import {
  STEPS, LEVELS, WARMUP, STRICTNESS, TEMPOS, notesOf, stepPhrase, canMirror, noteGap, grade, handBalance,
  loadProgress, saveProgress, recordAttempt, reviewSteps,
} from './course.js';

const $ = id => document.getElementById(id);
// ?demo: no mic, a simulated player echoes each phrase (for testing without a pad);
// ?demo=struggle: in "new" the player rushes until it has worked through the trouble spot
const DEMO = new URLSearchParams(location.search).has('demo');
const DEMO_STRUGGLE = new URLSearchParams(location.search).get('demo') === 'struggle';
let demoLearned = false;

const PREFS_KEY = 'pt.trainer';
const prefs = { strict: 'soft', metro: 30, blink: true, leftTop: false, length: 'short' };
try { Object.assign(prefs, JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')); } catch {}
const savePrefs = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch {} };

// how much a session holds
const LENGTHS = {
  short: { label: 'Коротке (~10 хв)', warmup: [0, 1, 4], review: 2, reviewClean: 1, goal: 6, minutes: 5 },
  full: { label: 'Повне (~20 хв)', warmup: [0, 1, 2, 3, 4, 5, 6], review: 3, reviewClean: 2, goal: 12, minutes: 10 },
};
const plan = () => LENGTHS[prefs.length] || LENGTHS.short;

const LISTEN_LEAD = 0.35;   // seconds from "listen" to the first note
const NEXT_PAUSE = 1800;    // ms between a clean result and the next phrase
const STAGE_PAUSE = 2800;   // ms to read a stage summary
const HOLD_DEAF = 800;      // ms after a miss before a pad tap counts as "go on"
const PERFECT = 0.07;       // share of the note gap for a "perfect" pop
const INSERT_EVERY = 3;     // in "new": a known phrase after this many accepted lesson phrases
const MIRROR_EVERY = 3;     // in "new": every 3rd lesson phrase is led by the other hand
const STUCK_AFTER = 8;      // attempts on the lesson without moving on before it's parked for a while
const PARK_FOR = 2;         // known phrases played while the lesson is parked

const progress = loadProgress();
let kit = null;
let running = false;
let sessionStarted = false;

let stage = null;           // 'check' | 'warmup' | 'review' | 'new' | 'finish' | 'done'
let warmIdx = 0;
let warmTakes = [];
let reviewQueue = [];
let reviewClean = 0;
let streak = 0;             // clean phrases in tempo in a row; a miss just resets it quietly
let stats = null;           // { accepted, best, startMs, startStep, startTempo }

// "new" stage: what to play next and how it's going
let newState = null;        // { accepted, goal, startMs, sinceInsert, lessonCount, stuck, parked, pick }

let base = null;            // the phrase as the course wants it: { title, notes: [{ hand, accent }], bpm }
let phrase = null;          // what is played now: base, or base slower, or its trouble spot
let phase = 'idle';         // idle | check | listen | wait | play | result | hold
let hits = [];
let holdSince = 0;
let lastTake = null;        // { hits, key } of the last finished attempt, for "how you played"
const phraseKey = () => `${help.key}|${help.mode}`;

let timers = [];
const later = (fn, ms) => timers.push(setTimeout(fn, Math.max(0, ms)));
const clearTimers = () => { timers.forEach(clearTimeout); timers = []; };
// ms until a ctx-clock time is heard
const msUntil = t => (t - E.ctx.currentTime + (E.ctx.outputLatency || 0)) * 1000;
const today = () => new Date().toDateString();

// ---------- help ladder ----------

// For a phrase that doesn't come out, like a teacher would: again → a tempo step slower →
// (still not) only the trouble spot, slow, in a loop → the whole phrase slow → back in tempo.
// Nothing moves on until the phrase comes out, unless skipped by hand.
let help = null;            // { key, mode: normal | slow | part, fails, slowFails, partClean, part }
const resetHelp = key => { help = { key, mode: 'normal', fails: 0, slowFails: 0, partClean: 0, part: null }; };
const slower = bpm => (TEMPOS.indexOf(bpm) > 0 ? TEMPOS[TEMPOS.indexOf(bpm) - 1] : Math.round(bpm * 0.9));
const PART_LEN = 4;         // notes in a trouble spot; played twice in a row

function helpPhrase() {
  if (help.mode === 'slow') return { ...base, bpm: slower(base.bpm) };
  if (help.mode === 'part') {
    const frag = base.notes.slice(help.part, help.part + PART_LEN);
    return { title: base.title, notes: [...frag, ...frag], bpm: slower(base.bpm), loop: PART_LEN };
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
  $('plate').className = 'plate' + (state ? ' p-' + state : '');
  $('plate').innerHTML = `<b>${title}</b>` + (sub ? `<span class="small">${sub}</span>` : '');
}

const STAGES = ['warmup', 'review', 'new', 'finish'];

function setStage(name) {
  stage = name;
  const cur = STAGES.indexOf(name === 'done' ? 'finish' : name);
  for (const el of $('stages').children) {
    const k = STAGES.indexOf(el.dataset.stage);
    el.className = k === cur ? 'active' : k < cur || name === 'done' ? 'done' : '';
  }
  $('skipBtn').disabled = name === 'warmup' || name === 'done';   // warm-up is mandatory
  $('skipBtn').textContent = name === 'new' ? 'Пропустити вправу' : name === 'check' ? 'Пропустити перевірку' : 'Пропустити';
}

function showStreak() {
  $('streak').textContent = streak >= 2 ? `🔥 ${streak} поспіль` : '';
  document.body.classList.toggle('fever', streak >= 4);
}

const COUNTS = ['1', 'і', '2', 'і', '3', 'і', '4', 'і'];

// two rows of dots, one per hand (right on top unless swapped), each hand in its own colour with its
// letter inside, so tired eyes don't mix them up; accents are big. Below: loudness bars, marks, count.
// A looped trouble spot gets a divider between its two passes.
function renderGrid() {
  const g = $('grid');
  g.style.setProperty('--n', phrase.notes.length);
  g.innerHTML = '';
  const cell = (cls, html = '', i) => {
    const d = document.createElement('div');
    d.className = cls + (phrase.loop && i === phrase.loop ? ' loop-start' : '');
    d.innerHTML = html;
    if (i !== undefined) d.dataset.i = i;
    g.append(d);
  };
  const row = hand => {
    const letter = hand === 'R' ? 'П' : 'Л';
    cell(`hand ${hand}`, letter);
    phrase.notes.forEach((nt, i) => cell(`slot ${hand}`, nt.hand === hand
      ? `<span class="note ${hand}${nt.accent ? ' acc' : ''}" data-i="${i}">${letter}</span>` : '', i));
  };
  for (const hand of prefs.leftTop ? ['L', 'R'] : ['R', 'L']) row(hand);
  cell('hand', '');
  phrase.notes.forEach((_, i) => cell('vel', '<i></i>', i));
  cell('hand', '');
  phrase.notes.forEach((_, i) => cell('mark', '', i));
  cell('hand', '');
  phrase.notes.forEach((_, i) => cell('count muted small', COUNTS[i % 8], i));
  $('gridLabel').textContent = phrase.loop ? `Шматок ×2: ${base.notes.slice(help.part, help.part + PART_LEN).map(n => (n.hand === 'R' ? 'П' : 'Л')).join(' ')}` : '';
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

// what went wrong, note by note, in words: "нота 3 (Л): рано"; a fallen-apart take gets one line
// (with the right number of hits, a "missing" note was played, just too far from its place)
const WHAT = { early: 'рано', late: 'пізно', miss: 'не почув', weak: 'акцент слабкий' };
function explain(r) {
  const bad = r.notes.map((res, i) => ({ res, i })).filter(({ res }) => res.status !== 'ok');
  if (!bad.length) return '';
  if (bad.length >= 4) return 'Розсипалось, нічого страшного 🙂';
  const moved = hits.length === phrase.notes.length;
  const what = st => (st === 'miss' && moved ? 'зсунулась' : WHAT[st]);
  return bad.map(({ res, i }) => `нота ${i + 1} (${phrase.notes[i].hand === 'R' ? 'П' : 'Л'}): ${what(res.status)}`).join(' · ');
}

const lessonNo = i => `Урок ${i + 1}`;

function showHeader(pickInfo) {
  let title = base.title;
  if (pickInfo?.step !== undefined) title = `${lessonNo(pickInfo.step)} · ${base.title}`;
  $('phraseTitle').textContent = title + (help.mode === 'part' ? ' — шматок' : '');
  $('bpmPlate').textContent = `${phrase.bpm} BPM`;
  if (help.mode === 'slow') {
    $('phraseSub').textContent = `Повільніше · потім у темпі ${base.bpm}`;
    return;
  }
  if (help.mode === 'part') {
    $('phraseSub').textContent = 'Розбираємо шматок · потім уся фраза';
    return;
  }
  const subs = [];
  if (stage === 'warmup') subs.push(`Розминка · фраза ${warmIdx + 1} з ${plan().warmup.length}`);
  if (stage === 'new') {
    let sub = `Фраза ${newState.accepted + 1} з ${newState.goal}`;
    if (pickInfo?.kind === 'lesson') {
      const st = progress.steps[STEPS[progress.current].id];
      sub += ` · до наступного кроку ${st.hist.filter(Boolean).length} з ${st.len === 'short' ? 2 : 3}`;
    }
    if (pickInfo?.kind === 'insert') sub += ' · знайоме, для перепочинку';
    subs.push(sub);
  }
  if (stage === 'review') subs.push(`Повторення · ще ${reviewQueue.length} ${reviewQueue.length === 1 ? 'вправа' : 'вправи'}`);
  if (stage === 'finish') subs.push('Легка фраза наостанок');
  $('phraseSub').textContent = subs.join('');
}

// ---------- lessons map ----------

function renderMap() {
  const out = [];
  LEVELS.forEach((lvl, li) => {
    out.push(`<div class="level${lvl.locked ? ' locked' : ''}"><b>${lvl.title}</b> <span class="muted small">${lvl.note}</span></div>`);
    lvl.lessons.forEach((title, k) => {
      if (lvl.locked) {
        out.push(`<div class="lesson locked"><span class="no">🔒</span><span class="grow">${title}</span><span class="muted small">згодом</span></div>`);
        return;
      }
      const step = STEPS[k], st = progress.steps[step.id];
      const cur = k === progress.current;
      const status = st.passed ? '✓' : cur ? '●' : '·';
      const pct = Math.round(st.t / step.max * 100);
      out.push(`<div class="lesson${cur ? ' current' : ''}${st.passed ? ' passed' : ''}${!st.passed && !cur && k > progress.current ? ' ahead' : ''}">
        <span class="no">${status} ${k + 1}</span><span class="grow">${title}</span>
        <span class="tempo"><i style="width:${pct}%"></i></span><span class="muted small">${TEMPOS[st.t]}/${TEMPOS[step.max]}</span></div>`);
    });
  });
  $('map').innerHTML = out.join('');
  $('mapSummary').textContent = `Ти зараз: ${lessonNo(progress.current)} з ${STEPS.length}, ${STEPS[progress.current].title}`;
}

// ---------- beat pulse ----------

// The frame pulses on the beats, bright on "1", plus a faint pulse on an "і" half-beat when a stroke
// falls on it. It keeps going from "listen" into "your turn" (beats only, no strokes there), so you
// can come in on any pulse; your first hit re-syncs it to you.
let beat = null;            // { t0, period: one eighth, strokes: eighths that carry a stroke } on the heard timeline
let lastBeat = -1;

function startBeat(t0, period, strokes) { beat = { t0, period, strokes }; lastBeat = -1; }
function stopBeat() { beat = null; }

// pulse for eighth k: 'strong' on "1", 'beat' on 2/3/4, 'half' on an "і" with a stroke, else none
export function pulseKind(k, strokes) {
  if (k % 8 === 0) return 'strong';
  if (k % 2 === 0) return 'beat';
  return k < strokes ? 'half' : null;
}

(function beatLoop() {
  if (beat && E.ctx && prefs.blink) {
    const heard = E.ctx.currentTime - (E.ctx.outputLatency || 0);
    const k = Math.floor((heard - beat.t0) / beat.period + 0.001);
    if (k >= 0 && k !== lastBeat) {
      lastBeat = k;
      const kind = pulseKind(k, beat.strokes);
      if (kind) {
        const frame = $('beatFrame');
        frame.className = '';
        void frame.offsetWidth;
        frame.className = 'pulse ' + kind;
        if (kind !== 'half' && phase !== 'listen') corgi.beat(kind === 'strong');
        const c = countEl(k % 8);
        if (c && phase !== 'result' && phase !== 'hold') {
          $('grid').querySelectorAll('.count.on').forEach(el => el.classList.remove('on'));
          c.classList.add('on');
        }
      }
    }
  }
  requestAnimationFrame(beatLoop);
})();

// ---------- sound check ----------

// Quick check, once a day: silence (no false hits), soft hits (all heard), accents (not clipping).
// Sensitivity adapts by itself; Gain advice is shown at the end.
const CHECK_HITS = 4;
let check = null;           // { step: silence | soft | accent, rounds, got: [db], soft }

function startCheck() {
  if (E.settings.checkDate === today()) {
    goStage('warmup', 'Звук уже перевірено сьогодні 👍', 'Одразу до розминки');
    return;
  }
  setStage('check');
  $('phraseTitle').textContent = 'Перевірка звуку';
  $('bpmPlate').textContent = '15 с';
  $('phraseSub').textContent = '15 секунд, раз на день, щоб мікрофон чув тебе правильно';
  $('grid').innerHTML = '';
  $('gridLabel').textContent = '';
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
    E.settings.accentGapDb = diff;   // the player's own soft→accent gap, used by "how you played"
    notes.push(`різниця тихий/акцент ${diff} дБ, ${diff >= 8 ? 'чути чітко' : 'можна сильніше розводити'}`);
  }
  E.settings.checkDate = today();
  E.saveSettings();
  check = null;
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
  if (name === 'warmup') { warmIdx = 0; warmTakes = []; }
  if (name === 'review') { reviewQueue = reviewSteps(progress).slice(0, plan().review); reviewClean = 0; }
  if (name === 'new') {
    newState = { accepted: 0, goal: plan().goal, startMs: Date.now(), sinceInsert: 0, lessonCount: 0, stuck: 0, parked: 0, pick: null };
  }
  setPlate('done', title, sub);
  later(nextPhrase, STAGE_PAUSE);
}

// a known phrase for a breather or the finish: a passed lesson a tempo step below its best,
// or single strokes when nothing is passed yet
function knownPick() {
  const passed = STEPS.map((s, i) => i).filter(i => progress.steps[STEPS[i].id].passed && i !== progress.current);
  if (!passed.length) return { kind: 'insert', warm: 4 };
  return { kind: 'insert', step: passed[Math.floor(Math.random() * passed.length)], slower: 1 };
}

// what "new" plays next: the lesson (every 3rd led by the other hand), a known phrase after every
// few accepted lesson phrases, or known phrases while a stuck lesson is parked
function pickNew() {
  const ns = newState;
  if (ns.parked > 0) return knownPick();
  if (ns.sinceInsert >= INSERT_EVERY) { ns.sinceInsert = 0; return knownPick(); }
  const step = STEPS[progress.current];
  const mirror = canMirror(step) && ns.lessonCount % MIRROR_EVERY === MIRROR_EVERY - 1;
  return { kind: 'lesson', step: progress.current, mirror };
}

function phraseOfPick(p) {
  if (p.warm !== undefined) {
    const w = WARMUP[p.warm];
    return { title: w.title, notes: notesOf(w.sticking, w.accents), bpm: w.bpm };
  }
  const step = STEPS[p.step];
  return stepPhrase(step, progress.steps[step.id], { mirror: p.mirror, slower: p.slower || 0 });
}

function nextPhrase() {
  let pickInfo = null;
  if (stage === 'warmup') {
    if (warmIdx >= plan().warmup.length) {
      const bal = handBalance(warmTakes);
      goStage('review', 'Розминку зроблено 👍', bal ? `Ліва рука ≈ ${bal}% від правої за силою удару` : '');
      return;
    }
    const w = WARMUP[plan().warmup[warmIdx]];
    base = { title: w.title, notes: notesOf(w.sticking, w.accents), bpm: w.bpm };
  } else if (stage === 'review') {
    if (!reviewQueue.length) {
      goStage('new', progress.steps[STEPS[0].id].passed ? 'Повторення зроблено 👍' : 'Поки нічого повторювати, це нормально',
        `Далі ${lessonNo(progress.current)}: ${STEPS[progress.current].title}`);
      return;
    }
    pickInfo = { step: reviewQueue[0] };
    const step = STEPS[reviewQueue[0]];
    base = stepPhrase(step, progress.steps[step.id]);
  } else if (stage === 'new') {
    const ns = newState;
    if (!ns.pick && (ns.accepted >= ns.goal || Date.now() - ns.startMs > plan().minutes * 60000)) {
      setStage('finish');
      ns.pick = knownPick();
    }
    ns.pick ??= pickNew();
    pickInfo = ns.pick;
    base = phraseOfPick(ns.pick);
  } else if (stage === 'finish') {
    pickInfo = newState.pick;
    base = phraseOfPick(newState.pick);
  } else {
    return;
  }
  const key = [stage, warmIdx, base.title, base.bpm, base.notes.length].join('|');
  if (help?.key !== key) resetHelp(key);
  phrase = helpPhrase();
  renderGrid();
  showHeader(pickInfo);
  listen();
}

// the app plays the phrase with a soft click on every beat
function listen() {
  clearTimers();
  phase = 'listen';
  corgi.mood('');
  clearMarks();
  setPlate('listen', 'Слухай…');
  $('againBtn').disabled = true;
  $('replayBtn').disabled = true;
  $('nextBtn').hidden = true;
  const gap = noteGap(phrase.bpm);
  const t0 = E.ctx.currentTime + LISTEN_LEAD;
  startBeat(t0, gap, phrase.notes.length);
  phrase.notes.forEach((nt, i) => {
    const t = t0 + i * gap;
    E.playNote(kit, nt.accent, t);
    if (i % 2 === 0) E.click(t, prefs.metro / 100, i === 0);
    later(() => { flash(i, 'now'); corgi.hit(nt.hand, nt.accent); }, msUntil(t));
  });
  later(waitTurn, msUntil(t0 + phrase.notes.length * gap));
}

// patient: nothing happens until the first hit; the pulse keeps going meanwhile
function waitTurn() {
  phase = 'wait';
  hits = [];
  setPlate('go', 'Твоя черга', 'Вступай на будь-який спалах рамки. Я почекаю.');
  $('againBtn').disabled = false;
  // the previous take can still be heard while waiting, if it was this same phrase
  $('replayBtn').disabled = lastTake?.key !== phraseKey();
  if (DEMO) simulatePlayer();
}

function onHit(h) {
  if (phase === 'check') { checkHit(h); return; }
  // after a miss: a deliberate tap on the pad means "ready, go on"
  if (phase === 'hold') {
    if (performance.now() - holdSince > HOLD_DEAF) goOn();
    return;
  }
  const n = phrase?.notes.length, gap = phrase && noteGap(phrase.bpm);
  if (phase === 'wait') {
    phase = 'play';
    hits = [h];
    $('againBtn').disabled = true;
    // the pulse and the soft click now follow the player's own first hit. A hit is stamped in+out
    // latency after the stroke on the timeline sounds are scheduled on, so that is taken off.
    const start = h.time - E.latencySec();
    startBeat(start, gap, n);
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
  // warm-up and the final phrase are judged softly: "more or less" is enough there
  const r = grade(phrase, hits, stage === 'warmup' || stage === 'finish' ? 'soft' : prefs.strict);
  showResult(r);
  const { msg, accepted, summary } = stepHelp(r);
  corgi.mood(accepted || summary ? 'happy' : 'cheer');
  showStreak();
  renderMap();
  if (summary) return;

  lastTake = hits.length ? { hits, key: phraseKey() } : null;
  $('replayBtn').disabled = !lastTake;
  if (accepted) {
    later(nextPhrase, NEXT_PAUSE + (msg ? 1200 : 0));
    return;
  }
  // not this time: stay on the result until the player is ready
  phase = 'hold';
  holdSince = performance.now();
  $('plate').insertAdjacentHTML('beforeend', '<span class="small hold">Прочитай спокійно. Вдар по паду або натисни «Далі», коли готовий.</span>');
  $('nextBtn').hidden = false;
  if (DEMO) later(goOn, 2500);
}

function goOn() {
  if (phase !== 'hold') return;
  $('nextBtn').hidden = true;
  nextPhrase();
}

// Move along the help ladder and the session -> { msg: course message, accepted: the phrase is done }
function stepHelp(r) {
  const why = explain(r);
  const detail = (hint) => [hint, why].filter(Boolean).join('<br>');
  if (help.mode === 'slow') {
    if (r.clean) {
      help.mode = 'normal';
      help.fails = 1;   // one more miss in tempo goes straight back to slow
      setPlate('done', 'Вийшло! 👍', `А тепер у темпі ${base.bpm}`);
      return { msg: null, accepted: true };
    }
    if (++help.slowFails >= 2) {
      help.mode = 'part';
      help.part = troubleSpot(r);
      help.partClean = 0;
      const frag = base.notes.slice(help.part, help.part + PART_LEN).map(n => (n.accent ? '>' : '') + (n.hand === 'R' ? 'П' : 'Л')).join(' ');
      setPlate('wait', 'Розберемо шматок', detail(`${frag} — двічі поспіль, повільно`));
    } else {
      setPlate('wait', 'Ще раз, повільно 🙂', detail(r.hint));
    }
    return { msg: null, accepted: false };
  }
  if (help.mode === 'part') {
    if (r.clean && ++help.partClean >= 2) {
      help.mode = 'slow';
      help.slowFails = 0;
      setPlate('done', 'Шматок вийшов 👍', 'Тепер уся фраза, повільно');
      return { msg: null, accepted: true };
    }
    if (r.clean) {
      setPlate('done', 'Добре, ще раз', 'Шматок двічі чисто, і йдемо далі');
      return { msg: null, accepted: true };
    }
    setPlate('wait', 'Ще раз 🙂', detail(r.hint));
    return { msg: null, accepted: false };
  }

  // in tempo
  let msg = null;
  const pick = stage === 'new' || stage === 'finish' ? newState.pick : null;
  const stepIdx = stage === 'review' ? reviewQueue[0] : pick?.step;
  if (stepIdx !== undefined && stage !== 'finish' && !pick?.slower) {
    // a clean take in your own tempo is accepted, but only one near the target moves the course on
    msg = recordAttempt(progress, stepIdx, r.onTarget);
    saveProgress(progress);
  }
  if (stage === 'new' && pick?.kind === 'lesson') {
    newState.stuck = msg ? 0 : newState.stuck + 1;
  }

  if (!r.clean) {
    streak = 0;
    if (++help.fails >= 2) {
      help.mode = 'slow';
      help.slowFails = 0;
      setPlate('wait', 'Повільніше, розберемося 🙂', detail(`${r.hint}. Зіграємо на ${slower(base.bpm)} BPM`));
    } else {
      setPlate('wait', 'Ще раз 🙂', detail(r.hint));
    }
    // a lesson that won't move: put it aside for a couple of known phrases, come back fresh
    if (stage === 'new' && pick?.kind === 'lesson' && newState.stuck >= STUCK_AFTER) {
      newState.stuck = 0;
      newState.parked = PARK_FOR;
      newState.pick = null;
      setPlate('wait', 'Відкладемо цю на хвилинку 🙂', detail('Пограємо знайоме і повернемося на свіжу голову'));
    }
    return { msg, accepted: false };
  }

  streak++;
  stats.accepted++;
  stats.best = Math.max(stats.best, streak);
  if (stage === 'warmup') {
    warmTakes.push({ phrase, result: r });
    warmIdx++;
    setPlate('done', 'Добре 👍', r.tempoRatio < 0.94 ? 'Трохи поспішаєш, не жени 🙂' : r.tempoRatio > 1.06 ? 'Трохи тягнеш, можна живіше' : '');
  } else if (stage === 'review') {
    if (++reviewClean >= plan().reviewClean) {
      reviewQueue.shift();
      reviewClean = 0;
    }
    setPlate('done', r.hint, msg || '');
  } else if (stage === 'new') {
    newState.accepted++;
    if (pick.kind === 'lesson') { newState.lessonCount++; newState.sinceInsert++; }
    if (pick.kind === 'insert' && newState.parked > 0) newState.parked--;
    newState.pick = null;
    setPlate('done', r.hint, msg || '');
  } else if (stage === 'finish') {
    showSummary();
    return { msg: null, accepted: false, summary: true };
  }
  return { msg, accepted: true };
}

// ---------- finish ----------

function showSummary() {
  clearTimers();
  setStage('done');
  phase = 'idle';
  const mins = Math.max(1, Math.round((Date.now() - stats.startMs) / 60000));
  const step = STEPS[progress.current], st = progress.steps[step.id];
  const lines = [
    `${stats.accepted} фраз зараховано за ${mins} хв · найкраща серія ${stats.best}`,
    `${lessonNo(progress.current)}: ${step.title}, зараз ${TEMPOS[st.t]} BPM` +
      (progress.current !== stats.startStep || st.t !== stats.startTempo ? ' (рух уперед! 🎉)' : ''),
  ];
  const bal = handBalance(warmTakes);
  if (bal) lines.push(`Ліва ≈ ${bal}% від правої за силою удару`);
  $('phraseTitle').textContent = 'Заняття завершено';
  $('bpmPlate').textContent = `${mins} хв`;
  $('phraseSub').textContent = 'Добра робота. Коротко, але щодня — найкраще.';
  corgi.mood('happy');
  $('grid').innerHTML = '';
  $('gridLabel').textContent = '';
  setPlate('done', 'Підсумок', lines.join('<br>') +
    '<span class="row"><button id="endBtn" class="cta">Завершити</button><button id="moreBtn" class="cta">Ще трохи</button></span>');
  $('moreBtn').onclick = () => {
    setStage('new');
    newState.goal = newState.accepted + Math.ceil(plan().goal / 2);
    newState.startMs = Date.now();
    newState.pick = null;
    nextPhrase();
  };
  $('endBtn').onclick = leaveSession;
  $('againBtn').disabled = true;
  $('replayBtn').disabled = true;
  $('nextBtn').hidden = true;
  stopBeat();
}

// "How you played", on demand: the last take re-sounded with the kit, keeping its timing and
// dynamics. A stroke counts as an accent only when it rises above the take's typical stroke by at
// least half of the player's own soft→accent gap (from the sound check), so even playing sounds even.
const DEFAULT_ACCENT_GAP_DB = 16;

function replay(take) {
  const med = a => [...a].sort((x, y) => x - y)[a.length >> 1];
  const typical = med(take.map(h => h.db));
  const rise = Math.max(4, (E.settings.accentGapDb ?? DEFAULT_ACCENT_GAP_DB) / 2);
  const isAccent = h => h.db >= typical + rise;
  const accents = take.filter(isAccent).map(h => h.db);
  const ref = { true: accents.length ? med(accents) : 0, false: typical };
  const t0 = E.ctx.currentTime + 0.25;
  take.forEach((h, i) => {
    const accent = isAccent(h);
    const level = Math.min(1.5, Math.max(0.6, 10 ** ((h.db - ref[accent]) / 20)));
    const t = t0 + h.time - take[0].time;
    E.playNote(kit, accent, t, level);
    if (i < phrase.notes.length) later(() => flash(i, 'now'), msUntil(t));
  });
  return 0.25 + take.at(-1).time - take[0].time + 0.6;
}

$('replayBtn').onclick = () => {
  if (lastTake?.key !== phraseKey() || !['result', 'hold', 'wait'].includes(phase)) return;
  $('replayBtn').disabled = true;
  const was = phase;
  if (was === 'result') clearTimers();   // hold the flow while it plays
  const ms = replay(lastTake.hits) * 1000;
  const plate = $('plate').innerHTML, cls = $('plate').className;
  setPlate('listen', '▶ Так ти зіграв');
  if (was === 'hold') phase = 'replay';  // taps during the replay don't count as "go on"
  later(() => {
    $('plate').className = cls;
    $('plate').innerHTML = plate;
    $('replayBtn').disabled = false;
    if (was === 'result') nextPhrase();
    if (was === 'hold') { phase = 'hold'; holdSince = performance.now(); }
  }, ms + 400);
};

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
  showScreen('play');
  $('pauseBtn').textContent = '❚❚';
  if (!sessionStarted) {
    sessionStarted = true;
    progress.session++;
    if (!progress.days.includes(today())) progress.days = [...progress.days, today()].slice(-60);
    saveProgress(progress);
    streak = 0;
    stats = { accepted: 0, best: 0, startMs: Date.now(), startStep: progress.current, startTempo: progress.steps[STEPS[progress.current].id].t };
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
  $('pauseBtn').textContent = '▶';
  $('againBtn').disabled = true;
  $('nextBtn').hidden = true;
  setPlate('', 'Пауза', 'Продовжимо з тієї ж фрази.' +
    '<span class="row"><button id="resumeBtn" class="cta">▶ Продовжити</button><button id="leaveBtn" class="cta">На головну</button></span>');
  $('resumeBtn').onclick = resume;
  $('leaveBtn').onclick = leaveSession;
}

async function resume() {
  try {
    await start();
  } catch (e) {
    pause();
    setPlate('warn', 'Не вдалося увімкнути мікрофон', e.message || e.name);
  }
}

// back to "today": the session ends here, the next start is a new one
function leaveSession() {
  clearTimers();
  stopBeat();
  E.stopMic();
  running = false;
  sessionStarted = false;
  phase = 'idle';
  stage = null;
  document.body.classList.remove('fever');
  renderHome();
  showScreen('home');
}

$('goBtn').onclick = async () => {
  $('goBtn').disabled = true;
  await resume();
  $('goBtn').disabled = false;
};
$('pauseBtn').onclick = () => (running ? pause() : resume());

$('againBtn').onclick = () => { if (phase === 'wait') listen(); };
$('nextBtn').onclick = goOn;

$('skipBtn').onclick = () => {
  if (!running || stage === 'warmup' || stage === 'done') return;
  clearTimers();
  if (stage === 'check') {
    check = null;
    goStage('warmup', 'Перевірку пропущено', 'Далі розминка');
    return;
  }
  if (stage === 'review') {
    reviewQueue.shift();
    reviewClean = 0;
    nextPhrase();
    return;
  }
  if (stage === 'finish') { showSummary(); return; }
  if (newState.pick?.kind === 'insert') {
    newState.pick = null;
    nextPhrase();
    return;
  }
  const st = progress.steps[STEPS[progress.current].id];
  st.passed = true;
  if (progress.current < STEPS.length - 1) progress.current++;
  saveProgress(progress);
  renderMap();
  newState.pick = null;
  setPlate('done', 'Пропущено', `Далі ${lessonNo(progress.current)}: ${STEPS[progress.current].title}`);
  later(nextPhrase, STAGE_PAUSE);
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
const lengthSel = $('lengthSelect');
for (const [k, v] of Object.entries(LENGTHS)) lengthSel.add(new Option(v.label, k));
lengthSel.value = prefs.length;
lengthSel.onchange = () => { prefs.length = lengthSel.value; savePrefs(); };

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

// ---------- screens ----------

function showScreen(name) {
  document.body.dataset.screen = name;
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.go === name));
  if (name === 'path') renderMap();
}
document.querySelectorAll('.tabs button').forEach(b => { b.onclick = () => showScreen(b.dataset.go); });

// days in a row up to today (or yesterday, if today isn't played yet)
function dayStreak() {
  const set = new Set(progress.days);
  const d = new Date();
  if (!set.has(d.toDateString())) d.setDate(d.getDate() - 1);
  let n = 0;
  while (set.has(d.toDateString())) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

function renderHome() {
  const step = STEPS[progress.current], st = progress.steps[step.id];
  $('homeLesson').textContent = `${lessonNo(progress.current)} · ${step.title}`;
  $('homeMeta').textContent = `${TEMPOS[st.t]} BPM · розминка, повторення, нове і фініш`;
  $('homeLength').textContent = prefs.length === 'full' ? '20 хв' : '10 хв';
  const days = dayStreak();
  $('homeDays').textContent = days >= 2 ? `🔥 ${days} дні поспіль` : days === 1 ? 'Вчора грав 👍' : '';
}

const corgi = createCorgi($('corgiPlay'));
createCorgi($('corgiHome'));
lengthSel.addEventListener('change', renderHome);
renderMap();
renderHome();
