// What to play and how an attempt is judged. Pure logic: no audio, no DOM.

export const TEMPOS = [60, 66, 72, 80, 88, 96];   // BPM
const TEMPOS_16 = [60, 66, 72, 80, 88, 96, 100];

// The ladder. sticking: the full phrase; accents: note indexes; div: notes per beat (2 eighths,
// 3 triplets, 4 sixteenths); short: the half-length version comes first; unlock: the lesson's target
// tempo index (good quality there: the lesson settles and the next one opens); max: highest tempo
// index here; needs: lessons this one stands on; level: 0 beginner, 1 amateur; accentAny: the accent
// moves to a different note every phrase.
export const STEPS = [
  { id: 'right', title: 'Права рука', sticking: 'RRRRRRRR', accents: [], short: true, unlock: 1, max: 2, needs: [] },
  { id: 'left', title: 'Ліва рука', sticking: 'LLLLLLLL', accents: [], short: true, unlock: 1, max: 2, needs: [] },
  { id: 'change', title: 'Зміна руки', sticking: 'RRRRLLLL', accents: [], short: false, unlock: 1, max: 3, needs: ['right', 'left'] },
  { id: 'singles', title: 'Одиночні', sticking: 'RLRLRLRL', accents: [], short: true, unlock: 2, max: 5, needs: ['right', 'left'] },
  { id: 'accent-tap', title: 'Акцент і тихі', sticking: 'RRRRLLLL', accents: [0, 4], short: false, unlock: 1, max: 2, needs: ['change'] },
  { id: 'singles-acc', title: 'Одиночні з акцентом', sticking: 'RLRLRLRL', accents: [0, 4], short: false, unlock: 2, max: 3, needs: ['singles', 'accent-tap'] },
  { id: 'doubles', title: 'Подвійні', sticking: 'RRLLRRLL', accents: [], short: true, unlock: 2, max: 5, needs: ['singles'] },
  { id: 'paradiddle', title: 'Парадідл', sticking: 'RLRRLRLL', accents: [], short: true, unlock: 2, max: 5, needs: ['singles', 'doubles'] },
  { id: 'paradiddle-acc', title: 'Парадідл з акцентом', sticking: 'RLRRLRLL', accents: [0, 4], short: false, unlock: 2, max: 4, needs: ['paradiddle', 'accent-tap'] },
  { id: 'inv-inward', title: 'Інверсія П П Л П', sticking: 'RRLRLLRL', accents: [0, 4], short: false, unlock: 2, max: 4, needs: ['paradiddle-acc'], level: 1 },
  { id: 'inv-outward', title: 'Інверсія П Л Л П', sticking: 'RLLRLRRL', accents: [0, 4], short: false, unlock: 2, max: 4, needs: ['paradiddle-acc'], level: 1 },
  { id: 'inv-third', title: 'Інверсія П Л П Л', sticking: 'RLRLLRLR', accents: [0, 4], short: false, unlock: 2, max: 4, needs: ['paradiddle-acc'], level: 1 },
  { id: 'double-para', title: 'Подвійний парадідл', sticking: 'RLRLRRLRLRLL', accents: [0, 6], div: 3, short: true, unlock: 2, max: 4, needs: ['paradiddle-acc'], level: 1 },
  { id: 'para-diddle', title: 'Парадідл-дідл', sticking: 'RLRRLLRLRRLL', accents: [0, 6], div: 3, short: true, unlock: 2, max: 4, needs: ['paradiddle', 'doubles'], level: 1 },
  { id: 'para-16', title: 'Парадідл шістнадцятими', sticking: 'RLRRLRLLRLRRLRLL', accents: [0, 4, 8, 12], div: 4, tempos: TEMPOS_16, short: true, unlock: 3, max: 6, needs: ['paradiddle-acc'], level: 1 },
  { id: 'accent-any', title: 'Акцент будь-де', sticking: 'RLRLRLRL', accents: [0, 4], accentAny: true, short: false, unlock: 2, max: 4, needs: ['singles-acc'], level: 1 },
];

// the stages of the way; lessons of the last one aren't written yet
export const LEVELS = [
  { title: 'Новачок', note: 'вісімки 60→96, рівні руки, чіткі акценти' },
  { title: 'Аматор', note: 'інверсії, тріолі, шістнадцяті до 100, акцент будь-де' },
  { title: 'Впевнений', note: 'будь-який темп і гучність без напруги', locked: true },
];
export const levelOf = step => step.level || 0;
export const temposOf = step => step.tempos || TEMPOS;
export const tempoOf = (step, st) => temposOf(step)[st.t];
export const stepIndex = id => STEPS.findIndex(s => s.id === id);

// warm-up is judged softly: "more or less" is enough there
export const WARMUP = [
  { title: 'Права рука', sticking: 'RRRRRRRR', accents: [], bpm: 60 },
  { title: 'Ліва рука', sticking: 'LLLLLLLL', accents: [], bpm: 60 },
  { title: 'Права рука', sticking: 'RRRRRRRR', accents: [], bpm: 60 },
  { title: 'Ліва рука', sticking: 'LLLLLLLL', accents: [], bpm: 60 },
  { title: 'Одиночні', sticking: 'RLRLRLRL', accents: [], bpm: 60 },
  { title: 'Одиночні', sticking: 'RLRLRLRL', accents: [], bpm: 72 },
  { title: 'Одиночні', sticking: 'RLRLRLRL', accents: [], bpm: 60 },
];

// how lenient the judging is: timing window (share of the note gap), accent margin (dB) and how far
// the player's own steady tempo may be from the target and still be judged on its own grid
export const STRICTNESS = {
  soft: { label: 'М\'яко', window: 0.25, accentDb: 4, tempoFree: 0.2 },
  normal: { label: 'Нормально', window: 0.15, accentDb: 6, tempoFree: 0.08 },
  strict: { label: 'Строго', window: 0.1, accentDb: 8, tempoFree: 0 },
};

export const notesOf = (sticking, accents) =>
  [...sticking].map((hand, i) => ({ hand, accent: accents.includes(i) }));

// mirror: the same exercise led by the other hand (R↔L), so the left gets equal work
export function stepPhrase(step, st, { mirror = false, slower = 0 } = {}) {
  const len = st.len === 'short' ? step.sticking.length / 2 : step.sticking.length;
  let sticking = step.sticking.slice(0, len);
  if (mirror) sticking = [...sticking].map(h => (h === 'R' ? 'L' : 'R')).join('');
  let accents = step.accents;
  if (step.accentAny) {
    const k = Math.floor(Math.random() * 4);
    accents = [k, k + 4];
  }
  return {
    title: step.title + (mirror ? ' з лівої' : ''),
    notes: notesOf(sticking, accents.filter(i => i < len)),
    bpm: temposOf(step)[Math.max(0, st.t - slower)],
    div: step.div || 2,
  };
}

export const canMirror = step => step.sticking.includes('R') && step.sticking.includes('L');

// seconds between notes; div notes per beat (2 = eighths)
export const noteGap = (bpm, div = 2) => 60 / bpm / div;

const ON_TARGET = 0.08;   // a clean take this close to the target tempo counts towards progress

const median = a => [...a].sort((x, y) => x - y)[a.length >> 1];
const mean = a => a.reduce((s, v) => s + v, 0) / a.length;

// match each expected note to the nearest unused hit inside the window around t0 + i * gap
function match(n, gap, hits, t0, window) {
  const used = new Set();
  const out = [];
  for (let i = 0; i < n; i++) {
    const target = t0 + i * gap;
    let best = -1;
    hits.forEach((h, k) => {
      if (used.has(k) || Math.abs(h.time - target) > window * gap) return;
      if (best < 0 || Math.abs(h.time - target) < Math.abs(hits[best].time - target)) best = k;
    });
    if (best >= 0) used.add(best);
    out.push(best);
  }
  return out;
}

function slopeOf(pts) {
  const mi = mean(pts.map(p => p[0])), mt = mean(pts.map(p => p[1]));
  return pts.reduce((s, [i, t]) => s + (i - mi) * (t - mt), 0) / pts.reduce((s, [i]) => s + (i - mi) ** 2, 0);
}

// grid starting at the first hit, then re-centred on all matched hits
function fitGrid(n, gap, hits, window) {
  let t0 = hits[0].time;
  let idx = match(n, gap, hits, t0, window);
  for (let k = 0; k < 2; k++) {
    const res = idx.flatMap((h, i) => (h < 0 ? [] : [hits[h].time - (t0 + i * gap)]));
    if (!res.length) break;
    t0 += mean(res);
    idx = match(n, gap, hits, t0, window);
  }
  return { t0, idx };
}

// Judge one echo. The grid starts at the player's first hit, so mic/output latency never counts as
// being late. Its tempo is the player's own steady tempo when that is within the strictness'
// tempoFree of the target: playing evenly but a bit slower or faster than the metronome is fine at
// first; speeding up or slowing down inside the phrase still shows as uneven notes.
// -> { clean, notes: [{ status, dev, db }], extra, hint, tempoRatio, playedBpm }
//    status: ok | early | late | miss | weak (accent not louder than the taps)
//    tempoRatio: played note gap / target note gap (< 1 = faster than the target)
export function grade(phrase, hits, strictness) {
  const { window, accentDb, tempoFree } = STRICTNESS[strictness] || STRICTNESS.soft;
  const n = phrase.notes.length;
  const gap = noteGap(phrase.bpm, phrase.div);
  if (!hits.length) {
    return { clean: false, notes: phrase.notes.map(() => ({ status: 'miss' })), extra: 0, hint: 'Не почув ударів 🙂', tempoRatio: 1, playedBpm: null, creep: 1 };
  }

  // the player's tempo: with the right number of hits, hit i is note i even when the late ones
  // drifted out of their windows; otherwise use the hits matched on the target grid
  let pts = hits.length === n ? hits.map((h, i) => [i, h.time]) : null;
  if (!pts) {
    const { idx } = fitGrid(n, gap, hits, window);
    pts = idx.flatMap((h, i) => (h < 0 ? [] : [[i, hits[h].time]]));
  }
  const tempoRatio = pts.length >= 4 ? slopeOf(pts) / gap : 1;
  const gridGap = gap * Math.min(1 + tempoFree, Math.max(1 - tempoFree, tempoRatio));
  // tempo creeping inside the phrase: second half against the first
  const creep = hits.length === n && n >= 8 ? slopeOf(pts.slice(n >> 1)) / slopeOf(pts.slice(0, n >> 1)) : 1;

  const { t0, idx } = fitGrid(n, gridGap, hits, window);
  const notes = idx.map((h, i) => {
    if (h < 0) return { status: 'miss' };
    const dev = (hits[h].time - (t0 + i * gridGap)) / gridGap;
    const status = Math.abs(dev) <= window / 2 ? 'ok' : dev < 0 ? 'early' : 'late';
    return { status, dev, db: hits[h].db };
  });
  const extra = hits.length - idx.filter(h => h >= 0).length;

  // accents: compared with the taps of the same attempt, never with absolute dB
  const tapDbs = notes.filter((r, i) => r.db !== undefined && !phrase.notes[i].accent).map(r => r.db);
  let weak = 0;
  if (tapDbs.length) {
    const tapMed = median(tapDbs);
    notes.forEach((r, i) => {
      if (phrase.notes[i].accent && r.db !== undefined && r.db < tapMed + accentDb) { r.status = 'weak'; weak++; }
    });
  }

  const playedBpm = Math.round(phrase.bpm / tempoRatio);
  const offTarget = Math.abs(tempoRatio - 1) > 0.05;
  const missed = notes.filter(r => r.status === 'miss').length;
  const offGrid = notes.filter(r => r.status === 'early' || r.status === 'late').length;
  const clean = !missed && !extra && !weak;
  let hint;
  if (clean) {
    const yours = `твій темп ≈ ${playedBpm}, ціль ${phrase.bpm}`;
    if (creep < 0.9 || creep > 1.1) hint = 'Зараховано! Але темп трохи пливе всередині фрази, тримай рівно';
    else if (offGrid) hint = offTarget ? `Зараховано! Т${yours.slice(1)}` : 'Зараховано! Ще трохи рівніше, і буде ідеально';
    else if (!offTarget) hint = 'Чисто! ✓';
    else hint = `Рівно! ✓ Т${yours.slice(1)}, ${tempoRatio > 1 ? 'поступово підтягуй' : 'можна спокійніше'}`;
  } else if (creep < 0.9) hint = 'Розганяєшся всередині фрази, тримай рівно 🙂';
  else if (creep > 1.1) hint = 'Сповільнюєшся до кінця фрази, тримай рівно';
  else if (tempoRatio < 1 - tempoFree - 0.04) hint = 'Трохи поспішаєш, не жени 🙂';
  else if (tempoRatio > 1 + tempoFree + 0.04) hint = 'Трохи тягнеш, можна живіше';
  else if (missed || extra) hint = hits.length === n ? 'Удари трохи розбіглися, послухай ще раз' : 'Кількість ударів не та, послухай ще раз';
  else hint = 'Акценти можна гучніше, а тихі тихіше';
  // only takes near the target tempo move the course on (longer phrase, faster tempo)
  const onTarget = clean && Math.abs(tempoRatio - 1) <= ON_TARGET;
  return { clean, onTarget, notes, extra, hint, tempoRatio, playedBpm, creep: hits.length === n && n >= 8 ? creep : null };
}

// Style rank for one take, D..S, from three 0..1 scores (null = doesn't apply to this phrase):
// timing (how close each note sat to its place; a missing note scores 0), accents (how far the
// accents rose above the taps, full marks at +12 dB, a clear high/low stick height) and hands (left
// and right taps equally loud). The same scale at any strictness, so S always means the same; a
// take that isn't clean never ranks above C: "again, you're close".
const RANKS = [['S', 0.92], ['A', 0.8], ['B', 0.65], ['C', 0.45], ['D', -1]];
const WEIGHTS = { timing: 0.6, accents: 0.25, hands: 0.15 };
const RANK_TIMING = 0.2;   // a note this far off its place (share of the gap) scores 0
const RANK_ACCENT_DB = 12;

export function rankOf(phrase, r) {
  const clamp = v => Math.min(1, Math.max(0, v));
  const timing = mean(r.notes.map(n => (n.dev === undefined ? 0 : clamp(1 - Math.abs(n.dev) / RANK_TIMING))));

  let accents = null;
  const accDbs = r.notes.filter((n, i) => phrase.notes[i].accent && n.db !== undefined).map(n => n.db);
  const tapDbs = r.notes.filter((n, i) => !phrase.notes[i].accent && n.db !== undefined).map(n => n.db);
  if (phrase.notes.some(n => n.accent)) {
    accents = accDbs.length && tapDbs.length ? clamp((median(accDbs) - median(tapDbs)) / RANK_ACCENT_DB) : 0;
  }

  let hands = null;
  const amp = db => 10 ** (db / 20);
  const by = { R: [], L: [] };
  r.notes.forEach((n, i) => { if (n.db !== undefined && !phrase.notes[i].accent) by[phrase.notes[i].hand].push(amp(n.db)); });
  if (by.R.length && by.L.length) {
    const ratio = mean(by.L) / mean(by.R);
    hands = clamp(1 - (1 - Math.min(ratio, 1 / ratio)) * 1.25);
  }

  const parts = { timing, accents, hands };
  let sum = 0, wsum = 0;
  for (const [k, w] of Object.entries(WEIGHTS)) if (parts[k] !== null) { sum += parts[k] * w; wsum += w; }
  const score = sum / wsum;
  let rank = RANKS.find(([, min]) => score >= min)[0];
  if (!r.clean && 'SAB'.includes(rank)) rank = 'C';
  return { rank, score, ...parts };
}

// left vs right loudness across warm-up phrases, as "left = N % of right"; null if one hand is missing
export function handBalance(takes) {
  const amp = db => 10 ** (db / 20);
  const by = { R: [], L: [] };
  for (const { phrase, result } of takes) {
    result.notes.forEach((r, i) => { if (r.db !== undefined && !phrase.notes[i].accent) by[phrase.notes[i].hand].push(amp(r.db)); });
  }
  if (by.R.length < 3 || by.L.length < 3) return null;
  return Math.round(mean(by.L) / mean(by.R) * 100);
}

// ---------- progress ----------

// A lesson is a skill learned over sessions, not passed in one: it is learning while it's the focus;
// settling once a session at its target tempo went well (the next lesson opens, this one keeps coming
// back); mastered when it went well again on another day (it settles overnight); slipping when its
// form faded from not playing it or its ranks dropped. Never "failed", nothing is ever taken away.

const PROGRESS_KEY = 'pt.progress';
const DAY_MS = 86400000;
const FORM_HALF_LIFE = 21;   // days without playing until a mastered lesson's form halves
const GOOD = { score: 0.8, takes: 3, hands: 0.7, accents: 0.5 };   // a session that counts towards mastery
const SLIP_SCORE = 0.65;     // a mastered lesson played below this (rank B) in a session has slipped

const clamp = v => Math.min(1, Math.max(0, v));
export const dayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const freshStep = step => ({
  t: 0, len: step.short ? 'short' : 'long', hist: [], passed: false, seen: 0,
  good: [], log: [], mastered: false, slipped: false, form: 0, formAt: 0,
});

export function loadProgress() {
  let p = null;
  try { p = JSON.parse(localStorage.getItem(PROGRESS_KEY)); } catch {}
  p ??= { current: 0, session: 0, steps: {} };
  p.days ??= [];
  for (const s of STEPS) {
    const st = (p.steps[s.id] ??= freshStep(s));
    // older saves: "passed" meant only "the next lesson is open"; it still has to hold on another day
    st.good ??= st.passed ? [{ day: 'before', score: GOOD.score }] : [];
    st.log ??= [];
    st.mastered ??= false;
    st.slipped ??= false;
    st.form ??= 0;
    st.formAt ??= 0;
  }
  return p;
}

export const saveProgress = p => { try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(p)); } catch {} };

// Record one attempt of a lesson: the phrase grows to full length, the tempo climbs. Patient: a miss
// just means "again", nothing ever goes down. -> a short message when something changed, else null
export function recordAttempt(p, stepIndex, clean) {
  const step = STEPS[stepIndex];
  const st = p.steps[step.id];
  st.seen = p.session;
  st.hist = [...st.hist, clean].slice(-5);
  const cleanCount = st.hist.filter(Boolean).length;

  if (st.len === 'short') {
    if (cleanCount < 2) return null;
    st.len = 'long';
    st.hist = [];
    return 'Тепер фраза повна';
  }
  if (cleanCount < 3 || st.t >= step.max) return null;
  st.t++;
  st.hist = [];
  return `Темп ↑ ${temposOf(step)[st.t]}`;
}

// how a lesson went in this session, from its in-tempo takes [{ t, score, timing, accents, hands }]:
// the latest takes at its target tempo or above; null until there are enough of them
export function sessionQuality(step, takes) {
  const at = takes.filter(k => k.t >= step.unlock).slice(-6);
  if (at.length < GOOD.takes) return null;
  const q = { takes: at.length };
  for (const key of ['score', 'timing', 'accents', 'hands']) {
    const v = at.map(k => k[key]).filter(x => x !== null && x !== undefined);
    q[key] = v.length ? mean(v) : null;
  }
  q.good = q.score >= GOOD.score && (q.hands === null || q.hands >= GOOD.hands) && (q.accents === null || q.accents >= GOOD.accents);
  return q;
}

// a mastered lesson's form now: it fades while the lesson isn't played
export const formOf = (st, now = Date.now()) =>
  (st.mastered ? st.form * 0.5 ** ((now - st.formAt) / DAY_MS / FORM_HALF_LIFE) : 0);

// learning | settling | mastered | slipping | ahead (not opened yet)
export function lessonStatus(p, i, now = Date.now()) {
  const st = p.steps[STEPS[i].id];
  if (st.mastered) return st.slipped || formOf(st, now) < 0.5 ? 'slipping' : 'mastered';
  if (st.passed) return 'settling';
  return i <= p.current ? 'learning' : 'ahead';
}

// 0..1, for the skills cloud: never on/off, it grows with tempo and quality and fades with form
export function lessonMastery(p, i, now = Date.now()) {
  const step = STEPS[i], st = p.steps[step.id];
  const quality = clamp(((st.log.at(-1)?.score ?? 0.45) - 0.45) / 0.47);
  const form = formOf(st, now);
  switch (lessonStatus(p, i, now)) {
    case 'ahead':   // tried ahead of the route (from a skill tag): counts like learning
    case 'learning': return st.log.length ? 0.1 + 0.35 * Math.min(1, st.t / step.unlock) + 0.15 * quality : 0;
    case 'settling': return 0.65 + 0.1 * quality;
    case 'mastered': return 0.8 + 0.2 * form;
    default: return 0.35 + 0.3 * form;   // slipping
  }
}

// The current lesson reached its target tempo with good quality: it settles, the next one opens.
// -> true when the next lesson was opened
export function openNext(p, i) {
  p.steps[STEPS[i].id].passed = true;
  if (i !== p.current || p.current >= STEPS.length - 1) return false;
  p.current++;
  return true;
}

// End of a session: each lesson played gets a log line, and mastery moves on the evidence of the
// whole session, not one take. On a day when everything is off (offForm) nothing moves either way.
// takesById: { stepId: [{ t, score, timing, accents, hands }] } -> events [{ type, id }],
// type: settling | mastered | slipped | recovered
export function closeSession(p, takesById, { offForm = false } = {}) {
  const day = dayKey(), now = Date.now(), events = [];
  for (const [id, takes] of Object.entries(takesById)) {
    if (!takes.length) continue;
    const step = STEPS[stepIndex(id)], st = p.steps[id];
    const avg = key => {
      const v = takes.map(k => k[key]).filter(x => x !== null && x !== undefined);
      return v.length ? Math.round(mean(v) * 100) / 100 : null;
    };
    const score = avg('score');
    st.log = [...st.log, { day, n: takes.length, score, timing: avg('timing'), accents: avg('accents'), hands: avg('hands'), bpm: tempoOf(step, st) }].slice(-40);
    if (offForm) continue;

    const q = sessionQuality(step, takes);
    if (q?.good) {
      const first = !st.good.length;
      st.passed = true;
      if (!st.good.some(g => g.day === day)) st.good = [...st.good, { day, score: q.score }].slice(-10);
      if (st.slipped) { st.slipped = false; events.push({ type: 'recovered', id }); }
      if (!st.mastered && st.good.length >= 2 && new Set(st.good.map(g => g.day)).size >= 2) {
        st.mastered = true;
        st.form = 1;
        st.formAt = now;
        events.push({ type: 'mastered', id });
        continue;
      }
      if (first) events.push({ type: 'settling', id });
    }
    if (st.mastered) {
      st.form = clamp(0.6 * formOf(st, now) + 0.4 * clamp((score - 0.45) / 0.47));
      st.formAt = now;
      if (!st.slipped && score < SLIP_SCORE && takes.length >= 2) { st.slipped = true; events.push({ type: 'slipped', id }); }
    }
  }
  return events;
}

// a lesson the current one stands on that has slipped: bring it back first; -1 if none
export function slippedNeed(p, now = Date.now()) {
  return STEPS[p.current].needs.map(stepIndex).find(i => lessonStatus(p, i, now) === 'slipping') ?? -1;
}

// up to 3 opened lessons for review (not the current one): slipped ones first (those the current
// lesson stands on before others), then settling ones not yet played well today, then mastered
// ones, the most faded first
export function reviewSteps(p, now = Date.now()) {
  const day = dayKey();
  const needs = STEPS[p.current].needs;
  const prio = i => {
    const st = p.steps[STEPS[i].id];
    const status = lessonStatus(p, i, now);
    if (status === 'slipping') return needs.includes(STEPS[i].id) ? 0 : 1;
    if (status === 'settling') return st.good.at(-1)?.day === day ? 5 : 2;
    return 3 + formOf(st, now);
  };
  return STEPS.map((s, i) => i)
    .filter(i => i !== p.current && p.steps[STEPS[i].id].passed)
    .sort((a, b) => prio(a) - prio(b) || p.steps[STEPS[a].id].seen - p.steps[STEPS[b].id].seen)
    .slice(0, 3);
}

// settling lessons not yet played well today: they keep coming back in "new" too
export function settlingSteps(p) {
  const day = dayKey();
  return STEPS.map((s, i) => i).filter(i => i !== p.current && lessonStatus(p, i) === 'settling' &&
    p.steps[STEPS[i].id].good.at(-1)?.day !== day);
}
