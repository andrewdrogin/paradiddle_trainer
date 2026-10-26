# Backlog

What's agreed but not built yet.

## The idea behind all of it

Practising with the trainer should feel like lessons with a great, patient teacher who sees you and mentors you towards mastery. Every feature is checked against this.

- **Sees you**: strong and weak sides from every stroke, your pace of learning, your state today.
- **Talks to you**: feedback on the stroke, after each phrase, after the session, after the lesson — what worked and what to work on, in plain words, not just numbers.
- **Adjusts**: plan, exercises, tempo and amount follow you; weak spots get more attention, easy things don't hold you back.
- **Leads like a mentor**: knows where you're going (mastery, not "the end of the course") and says why each exercise matters.
- **Patient**: never rushes or scolds, never lets you move on before it's really good.
- **A good teacher, not Duolingo**: no streak pressure, no guilt ("you'll lose your flame!"), no XP, leagues or nagging notifications. It optimises for you learning, not for you opening the app: praise real progress («ліва нарешті вирівнялась»), pick up where you are after a gap without guilt, don't distract when you need to focus. In-session feedback (ranks, combo, ТУК!) is fine; habit-pressure mechanics aren't. The days-in-a-row counter is gone; the home screen shows a short note about last time (lesson, tempo, moving on, hand balance). Make that note smarter once the profile exists («ліва нарешті вирівнялась»).

## Darcy, the partner

- The corgi is **Darcy** (she), after Andrew's real corgi. Copy: «Дарсі грає фразу», «Дарсі рада», «Дарсі пишається тобою».
- Redraw her from photos of the real Darcy (colouring, markings, ears). Small paws: a beginner drummer, like the player.
- Maybe: her look quietly reflects the player's level (barely reaching the pad → a headband → dark glasses and spinning sticks). Only as a mirror of where you are, never a reward to chase; drop it if it reads like a game.
- Replace the placeholder SVG in `corgi.js` with a proper illustration (same `createCorgi` API: `beat`, `hit`, `mood`).

## USB-MIDI pad (ESP32-S3-Zero)

- Cork pad: 3× cork trivet Ø18 cm × ~1 cm (+1 spare), mat on top, foam below; piezo 27 mm under cork 1, 3–4 cm off centre.
- One channel per piezo (see the schematic discussed): bias 100k/100k + 1 µF to ~1.65 V, piezo ∥ 1 MΩ, 10 kΩ series, Schottky clamps (BAT85 / 1N5819) to 3V3 and GND, 1 nF on the input. Channels on GPIO1/2/3 (ADC1).
- One ESP inside the pad, one USB-C cable to the phone/PC; more piezos (cymbal, kick) wire into the same board.
- Firmware: native USB as a USB-MIDI device (TinyUSB), continuous ADC ~20 kHz, threshold, retrigger guard, velocity from the peak.
- Rim: a hard plastic edge (U-profile for panel edges, or an ABS/acrylic strip) glued to cork 1. One piezo tells center from rim by the hit's sharpness; a learning mode (10 center + 10 rim hits) sets the boundary. Two MIDI notes: center, rim.
- Trainer: an input choice «Мікрофон / Пад (MIDI)» via Web MIDI (check Edge on Android; Chrome supports it).

## Trainer

- **Mastery, not "passed"** — a soft but persistent teacher: move on only when a lesson is really learned, go back when it slips. This is learning, not a game: no achievements, no "unlocked!", no collecting. Ranks, words and pulse are feedback on how it sounded, not rewards. Copy reads like a teacher: «Парадідл засвоєно. Далі: парадідл з акцентом».
  - A lesson is a skill, not a session: it takes as many 10-minute sessions as it needs, several a day is fine. Simple exercises, brought to clean.
  - Each lesson has a mastery meter 0–100 %, shown in «Мій шлях».
  - Mastered = at the lesson's target tempo, steadily A/S ranks, even hands (left ≥ ~85 % of right), clear accents — stable across several sessions with breaks between them, at least one of them on a different day (it settles overnight). Several sessions in one evening speed it up but don't replace the next-day check. Until then the lesson stays in «Нове».
  - Every passed lesson has a "form" that fades when it isn't played and is refreshed by review ranks. When the ranks drop (e.g. average below B) the lesson goes back to "needs review": it shows up more in warm-up and review, with an honest note («Одиночні трохи просіли, давай освіжимо»).
  - If a lesson the current one builds on slips (doubles under the paradiddle), bring it back first, then go on. Never punishing, never "failed".
- **Learner profile and individual plan** — students differ: what's easy for one is hard for another, and the plan follows the player, not a fixed track.
  - Keep accumulating from every note (hand, early/late, loudness) into a skills profile: per hand timing accuracy and rush/drag tendency; evenness of doubles; accent vs tap contrast; tempo stability inside a phrase; the tempo where it starts to fall apart; left/right balance. Mastery is computed from the same profile.
  - The plan adapts to it: a weak spot gets more targeted work (left late → more left-led warm-ups, mirror variants and left-hand review); rushing at higher tempi → longer at the current tempo; easy things → fewer repetitions and moving on sooner; hard things → smaller steps, more time, back to the basics underneath.
- **Everyone's pace is different**: mastery is judged by quality, never by time (3 sessions or 15 — both fine); tempo steps adapt (wider when it's easy, +2–4 BPM when it's hard); the amount of repetition adapts; no deadlines, no "normal pace", no comparison with others — reports compare you only with your own earlier sessions.
- **Sessions**: 10 minutes stays the default.
  - Stop on a good note when tired: if quality drops inside a session (ranks sliding A → C, a hand starting to lag), offer to finish on an easy phrase — tired practice trains the mistakes in.
  - A 3–5 minute mini-session for busy days: short warm-up + one or two of the exercises that slipped. Regular beats long.
  - Answer with the pad, hands stay on it: at the end «Ще 5 хвилин?» — 1 tap finish, 2 taps +5 minutes (wait ~1 s after the first tap for a second one, then confirm on screen). Same tap dialog for the fatigue offer. On-screen buttons stay as a fallback.
  - Later, maybe: free play with Darcy and the metronome, no grading.
- **Reading the player's state** — a teacher notices a bad day.
  - Signals, always against the player's own profile, never a norm: warm-up clearly worse than usual (off form from the start); quality sliding after a good start (fatigue); several takes in a row falling apart even after the help ladder (everything slips).
  - Responses by case: a mild dip → quietly a tempo step down and simpler phrases; off form from the start → offer «Схоже, сьогодні руки не в формі. 5 хвилин спокійних вправ на концентрацію і на цьому все?» — no new material that day, only easy consolidation; fatigue mid-session → finish on an easy phrase. Answered with pad taps (1 = yes, easier; 2 = no, keep going); the player always decides.
  - Concentration exercises: singles very slow (~50 BPM) listening only for an even sound in both hands; one hand, hit — long pause — hit; everything as quiet and even as possible; a short 2–3 note echo to feel the hits land.
  - A bad day must not wreck the profile or lessons' form: when the dip is general, not lesson-specific, those takes weigh little in mastery, so one tired evening doesn't push you back.
- **Report ("зріз")** like a teacher's notes: a short one after every session, a full one when a lesson is mastered — what's good, what's still weak, 2–3 concrete things to watch next, and how timing / hands / accents changed from the first session to the last.
- A notation row under the dots.
- Intermediate lessons: paradiddle inversions, double paradiddle, paradiddle-diddle (triplets), sixteenths 60→100, accent on any note.
