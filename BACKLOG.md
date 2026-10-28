# Backlog

What's agreed but not built yet.

## The idea behind all of it

Practising with the trainer should feel like lessons with a great, patient teacher who sees you and mentors you towards mastery. Every feature is checked against this.

- **Sees you**: strong and weak sides from every stroke, your pace of learning, your state today.
- **Talks to you**: feedback on the stroke, after each phrase, after the session, after the lesson — what worked and what to work on, in plain words, not just numbers.
- **Adjusts**: plan, exercises, tempo and amount follow you; weak spots get more attention, easy things don't hold you back.
- **Leads like a mentor**: knows where you're going (mastery, not "the end of the course") and says why each exercise matters.
- **Patient**: never rushes or scolds, never lets you move on before it's really good.
- **A good teacher, not Duolingo**: no streak pressure, no guilt ("you'll lose your flame!"), no XP, leagues or nagging notifications. It optimises for you learning, not for you opening the app: praise real progress («ліва нарешті вирівнялась»), pick up where you are after a gap without guilt, don't distract when you need to focus. In-session feedback (ranks, combo, ТУК!) is fine; habit-pressure mechanics aren't. The days-in-a-row counter is gone; the home screen shows a short note about last time (lesson, tempo, moving on, hand balance).

## Darcy, the partner

- The corgi is **Darcy** (she), after Andrew's real corgi. Copy: «Дарсі грає фразу», «Дарсі рада», «Дарсі пишається тобою».
- Redraw her from photos of the real Darcy (colouring, markings, ears). Small paws: a beginner drummer, like the player.
- Maybe: her look quietly reflects the player's level (barely reaching the pad → a headband → dark glasses and spinning sticks). Only as a mirror of where you are, never a reward to chase; drop it if it reads like a game.
- Replace the placeholder SVG in `corgi.js` with a proper illustration (same `createCorgi` API: `beat`, `hit`, `mood`).
- App icon from Darcy's head: browser tab favicon (now the default globe), plus PWA icons (manifest, 192/512) and apple-touch-icon for the home screen.

## USB-MIDI pad (ESP32-S3-Zero)

- Cork pad: 3× cork trivet Ø18 cm × ~1 cm (+1 spare), mat on top, foam below; piezo 27 mm under cork 1, 3–4 cm off centre.
- One channel per piezo (see the schematic discussed): bias 100k/100k + 1 µF to ~1.65 V, piezo ∥ 1 MΩ, 10 kΩ series, Schottky clamps (BAT85 / 1N5819) to 3V3 and GND, 1 nF on the input. Channels on GPIO1/2/3 (ADC1).
- One ESP inside the pad, one USB-C cable to the phone/PC; more piezos (cymbal, kick) wire into the same board.
- Firmware: native USB as a USB-MIDI device (TinyUSB), continuous ADC ~20 kHz, threshold, retrigger guard, velocity from the peak.
- Rim: a hard plastic edge (U-profile for panel edges, or an ABS/acrylic strip) glued to cork 1. One piezo tells center from rim by the hit's sharpness; a learning mode (10 center + 10 rim hits) sets the boundary. Two MIDI notes: center, rim.
- Trainer: an input choice «Мікрофон / Пад (MIDI)» via Web MIDI (check Edge on Android; Chrome supports it).

## Trainer

Built: mastery over sessions, learner profile, reading the day, mini sessions, pad-tap answers, skill clouds with practice, teacher reports, notation row, amateur lessons (see README). Still open:

- **Tune on the real pad**: the thresholds were set by reasoning, not by playing — a good session (avg score 0.8), off form (warm-up 0.12 below usual), tiring (0.15 below the best stretch), form half-life (21 days), the scales behind each skill's colour. Adjust after a week or two of real sessions.
- **A mild dip**: quietly a tempo step down and simpler phrases for the rest of the session (now only the help ladder slows down, phrase by phrase).
- **Calm exercises without the ladder**: on a calm day a miss could just mean "again", no "slower / trouble spot".
- **Home note**: say more from the profile than "last time" plus one line of progress (e.g. what today's plan focuses on and why).
- Later, maybe: free play with Darcy and the metronome, no grading.
- Rim: two MIDI notes once the USB pad exists; a rim lesson then.
