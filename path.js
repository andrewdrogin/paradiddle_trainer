// «Мій шлях»: a cloud of skill tags per stage instead of a list of lessons with ticks. Colour =
// mastery (pale → green, fades when a skill slips), size = how relevant it is right now. The cloud in
// focus is large; earlier ones shrink beside it, green; the next one is a pale silhouette that fades
// in as the current one turns green. Tap a tag: the teacher's note and «Попрацювати над цим».
// The lessons stay underneath as the route.

import { STEPS, LEVELS, lessonStatus, levelOf, tempoOf, temposOf } from './course.js';
import {
  SKILLS, CLOUDS, GROUPS, skillValue, cloudValue, currentCloud, relevance, weakestSkills, levelWord, skillNote,
} from './skills.js';

let openTag = null;

// biggest tags in the middle of the cloud, smaller ones around them
function cloudOrder(tags) {
  const rank = { big: 0, mid: 1, small: 2 };
  const sorted = [...tags].sort((a, b) => rank[a.size] - rank[b.size] || b.v - a.v);
  const out = [];
  sorted.forEach((t, k) => (k % 2 ? out.push(t) : out.unshift(t)));
  return out;
}

const STATUS_ICON = { learning: '●', settling: '◐', mastered: '✓', slipping: '↺', ahead: '·' };
const STATUS_WORD = { learning: 'вчимо', settling: 'закріплюється', mastered: 'засвоєно', slipping: 'освіжити', ahead: 'попереду' };

function routeHtml(progress) {
  const out = [];
  LEVELS.forEach((lvl, li) => {
    out.push(`<div class="level${lvl.locked ? ' locked' : ''}"><b>${lvl.title}</b> <span>${lvl.note}</span></div>`);
    STEPS.forEach((step, k) => {
      if (levelOf(step) !== li) return;
      const st = progress.steps[step.id], status = lessonStatus(progress, k);
      const pct = Math.round(st.t / step.max * 100);
      out.push(`<div class="lesson s-${status}${k === progress.current ? ' current' : ''}">
        <span class="no">${STATUS_ICON[status]} ${k + 1}</span><span class="grow">${step.title}</span>
        <span class="muted small">${STATUS_WORD[status]}</span>
        <span class="tempo"><i style="width:${pct}%"></i></span><span class="muted small">${tempoOf(step, st)}/${temposOf(step)[step.max]}</span></div>`);
    });
  });
  return out.join('');
}

export function renderPath({ progress, profile, onPractice }) {
  const ctx = { progress, profile, now: Date.now() };
  const cur = currentCloud(ctx);
  const curGreen = cloudValue(cur, ctx);
  const weakest = weakestSkills(cur, ctx);

  const clouds = CLOUDS.map((cloud, ci) => {
    const role = ci < cur ? 'past' : ci === cur ? 'current' : ci === cur + 1 ? 'next' : 'later';
    const tags = cloud.skills.map(id => {
      const v = skillValue(id, ctx);
      return { id, v, size: ci === cur ? relevance(id, ctx, weakest) : 'small' };
    });
    const html = cloudOrder(tags).map(t => `<button class="tag z-${t.size} g-${SKILLS[t.id].group}${openTag === t.id ? ' open' : ''}"
      data-skill="${t.id}" style="--m:${Math.round(t.v * 100)}%">${SKILLS[t.id].title}</button>`).join('');
    // the next cloud fades in as the current one turns green
    const fade = role === 'next' ? `style="--fade:${(0.3 + 0.55 * Math.min(1, curGreen / 0.7)).toFixed(2)}"` : '';
    return `<section class="cloud ${role}" ${fade} data-cloud="${ci}">
      <h3>${cloud.title}</h3>
      <div class="tags">${html}</div>
    </section>`;
  }).join('');

  const legend = Object.entries(GROUPS).map(([k, v]) => `<span class="g-${k}">${v}</span>`).join('');
  document.getElementById('mapSummary').textContent = cur > 0
    ? `Основу ти вже тримаєш. Зараз у фокусі хмаринка «${CLOUDS[cur].title}».`
    : `Хмаринка «${CLOUDS[cur].title}». Колір показує, як скіл тримається, розмір — наскільки він важливий зараз.`;
  document.getElementById('map').innerHTML = `
    <div class="clouds">${clouds}</div>
    <div class="legend">${legend}<span class="scale"><i></i>блідий → зелений: як тримається</span></div>
    <div id="tagNote" class="tag-note" hidden></div>
    <details class="route"><summary>Маршрут уроків</summary><div class="lessons">${routeHtml(progress)}</div></details>`;

  document.querySelectorAll('#map .tag').forEach(b => {
    b.onclick = () => {
      openTag = openTag === b.dataset.skill ? null : b.dataset.skill;
      document.querySelectorAll('#map .tag').forEach(x => x.classList.toggle('open', x.dataset.skill === openTag));
      showNote(ctx, onPractice);
    };
  });
  showNote(ctx, onPractice);
}

function showNote(ctx, onPractice) {
  const el = document.getElementById('tagNote');
  if (!openTag) { el.hidden = true; return; }
  const s = SKILLS[openTag], v = skillValue(openTag, ctx);
  const { text, exercises } = skillNote(openTag, ctx);
  el.hidden = false;
  el.innerHTML = `
    <div class="tn-head"><b>${s.title}</b><span class="tn-level" style="--m:${Math.round(v * 100)}%">${s.future ? 'попереду' : levelWord(v)}</span></div>
    <p>${text}</p>
    ${exercises.length ? `<p class="muted small">Вправи: ${exercises.join(' · ')}</p>` : ''}
    ${s.future ? '' : '<button class="cta small" id="practiceBtn">Попрацювати над цим</button>'}`;
  if (!s.future) document.getElementById('practiceBtn').onclick = () => onPractice(openTag);
  el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// bring the cloud in focus into view (after the screen is shown)
export function focusCloud() {
  const el = document.querySelector('#map .cloud.current');
  const box = el?.parentElement;
  if (box) box.scrollLeft = el.offsetLeft - box.offsetLeft - (box.clientWidth - el.clientWidth) / 2;
}
