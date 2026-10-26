# Backlog

What's agreed but not built yet.

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
- A notation row under the dots.
- Intermediate lessons: paradiddle inversions, double paradiddle, paradiddle-diddle (triplets), sixteenths 60→100, accent on any note.
