// Echo trainer: the app plays a phrase, waits patiently, you echo it on the pad, it shows how it went.
// Session (short ~10 min by default, full ~20, or a mini one for busy days): sound check once a day →
// warm-up → review of slipped / settling / mastered lessons → the current lesson, mixed with its
// mirror and a settling or known phrase now and then → an easy final phrase and a teacher's summary.
// A skill session (from a tag in «Мій шлях») is warm-up → that skill's exercises → finish.
// Like a teacher it notices the day: off form from the warm-up → offers calm concentration exercises;
// quality sliding mid-session → offers to finish on an easy phrase. Questions are answered with the
// pad: 1 tap or 2 taps. Visual support in the spirit of Patapon: the screen frame pulses on the beats
// and every hit pops right away, brighter the closer it is to the beat.

import * as E from './engine.js';
import { createCorgi } from './corgi.js';
import {
  STEPS, WARMUP, STRICTNESS, TEMPOS, notesOf, stepPhrase, canMirror, noteGap, grade, rankOf, handBalance, tempoOf,
  loadProgress, saveProgress, recordAttempt, reviewSteps, settlingSteps, slippedNeed, sessionQuality, openNext,
  closeSession, dayKey,
} from './course.js';
import {
  loadProfile, saveProfile, takeMetrics, addTake, warmupOffForm, tiring, sessionReport, endSession,
  progressNote, lessonReport, metric,
} from './profile.js';
import { SKILLS, skillValue, levelWord, skillNote, skillPractice, skillFocus } from './skills.js';
import { renderPath, focusCloud } from './path.js';

const $ = id => document.getElementById(id);
// ?demo: no mic, a simulated player echoes each phrase (for testing without a pad);
// ?demo=struggle: in "new" the player rushes until it has worked through the trouble spot
const DEMO = new URLSearchParams(location.search).has('demo');
const DEMO_STRUGGLE = new URLSearchParams(location.search).get('demo') === 'struggle';
// ?demo=offform: the warm-up reads as a bad day and the calm exercises are accepted
const DEMO_OFF = new URLSearchParams(location.search).get('demo') === 'offform';
let demoLearned = false;

const PREFS_KEY = 'pt.trainer';
const prefs = { strict: 'soft', metro: 30, blink: true, leftTop: false, length: 'short' };
try { Object.assign(prefs, JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')); } catch {}
const savePrefs = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch {} };

// how much a session holds; mini (busy days) and skill sessions are started from their own buttons
const LENGTHS = {
  short: { label: 'Коротке (~10 хв)', warmup: [0, 1, 4], review: 2, reviewClean: 1, goal: 6, minutes: 5 },
  full: { label: 'Повне (~20 хв)', warmup: [0, 1, 2, 3, 4, 5, 6], review: 3, reviewClean: 2, goal: 12, minutes: 10 },
  mini: { label: 'Міні (~4 хв)', warmup: [0, 4], review: 2, reviewClean: 1, goal: 3, minutes: 2 },
  skill: { label: 'Скіл (~7 хв)', warmup: [4], review: 0, reviewClean: 1, goal: 6, minutes: 5 },
};
let sessionLen = null;      // this session's length when it isn't the default one
const plan = () => LENGTHS[sessionLen || prefs.length] || LENGTHS.short;

// concentration exercises for a day when the hands aren't in form: slow, quiet, listening
const CALM = [
  { title: 'Одиночні, дуже повільно', sticking: 'RLRLRLRL', bpm: 50, div: 2, say: 'Слухай лише одне: щоб обидві руки звучали однаково' },
  { title: 'Права: удар і пауза', sticking: 'RRRR', bpm: 50, div: 1, say: 'Удар, і довга пауза. Відчуй, як нота лягає' },
  { title: 'Ліва: удар і пауза', sticking: 'LLLL', bpm: 50, div: 1, say: 'Удар, і довга пауза. Відчуй, як нота лягає' },
  { title: 'Тихо і рівно', sticking: 'RLRLRLRL', bpm: 56, div: 2, say: 'Все якомога тихіше й рівніше' },
  { title: 'Коротке ехо', sticking: 'RLR', bpm: 60, div: 2, say: 'Три ноти: відчуй кожну' },
];
const CALM_EACH = 2;        // accepted takes of each concentration exercise
const CALM_MINUTES = 5;

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
const profile = loadProfile();
let kit = null;
let running = false;
let sessionStarted = false;

// what this session has seen, for mastery, the profile and the summary
let skillId = null;         // a skill session: the skill being worked on
let skillBefore = 0;
let sessionTakes = {};      // stepId -> [{ t, score, timing, accents, hands }], in-tempo lesson takes
let sessionMetrics = [];    // per-take metrics (profile.takeMetrics)
let warmScores = [];        // rank scores of the warm-up
let mainScores = [];        // rank scores in the main part, in order, for noticing fatigue
let offForm = false;        // the warm-up was clearly below usual: takes weigh little today
let offFormAsked = false;
let tiredAsked = false;
let sessionClosed = false;
let summaryHtml = '';

let stage = null;           // 'check' | 'warmup' | 'review' | 'new' | 'finish' | 'done'
let warmIdx = 0;
let warmTakes = [];
let reviewQueue = [];
let reviewClean = 0;
let streak = 0;             // clean phrases in tempo in a row; a miss just resets it quietly
let stats = null;           // { accepted, best, startMs, startStep, startTempo }

// "new" stage: what to play next and how it's going
// skill: a skill session's exercises in rotation; calm: concentration exercises (index into CALM);
// prereq: a slipped lesson the current one stands on, brought back first
let newState = null;        // { accepted, goal, startMs, minutes, sinceInsert, lessonCount, stuck, parked, pick,
                            //   skill, skillIdx, calm, calmIdx, calmClean, prereq, prereqClean }

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
    return { title: base.title, notes: [...frag, ...frag], bpm: slower(base.bpm), div: base.div, loop: PART_LEN };
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
    el.classList.toggle('active', k === cur);
    el.classList.toggle('done', k !== cur && (k < cur || name === 'done'));
  }
  $('skipBtn').disabled = name === 'warmup' || name === 'done';   // warm-up is mandatory
  $('skipBtn').textContent = name === 'new' ? 'Пропустити вправу' : name === 'check' ? 'Пропустити перевірку' : 'Пропустити';
}

// the stage names follow the kind of session: a skill session has no review, a calm one is calm
function labelStages(calm = false) {
  const span = k => $('stages').querySelector(`[data-stage="${k}"]`);
  span('review').classList.toggle('skip', !!skillId || calm);
  span('new').textContent = calm ? 'Спокійно' : skillId ? 'Скіл' : 'Нове';
}

function showStreak() {
  $('streak').textContent = streak >= 2 ? `x${streak} КОМБО` : '';
  document.body.classList.toggle('fever', streak >= 4);
}

// the count under each note: the beat number on a beat, "і" / "і а" / "е і а" between beats
const COUNT_SUB = { 1: [''], 2: ['', 'і'], 3: ['', 'і', 'а'], 4: ['', 'е', 'і', 'а'] };
const countLabel = (i, div) => (i % div === 0 ? String(Math.floor(i / div) % 4 + 1) : COUNT_SUB[div][i % div]);
const divOf = p => p.div || 2;

// one note of drum notation: a head with a stem, beamed per beat (two beams for sixteenths), an accent
// mark above, "3" over a triplet
function notaCell(i) {
  const div = divOf(phrase), pos = i % div;
  const last = pos === div - 1 || i === phrase.notes.length - 1;
  let cls = 'nota';
  if (div > 1 && !(pos === 0 && last)) cls += pos === 0 ? ' b-start' : last ? ' b-end' : ' b-mid';
  if (div === 4) cls += ' b2';
  const acc = phrase.notes[i].accent ? '<em>&gt;</em>' : '';
  const trip = div === 3 && pos === 1 ? '<sup>3</sup>' : '';
  return [cls, `${acc}${trip}<span class="nh"></span>`];
}

// two rows of dots, one per hand (right on top unless swapped), each hand in its own colour with its
// letter inside, so tired eyes don't mix them up; accents are big. Below: the notation row, loudness
// bars, marks, count. A looped trouble spot gets a divider between its two passes.
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
  phrase.notes.forEach((_, i) => cell(...notaCell(i), i));
  cell('hand', '');
  phrase.notes.forEach((_, i) => cell('vel', '<i></i>', i));
  cell('hand', '');
  phrase.notes.forEach((_, i) => cell('mark', '', i));
  cell('hand', '');
  phrase.notes.forEach((_, i) => cell('count muted small', countLabel(i, divOf(phrase)), i));
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
  $('rank').className = 'rank';
  $('rank').textContent = '';
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
  if (stage === 'new' && newState.calm) {
    subs.push(`Спокійно · ${CALM[newState.calmIdx].say}`);
  } else if (stage === 'new') {
    let sub = newState.skill ? `Скіл «${SKILLS[newState.skill].title}» · фраза ${newState.accepted + 1} з ${newState.goal}`
      : `Фраза ${newState.accepted + 1} з ${newState.goal}`;
    if (pickInfo?.prereq) {
      sub += ` · освіжаємо: на цьому тримається «${STEPS[progress.current].title}»`;
    } else if (pickInfo?.kind === 'lesson' && pickInfo.step === progress.current) {
      const st = progress.steps[STEPS[progress.current].id];
      sub += ` · до наступного кроку ${st.hist.filter(Boolean).length} з ${st.len === 'short' ? 2 : 3}`;
    }
    if (pickInfo?.settle) sub += ' · закріплюємо';
    else if (pickInfo?.kind === 'insert') sub += ' · знайоме, для перепочинку';
    subs.push(sub);
  }
  if (stage === 'review') subs.push(`Повторення · ще ${reviewQueue.length} ${reviewQueue.length === 1 ? 'вправа' : 'вправи'}`);
  if (stage === 'finish') subs.push('Легка фраза наостанок');
  $('phraseSub').textContent = subs.join('');
}

// ---------- my way ----------

function renderMap() {
  if (document.body.dataset.screen !== 'path') return;
  renderPath({ progress, profile, onPractice: id => startSession('skill', id) });
}

// ---------- beat pulse ----------

// The frame pulses on the beats, bright on "1", plus a faint pulse on an "і" half-beat when a stroke
// falls on it. It keeps going from "listen" into "your turn" (beats only, no strokes there), so you
// can come in on any pulse; your first hit re-syncs it to you.
let beat = null;            // { t0, period: one note, strokes: notes that carry a stroke, div } on the heard timeline
let lastBeat = -1;

function startBeat(t0, period, strokes, div = 2) { beat = { t0, period, strokes, div }; lastBeat = -1; }
function stopBeat() { beat = null; }

// the whole screen gives a small bump on the beats, a bigger one on "1" (Hi-Fi Rush style)
let thumpTimer = null;
function thump(strong) {
  const b = document.body;
  b.classList.remove('thump', 'thump-1');
  void b.offsetWidth;
  b.classList.add(strong ? 'thump-1' : 'thump');
  clearTimeout(thumpTimer);
  thumpTimer = setTimeout(() => b.classList.remove('thump', 'thump-1'), 110);
}

// pulse for note k (div notes per beat): 'strong' on "1", 'beat' on 2/3/4, 'half' between beats
// where a stroke falls, else none
export function pulseKind(k, strokes, div = 2) {
  if (k % (div * 4) === 0) return 'strong';
  if (k % div === 0) return 'beat';
  return k < strokes ? 'half' : null;
}

(function beatLoop() {
  if (beat && E.ctx && prefs.blink) {
    const heard = E.ctx.currentTime - (E.ctx.outputLatency || 0);
    const k = Math.floor((heard - beat.t0) / beat.period + 0.001);
    if (k >= 0 && k !== lastBeat) {
      lastBeat = k;
      const kind = pulseKind(k, beat.strokes, beat.div);
      if (kind) {
        const frame = $('beatFrame');
        frame.className = '';
        void frame.offsetWidth;
        frame.className = 'pulse ' + kind;
        if (kind !== 'half' && phase !== 'listen') corgi.beat(kind === 'strong');
        if (kind !== 'half') thump(kind === 'strong');
        const c = phrase && countEl(k % phrase.notes.length);
        if (c && phase !== 'result' && phase !== 'hold' && phase !== 'ask') {
          $('grid').querySelectorAll('.count.on').forEach(el => el.classList.remove('on'));
          c.classList.add('on');
        }
      }
    }
  }
  requestAnimationFrame(beatLoop);
})();

// ---------- answering with the pad ----------

// Hands stay on the pad: 1 tap = the first answer, 2 taps = the second. After the first tap it waits
// a moment for a second one, then says on screen what it understood. Buttons are the fallback.
const ASK_DEAF = 800;       // ms after the question before taps count (the last stroke still rings)
const ASK_SECOND = 1000;    // ms to wait for a second tap
let ask = null;             // { since, taps, timer, answers: [first, second], then(k) }

function askPad(title, sub, answers, then, demoAnswer = 1) {
  clearTimers();
  stopBeat();
  phase = 'ask';
  ask = { since: performance.now(), taps: 0, timer: null, answers, then };
  $('rank').className = 'rank';
  setPlate('go', title, (sub ? `${sub}<br>` : '') +
    `<span class="taps">Вдар по паду: 1 раз — ${answers[0]}, 2 рази — ${answers[1]}</span>` +
    `<span class="row"><button class="cta" data-ans="1">${answers[0]}</button><button class="cta" data-ans="2">${answers[1]}</button></span>`);
  $('plate').querySelectorAll('[data-ans]').forEach(b => { b.onclick = () => answer(Number(b.dataset.ans)); });
  $('againBtn').disabled = true;
  $('replayBtn').disabled = true;
  $('nextBtn').hidden = true;
  if (DEMO) later(() => answer(demoAnswer), 6000);
}

function askHit() {
  if (performance.now() - ask.since < ASK_DEAF) return;
  ask.taps++;
  clearTimeout(ask.timer);
  const el = $('plate').querySelector('.taps');
  if (el) el.textContent = `Почув: ${'● '.repeat(ask.taps).trim()}`;
  if (ask.taps >= 2) answer(2);
  else ask.timer = setTimeout(() => answer(1), ASK_SECOND);
}

function answer(k) {
  if (!ask) return;
  clearTimeout(ask.timer);
  const { answers, then } = ask;
  ask = null;
  phase = 'idle';
  setPlate('done', `${k === 1 ? '●' : '● ●'}  ${answers[k - 1]}`);
  later(() => then(k), 700);
}

function dropAsk() {
  if (ask) clearTimeout(ask.timer);
  ask = null;
}

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

const freshNew = extra => ({
  accepted: 0, goal: plan().goal, startMs: Date.now(), minutes: plan().minutes, sinceInsert: 0, lessonCount: 0,
  stuck: 0, parked: 0, pick: null, skill: skillId, skillIdx: 0, calm: false, prereq: null, prereqClean: 0, ...extra,
});

function goStage(name, title, sub) {
  setStage(name);
  if (name === 'warmup') { warmIdx = 0; warmTakes = []; }
  if (name === 'review') { reviewQueue = reviewSteps(progress).slice(0, plan().review); reviewClean = 0; }
  if (name === 'new') {
    newState = freshNew();
    // a lesson the current one stands on has slipped: bring it back first
    const need = skillId ? -1 : slippedNeed(progress);
    if (need >= 0) {
      newState.prereq = need;
      title = `Спершу освіжимо «${STEPS[need].title}»`;
      sub = `На ній тримається «${STEPS[progress.current].title}». Кілька чистих фраз, і далі`;
    }
  }
  setPlate('done', title, sub);
  later(nextPhrase, STAGE_PAUSE);
}

// after the warm-up: review, or straight to the skill in a skill session
const afterWarmup = () => (skillId ? 'new' : 'review');

// concentration exercises instead of the rest of the session, on a day the hands aren't in form
function startCalm() {
  labelStages(true);
  setStage('new');
  newState = freshNew({ skill: null, calm: true, calmIdx: 0, calmClean: 0, goal: CALM.length * CALM_EACH, minutes: CALM_MINUTES });
  setPlate('done', 'Спокійні вправи', 'Повільно, тихо, слухаючи. Тут нікуди не треба поспішати');
  later(nextPhrase, STAGE_PAUSE);
}

// A known phrase for a breather: mostly a settling lesson at its own tempo (it counts towards
// mastery), else a passed lesson a tempo step below its best, or single strokes when nothing is
// passed yet. easy: only the relaxed kind, for the final phrase.
function knownPick(easy = false) {
  const settle = easy ? [] : settlingSteps(progress);
  if (settle.length && Math.random() < 0.7) return { kind: 'insert', step: settle[Math.floor(Math.random() * settle.length)], settle: true };
  const passed = STEPS.map((s, i) => i).filter(i => progress.steps[STEPS[i].id].passed && i !== progress.current);
  if (!passed.length) return { kind: 'insert', warm: 4 };
  return { kind: 'insert', step: passed[Math.floor(Math.random() * passed.length)], slower: 1 };
}

// what "new" plays next: a slipped lesson underneath first; the lesson (every 3rd led by the other
// hand), a known phrase after every few accepted lesson phrases, or known phrases while a stuck lesson
// is parked. A skill session rotates its skill's exercises; a calm one goes through CALM.
function pickNew() {
  const ns = newState;
  if (ns.calm) return { kind: 'calm', calm: ns.calmIdx };
  if (ns.skill) {
    const list = skillPractice(ns.skill);
    return { kind: 'skill', ...list[ns.skillIdx % list.length] };
  }
  if (ns.prereq !== null) return { kind: 'lesson', step: ns.prereq, prereq: true };
  if (ns.parked > 0) return knownPick();
  if (ns.sinceInsert >= INSERT_EVERY) { ns.sinceInsert = 0; return knownPick(); }
  const step = STEPS[progress.current];
  const mirror = canMirror(step) && ns.lessonCount % MIRROR_EVERY === MIRROR_EVERY - 1;
  return { kind: 'lesson', step: progress.current, mirror };
}

function phraseOfPick(p) {
  if (p.calm !== undefined) {
    const c = CALM[p.calm];
    return { title: c.title, notes: notesOf(c.sticking, []), bpm: c.bpm, div: c.div };
  }
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
      const sub = bal ? `Ліва рука ≈ ${bal}% від правої за силою удару` : '';
      // a teacher notices a bad day from the warm-up: offer calm exercises instead, the player decides
      if (!offFormAsked) {
        offFormAsked = true;
        offForm = warmupOffForm(profile, warmScores) || DEMO_OFF;
        saveProfile(profile);
        if (offForm) {
          askPad('Схоже, сьогодні руки не в формі', 'Це буває. 5 хвилин спокійних вправ на концентрацію, і на цьому все?',
            ['так, спокійно', 'ні, граємо далі'], k => (k === 1 ? startCalm() : goStage(afterWarmup(), 'Добре, граємо далі', '')), DEMO_OFF ? 1 : 2);
          return;
        }
      }
      goStage(afterWarmup(), 'Розминку зроблено 👍', sub);
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
    const over = ns.accepted >= ns.goal || Date.now() - ns.startMs > ns.minutes * 60000;
    if (ns.calm && !ns.pick && (over || ns.calmIdx >= CALM.length)) { showSummary(); return; }
    if (!ns.pick && over) {
      setStage('finish');
      ns.pick = knownPick(true);
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
  setPlate('listen', 'Слухай…', 'Дарсі грає фразу');
  $('againBtn').disabled = true;
  $('replayBtn').disabled = true;
  $('nextBtn').hidden = true;
  const div = divOf(phrase), gap = noteGap(phrase.bpm, div);
  const t0 = E.ctx.currentTime + LISTEN_LEAD;
  startBeat(t0, gap, phrase.notes.length, div);
  phrase.notes.forEach((nt, i) => {
    const t = t0 + i * gap;
    E.playNote(kit, nt.accent, t);
    if (i % div === 0) E.click(t, prefs.metro / 100, i === 0);
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
  if (phase === 'ask') { askHit(); return; }
  // after a miss: a deliberate tap on the pad means "ready, go on"
  if (phase === 'hold') {
    if (performance.now() - holdSince > HOLD_DEAF) goOn();
    return;
  }
  const n = phrase?.notes.length, div = phrase && divOf(phrase), gap = phrase && noteGap(phrase.bpm, div);
  if (phase === 'wait') {
    phase = 'play';
    hits = [h];
    $('againBtn').disabled = true;
    // the pulse and the soft click now follow the player's own first hit. A hit is stamped in+out
    // latency after the stroke on the timeline sounds are scheduled on, so that is taken off.
    const start = h.time - E.latencySec();
    startBeat(start, gap, n, div);
    for (let i = div; i < n; i += div) {
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

// instant feedback on the note this hit belongs to: perfect / good / off. Judged on the player's own
// pulse, like the final grade: each gap against the typical gap so far (the target's while there's
// only one), so steady playing a bit off the metronome still pops bright.
function popHit(h) {
  const i = hits.length - 1;
  if (i >= phrase.notes.length) return;
  let dev = 0;
  if (i > 0) {
    const target = noteGap(phrase.bpm, divOf(phrase)), free = STRICTNESS[prefs.strict].tempoFree;
    const gaps = hits.slice(1, -1).map((x, k) => x.time - hits[k].time).sort((a, b) => a - b);
    const typical = gaps.length ? gaps[gaps.length >> 1] : target;
    const ref = Math.min(target * (1 + free), Math.max(target * (1 - free), typical));
    dev = Math.abs(h.time - hits[i - 1].time - ref) / ref;
  }
  const q = dev <= PERFECT ? 'pop-perfect' : dev <= STRICTNESS[prefs.strict].window / 2 ? 'pop-good' : 'pop-off';
  noteEl(i)?.classList.add('heard');
  flash(i, q, 450);
  word(i, q);
}

// comic onomatopoeia over the note: "ТУК!" on the beat, "БАХ!" for an accent, a small "тук" when off
function word(i, q) {
  const slot = noteEl(i)?.parentElement;
  if (!slot) return;
  const accent = phrase.notes[i].accent;
  const w = document.createElement('span');
  w.className = 'word ' + q.replace('pop-', '') + (accent ? ' acc' : '');
  w.textContent = q === 'pop-off' ? 'тук' : accent ? 'БАХ!' : q === 'pop-perfect' ? 'ТУК!' : 'тук!';
  w.style.setProperty('--tilt', `${Math.round(Math.random() * 24 - 12)}deg`);
  slot.append(w);
  setTimeout(() => w.remove(), 700);
}

// the take's rank as a big comic letter, plus what it is made of
const RANK_SAYS = { S: 'Стильно!', A: 'Круто!', B: 'Добре', C: 'Ти близько', D: 'Ще раз' };
function showRank(rk) {
  const el = $('rank');
  el.textContent = rk.rank;
  el.className = 'rank';
  void el.offsetWidth;
  el.className = 'rank show r-' + rk.rank;
  stats.ranks[rk.rank] = (stats.ranks[rk.rank] || 0) + 1;
}

function scoreBars(rk) {
  const bar = (label, v) => (v === null ? '' :
    `<span class="bar"><em>${label}</em><i><u style="width:${Math.round(v * 100)}%"></u></i></span>`);
  return `<span class="bars">${bar('Таймінг', rk.timing)}${bar('Акценти', rk.accents)}${bar('Руки', rk.hands)}</span>`;
}

// the lesson this take belongs to, when it was played as the lesson itself (not slower, not a
// fragment of it): -> step index or -1
function takeStep() {
  if (help.mode === 'part') return -1;
  if (stage === 'review') return reviewQueue[0] ?? -1;
  const pick = stage === 'new' ? newState.pick : null;
  return pick?.step !== undefined && !pick.slower ? pick.step : -1;
}

// every take teaches the trainer about you: the profile, the lesson's session takes, the scores
// the state is read from
function recordTake(r, rk) {
  if (!hits.length) return null;
  const m = takeMetrics(phrase, r);
  const si = takeStep();
  const step = si >= 0 ? STEPS[si] : null;
  addTake(profile, m, rk.score, { weight: offForm ? 0.3 : 1, stepId: step?.id, bpm: step && phrase.bpm });
  saveProfile(profile);
  sessionMetrics.push(m);
  if (stage === 'warmup') warmScores.push(rk.score);
  if (step && help.mode === 'normal') {
    (sessionTakes[step.id] ??= []).push({ t: progress.steps[step.id].t, score: rk.score, timing: rk.timing, accents: rk.accents, hands: rk.hands });
  }
  if (stage === 'new' && help.mode === 'normal' && !newState.calm) mainScores.push(rk.score);
  return m;
}

// The current lesson came out well at its target tempo across this session's takes: it settles,
// the next lesson opens. -> a plate message, or null
function checkReady(pick) {
  if (stage !== 'new' || pick?.kind !== 'lesson' || pick.prereq || pick.step !== progress.current || help.mode !== 'normal') return null;
  const step = STEPS[progress.current], st = progress.steps[step.id];
  if (st.passed || !sessionQuality(step, sessionTakes[step.id] || [])?.good) return null;
  const from = progress.current;
  const opened = openNext(progress, from);
  saveProgress(progress);
  newState.pick = null;
  return {
    title: `«${step.title}» тримається 👍`,
    sub: 'Перевіримо ще в інший день, як уляглося.' + (opened ? ` А тепер знайомимося: ${lessonNo(progress.current)} «${STEPS[progress.current].title}»` : ''),
  };
}

function finish() {
  phase = 'result';
  stopBeat();
  $('grid').querySelectorAll('.count.on').forEach(el => el.classList.remove('on'));
  // warm-up, the final phrase and calm exercises are judged softly: "more or less" is enough there
  const soft = stage === 'warmup' || stage === 'finish' || newState?.calm;
  const r = grade(phrase, hits, soft ? 'soft' : prefs.strict);
  showResult(r);
  const rk = rankOf(phrase, r);
  const pick = stage === 'new' ? newState.pick : null;
  const m = recordTake(r, rk);
  const { msg, accepted, summary } = stepHelp(r);
  corgi.mood(rk.rank === 'S' || rk.rank === 'A' ? 'happy' : accepted || summary ? '' : 'cheer');
  showStreak();
  if (summary) return;
  showRank(rk);
  const title = $('plate').querySelector('b');
  title.textContent = `${rk.rank} · ${title.textContent === 'Чисто! ✓' ? RANK_SAYS[rk.rank] : title.textContent}`;
  $('plate').insertAdjacentHTML('beforeend', scoreBars(rk));
  // a skill session talks about that skill
  if (newState?.skill && stage === 'new' && m) {
    const line = skillFocus(newState.skill, phrase, r, m);
    if (line) $('plate').insertAdjacentHTML('beforeend', `<span class="focus">${line}</span>`);
  }

  lastTake = hits.length ? { hits, key: phraseKey() } : null;
  $('replayBtn').disabled = !lastTake;
  const ready = r.clean ? checkReady(pick) : null;
  if (ready) setPlate('done', ready.title, ready.sub);
  // quality sliding after a good start: offer to stop on a good note, once
  if (stage === 'new' && !tiredAsked && tiring(mainScores)) {
    tiredAsked = true;
    later(() => askPad('Схоже, руки втомились', 'Втомлена гра тренує помилки. Закінчимо на легкій фразі?',
      ['так, легку і все', 'ні, ще пограю'], k => (k === 1 ? finishEasy() : nextPhrase()), 2), NEXT_PAUSE);
    return;
  }
  if (accepted) {
    later(nextPhrase, NEXT_PAUSE + (msg ? 1200 : 0) + (ready ? 2600 : 0));
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

// stop on a good note: the easy final phrase now
function finishEasy() {
  setStage('finish');
  newState.pick = knownPick(true);
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
    const ns = newState;
    ns.accepted++;
    let note = msg || '';
    if (pick.kind === 'lesson' && !pick.prereq) { ns.lessonCount++; ns.sinceInsert++; }
    if (pick.kind === 'insert' && ns.parked > 0) ns.parked--;
    if (pick.kind === 'skill') ns.skillIdx++;
    if (pick.kind === 'calm' && ++ns.calmClean >= CALM_EACH) { ns.calmIdx++; ns.calmClean = 0; }
    if (pick.prereq && ++ns.prereqClean >= 3) {
      ns.prereq = null;
      note = `Освіжили 👍 Тепер «${STEPS[progress.current].title}»`;
    }
    ns.pick = null;
    setPlate('done', r.hint, note);
  } else if (stage === 'finish') {
    showSummary();
    return { msg: null, accepted: false, summary: true };
  }
  return { msg, accepted: true };
}

// ---------- finish ----------

const EVENT_SAYS = {
  settling: t => `«${t}» тримається. Перевіримо ще в інший день, як уляглося`,
  mastered: t => `«${t}» засвоєно 🎉`,
  slipped: t => `«${t}» трохи просіли. Наступного разу освіжимо, це нормально`,
  recovered: t => `«${t}» знову в формі`,
};
const li = items => `<ul>${items.map(x => `<li>${x}</li>`).join('')}</ul>`;

// End of the session, once: mastery moves on the whole session's evidence, the profile remembers it,
// and a teacher's summary is put together. -> the summary html
function closeOut() {
  if (sessionClosed) return summaryHtml;
  sessionClosed = true;
  const mins = Math.max(1, Math.round((Date.now() - stats.startMs) / 60000));
  // an off day only when it stayed off: a good main part after a weak warm-up was just a slow start
  const typical = metric(profile, 'score', 10);
  const mainAvg = mainScores.length ? mainScores.reduce((s, v) => s + v, 0) / mainScores.length : null;
  if (offForm && mainAvg !== null && typical !== null && mainAvg >= typical) offForm = false;
  const events = closeSession(progress, sessionTakes, { offForm });
  const report = sessionReport(profile, sessionMetrics);
  endSession(profile, { day: dayKey(), score: mainAvg, offForm });
  saveProfile(profile);

  const step = STEPS[progress.current], st = progress.steps[step.id];
  const moved = progress.current !== stats.startStep || st.t !== stats.startTempo;
  const ranks = 'SABCD'.split('').filter(k => stats.ranks[k]).map(k => `${k}×${stats.ranks[k]}`).join(' ');
  const out = [];
  out.push(`<p>${stats.accepted} фраз зараховано за ${mins} хв` + (ranks ? ` · ранги ${ranks}` : '') +
    (stats.best >= 2 ? `<br>Найдовша серія: ${stats.best} фраз поспіль вийшли добре` : '') + '</p>');
  if (skillId) {
    const after = skillValue(skillId, { progress, profile, now: Date.now() });
    out.push(`<p><b>Скіл «${SKILLS[skillId].title}»</b>: ${levelWord(skillBefore)}${levelWord(after) !== levelWord(skillBefore) ? ` → ${levelWord(after)}` : ''}. ${skillNote(skillId, { progress, profile, now: Date.now() }).text}</p>`);
  } else if (!newState?.calm) {
    out.push(`<p>${lessonNo(progress.current)}: ${step.title}, зараз ${tempoOf(step, st)} BPM${moved ? ' — рух уперед' : ''}</p>`);
  }
  const said = events.map(e => EVENT_SAYS[e.type](STEPS.find(s => s.id === e.id).title));
  if (said.length) out.push(li(said));
  for (const e of events.filter(x => x.type === 'mastered')) {
    out.push(`<div class="lesson-report"><b>Звіт: «${STEPS.find(s => s.id === e.id).title}»</b>${li(lessonReport(e.id, progress.steps[e.id]))}</div>`);
  }
  if (report.good.length) out.push(`<p class="good"><b>Добре:</b> ${report.good.join('; ')}</p>`);
  if (report.work.length) out.push(`<p class="work"><b>Наступного разу:</b> ${report.work.join('; ')}</p>`);
  if (offForm) out.push('<p class="muted">Сьогодні руки були не в формі, це буває. На прогрес цей день майже не вплинув.</p>');

  // what the home screen says next time
  const work = report.work[0];
  progress.lastNote = (newState?.calm ? 'спокійні вправи на концентрацію' : `${step.title}, ${tempoOf(step, st)} BPM${moved ? ', рух уперед' : ''}`) +
    (work ? `. Звернемо увагу: ${work.charAt(0).toLowerCase() + work.slice(1)}.` : '. Сьогодні продовжимо.');
  saveProgress(progress);
  summaryHtml = out.join('');
  return summaryHtml;
}

function showSummary() {
  clearTimers();
  setStage('done');
  phase = 'idle';
  stopBeat();
  const html = closeOut();
  const mins = Math.max(1, Math.round((Date.now() - stats.startMs) / 60000));
  $('phraseTitle').textContent = 'Заняття завершено';
  $('bpmPlate').textContent = `${mins} хв`;
  $('phraseSub').textContent = 'Добра робота. Відпочинь: руки запам\'ятовують і між заняттями.';
  corgi.mood('happy');
  $('grid').innerHTML = '';
  $('gridLabel').textContent = '';
  $('summary').innerHTML = html;
  // hands stay on the pad: 1 tap finishes, 2 taps give five more minutes
  askPad('Ще 5 хвилин?', 'Дарсі пишається тобою', ['завершуємо', 'ще 5 хвилин'], k => (k === 1 ? leaveSession() : moreMinutes()), 1);
}

// five more minutes of the same kind of session; they count as a new stretch
function moreMinutes() {
  $('summary').innerHTML = '';
  sessionClosed = false;
  sessionTakes = {};
  sessionMetrics = [];
  mainScores = [];
  const calm = newState?.calm;
  setStage('new');
  newState = calm ? freshNew({ skill: null, calm: true, calmIdx: 0, calmClean: 0, goal: CALM.length * CALM_EACH, minutes: 5 })
    : freshNew({ goal: Math.ceil(plan().goal / 2) + 2, minutes: 5 });
  nextPhrase();
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
  const gap = noteGap(phrase.bpm, divOf(phrase));
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
    stats = { accepted: 0, best: 0, ranks: {}, startMs: Date.now(), startStep: progress.current, startTempo: progress.steps[STEPS[progress.current].id].t };
    sessionTakes = {};
    sessionMetrics = [];
    warmScores = [];
    mainScores = [];
    offForm = offFormAsked = tiredAsked = sessionClosed = false;
    summaryHtml = '';
    newState = null;
    skillBefore = skillId ? skillValue(skillId, { progress, profile, now: Date.now() }) : 0;
    $('summary').innerHTML = '';
    labelStages();
    later(startCheck, kit ? 300 : 2500);
  } else if (stage === 'check') {
    later(startCheck, 300);
  } else if (stage === 'done') {
    later(showSummary, 300);
  } else {
    later(nextPhrase, 300);   // resume: the same phrase again from "listen"
  }
}

function pause() {
  clearTimers();
  dropAsk();
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
  dropAsk();
  stopBeat();
  E.stopMic();
  // leaving mid-session still counts what was played
  if (sessionStarted && !sessionClosed && sessionMetrics.length) closeOut();
  running = false;
  sessionStarted = false;
  sessionLen = null;
  skillId = null;
  phase = 'idle';
  stage = null;
  $('summary').innerHTML = '';
  document.body.classList.remove('fever');
  renderHome();
  showScreen('home');
}

// len: null (the default length), 'mini' or 'skill' (with the skill to work on)
async function startSession(len, skill = null) {
  if (sessionStarted) return;
  sessionLen = len;
  skillId = skill;
  await resume();
  if (!sessionStarted) { sessionLen = null; skillId = null; }   // the mic didn't start
}

$('goBtn').onclick = async () => {
  $('goBtn').disabled = true;
  await startSession(null);
  $('goBtn').disabled = false;
};
$('miniBtn').onclick = () => startSession('mini');
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
  const ns = newState, pick = ns.pick;
  if (pick?.kind !== 'lesson' || pick.prereq) {
    if (pick?.kind === 'skill') ns.skillIdx++;
    if (pick?.kind === 'calm') { ns.calmIdx++; ns.calmClean = 0; }
    if (pick?.prereq) ns.prereq = null;
    ns.pick = null;
    nextPhrase();
    return;
  }
  // skipping the current lesson: "I know this one" — it still has to hold in a later session
  const st = progress.steps[STEPS[progress.current].id];
  if (!st.good.length) st.good = [{ day: 'skip', score: 0.8 }];
  openNext(progress, progress.current);
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
for (const k of ['short', 'full']) lengthSel.add(new Option(LENGTHS[k].label, k));
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
  if (name === 'path') { renderMap(); focusCloud(); }
}
document.querySelectorAll('.tabs button').forEach(b => { b.onclick = () => showScreen(b.dataset.go); });

function renderHome() {
  const step = STEPS[progress.current], st = progress.steps[step.id];
  $('homeLesson').textContent = `${lessonNo(progress.current)} · ${step.title}`;
  const need = slippedNeed(progress);
  $('homeMeta').textContent = need >= 0 ? `${tempoOf(step, st)} BPM · спершу освіжимо «${STEPS[need].title}»`
    : `${tempoOf(step, st)} BPM · розминка, повторення, нове і фініш`;
  $('homeLength').textContent = prefs.length === 'full' ? '20 хв' : '10 хв';
  // a teacher's note about last time instead of a days-in-a-row counter: no habit pressure;
  // real progress gets mentioned when there is some
  const praise = progressNote(profile);
  $('homeNote').textContent = [progress.lastNote ? `Минулого разу: ${progress.lastNote}` : '', praise].filter(Boolean).join(' ');
}

const corgi = createCorgi($('corgiPlay'));
createCorgi($('corgiHome'));
lengthSel.addEventListener('change', renderHome);
renderHome();
