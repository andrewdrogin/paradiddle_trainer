// The learner profile: what the trainer has learned about how you play, from every note — per hand
// timing and rush/drag, doubles, accents, hand balance, steadiness, the tempo where it falls apart.
// Plus reading today's state (off form from the start, tiring mid-session) and a teacher's words
// after a session and when a lesson is mastered. Always against your own profile, never a norm.
// Pure logic: no audio, no DOM.

import { STEPS, stepIndex } from './course.js';

const KEY = 'pt.profile';
const ALPHA = 0.12;          // how fast a metric follows new takes once it has enough of them

const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
const median = a => [...a].sort((x, y) => x - y)[a.length >> 1];
const std = a => { const m = mean(a); return Math.sqrt(mean(a.map(v => (v - m) ** 2))); };
const amp = db => 10 ** (db / 20);
const pct = v => Math.round(v * 100);

export function loadProfile() {
  let p = null;
  try { p = JSON.parse(localStorage.getItem(KEY)); } catch {}
  p ??= {};
  p.m ??= {};                    // metric -> { v, n }
  p.edge ??= {};                 // stepId -> { bpm: { v, n } }: rank score at each tempo
  p.warm ??= { v: 0, n: 0 };     // your usual warm-up rank score
  p.sessions ??= [];             // [{ day, score, offForm, m: { metric: v } }]
  return p;
}

export const saveProfile = p => { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch {} };

// running average: a plain mean for the first takes, then an exponential one
function fold(e, x, w) {
  e.v += (x - e.v) * Math.min(1, Math.max(ALPHA, 1 / (e.n + 1)) * w);
  e.n++;
}
const foldKey = (p, key, x, w) => {
  if (x === null || x === undefined || !Number.isFinite(x)) return;
  fold(p.m[key] ??= { v: x, n: 0 }, x, w);
};

// a metric once it has enough takes behind it, else null ("I don't know you there yet")
export const metric = (p, key, min = 4) => (p.m[key]?.n >= min ? p.m[key].v : null);

// One take, note by note. dev is the offset from the note's place as a share of the note gap.
// -> { timeR, timeL, pushR, pushL, doubles, accent, balance, tapSpread, steady, rush }, null = n/a
export function takeMetrics(phrase, r) {
  const played = r.notes.map((x, i) => ({ ...x, ...phrase.notes[i], i })).filter(n => n.dev !== undefined);
  const hand = h => played.filter(n => n.hand === h);
  const absDev = a => (a.length ? mean(a.map(n => Math.abs(n.dev))) : null);
  const push = a => (a.length ? mean(a.map(n => n.dev)) : null);
  // the second note of a double (only where hands alternate at all: one-hand exercises have no doubles)
  const both = phrase.notes.some(n => n.hand === 'R') && phrase.notes.some(n => n.hand === 'L');
  const doubles = both ? played.filter(n => n.i > 0 && phrase.notes[n.i - 1].hand === n.hand) : [];
  const taps = played.filter(n => !n.accent), accs = played.filter(n => n.accent);
  const tR = taps.filter(n => n.hand === 'R'), tL = taps.filter(n => n.hand === 'L');
  return {
    timeR: absDev(hand('R')),
    timeL: absDev(hand('L')),
    pushR: push(hand('R')),
    pushL: push(hand('L')),
    doubles: absDev(doubles),
    accent: accs.length && taps.length ? median(accs.map(n => n.db)) - median(taps.map(n => n.db)) : null,
    balance: tR.length && tL.length ? mean(tL.map(n => amp(n.db))) / mean(tR.map(n => amp(n.db))) : null,
    tapSpread: taps.length >= 3 ? std(taps.map(n => n.db)) : null,
    steady: r.creep === null || r.creep === undefined ? null : Math.abs(r.creep - 1),
    rush: r.playedBpm ? r.tempoRatio - 1 : null,
  };
}

// fold a take into the profile; weight < 1 on an off day, so one tired evening doesn't redraw you
export function addTake(p, metrics, score, { weight = 1, stepId = null, bpm = null } = {}) {
  for (const [k, v] of Object.entries(metrics)) foldKey(p, k, v, weight);
  foldKey(p, 'score', score, weight);
  if (stepId && bpm) {
    const at = (p.edge[stepId] ??= {});
    fold(at[bpm] ??= { v: score, n: 0 }, score, weight);
  }
}

// the fastest tempo where these lessons still come out well (rank A on average); null if none yet
export function edgeBpm(p, stepIds, min = 0.8) {
  let best = null;
  for (const id of stepIds) {
    for (const [bpm, e] of Object.entries(p.edge[id] || {})) {
      if (e.n >= 2 && e.v >= min && (best === null || Number(bpm) > best)) best = Number(bpm);
    }
  }
  return best;
}

// ---------- today's state ----------

const OFF_FORM = 0.12;       // warm-up this much below your usual = off form from the start
const TIRED = 0.15;          // the latest takes this much below the session's best stretch = tiring

// End of warm-up: compare with your usual warm-up. -> true when clearly worse than usual
export function warmupOffForm(p, scores) {
  if (!scores.length) return false;
  const now = mean(scores);
  const off = p.warm.n >= 3 && now < p.warm.v - OFF_FORM;
  fold(p.warm, now, off ? 0.3 : 1);
  return off;
}

// Quality sliding after a good start: the last 4 in-tempo takes against the best 4 in a row before
export function tiring(scores) {
  if (scores.length < 8) return false;
  const win = k => mean(scores.slice(k, k + 4));
  let best = 0;
  for (let k = 0; k + 4 <= scores.length - 4; k++) best = Math.max(best, win(k));
  const last = win(scores.length - 4);
  return last < best - TIRED && last < 0.75;
}

// ---------- the teacher's words ----------

const sessionMetric = (list, key) => {
  const v = list.map(m => m[key]).filter(x => x !== null && x !== undefined);
  return v.length >= 2 ? mean(v) : null;
};

// After a session: what went well and 2–3 concrete things to work on, from this session's takes,
// compared with your own earlier sessions where it says "better". list: per-take metrics.
// -> { good: [string], work: [string] }
export function sessionReport(p, list) {
  const good = [], work = [];
  if (!list.length) return { good, work };
  const m = k => sessionMetric(list, k);
  const timeR = m('timeR'), timeL = m('timeL'), bal = m('balance'), acc = m('accent');
  const dbl = m('doubles'), steady = m('steady'), pushR = m('pushR'), pushL = m('pushL');
  const time = timeR !== null && timeL !== null ? (timeR + timeL) / 2 : timeR ?? timeL;

  if (time !== null) {
    if (time <= 0.05) good.push('Таймінг рівний: ноти лягають на свої місця');
    else if (time >= 0.09) work.push('Ноти трохи гуляють довкола долі: на повільному темпі слухай клік і грай «в нього»');
  }
  if (timeR !== null && timeL !== null && timeL - timeR > 0.03) work.push('Ліва трохи менш точна за праву: варто більше вправ з лівої');
  if (timeR !== null && timeL !== null && timeR - timeL > 0.03) work.push('Права цього разу менш точна за ліву: не форсуй її');
  const push = [pushR, pushL].filter(x => x !== null);
  if (push.length && mean(push) < -0.05) work.push('Трохи поспішаєш: дай кожній ноті долетіти');
  else if (push.length && mean(push) > 0.05) work.push('Трохи тягнеш: можна сміливіше');
  if (bal !== null) {
    if (bal >= 0.9 && bal <= 1.12) good.push('Руки звучать однаково');
    else if (bal < 0.8) work.push(`Ліва тихіша за праву, ≈ ${pct(bal)}%: піднімай її на ту саму висоту`);
    else if (bal > 1.25) work.push('Ліва гучніша за праву: вирівняй висоту паличок');
  }
  if (acc !== null) {
    if (acc >= 10) good.push('Акценти чітко над тихими нотами');
    else if (acc < 6) work.push('Акценти можна розводити сильніше: акцент високо, тихі низько');
  }
  if (dbl !== null) {
    if (dbl <= 0.05) good.push('Подвійні рівні');
    else if (dbl >= 0.09) work.push('Друга нота в подвійних зсувається: це відскок, а не другий удар');
  }
  if (steady !== null && steady >= 0.08) work.push('Темп пливе всередині фрази: тримай рівно до останньої ноти');

  // real progress against your own beginning
  const first = p.sessions.find(s => s.m);
  if (first && p.sessions.length >= 3) {
    if (bal !== null && first.m.balance !== undefined && first.m.balance < 0.85 && bal >= 0.9) good.unshift('Ліва нарешті вирівнялась із правою 🙂');
    const t0 = first.m.timeR !== undefined && first.m.timeL !== undefined ? (first.m.timeR + first.m.timeL) / 2 : null;
    if (time !== null && t0 && time < t0 * 0.75) good.unshift('Таймінг помітно рівніший, ніж на початку');
  }
  return { good: good.slice(0, 3), work: work.slice(0, 3) };
}

// remember a finished session: a snapshot of the profile for "since the beginning" comparisons
export function endSession(p, { day, score, offForm }) {
  const m = {};
  for (const [k, e] of Object.entries(p.m)) m[k] = Math.round(e.v * 1000) / 1000;
  p.sessions = [...p.sessions, { day, score, offForm, m }].slice(-120);
}

// a short line of real progress for the home screen, or ''
export function progressNote(p) {
  const s = p.sessions.filter(x => x.m && !x.offForm);
  if (s.length < 4) return '';
  const a = s[0].m, b = s.at(-1).m;
  if (a.balance < 0.85 && b.balance >= 0.9) return 'Ліва нарешті вирівнялась із правою.';
  const t = m => (m.timeR !== undefined && m.timeL !== undefined ? (m.timeR + m.timeL) / 2 : null);
  if (t(a) && t(b) && t(b) < t(a) * 0.75) return 'Таймінг помітно рівніший, ніж на початку.';
  if (a.accent !== undefined && b.accent !== undefined && b.accent - a.accent >= 4) return 'Акценти стали набагато виразніші.';
  return '';
}

// When a lesson is mastered: the way from its first session to the last, what's good, what's
// still weak, what to watch next. -> [string]
export function lessonReport(stepId, st) {
  const step = STEPS[stepIndex(stepId)];
  const log = st.log.filter(l => l.score !== null);
  if (!log.length) return [];
  const a = log[0], b = log.at(-1);
  const out = [];
  const change = (label, k) => (a[k] !== null && b[k] !== null && a[k] !== undefined && b[k] !== undefined
    ? `${label} ${pct(a[k])}% → ${pct(b[k])}%` : null);
  const way = [change('таймінг', 'timing'), change('руки', 'hands'), change('акценти', 'accents')].filter(Boolean);
  const n = log.length, word = n % 10 === 1 && n % 100 !== 11 ? 'заняття'
    : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'заняття' : 'занять';
  out.push(`Від першого заняття (${a.bpm} BPM) до сьогодні (${b.bpm} BPM), за ${n} ${word}: ${way.join(', ')}`);
  const good = [], weak = [];
  for (const [k, label] of [['timing', 'таймінг'], ['hands', 'рівність рук'], ['accents', 'акценти']]) {
    if (b[k] === null || b[k] === undefined) continue;
    if (b[k] >= 0.85) good.push(label);
    else if (b[k] < 0.7) weak.push(label);
  }
  if (good.length) out.push(`Добре: ${good.join(', ')}`);
  if (weak.length) out.push(`Ще підтягнути: ${weak.join(', ')}`);
  const watch = [];
  if (weak.includes('рівність рук')) watch.push('ліва на тій самій висоті, що й права');
  if (weak.includes('акценти')) watch.push('акцент високо, тихі низько');
  if (weak.includes('таймінг')) watch.push('рівно на повільному темпі, перш ніж розганятись');
  if (!watch.length) watch.push(`${step.title} у вищому темпі`, 'розслаблені руки');
  out.push(`Далі звертай увагу: ${watch.join('; ')}`);
  return out;
}
