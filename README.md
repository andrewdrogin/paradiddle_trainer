# Paradiddle trainer

Personal rudiment trainer in "echo" style (phone plays a sticking phrase, you repeat it on a practice pad, the mic checks timing and accents).

**Echo trainer** (`index.html`, `trainer.js`): the app plays a phrase, waits patiently for you, you echo it on the pad, every note gets a mark.

Look: a rhythm-action comic in the spirit of Hi-Fi Rush / Persona / Patapon (`trainer.css`): cream paper, black ink, thick outlines, slanted plates, Dela Gothic One + Manrope. A corgi drummer partner (`corgi.js`, placeholder art) plays the phrase stick by stick in mirror view, nods on the beat and reacts to the result. Screens: Today (lesson + start), Play, My path, Settings.

- Session, short (~10 min, default) or full (~20): sound check once a day → warm-up (mandatory, judged softly, ends with left/right balance) → review of passed lessons → the current lesson until a goal (6/12 accepted phrases or 5/10 min) → an easy final phrase → summary with "more" / "finish"
- In "new": every 3rd lesson phrase led by the other hand, a known phrase after every 3 lesson phrases, a lesson stuck for 8 attempts is parked for 2 known phrases
- After a miss the result stays with a note-by-note explanation until a pad tap or "Далі"
- Lessons map: the 9 beginner lessons with tempo progress, then locked intermediate and pro lessons
- Phrase as dots: right hand on top, left below, accents big; timing judged from your own first hit, so latency doesn't count
- Ladder of 9 steps (`course.js`): right, left, change, singles, accent/tap, accented singles, doubles, paradiddle, accented paradiddle; 60→96 BPM eighths, tempo rises by itself after 3 clean of 5
- Help ladder when a phrase doesn't come out: again → a tempo step slower → the trouble spot alone in a loop → whole phrase slow → back in tempo; nothing moves on by itself
- Short sound check at the start (silence, soft hits, accents): sensitivity adapts, Gain advice
- Visuals: the screen frame pulses on every beat (re-syncs to your first hit), each hit pops on its note, per-note loudness bars, hands in their own colour with a letter, clean streak
- Settings: sound (recorded pad or synthesized snare), judging (soft/normal/strict), mic sensitivity, metronome volume, beat frame, left hand on top, plus an on-demand "how you played" button (accent = above half of your own soft→accent gap from the sound check)
- Progress in localStorage

**Detector test page** (`test.html`, `app.js`): live level and detected hits, sensitivity, latency calibration, pad sample recording (IndexedDB).

Shared: `onset-worklet.js` (onset detector on the stick click, 2 kHz high-pass, masking of the ring-out), `engine.js` (mic, sounds, click), `snare.js` (synthesized snare), `db.js`.

Plain HTML/CSS/JS, no build step. Served by GitHub Pages from `main`.
Open with `?demo` to run without a microphone (test page: synthetic hits; trainer: a simulated player; `?demo=struggle` walks the help ladder).

Local run: `python -m http.server 8765` and open http://localhost:8765/ (mic needs localhost or HTTPS).
