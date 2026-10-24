// What to play and how an attempt is judged. Pure logic: no audio, no DOM.

export const TEMPOS = [60, 66, 72, 80, 88, 96];   // BPM, notes are eighths

// The ladder. sticking: one bar of eighths; accents: note indexes; short: the half-bar version
// comes first; unlock: tempo index at which the next step opens; max: highest tempo index here.
export const STEPS = [
  { id: 'right', title: 'Права рука', sticking: 'RRRRRRRR', accents: [], short: true, unlock: 1, max: 2 },
  { id: 'left', title: 'Ліва рука', sticking: 'LLLLLLLL', accents: [], short: true, unlock: 1, max: 2 },
  { id: 'change', title: 'Зміна руки', sticking: 'RRRRLLLL', accents: [], short: false, unlock: 1, max: 3 },
  { id: 'singles', title: 'Одиночні', sticking: 'RLRLRLRL', accents: [], short: true, unlock: 2, max: 5 },
  { id: 'accent-tap', title: 'Акцент і тихі', sticking: 'RRRRLLLL', accents: [0, 4], short: false, unlock: 1, max: 2 },
  { id: 'singles-acc', title: 'Одиночні з акцентом', sticking: 'RLRLRLRL', accents: [0, 4], short: false, unlock: 2, max: 3 },
  { id: 'doubles', title: 'Подвійні', sticking: 'RRLLRRLL', accents: [], short: true, unlock: 2, max: 5 },
  { id: 'paradiddle', title: 'Парадідл', sticking: 'RLRRLRLL', accents: [], short: true, unlock: 2, max: 5 },
  { id: 'paradiddle-acc', title: 'Парадідл з акцентом', sticking: 'RLRRLRLL', accents: [0, 4], short: false, unlock: 2, max: 4 },
];

// Every step is a lesson. Beyond the ladder, the map shows what comes next (locked for now), so
// the way from beginner to intermediate is visible.
export const LEVELS = [
  { title: 'Початківець', lessons: STEPS.map(s => s.title), note: 'вісімки 60→96, рівні руки, чіткі акценти' },
  {
    title: 'Середній',
    lessons: ['Інверсії парадідла', 'Подвійний парадідл', 'Парадідл-дідл', 'Парадідл шістнадцятими 60→100', 'Акцент на будь-якій ноті'],
    note: 'шістнадцяті 100–120 рівно, дві висоти палички',
    locked: true,
  },
  {
    title: 'Профі',
    lessons: ['Привидні ноти і динаміка', 'Парадідл у грув', 'Шістнадцяті 140+ без напруги'],
    note: 'будь-який темп і гучність без напруги',
    locked: true,
  },
];

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
  const len = st.len === 'short' ? 4 : 8;
  let sticking = step.sticking.slice(0, len);
  if (mirror) sticking = [...sticking].map(h => (h === 'R' ? 'L' : 'R')).join('');
  return {
    title: step.title + (mirror ? ' з лівої' : ''),
    notes: notesOf(sticking, step.accents),
    bpm: TEMPOS[Math.max(0, st.t - slower)],
  };
}

export const canMirror = step => step.sticking.includes('R') && step.sticking.includes('L');

export const noteGap = bpm => 60 / bpm / 2;

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
  const gap = noteGap(phrase.bpm);
  if (!hits.length) {
    return { clean: false, notes: phrase.notes.map(() => ({ status: 'miss' })), extra: 0, hint: 'Не почув ударів 🙂', tempoRatio: 1, playedBpm: null };
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
  const creep = hits.length === n && n >= 8 ? slopeOf(pts.slice(n / 2)) / slopeOf(pts.slice(0, n / 2)) : 1;

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
  return { clean, onTarget, notes, extra, hint, tempoRatio, playedBpm };
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

const PROGRESS_KEY = 'pt.progress';

const freshStep = step => ({ t: 0, len: step.short ? 'short' : 'long', hist: [], passed: false, seen: 0 });

export function loadProgress() {
  let p = null;
  try { p = JSON.parse(localStorage.getItem(PROGRESS_KEY)); } catch {}
  p ??= { current: 0, session: 0, steps: {} };
  p.days ??= [];   // dates played, for "days in a row"
  for (const s of STEPS) p.steps[s.id] ??= freshStep(s);
  return p;
}

export const saveProgress = p => { try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(p)); } catch {} };

// Record one attempt of a ladder step and move it on. Patient: a miss just means "again", nothing
// ever goes down. -> a short message when something changed (longer phrase, faster, new step), else null
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
    return 'Тепер фраза на цілий такт';
  }
  if (cleanCount < 3 || st.t >= step.max) return null;
  st.t++;
  st.hist = [];
  let msg = `Темп ↑ ${TEMPOS[st.t]}`;
  if (!st.passed && st.t >= step.unlock) {
    st.passed = true;
    if (stepIndex === p.current && p.current < STEPS.length - 1) {
      p.current++;
      msg += `. Відкрито нову вправу: ${STEPS[p.current].title}`;
    }
  }
  return msg;
}

// up to 3 passed steps (not the current one), the longest unseen first
export function reviewSteps(p) {
  return STEPS.map((s, i) => ({ s, i }))
    .filter(({ s, i }) => p.steps[s.id].passed && i !== p.current)
    .sort((a, b) => p.steps[a.s.id].seen - p.steps[b.s.id].seen)
    .slice(0, 3)
    .map(({ i }) => i);
}
