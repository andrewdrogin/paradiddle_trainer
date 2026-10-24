// Synthesized snare kit: a low-tuned, warm, fat snare with soft (ghost) and accented takes.
// Rendered offline once; every take varies a little so repeated notes don't sound identical.

const TAKES = 5;           // takes per kind
const LENGTH = 1.0;        // seconds per take
const TUNE_HZ = 180;       // fundamental of the head: low tuning, lots of body
const MODES = [            // drum-head partials (ratio to the fundamental, level, decay scale)
  [1, 1, 1],
  [1.59, 0.55, 0.8],
  [2.14, 0.3, 0.6],
];

const rand = (a, b) => a + Math.random() * (b - a);

function noiseBuffer(ac, seconds) {
  const buf = ac.createBuffer(1, Math.round(seconds * ac.sampleRate), ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

// small dark room: decaying, low-passed noise
function roomImpulse(ac) {
  const sr = ac.sampleRate;
  const buf = ac.createBuffer(1, Math.round(0.5 * sr), sr);
  const d = buf.getChannelData(0);
  let lp = 0;
  for (let i = 0; i < d.length; i++) {
    lp += ((Math.random() * 2 - 1) - lp) * 0.25;
    d[i] = lp * Math.exp(-i / (0.11 * sr));
  }
  return buf;
}

function decayEnv(param, t0, peak, attack, tau) {
  param.setValueAtTime(0, t0);
  param.linearRampToValueAtTime(peak, t0 + attack);
  param.setTargetAtTime(0, t0 + attack, tau);
}

async function renderTake(sampleRate, accent) {
  const ac = new OfflineAudioContext(1, Math.round(LENGTH * sampleRate), sampleRate);
  const t0 = 0.002;
  const tune = TUNE_HZ * rand(0.985, 1.015);
  const decay = rand(0.9, 1.1);

  // warmth: gentle tape-like saturation, harder on accents
  const drive = accent ? 1.8 : 1.1;
  const shaper = ac.createWaveShaper();
  const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * drive) / Math.tanh(drive);
  }
  shaper.curve = curve;

  const dry = ac.createGain();
  const room = ac.createConvolver();
  room.buffer = roomImpulse(ac);
  const wet = ac.createGain();
  wet.gain.value = 0.16;
  dry.connect(shaper);
  dry.connect(room).connect(wet).connect(shaper);
  shaper.connect(ac.destination);

  // head: a few partials with a quick pitch drop at the strike
  for (const [ratio, level, decayScale] of MODES) {
    const osc = ac.createOscillator();
    osc.type = ratio === 1 ? 'triangle' : 'sine';
    const f = tune * ratio;
    osc.frequency.setValueAtTime(f * (accent ? 1.22 : 1.1), t0);
    osc.frequency.exponentialRampToValueAtTime(f, t0 + 0.03);
    const g = ac.createGain();
    decayEnv(g.gain, t0, level * (accent ? 0.9 : 0.55), 0.0015, (accent ? 0.075 : 0.05) * decayScale * decay);
    osc.connect(g).connect(dry);
    osc.start(t0);
    osc.stop(LENGTH);
  }

  // snare wires: band-limited noise, darker and relatively louder on ghost notes
  const wires = ac.createBufferSource();
  wires.buffer = noiseBuffer(ac, LENGTH);
  const hp = ac.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 800;
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = accent ? 6500 : 4200;
  const body = ac.createBiquadFilter();
  body.type = 'peaking';
  body.frequency.value = 2600;
  body.gain.value = 3;
  const wg = ac.createGain();
  decayEnv(wg.gain, t0 + 0.002, accent ? 0.55 : 0.5, 0.003, (accent ? 0.11 : 0.07) * decay);
  wires.connect(hp).connect(lp).connect(body).connect(wg).connect(dry);
  wires.start(t0);

  // stick: short bright tick; on accents a fat rim-and-head crack
  const tick = ac.createBufferSource();
  tick.buffer = noiseBuffer(ac, 0.02);
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = accent ? 1800 : 3000;
  bp.Q.value = 0.9;
  const tg = ac.createGain();
  decayEnv(tg.gain, t0, accent ? 0.9 : 0.25, 0.0005, 0.004);
  tick.connect(bp).connect(tg).connect(dry);
  tick.start(t0);
  if (accent) {
    const crack = ac.createOscillator();
    crack.frequency.value = 520 * rand(0.97, 1.03);
    const cg = ac.createGain();
    decayEnv(cg.gain, t0, 0.35, 0.001, 0.012);
    crack.connect(cg).connect(dry);
    crack.start(t0);
    crack.stop(t0 + 0.1);
  }

  const level = (accent ? 1 : 0.17) * 10 ** (rand(-1, 1) / 20);
  const out = (await ac.startRendering()).getChannelData(0);
  let peak = 0;
  for (let i = 0; i < out.length; i++) { out[i] *= level; peak = Math.max(peak, Math.abs(out[i])); }
  return { data: out, peak };
}

// -> [{ id, kind: 'soft' | 'accent', sampleRate, data, peak }], same shape as recorded pad samples
export async function renderSnareKit(sampleRate) {
  const kit = [];
  for (const kind of ['soft', 'accent']) {
    for (let i = 0; i < TAKES; i++) {
      const { data, peak } = await renderTake(sampleRate, kind === 'accent');
      kit.push({ id: `snare-${kind}-${i}`, kind, sampleRate, data, peak });
    }
  }
  return kit;
}
