# Backlog

What's agreed but not built yet.

## Darcy, the partner

- The corgi is **Darcy** (she), after Andrew's real corgi. Copy: «Дарсі грає фразу», «Дарсі рада», «Дарсі пишається тобою».
- Redraw her from photos of the real Darcy (colouring, markings, ears). Small paws: a beginner drummer, like the player.
- She grows with the player's level:
  - Початківець: barely reaches the pad with her paws;
  - Середній: a headband, like a real drummer;
  - Профі: dark glasses, sticks spinning in her paws.
- Replace the placeholder SVG in `corgi.js` with a proper illustration (same `createCorgi` API: `beat`, `hit`, `mood`).

## USB-MIDI pad (ESP32-S3-Zero)

- Cork pad: 3× cork trivet Ø18 cm × ~1 cm (+1 spare), mat on top, foam below; piezo 27 mm under cork 1, 3–4 cm off centre.
- One channel per piezo (see the schematic discussed): bias 100k/100k + 1 µF to ~1.65 V, piezo ∥ 1 MΩ, 10 kΩ series, Schottky clamps (BAT85 / 1N5819) to 3V3 and GND, 1 nF on the input. Channels on GPIO1/2/3 (ADC1).
- One ESP inside the pad, one USB-C cable to the phone/PC; more piezos (cymbal, kick) wire into the same board.
- Firmware: native USB as a USB-MIDI device (TinyUSB), continuous ADC ~20 kHz, threshold, retrigger guard, velocity from the peak.
- Rim: a hard plastic edge (U-profile for panel edges, or an ABS/acrylic strip) glued to cork 1. One piezo tells center from rim by the hit's sharpness; a learning mode (10 center + 10 rim hits) sets the boundary. Two MIDI notes: center, rim.
- Trainer: an input choice «Мікрофон / Пад (MIDI)» via Web MIDI (check Edge on Android; Chrome supports it).

## Trainer

- A notation row under the dots.
- Review by Leitner boxes counted in sessions; a new lesson opens only after reaching the threshold in two different sessions.
- Intermediate lessons: paradiddle inversions, double paradiddle, paradiddle-diddle (triplets), sixteenths 60→100, accent on any note.
