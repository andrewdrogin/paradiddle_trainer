// The partner: a corgi drummer behind a mesh pad. It plays the phrase in "listen", nods and wags on
// the beat, and reacts to how it went. Mirror view: its right stick (coral) is on the screen's right,
// like a teacher you copy in a mirror. Placeholder art until a proper illustration replaces it.

const INK = '#141210';
const FUR = '#f08a3c';
const CREAM = '#fff4e2';

const SVG = `
<svg class="corgi" viewBox="0 0 220 200" role="img" aria-label="Коргі-барабанщик">
  <path class="body" d="M62 186 C58 140 76 118 110 118 C144 118 162 140 158 186 Z" fill="${FUR}" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
  <path d="M90 186 C88 156 98 134 110 134 C122 134 132 156 130 186 Z" fill="${CREAM}"/>

  <g class="head">
    <path d="M66 70 L50 12 Q48 4 56 8 L98 40 Z" fill="${FUR}" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
    <path d="M154 70 L170 12 Q172 4 164 8 L122 40 Z" fill="${FUR}" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
    <path d="M70 56 L60 22 L88 42 Z" fill="#ffb59a"/>
    <path d="M150 56 L160 22 L132 42 Z" fill="#ffb59a"/>
    <ellipse cx="110" cy="82" rx="56" ry="44" fill="${FUR}" stroke="${INK}" stroke-width="5"/>
    <path d="M110 46 C102 58 98 76 88 92 C80 104 90 122 110 122 C130 122 140 104 132 92 C122 76 118 58 110 46 Z" fill="${CREAM}"/>
    <ellipse cx="78" cy="100" rx="9" ry="5" fill="#ff8f7a" opacity=".55"/>
    <ellipse cx="142" cy="100" rx="9" ry="5" fill="#ff8f7a" opacity=".55"/>
    <g class="eyes-open">
      <ellipse cx="88" cy="80" rx="7" ry="8.5" fill="${INK}"/><circle cx="90.5" cy="77" r="2.6" fill="#fff"/>
      <ellipse cx="132" cy="80" rx="7" ry="8.5" fill="${INK}"/><circle cx="134.5" cy="77" r="2.6" fill="#fff"/>
    </g>
    <g class="eyes-happy" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round">
      <path d="M80 82 Q88 72 96 82"/><path d="M124 82 Q132 72 140 82"/>
    </g>
    <ellipse cx="110" cy="99" rx="8" ry="5.5" fill="${INK}"/>
    <path class="mouth" d="M100 108 Q105 114 110 108 Q115 114 120 108" fill="none" stroke="${INK}" stroke-width="3.5" stroke-linecap="round"/>
    <path class="mouth-open" d="M100 107 Q110 124 120 107 Z" fill="#e8332a" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>
  </g>

  <ellipse cx="110" cy="182" rx="84" ry="16" fill="#3a352e" stroke="${INK}" stroke-width="5"/>
  <ellipse cx="110" cy="172" rx="84" ry="16" fill="#e9e4d8" stroke="${INK}" stroke-width="5"/>
  <g stroke="#cfc6b4" stroke-width="1.5"><path d="M44 172 H176"/><path d="M58 164 H162"/><path d="M58 180 H162"/><path d="M90 158 V186"/><path d="M110 157 V187"/><path d="M130 158 V186"/></g>

  <g class="arm arm-l">
    <line x1="56" y1="150" x2="18" y2="106" stroke="#2fb3e6" stroke-width="8" stroke-linecap="round"/>
    <line x1="56" y1="150" x2="18" y2="106" stroke="${INK}" stroke-width="2" stroke-linecap="round" opacity=".35"/>
    <ellipse cx="60" cy="152" rx="15" ry="12" fill="${FUR}" stroke="${INK}" stroke-width="5"/>
    <path d="M50 158 q10 6 20 0" fill="none" stroke="${CREAM}" stroke-width="4" stroke-linecap="round"/>
  </g>
  <g class="arm arm-r">
    <line x1="164" y1="150" x2="202" y2="106" stroke="#ff5a36" stroke-width="8" stroke-linecap="round"/>
    <line x1="164" y1="150" x2="202" y2="106" stroke="${INK}" stroke-width="2" stroke-linecap="round" opacity=".35"/>
    <ellipse cx="160" cy="152" rx="15" ry="12" fill="${FUR}" stroke="${INK}" stroke-width="5"/>
    <path d="M150 158 q10 6 20 0" fill="none" stroke="${CREAM}" stroke-width="4" stroke-linecap="round"/>
  </g>
</svg>`;

// -> { beat(strong), hit(hand, accent), mood(name) }; mood: '' | 'happy' | 'cheer' | 'focus'
export function createCorgi(host) {
  host.innerHTML = SVG;
  const root = host.firstElementChild;
  const timers = {};
  const pulse = (cls, ms) => {
    root.classList.remove(cls);
    void root.getBoundingClientRect();   // restart the transition when the same class comes again
    root.classList.add(cls);
    clearTimeout(timers[cls]);
    timers[cls] = setTimeout(() => root.classList.remove(cls), ms);
  };
  return {
    beat(strong) { pulse('bob', strong ? 180 : 130); pulse('wag', 220); },
    hit(hand, accent) { pulse(hand === 'R' ? 'hit-r' : 'hit-l', accent ? 170 : 120); if (accent) pulse('big', 170); },
    mood(name = '') { root.dataset.mood = name; },
  };
}
