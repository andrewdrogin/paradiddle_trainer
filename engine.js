// Audio engine for the trainer: mic + onset detector, phrase sounds (recorded pad or synthesized
// snare), metronome click. The detector test page (test.html / app.js) has its own copy of the mic
// plumbing with extra diagnostics.

import { listSamples } from './db.js';
import { renderSnareKit } from './snare.js';

const SETTINGS_KEY = 'pt.settings';  // shared with the test page: mic, sensitivity, sound
const LATENCY_KEY = 'pt.latency';

export const settings = { sensDb: 18, guardMs: 60, deviceId: '', kit: 'pad' };
try { Object.assign(settings, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); } catch {}
export const saveSettings = () => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {} };

// in + out latency measured on the test page; used only to line clicks up with the player's hits
export function latencySec() {
  try { return (JSON.parse(localStorage.getItem(LATENCY_KEY))?.offsetMs || 0) / 1000; } catch { return 0; }
}

export let ctx = null;
let stream = null, source = null, node = null, wakeLock = null;

export async function ensureCtx() {
  if (!ctx) {
    ctx = new AudioContext({ latencyHint: 'interactive' });
    // bump together with app.js when onset-worklet.js changes
    await ctx.audioWorklet.addModule('onset-worklet.js?v=5');
  }
  if (ctx.state !== 'running') await ctx.resume();
  return ctx;
}

export const listening = () => !!node;

// onHit({ time, db }) — time is on the ctx clock (input side); onLevel(db) — live input peak, ~100/s
export async function startMic(onHit, onLevel) {
  await ensureCtx();
  node = new AudioWorkletNode(ctx, 'onset', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    processorOptions: { sensDb: settings.sensDb, guardMs: settings.guardMs },
  });
  node.port.onmessage = e => {
    if (e.data.type === 'hit') onHit({ time: e.data.time, db: e.data.db });
    else if (e.data.type === 'level') onLevel?.(e.data.db);
  };
  const sink = ctx.createGain();
  sink.gain.value = 0;
  node.connect(sink).connect(ctx.destination);
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: settings.deviceId ? { exact: settings.deviceId } : undefined,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
    });
  } catch (e) {
    stopMic();
    throw e;
  }
  source = ctx.createMediaStreamSource(stream);
  source.connect(node);
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch {}
  return stream.getAudioTracks()[0]?.label || 'мікрофон';
}

// detection threshold above the noise floor, dB: lower = more sensitive
export function setSensitivity(sensDb) {
  settings.sensDb = sensDb;
  saveSettings();
  node?.port.postMessage({ sensDb });
}

export function stopMic() {
  stream?.getTracks().forEach(t => t.stop());
  source?.disconnect();
  node?.disconnect();
  stream = source = node = null;
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}

// ---------- sounds ----------

const buffers = new Map();   // take id -> AudioBuffer
let snareKit = null;

// -> { name, soft: [take], accent: [take], gain } or null when the pad has no recordings yet
export async function loadKit() {
  await ensureCtx();
  let takes;
  if (settings.kit === 'snare') {
    snareKit ??= await renderSnareKit(ctx.sampleRate);
    takes = snareKit;
  } else {
    takes = await listSamples();
  }
  const soft = takes.filter(s => s.kind === 'soft');
  const accent = takes.filter(s => s.kind === 'accent');
  if (!soft.length || !accent.length) return null;
  // one gain per kit so soft/accent keep their real loudness ratio
  const gain = Math.min(0.8 / Math.max(1e-4, ...takes.map(s => s.peak)), 100);
  return { soft, accent, gain };
}

const lastPicked = new Map();   // kind -> take id
function pick(pool) {
  const choices = pool.length > 1 ? pool.filter(s => s.id !== lastPicked.get(pool[0].kind)) : pool;
  const s = choices[Math.floor(Math.random() * choices.length)];
  lastPicked.set(s.kind, s.id);
  return s;
}

// one note of the kit at time t; level scales around the take's own loudness (1 = as recorded)
export function playNote(kit, accent, t, level = 1) {
  const s = pick(accent ? kit.accent : kit.soft);
  let buf = buffers.get(s.id);
  if (!buf) {
    buf = ctx.createBuffer(1, s.data.length, s.sampleRate);
    buf.copyToChannel(s.data, 0);
    buffers.set(s.id, buf);
  }
  const src = ctx.createBufferSource();
  const g = ctx.createGain();
  src.buffer = buf;
  g.gain.value = kit.gain * level;
  src.connect(g).connect(ctx.destination);
  src.start(t);
}

// metronome tick, a clear woodblock-like knock that cuts through the pad, higher and louder on "1";
// volume 0..1. -> the oscillator (to cancel it with .stop()), or null when muted
export function click(t, volume, strong = false) {
  if (volume <= 0) return null;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'triangle';
  o.frequency.setValueAtTime(strong ? 1900 : 1300, t);
  o.frequency.exponentialRampToValueAtTime(strong ? 1500 : 1000, t + 0.05);
  const peak = (strong ? 0.7 : 0.5) * volume;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + 0.001);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + 0.08);
  return o;
}
