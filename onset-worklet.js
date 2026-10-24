// Onset (hit) detector running on the audio thread.
// Times are reported in AudioContext frames, so they share a clock with ctx.currentTime.

const RISE_RATIO = 1.6;      // envelope must jump ~4 dB over its decayed memory to count as a new hit
const PEAK_WINDOW = 0.02;    // seconds after onset used to measure hit loudness
const CAPTURE_PRE = 0.02;    // seconds of audio kept before onset when recording a sample
const CAPTURE_POST = 0.45;   // seconds kept after onset
const CAPTURE_ARM_DELAY = 0.4; // ignore onsets right after arming (the click/tap on the button itself)
const LEVEL_EVERY = 4;       // post a level reading every N render quanta (~10 ms)

const toDb = v => 20 * Math.log10(Math.max(v, 1e-6));

class OnsetProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options.processorOptions || {};
    this.sensDb = o.sensDb ?? 18;
    this.guardFrames = Math.round((o.guardMs ?? 60) / 1000 * sampleRate);
    this.minThr = 10 ** (-75 / 20);

    // one-pole high-pass (~120 Hz) to drop rumble and handling noise
    this.hpA = Math.exp(-2 * Math.PI * 120 / sampleRate);
    this.hpX = 0;
    this.hpY = 0;

    this.fast = 0;                                   // peak envelope, ~5 ms release
    this.ref = 0;                                    // decayed memory, ~20 ms release
    this.fastRel = Math.exp(-1 / (0.005 * sampleRate));
    this.refRel = Math.exp(-1 / (0.02 * sampleRate));
    this.floorDb = null;                             // adaptive noise floor (block RMS)
    this.floorRise = 6 * 128 / sampleRate;           // dB per block: floor creeps up at 6 dB/s

    this.warmupEnd = Math.round(0.3 * sampleRate);   // let the noise floor settle before detecting
    this.lastOnset = -Infinity;
    this.measure = null;

    // ring long enough for one capture at any sample rate (some devices run 96-192 kHz)
    let ringSize = 1024;
    while (ringSize < (CAPTURE_PRE + CAPTURE_POST + 0.05) * sampleRate) ringSize *= 2;
    this.ring = new Float32Array(ringSize);
    this.captureArmed = false;
    this.captureFrom = 0;
    this.capture = null;

    this.lvlPeak = 0;
    this.lvlBlocks = 0;

    this.port.onmessage = e => {
      const m = e.data;
      if (m.sensDb !== undefined) this.sensDb = m.sensDb;
      if (m.guardMs !== undefined) this.guardFrames = Math.round(m.guardMs / 1000 * sampleRate);
      if (m.capture !== undefined) {
        // stays armed for a whole series; disarming drops a capture in progress (the click that stopped it)
        this.captureArmed = m.capture;
        this.captureFrom = currentFrame + Math.round(CAPTURE_ARM_DELAY * sampleRate);
        if (!m.capture) this.capture = null;
      }
    };
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;

    const n = ch.length;
    const base = currentFrame;
    const floorDb = this.floorDb ?? -100;
    const thr = Math.max(10 ** ((floorDb + this.sensDb) / 20), this.minThr);
    const ringLen = this.ring.length;
    let sumSq = 0;

    for (let i = 0; i < n; i++) {
      const x = ch[i];
      const frame = base + i;
      this.ring[frame % ringLen] = x;

      const y = this.hpA * (this.hpY + x - this.hpX);
      this.hpX = x;
      this.hpY = y;
      const e = Math.abs(y);
      sumSq += y * y;
      if (Math.abs(x) > this.lvlPeak) this.lvlPeak = Math.abs(x);

      this.fast = e > this.fast ? e : this.fast * this.fastRel;

      if (!this.measure && frame > this.warmupEnd && this.fast > thr && this.fast > this.ref * RISE_RATIO &&
          frame - this.lastOnset > this.guardFrames) {
        this.lastOnset = frame;
        this.measure = { frame, peak: 0, end: frame + Math.round(PEAK_WINDOW * sampleRate) };
        if (this.captureArmed && !this.capture && frame >= this.captureFrom) {
          this.capture = {
            onset: frame,
            start: frame - Math.round(CAPTURE_PRE * sampleRate),
            end: frame + Math.round(CAPTURE_POST * sampleRate),
          };
        }
      }
      this.ref = Math.max(this.ref * this.refRel, this.fast);

      if (this.measure) {
        if (e > this.measure.peak) this.measure.peak = e;
        if (frame >= this.measure.end) {
          this.port.postMessage({ type: 'hit', time: this.measure.frame / sampleRate, db: toDb(this.measure.peak) });
          this.measure = null;
        }
      }

      if (this.capture && frame >= this.capture.end) {
        const c = this.capture;
        const out = new Float32Array(c.end - c.start);
        for (let k = 0; k < out.length; k++) out[k] = this.ring[(c.start + k) % ringLen];
        this.port.postMessage({ type: 'capture', data: out, onsetIndex: c.onset - c.start, sampleRate }, [out.buffer]);
        this.capture = null;
      }
    }

    const rmsDb = Math.max(toDb(Math.sqrt(sumSq / n)), -100);
    if (this.floorDb === null) this.floorDb = rmsDb;
    else if (rmsDb < this.floorDb) this.floorDb += (rmsDb - this.floorDb) * 0.2;
    else this.floorDb += Math.min(rmsDb - this.floorDb, this.floorRise);

    if (++this.lvlBlocks >= LEVEL_EVERY) {
      this.port.postMessage({
        type: 'level',
        time: (base + n) / sampleRate,
        db: toDb(this.lvlPeak),
        floorDb: this.floorDb,
        thrDb: toDb(thr),
      });
      this.lvlPeak = 0;
      this.lvlBlocks = 0;
    }
    return true;
  }
}

registerProcessor('onset', OnsetProcessor);
