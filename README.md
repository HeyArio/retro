# MUNICITRON M-58

A 1958 municipal simulation console by Nazarban Instrument Works.
Static frontend — no build step, no dependencies. Vanilla JS + Canvas 2D.

Nazarban Instrument Works survives to this day: it builds thinking
machines now, as [Nazarban AI](https://nazarbanai.com). The nameplate
on the console footer, the fine print on every transmitted postcard,
and the WORKS TODAY line in the maintenance hatch all point home.

## Files

- `index.html` — page markup (console + postcard overlay)
- `css/styles.css` — all styling (palette tokens in `:root`)
- `js/city.js` — the living city: seeded generation, growth, weather,
  time of day, calendar, ambient life, bulletin wire
- `js/municitron.js` — console logic (knobs, lever, gauge, transmit, coin,
  machine personality)
- `js/postcard.js` — composes and downloads the postcard PNG
- `js/certificate.js` — composes and downloads the certificate of incorporation
- `js/almanac.js` — composes and downloads the municipal almanac (Form CA-2)
- `js/record.js` — composes and downloads the commissioner's record (Form CR-5)
- `js/newsreel.js` — records a six-second WebM of the living canvas
- `js/sound.js` — optional valve audio: the machine at work — transformer
  hum, motor whir and tabulator clatter (muted by default; POWER lamp toggles)

## Run

Open `index.html` in any browser, or serve the folder:

    npx serve .

Every visitor gets a seeded city; `?seed=N` reproduces one exactly, and
the address bar always holds a shareable link to the current scene.

## Deploy

Static files only — any host works (GitHub Pages, Netlify, Cloudflare
Pages). Two things to do before going public:

1. Replace the placeholder Ko-fi URL in `js/municitron.js` (`KOFI_URL`)
   with your real page.
2. In `index.html`, make the `og:image` / `twitter:image` URLs absolute
   by prepending your domain (scrapers don't resolve relative paths).

Share assets live in `assets/`: `favicon.svg` (the atomic starburst),
`apple-touch-icon.png`, and `og-card.png` (1200×630, rendered from a
real evening city by the machine itself).

## Controls

The machine fills the browser window at any size: the sim viewport
absorbs the extra height (tall screens get more sky; short screens
scale the whole skyline down so no spire is ever cropped).

Everything below also works from the keyboard: **←/→** turn the TIME
dial, **↑/↓** work the GROWTH lever, **1–4** dial the WEATHER, **P**
transmits a postcard, **M** works the speaker switch. The GROWTH lever
also really slides — grab it and drag; it snaps to the nearest detent.

The city itself sits behind glass — look, don't touch. Everything
civic runs from the **AUXILIARY SERVICES** rail under the console,
and the rail is real 1958 hardware, not labelled keys:

- **FORMS desk** — a bakelite selector dial (ALMANAC · DAY LOG · WIRE
  PHOTO · RECORD) feeding a brass **PRINT** button. Almanac is Form
  CA-2; Day Log is Form DL-7, a ticker-tape PNG of everything the
  municipal wire carried; Wire Photo re-shoots the canvas as a duotone
  press photograph with scanlines, crop marks and a typeset caption;
  Record is the commissioner's Form CR-5.
- **Ceremony pushbuttons** — round momentary buttons for **CONCERT**,
  **PARADE**, **SALUTE**, **WHISTLE** (the fire station marks noon:
  folks stop mid-stride, a flock objects, every boiler lets off
  steam), and **NEWSREEL**.
- **Bat-handle switches** — **SPEAKER**, **TELECAST** (KNAZ-TV) and
  **ATTRACT** (the machine strolls through the day on its own); the
  handle throws up in orange when a circuit is live.
- **Travel desk** — a destination selector (NEW TOWN / SISTER CITY)
  and a guarded orange **DEPART** button that arms and asks "SURE?"
  before it leaves town, dial settings carried along.
- **Machine fittings** — a miniature **VOLUME** knob (LOW / STANDARD /
  FULL), the **civic-calendar window** (a dial too: click it to turn
  the month early, customs and all), and the **HATCH**, a tiny
  screwed-down plate that opens the field diagnostics: serial number,
  commission date, postcards transmitted, coins received, uptime this
  shift.

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
- **XMIT lamp / NEWSREEL key** — records a six-second newsreel (WebM
  download)
- **ALMANAC key** — issues the municipal almanac (Form CA-2): founding
  year, chief exports, disputed rainfall, and the sister city with a
  real `?seed=` address you can visit
- **POWER lamp** — click to toggle the valve audio unit. On, you hear
  the M-58 itself at work: a transformer hum, a motor whir and a
  tabulator's steady relay clatter computing the city, with the noon
  whistle and civic chimes ducking the clatter to ring out over it.
  Faint underneath runs the MUNICITRON BROADCAST SERVICE: occasional
  generative celesta phrases in a seasonal pentatonic mode

## Atmosphere

The scene is staged in parallax layers under a living camera: a slow
breathing zoom anchored at the ground line, pointer parallax (the sky
drifts least, the street the most) and an idle wander when the mouse is
away. Poster clouds cross every sky and darken into storm cells, chimney
smoke leans with the wind, lightning cracks over full rain (with thunder
on the valve audio), wet streets reflect the lamps and doorways, and
snow settles on every rooftop and the monorail beam.

## Terrain

Three kinds of town share the seed space. **Harbor towns** (about a
third of seeds) face the water: a bay with drifting waves, a pier and a
moored sloop, a striped lighthouse whose beam sweeps the night sky, and
a ferry with a horn on the valve audio — in the iced months the bay
freezes into pack ice and the ferry is suspended until the thaw.
**Hillside towns** (a share of the inland seeds) climb a lifted-teal
hill behind the back row, dotted with cottages whose windows keep their
own evening schedules, served by a counterbalanced funicular, and
crowned by a summit beacon. The rest are honest prairie flats. On
Founders' Day a parade — flag bearer, marching band, starburst float —
marches the length of Main Street in every one of them.

## Civic life

A sixteen-second civic month drives the seasons: December strings lights
between rooftops, October turns the windows orange, spring blossoms the
park, July throws the Founders' Day fireworks and puts pennants on the
tail-finned cars. Every town has a drive-in that screens an abstract
picture after dark — until 36,000 souls recommission the lot as the
permanent fairground and the Ferris wheel goes up. The park keeps a
bandstand, a fountain, a bench and lobed poster trees; vacant civic
plazas hold survey billboards until their landmark is commissioned.
Kites fly over the park in fair-weather
months, autumn strips the park trees leaf by leaf, and deep snow raises
a snowman by the bench. Citizens stroll Main Street — some in hats, one
or two walking Comet — somebody usually has the park bench, a fisherman
works the pier when the water is open, and the courthouse keeps its
clock stopped at 3:47 as it has been since 1949. The bulletin wire
carries
Mayor Wembly's campaigns, the Grebbsville rivalry and the courthouse
clock saga. Birds commute at dawn and dusk, a balloon regatta drifts
through on rare occasions, rain ends in a poster rainbow — and once in a
long while an object officials decline to comment on crosses the
northern district. Civic firsts are entered in a municipal ledger
(localStorage) and returning commissioners are welcomed back.

The town also asks favors (Form MR-1): every few minutes the wire may
petition you to operate the console — rain for the garden auxiliary,
darkness for the observatory, a moment of DORMANT for the quiet-hours
petition. Honoring one earns thanks in character; every third favor
orders a key to the city with a salute in the sky. Ignored requests
are withdrawn with no hard feelings. A milk truck makes its rounds at
first light (bottle clinks on the valve audio), citizens stop walking
to watch fireworks, the parade brings its own drum line, the broadcast
service switches to a minor key in winter and settles lower in autumn,
and every November Wembly defeats Wembly at the polls.

Your city also remembers you: growth persists per seed in localStorage,
so a returning commissioner finds the skyline where they left it —
while a shared `?seed=` link still starts young for new visitors. A
first-time visitor gets a short demonstration: the machine works its
own dials with captions on the wire, then hands the city over (any
touch cancels it). Now and then mail arrives from the sister city — a
little postcard of *their* skyline slides onto the glass, postmarked
with their transmission number. And typing `LEDGER` (or clicking the
census odometer) downloads the COMMISSIONER'S RECORD (Form CR-5):
commission date, inspections logged, cities governed, requests
honored, keys to the city, and your civic firsts with their dates.

For technicians: typing `NAZARBAN` summons the factory test pattern,
typing `TELECAST` switches the whole scene to a KNAZ-TV evening
broadcast (scanlines, rolling bar, station bug), and a certain knob
ritual (RAIN, SNOW, RAIN, AURORA) summons something else.
