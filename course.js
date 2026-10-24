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

// warm-up is not graded: every phrase is played once, whatever comes out
export const WARMUP = [
  { title: 'Права рука', sticking: 'RRRRRRRR', accents: [], bpm: 60 },
  { title: 'Ліва рука', sticking: 'LLLLLLLL', accents: [], bpm: 60 },
  { title: 'Права рука', sticking: 'RRRRRRRR', accents: [], bpm: 60 },
  { title: 'Ліва рука', sticking: 'LLLLLLLL', accents: [], bpm: 60 },
  { title: 'Одиночні', sticking: 'RLRLRLRL', accents: [], bpm: 60 },
  { title: 'Одиночні', sticking: 'RLRLRLRL', accents: [], bpm: 72 },
  { title: 'Одиночні', sticking: 'RLRLRLRL', accents: [], bpm: 60 },
];

// how lenient the judging is: timing window (share of the note gap) and accent margin (dB)
export const STRICTNESS = {
  soft: { label: 'М\'яко', window: 0.25, accentDb: 4 },
  normal: { label: 'Нормально', window: 0.15, accentDb: 6 },
  strict: { label: 'Строго', window: 0.1, accentDb: 8 },
};

export const notesOf = (sticking, accents) =>
  [...sticking].map((hand, i) => ({ hand, accent: accents.includes(i) }));

export function stepPhrase(step, st) {
  const len = st.len === 'short' ? 4 : 8;
  return { title: step.title, notes: notesOf(step.sticking.slice(0, len), step.accents), bpm: TEMPOS[st.t] };
}

export const noteGap = bpm => 60 / bpm / 2;

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

// Judge one echo. The phrase grid starts at the player's first hit (then re-centred on all hits),
// so mic/output latency never counts as being late.
// -> { clean, notes: [{ status, dev, db }], extra, hint, tempoRatio }
//    status: ok | early | late | miss | weak (accent not louder than the taps)
export function grade(phrase, hits, strictness) {
  const { window, accentDb } = STRICTNESS[strictness] || STRICTNESS.soft;
  const n = phrase.notes.length;
  const gap = noteGap(phrase.bpm);
  if (!hits.length) {
    return { clean: false, notes: phrase.notes.map(() => ({ status: 'miss' })), extra: 0, hint: 'Не почув ударів 🙂', tempoRatio: 1 };
  }

  let t0 = hits[0].time;
  let idx = match(n, gap, hits, t0, window);
  for (let k = 0; k < 2; k++) {
    const res = idx.flatMap((h, i) => (h < 0 ? [] : [hits[h].time - (t0 + i * gap)]));
    if (!res.length) break;
    t0 += mean(res);
    idx = match(n, gap, hits, t0, window);
  }

  const notes = idx.map((h, i) => {
    if (h < 0) return { status: 'miss' };
    const dev = (hits[h].time - (t0 + i * gap)) / gap;
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

  // tempo drift: slope of hit times against the grid. With the right number of hits, hit i is
  // note i even when rushing pushed the late notes out of their windows.
  let tempoRatio = 1;
  const pts = hits.length === n
    ? hits.map((h, i) => [i, h.time])
    : idx.flatMap((h, i) => (h < 0 ? [] : [[i, hits[h].time]]));
  if (pts.length >= 4) {
    const mi = mean(pts.map(p => p[0])), mt = mean(pts.map(p => p[1]));
    const slope = pts.reduce((s, [i, t]) => s + (i - mi) * (t - mt), 0) / pts.reduce((s, [i]) => s + (i - mi) ** 2, 0);
    tempoRatio = slope / gap;
  }

  const missed = notes.filter(r => r.status === 'miss').length;
  const offGrid = notes.filter(r => r.status === 'early' || r.status === 'late').length;
  const clean = !missed && !extra && !weak;
  let hint;
  if (clean) hint = offGrid ? 'Зараховано! Ще трохи рівніше, і буде ідеально' : 'Чисто! ✓';
  else if (tempoRatio < 0.94) hint = 'Трохи поспішаєш, не жени 🙂';
  else if (tempoRatio > 1.06) hint = 'Трохи тягнеш, можна живіше';
  else if (missed || extra) hint = hits.length === n ? 'Удари трохи розбіглися, послухай ще раз' : 'Кількість ударів не та, послухай ще раз';
  else hint = 'Акценти можна гучніше, а тихі тихіше';
  if (clean && tempoRatio < 0.94) hint += '. Трохи поспішаєш 🙂';
  return { clean, notes, extra, hint, tempoRatio };
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
