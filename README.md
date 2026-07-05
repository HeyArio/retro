# MUNICITRON M-58

A 1958 municipal simulation console by Nazarban Instrument Works.
Static frontend — no build step, no dependencies. Vanilla JS + Canvas 2D.

## Files

- `index.html` — page markup (console + postcard overlay)
- `css/styles.css` — all styling (palette tokens in `:root`)
- `js/city.js` — the living city: seeded generation, growth, weather,
  time of day, calendar, ambient life, bulletin wire
- `js/municitron.js` — console logic (knobs, lever, gauge, transmit, coin,
  machine personality)
- `js/postcard.js` — composes and downloads the postcard PNG
- `js/certificate.js` — composes and downloads the certificate of incorporation
- `js/sound.js` — optional valve audio (muted by default; POWER lamp toggles)

## Run

Open `index.html` in any browser, or serve the folder:

    npx serve .

Every visitor gets a seeded city; `?seed=N` reproduces one exactly, and
the address bar always holds a shareable link to the current scene.

## Controls

- **WEATHER** knob — CLEAR / RAIN / SNOW / AURORA (the needle can't hold
  steady in rain; a change startles the rooftop flocks)
- **TIME OF DAY** dial — sky palettes, sun/moon, stars, window schedules
- **GROWTH** lever — DORMANT / STEADY / BOOM; tower cranes raise the city,
  wrecking balls densify it
- **POPULATION** gauge — rolling census odometer; once the count clears
  10,000, clicking the gauge issues a downloadable CERTIFICATE OF
  INCORPORATION with the city's seeded Latin motto
- **TRANSMIT POSTCARD** — downloads the postcard PNG; special skies earn
  overprints (NIGHT AIRMAIL, WINTER CARNIVAL EDITION, AURORA SPECIAL)
- **Coin slot** — opens the tip jar; the first coin funds the town's
  streetlamps, every coin after gets a fireworks salute
- **POWER lamp** — click to toggle the valve audio unit

## Civic life

A sixteen-second civic month drives the seasons: December strings lights
between rooftops, October turns the windows orange, spring blossoms the
park, July throws the Founders' Day fireworks. The bulletin wire carries
Mayor Wembly's campaigns, the Grebbsville rivalry and the courthouse
clock saga. Birds commute at dawn and dusk, a balloon regatta drifts
through on rare occasions, rain ends in a poster rainbow — and once in a
long while an object officials decline to comment on crosses the
northern district. Civic firsts are entered in a municipal ledger
(localStorage) and returning commissioners are welcomed back.

For technicians: typing `NAZARBAN` summons the factory test pattern, and
a certain knob ritual (RAIN, SNOW, RAIN, AURORA) summons something else.
