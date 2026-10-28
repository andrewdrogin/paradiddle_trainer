// Skills: what you can do, not which lessons you passed. Each tag in «Мій шлях» is a skill; its colour
// is mastery (from the lessons behind it and from the profile), its size how relevant it is now.
// One cloud per stage (новачок, аматор, впевнений). A tag knows what a teacher would say about it and
// which exercises train it, so tapping it can start a short session on just that skill.
// Pure logic: no DOM.

import { STEPS, stepIndex, lessonMastery, lessonStatus, tempoOf } from './course.js';
import { metric, edgeBpm } from './profile.js';

const clamp = v => Math.min(1, Math.max(0, v));
const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
const pct = v => Math.round(v * 100);

export const GROUPS = { hands: 'Руки', rhythm: 'Ритм', dyn: 'Динаміка', rud: 'Рудименти' };

// confidence: a metric seen on few takes counts only partly
const sure = (pf, key, full = 24) => Math.min(1, (pf.m[key]?.n || 0) / full);
const lessons = (ctx, ids) => mean(ids.map(id => lessonMastery(ctx.progress, stepIndex(id), ctx.now)));
const timingScore = v => clamp(1 - (v - 0.03) / 0.09);   // mean |dev| 0.03 of a gap → 1, 0.12 → 0

// focus line on the plate during a skill session: how this take did on just that skill
const handFocus = h => (phrase, r) => {
  const own = r.notes.filter((n, i) => phrase.notes[i].hand === h);
  return own.length ? `${h === 'R' ? 'Права' : 'Ліва'}: ${own.filter(n => n.status === 'ok').length} з ${own.length} нот рівно` : '';
};
const timingFocus = (phrase, r) => `Рівно: ${r.notes.filter(n => n.status === 'ok').length} з ${r.notes.length} нот`;
const balanceFocus = (phrase, r, m) => (m.balance ? `Ліва ≈ ${pct(m.balance)}% від правої за силою` : '');
const accentFocus = (phrase, r, m) => (m.accent !== null ? `Акцент на ${Math.round(m.accent)} дБ над тихими${m.accent >= 10 ? ' 👍' : ''}` : '');
const doublesFocus = (phrase, r) => {
  const second = r.notes.filter((n, i) => i > 0 && phrase.notes[i - 1].hand === phrase.notes[i].hand);
  return second.length ? `Друга нота подвійних: ${second.filter(n => n.status === 'ok').length} з ${second.length} на місці` : '';
};
const steadyFocus = (phrase, r) => (r.playedBpm ? `Твій темп ≈ ${r.playedBpm}, ${r.creep !== null && Math.abs(r.creep - 1) < 0.06 ? 'рівно до кінця' : 'тримай рівно до кінця'}` : '');

// id -> { title, group, value(ctx) 0..1, lessons: practice exercises [stepId or stepId:mirror],
//   note(ctx): what a teacher says now, focus(phrase, result, metrics): a line during practice }
export const SKILLS = {
  timing: {
    title: 'рівний таймінг', group: 'rhythm', lessons: ['singles', 'change', 'singles:mirror'],
    value: ({ profile: pf }) => {
      const r = metric(pf, 'timeR'), l = metric(pf, 'timeL');
      return r === null || l === null ? 0 : timingScore((r + l) / 2) * sure(pf, 'timeR');
    },
    note: ({ profile: pf }) => {
      const r = metric(pf, 'timeR'), l = metric(pf, 'timeL');
      if (r === null || l === null) return 'Ще мало нот, щоб сказати напевно. Пограй кілька занять, і я розповім.';
      const t = (r + l) / 2;
      return t <= 0.05 ? 'Ноти лягають рівно на свої місця. Тримай цю якість, коли піднімаєш темп.'
        : t <= 0.08 ? 'Здебільшого рівно, іноді нота трохи зсувається. Повільні одиночні під клік це вирівнюють.'
          : 'Ноти поки гуляють довкола долі. Нічого страшного: повільніше, слухай клік і грай «в нього».';
    },
    focus: timingFocus,
  },
  right: {
    title: 'права рука', group: 'hands', lessons: ['right', 'singles'],
    value: ({ profile: pf }) => { const v = metric(pf, 'timeR'); return v === null ? 0 : timingScore(v) * sure(pf, 'timeR'); },
    note: ({ profile: pf }) => {
      const v = metric(pf, 'timeR'), p = metric(pf, 'pushR');
      if (v === null) return 'Ще мало нот правою, щоб сказати напевно.';
      return (v <= 0.05 ? 'Права тримає темп впевнено.' : 'Права іноді зсувається з долі.') +
        (p !== null && p < -0.04 ? ' Вона трохи поспішає: дай ноті долетіти.' : p !== null && p > 0.04 ? ' Вона трохи запізнюється.' : '');
    },
    focus: handFocus('R'),
  },
  left: {
    title: 'ліва рука', group: 'hands', lessons: ['left', 'singles:mirror', 'change:mirror'],
    value: ({ profile: pf }) => {
      const v = metric(pf, 'timeL'), b = metric(pf, 'balance');
      if (v === null) return 0;
      return (timingScore(v) * 0.6 + (b === null ? 0.4 : clamp(1 - (1 - Math.min(b, 1)) * 2.5) * 0.4)) * sure(pf, 'timeL');
    },
    note: ({ profile: pf }) => {
      const v = metric(pf, 'timeL'), r = metric(pf, 'timeR'), b = metric(pf, 'balance');
      if (v === null) return 'Ще мало нот лівою, щоб сказати напевно.';
      const parts = [];
      parts.push(r !== null && v - r > 0.03 ? 'Ліва поки менш точна за праву, це звично для більшості.' : 'За точністю ліва вже не відстає від правої.');
      if (b !== null) parts.push(b < 0.85 ? `За силою ≈ ${pct(b)}% від правої: піднімай її на ту саму висоту.` : 'За силою вона майже як права.');
      return parts.join(' ');
    },
    focus: handFocus('L'),
  },
  even: {
    title: 'рівні руки', group: 'hands', lessons: ['singles', 'singles:mirror', 'change'],
    value: ({ profile: pf }) => { const b = metric(pf, 'balance'); return b === null ? 0 : clamp(1 - Math.abs(1 - b) * 3) * sure(pf, 'balance'); },
    note: ({ profile: pf }) => {
      const b = metric(pf, 'balance');
      if (b === null) return 'Ще мало нот обома руками, щоб порівняти.';
      return b >= 0.9 && b <= 1.12 ? 'Руки звучать однаково, це дуже добре.' : `Ліва ≈ ${pct(b)}% від правої за силою. Однакова висота паличок вирівнює звук.`;
    },
    focus: balanceFocus,
  },
  steady: {
    title: 'поспіх під контролем', group: 'rhythm', lessons: ['singles', 'paradiddle'],
    value: ({ profile: pf }) => {
      const s = metric(pf, 'steady'), r = metric(pf, 'rush');
      if (s === null && r === null) return 0;
      return clamp(1 - ((s ?? 0.02) - 0.02) / 0.1) * clamp(1 - (Math.abs(r ?? 0) - 0.02) / 0.1) * sure(pf, 'rush');
    },
    note: ({ profile: pf }) => {
      const s = metric(pf, 'steady'), r = metric(pf, 'rush');
      if (s === null && r === null) return 'Ще не бачив тебе на довгих фразах.';
      if (r !== null && r < -0.05) return 'Є звичка трохи розганятись. Слухай клік і не жени: швидкість прийде сама.';
      if (s !== null && s >= 0.08) return 'Темп іноді пливе всередині фрази. Тримай рівно до останньої ноти.';
      return 'Темп тримаєш рівно, без поспіху.';
    },
    focus: steadyFocus,
  },
  accents: {
    title: 'акценти', group: 'dyn', lessons: ['accent-tap', 'singles-acc'],
    value: ({ profile: pf }) => { const a = metric(pf, 'accent', 3); return a === null ? 0 : clamp((a - 4) / 8) * sure(pf, 'accent', 12); },
    note: ({ profile: pf }) => {
      const a = metric(pf, 'accent', 3);
      if (a === null) return 'Акценти ще попереду: урок «Акцент і тихі».';
      return a >= 10 ? 'Акценти чітко над тихими. Так і тримай.' : `Акцент зараз на ${Math.round(a)} дБ над тихими. Високо для акценту, низько для тихих, і різниця сама виросте.`;
    },
    focus: accentFocus,
  },
  change: { title: 'зміна руки', group: 'rud', lessons: ['change'], steps: ['change'] },
  singles: { title: 'одиночні', group: 'rud', lessons: ['singles', 'singles-acc'], steps: ['singles', 'singles-acc'] },
  doubles: {
    title: 'подвійні', group: 'rud', lessons: ['doubles', 'doubles:mirror'], steps: ['doubles'],
    value: ctx => {
      const d = metric(ctx.profile, 'doubles');
      const l = lessons(ctx, ['doubles']);
      return d === null ? l : (l + timingScore(d)) / 2;
    },
    focus: doublesFocus,
  },
  paradiddle: { title: 'парадідл', group: 'rud', lessons: ['paradiddle', 'paradiddle-acc'], steps: ['paradiddle', 'paradiddle-acc'] },
  tempo80: {
    title: 'темп 80', group: 'rhythm', lessons: ['singles', 'doubles', 'paradiddle'],
    value: ({ profile: pf }) => { const e = edgeBpm(pf, ['singles', 'change', 'doubles', 'paradiddle', 'singles-acc']); return e === null ? 0 : clamp((e - 56) / 24); },
    note: ({ profile: pf }) => {
      const e = edgeBpm(pf, ['singles', 'change', 'doubles', 'paradiddle', 'singles-acc']);
      return e === null ? 'Ще не бачив тебе стабільно на швидшому темпі.' : e >= 80 ? `Тримаєш якість на ${e} BPM.` : `Зараз чисто виходить до ${e} BPM. До 80 крок за кроком, якість важливіша.`;
    },
    focus: steadyFocus,
  },

  inversions: { title: 'інверсії', group: 'rud', lessons: ['inv-inward', 'inv-outward', 'inv-third'], steps: ['inv-inward', 'inv-outward', 'inv-third'] },
  'double-para': { title: 'подвійний парадідл', group: 'rud', lessons: ['double-para'], steps: ['double-para'] },
  triplets: { title: 'тріолі', group: 'rhythm', lessons: ['para-diddle', 'double-para'], steps: ['para-diddle'] },
  sixteenths: { title: 'шістнадцяті', group: 'rhythm', lessons: ['para-16'], steps: ['para-16'] },
  'accent-any': { title: 'акцент будь-де', group: 'dyn', lessons: ['accent-any'], steps: ['accent-any'], focus: accentFocus },
  quiet: {
    title: 'тихі ноти', group: 'dyn', lessons: ['accent-tap', 'paradiddle-acc'],
    value: ({ profile: pf }) => {
      const a = metric(pf, 'accent', 3), s = metric(pf, 'tapSpread');
      return a === null || s === null ? 0 : clamp((a - 6) / 8) * clamp(1 - (s - 1.5) / 4) * sure(pf, 'accent', 20);
    },
    note: ({ profile: pf }) => {
      const s = metric(pf, 'tapSpread');
      if (s === null) return 'Тихі ноти: рівні, низькі, без випадкових сплесків. Поки замало даних.';
      return s <= 2.5 ? 'Тихі ноти рівні за гучністю.' : 'Тихі ноти поки різні за гучністю: тримай паличку низько й однаково.';
    },
    focus: accentFocus,
  },
  tempo100: {
    title: 'шістнадцяті 100', group: 'rhythm', lessons: ['para-16'],
    value: ({ profile: pf }) => { const e = edgeBpm(pf, ['para-16']); return e === null ? 0 : clamp((e - 70) / 30); },
    note: ({ profile: pf }) => { const e = edgeBpm(pf, ['para-16']); return e === null ? 'Шістнадцяті ще попереду.' : `Шістнадцятими чисто до ${e} BPM.`; },
    focus: steadyFocus,
  },

  ghost: { title: 'привидні ноти', group: 'dyn', future: true },
  groove: { title: 'парадідл у грув', group: 'rud', future: true },
  fast16: { title: 'шістнадцяті 140+', group: 'rhythm', future: true },
  dynamics: { title: 'крещендо', group: 'dyn', future: true },
};

export const CLOUDS = [
  { title: 'Новачок', skills: ['timing', 'right', 'left', 'even', 'steady', 'accents', 'change', 'singles', 'doubles', 'paradiddle', 'tempo80'] },
  { title: 'Аматор', skills: ['inversions', 'double-para', 'triplets', 'sixteenths', 'accent-any', 'quiet', 'tempo100'] },
  { title: 'Впевнений', skills: ['ghost', 'groove', 'fast16', 'dynamics'], future: true },
];

const CLOUD_GREEN = 0.7;     // a cloud this green on average: the next one comes into focus

export function skillValue(id, ctx) {
  const s = SKILLS[id];
  if (s.future) return 0;
  return clamp(s.value ? s.value(ctx) : lessons(ctx, s.steps));
}

// the lesson ids behind a skill (for status words and practice)
const stepIdsOf = s => [...new Set((s.steps || s.lessons || []).map(x => x.split(':')[0]))];

export function cloudValue(ci, ctx) {
  return mean(CLOUDS[ci].skills.map(id => skillValue(id, ctx)));
}

// the cloud in focus: the first one not yet mostly green
export function currentCloud(ctx) {
  const i = CLOUDS.findIndex((c, ci) => !c.future && cloudValue(ci, ctx) < CLOUD_GREEN);
  return i < 0 ? CLOUDS.length - 1 : i;
}

// big: what you're working on now (the current lesson, or the weakest started skills);
// small: mastered basics and what's ahead; mid: the rest
export function relevance(id, ctx, weakest) {
  const s = SKILLS[id], v = skillValue(id, ctx);
  if (s.future) return 'small';
  const cur = STEPS[ctx.progress.current].id;
  if (stepIdsOf(s).includes(cur) || weakest.includes(id)) return 'big';
  if (v >= 0.85 || v === 0) return 'small';
  return 'mid';
}

export function weakestSkills(ci, ctx, n = 2) {
  return CLOUDS[ci].skills.map(id => ({ id, v: skillValue(id, ctx) }))
    .filter(x => x.v > 0 && x.v < 0.6).sort((a, b) => a.v - b.v).slice(0, n).map(x => x.id);
}

export function levelWord(v) {
  return v === 0 ? 'ще не пробували' : v < 0.35 ? 'тільки починаємо' : v < 0.6 ? 'вчимося' : v < 0.8 ? 'вже непогано' : 'тримається впевнено';
}

// what a teacher says about this skill now, plus which exercises train it
export function skillNote(id, ctx) {
  const s = SKILLS[id];
  if (s.future) return { text: 'Це попереду. Коли попередня хмаринка здебільшого зазеленіє, сюди з\'являться вправи.', exercises: [] };
  const parts = [];
  if (s.note) parts.push(s.note(ctx));
  for (const sid of stepIdsOf(s)) {
    const i = stepIndex(sid), st = ctx.progress.steps[sid];
    const status = lessonStatus(ctx.progress, i, ctx.now);
    const t = tempoOf(STEPS[i], st);
    const word = {
      learning: `вчимо, зараз ${t} BPM`,
      settling: 'закріплюється, перевіримо ще в інший день',
      mastered: `засвоєно, ${t} BPM`,
      slipping: 'трохи просіло, варто освіжити',
      ahead: st.log.length ? `уже пробували, ${t} BPM; у маршруті він трохи далі` : 'ще попереду, але спробувати можна',
    }[status];
    parts.push(`Урок ${i + 1} «${STEPS[i].title}»: ${word}.`);
  }
  const exercises = [...new Set((s.lessons || []).map(x => {
    const [sid, mirror] = x.split(':');
    return STEPS[stepIndex(sid)].title + (mirror ? ' з лівої' : '');
  }))];
  return { text: parts.join(' '), exercises };
}

// Practice for a skill: the exercises in rotation, each at the lesson's own current tempo (where it is
// on the edge for you now). -> [{ step, mirror }]
export function skillPractice(id) {
  return (SKILLS[id].lessons || []).map(x => {
    const [sid, mirror] = x.split(':');
    return { step: stepIndex(sid), mirror: !!mirror };
  });
}

export const skillFocus = (id, phrase, r, m) => (SKILLS[id].focus || timingFocus)(phrase, r, m) || '';
