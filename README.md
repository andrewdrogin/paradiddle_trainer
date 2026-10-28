# Paradiddle trainer

Personal rudiment trainer in "echo" style (phone plays a sticking phrase, you repeat it on a practice pad, the mic checks timing and accents).

**Echo trainer** (`index.html`, `trainer.js`): the app plays a phrase, waits patiently for you, you echo it on the pad, every note gets a mark.

Look: a rhythm-action comic in the spirit of Hi-Fi Rush / Persona / Patapon (`trainer.css`): cream paper, black ink, thick outlines, slanted plates, Dela Gothic One + Manrope. A corgi drummer partner (`corgi.js`, placeholder art) plays the phrase stick by stick in mirror view, nods on the beat and reacts to the result. Screens: Today (lesson + start + mini), Play, My way, Settings. Every take gets a style rank D–S (`rankOf` in `course.js`: timing 60 %, accents 25 %, hands 15 %; not clean → at most C) with its three bars; hits pop comic words (ТУК! / БАХ! / тук) judged on your own pulse; the whole play screen bumps on the beat; clean takes in a row count as a combo.

- Like a patient teacher, not a game: mastery over sessions instead of "passed", a learner profile from every note, a plan that follows it, honest words after every session
- Sessions: short (~10 min, default), full (~20) or mini (~4 min, warm-up + what slipped): sound check once a day → warm-up (mandatory, judged softly) → review (slipped lessons first, then settling, then the most faded mastered ones) → the current lesson until a goal → an easy final phrase → teacher's summary (what's good, what to watch next) → "5 more minutes?"
- Answers with the pad, hands stay on it: 1 tap / 2 taps (buttons as a fallback) — "5 more minutes?", "hands not in form today?", "tired, finish on an easy phrase?"
- Reading the day (`profile.js`): a warm-up clearly below your usual → offers calm concentration exercises (50 BPM singles, one hand with long pauses, quiet and even, a 3-note echo); quality sliding mid-session → offers to stop on a good note; an off day weighs little in the profile and doesn't move mastery
- Mastery (`course.js`): a lesson is learning → settling (a good session at its target tempo; the next lesson opens, this one keeps coming back) → mastered (good again on another day) → its form fades when not played; slipping when form or ranks drop; a slipped lesson the current one stands on comes back first. A full lesson report when one is mastered
- Learner profile (`profile.js`): per-hand timing and rush/drag, doubles, accent contrast, quiet-note evenness, left/right balance, steadiness, the tempo where it falls apart
- My way (`path.js`, `skills.js`): a cloud of skill tags per stage (новачок, аматор, впевнений); colour = mastery, size = relevance now; earlier clouds green and small, the next one a pale silhouette that fades in; tap a tag for the teacher's note and "work on this" (a short session on that skill, with feedback focused on it). The lesson route stays underneath
- In "new": every 3rd lesson phrase led by the other hand, a settling or known phrase after every 3 lesson phrases, a lesson stuck for 8 attempts is parked for 2 known phrases
- After a miss the result stays with a note-by-note explanation until a pad tap or "Далі"
- Phrase as dots: right hand on top, left below, accents big, a row of drum notation underneath (beams, accents, triplet 3); timing judged from your own first hit, so latency doesn't count
- 16 lessons (`course.js`): beginner — right, left, change, singles, accent/tap, accented singles, doubles, paradiddle, accented paradiddle; amateur — three paradiddle inversions, double paradiddle and paradiddle-diddle (triplets), paradiddle in sixteenths 60→100, accent anywhere. Tempo rises by itself after 3 clean of 5
- Help ladder when a phrase doesn't come out: again → a tempo step slower → the trouble spot alone in a loop → whole phrase slow → back in tempo; nothing moves on by itself
- Short sound check at the start (silence, soft hits, accents): sensitivity adapts, Gain advice
- Visuals: the screen frame pulses on every beat (re-syncs to your first hit), each hit pops on its note, per-note loudness bars, hands in their own colour with a letter, clean streak
- Settings: sound (recorded pad or synthesized snare), judging (soft/normal/strict), mic sensitivity, metronome volume, beat frame, left hand on top, plus an on-demand "how you played" button (accent = above half of your own soft→accent gap from the sound check)
- Progress and profile in localStorage

**Detector test page** (`test.html`, `app.js`): live level and detected hits, sensitivity, latency calibration, pad sample recording (IndexedDB).

Shared: `onset-worklet.js` (onset detector on the stick click, 2 kHz high-pass, masking of the ring-out), `engine.js` (mic, sounds, click), `snare.js` (synthesized snare), `db.js`.

Plain HTML/CSS/JS, no build step. Served by GitHub Pages from `main`.
Open with `?demo` to run without a microphone (test page: synthetic hits; trainer: a simulated player; `?demo=struggle` walks the help ladder; `?demo=offform` reads the warm-up as a bad day).

Local run: `python -m http.server 8765` and open http://localhost:8765/ (mic needs localhost or HTTPS).
