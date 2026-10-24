# Paradiddle trainer

Personal rudiment trainer in "echo" style (phone plays a sticking phrase, you repeat it on a practice pad, the mic checks timing and accents).

**Step 0 — hit-detector test page** (current): checks that the phone mic reliably detects hits on a quiet mesh pad.

- Live input level, scrolling envelope and detected hits
- Onset detection in an AudioWorklet (`onset-worklet.js`), sensitivity + re-trigger guard sliders
- Hit counter with "I played N" check, per-hit loudness bars with soft/accent split
- Latency calibration (8 clicks at 80 BPM, saved to localStorage)
- Pad sample recording (IndexedDB) and a test phrase (RLRR LRLL) played with the recorded samples

Plain HTML/CSS/JS, no build step. Served by GitHub Pages from `main`.
Open with `?demo` to feed synthetic hits instead of the microphone.

Local run: `python -m http.server 8765` and open http://localhost:8765/ (mic needs localhost or HTTPS).
