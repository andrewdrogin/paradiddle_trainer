// Onset (hit) detector running on the audio thread.
// Times are reported in AudioContext frames, so they share a clock with ctx.currentTime.

const RISE_RATIO = 2.5;      // envelope must grow ~8 dB within RISE_WINDOW to count as a new hit
const RISE_WINDOW = 0.01;    // seconds: a stick attack gets there in 1-3 ms, voice or handling noise doesn't
const DETECT_HP_HZ = 2000;   // onsets are found on the stick "click" above this; the drum ring below it is ignored
const MASK_RATIO = 0.25;     // right after a hit a new one must reach 1/4 (-12 dB) of the decaying previous peak
const MASK_RELEASE = 0.08;   // seconds
const PEAK_WINDOW = 0.02;    // seconds after onset used to measure hit loudness
const CAPTURE_PRE = 0.02;    // seconds of audio kept before onset when recording a sample
const CAPTURE_POST = 1.6;    // seconds kept after onset: the mesh pad's low ring lasts ~1.5 s
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

    // one-pole high-pass (~120 Hz) to drop rumble and handling noise; hit loudness is measured on this
    this.hpA = Math.exp(-2 * Math.PI * 120 / sampleRate);
    this.hpX = 0;
    this.hpY = 0;
    // two more one-pole high-passes for detection: the stick click stays, the ring-out of the
    // previous hit mostly goes, so a tap right after an accent isn't buried in the accent's tail
    this.dA = Math.exp(-2 * Math.PI * DETECT_HP_HZ / sampleRate);
    this.d1X = 0; this.d1Y = 0;
    this.d2X = 0; this.d2Y = 0;
    this.mask = 0;
    this.maskRel = Math.exp(-1 / (MASK_RELEASE * sampleRate));

    this.fast = 0;                                   // peak envelope, ~5 ms release
    this.fastRel = Math.exp(-1 / (0.005 * sampleRate));
    // the envelope RISE_WINDOW ago; comparing against it (not against the envelope itself)
    // lets smooth real pad hits trigger, not only white-noise-like bursts
    this.fastHist = new Float32Array(Math.round(RISE_WINDOW * sampleRate));
    this.floorDb = null;                             // adaptive noise floor: block peak of the detection signal
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
    this.captures = [];        // in progress; they may overlap when hits come faster than CAPTURE_POST

    this.lvlPeak = 0;
    this.lvlBlocks = 0;

    this.port.onmessage = e => {
      const m = e.data;
      if (m.sensDb !== undefined) this.sensDb = m.sensDb;
      if (m.guardMs !== undefined) this.guardFrames = Math.round(m.guardMs / 1000 * sampleRate);
      if (m.capture !== undefined) {
        // stays armed for a whole series; disarming drops a capture in progress (the click that stopped it)
        this.captureArmed = m.capture;
        this.captureFrom = currentFrame + Math.round((m.armDelay ?? CAPTURE_ARM_DELAY) * sampleRate);
        if (!m.capture) this.captures = [];
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
    let blockPeak = 0;

    for (let i = 0; i < n; i++) {
      const x = ch[i];
      const frame = base + i;
      this.ring[frame % ringLen] = x;

      const y = this.hpA * (this.hpY + x - this.hpX);
      this.hpX = x;
      this.hpY = y;
      const e = Math.abs(y);
      if (Math.abs(x) > this.lvlPeak) this.lvlPeak = Math.abs(x);

      const d1 = this.dA * (this.d1Y + y - this.d1X);
      this.d1X = y; this.d1Y = d1;
      const d2 = this.dA * (this.d2Y + d1 - this.d2X);
      this.d2X = d1; this.d2Y = d2;
      const d = Math.abs(d2);
      if (d > blockPeak) blockPeak = d;

      this.fast = d > this.fast ? d : this.fast * this.fastRel;
      const hi = frame % this.fastHist.length;
      const past = this.fastHist[hi];
      this.fastHist[hi] = this.fast;
      const masked = this.mask * MASK_RATIO;
      this.mask = Math.max(this.mask * this.maskRel, this.fast);

      if (!this.measure && frame > this.warmupEnd && this.fast > thr && this.fast > masked &&
          this.fast > past * RISE_RATIO && frame - this.lastOnset > this.guardFrames) {
        this.lastOnset = frame;
        this.measure = { frame, peak: 0, end: frame + Math.round(PEAK_WINDOW * sampleRate) };
        // captures still recording end where this hit starts
        for (const c of this.captures) if (c.next === undefined) c.next = frame;
        if (this.captureArmed && frame >= this.captureFrom) {
          this.captures.push({
            onset: frame,
            start: frame - Math.round(CAPTURE_PRE * sampleRate),
            end: frame + Math.round(CAPTURE_POST * sampleRate),
          });
        }
      }

      if (this.measure) {
        if (e > this.measure.peak) this.measure.peak = e;
        if (frame >= this.measure.end) {
          this.port.postMessage({ type: 'hit', time: this.measure.frame / sampleRate, db: toDb(this.measure.peak) });
          this.measure = null;
        }
      }

      if (this.captures.length && frame >= this.captures[0].end) {
        const c = this.captures.shift();
        const out = new Float32Array(c.end - c.start);
        for (let k = 0; k < out.length; k++) out[k] = this.ring[(c.start + k) % ringLen];
        this.port.postMessage({
          type: 'capture', data: out, onsetIndex: c.onset - c.start,
          nextIndex: c.next === undefined ? -1 : c.next - c.start, sampleRate,
        }, [out.buffer]);
      }
    }

    const peakDb = Math.max(toDb(blockPeak), -100);
    if (this.floorDb === null) this.floorDb = peakDb;
    else if (peakDb < this.floorDb) this.floorDb += (peakDb - this.floorDb) * 0.2;
    else this.floorDb += Math.min(peakDb - this.floorDb, this.floorRise);

    if (++this.lvlBlocks >= LEVEL_EVERY) {
      this.port.postMessage({
        type: 'level',
        time: (base + n) / sampleRate,
        db: toDb(this.lvlPeak),
        floorDb: this.floorDb,
        thrDb: toDb(Math.max(thr, this.mask * MASK_RATIO)),
      });
      this.lvlPeak = 0;
      this.lvlBlocks = 0;
    }
    return true;
  }
}

registerProcessor('onset', OnsetProcessor);
