# Paradiddle trainer

Personal rudiment trainer in "echo" style (phone plays a sticking phrase, you repeat it on a practice pad, the mic checks timing and accents).

**Echo trainer** (`index.html`, `trainer.js`): the app plays a phrase, waits patiently for you, you echo it on the pad, every note gets a mark.

- Session: sound check → warm-up (mandatory, judged softly, ends with left/right balance) → review of passed steps → the current new step
- Phrase as dots: right hand on top, left below, accents big; timing judged from your own first hit, so latency doesn't count
- Ladder of 9 steps (`course.js`): right, left, change, singles, accent/tap, accented singles, doubles, paradiddle, accented paradiddle; 60→96 BPM eighths, tempo rises by itself after 3 clean of 5
- Help ladder when a phrase doesn't come out: again → a tempo step slower → the trouble spot alone in a loop → whole phrase slow → back in tempo; nothing moves on by itself
- Short sound check at the start (silence, soft hits, accents): sensitivity adapts, Gain advice
- Visuals: the screen frame pulses on every beat (re-syncs to your first hit), each hit pops on its note, per-note loudness bars, hands in their own colour with a letter, clean streak
- Settings: sound (recorded pad or synthesized snare), judging (soft/normal/strict), mic sensitivity, metronome volume, beat frame, left hand on top, optional "how you played" replay
- Progress in localStorage

**Detector test page** (`test.html`, `app.js`): live level and detected hits, sensitivity, latency calibration, pad sample recording (IndexedDB).

Shared: `onset-worklet.js` (onset detector on the stick click, 2 kHz high-pass, masking of the ring-out), `engine.js` (mic, sounds, click), `snare.js` (synthesized snare), `db.js`.

Plain HTML/CSS/JS, no build step. Served by GitHub Pages from `main`.
Open with `?demo` to run without a microphone (test page: synthetic hits; trainer: a simulated player; `?demo=struggle` walks the help ladder).

Local run: `python -m http.server 8765` and open http://localhost:8765/ (mic needs localhost or HTTPS).
