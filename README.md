# MUNICITRON M-58

A 1958 municipal simulation console by Nazarban Instrument Works.
Static frontend — no build step, no dependencies. Vanilla JS + Canvas 2D.

Nazarban Instrument Works survives to this day: it builds thinking
machines now, as [Nazarban AI](https://nazarbanai.com). The nameplate
on the console footer, the fine print on every transmitted postcard,
and the WORKS TODAY line in the maintenance hatch all point home.

## Nazarban through the ages

The **ERA** dial (top-left of the sim) is the spine of the whole toy: the
M-58 renders the same kind of city across ages — 1858 steam, 1928 gilt,
1958 atomic, **1984 cassette**, 1999 wired, **2026 thinking (the present
day — the age Nazarban AI actually lives in)**, **2050 orbital**, 2077
green, 2140 woven — and each age
carries who Nazarban was
then and how its thinking machine helped the city (brief → install →
result). Every one resolves to the same live wire: Nazarban AI today, an
AI consultation & implementation firm. Open the maintenance **HATCH** for
the full dossier and the call to action, or read the age stamped into the
fine print of any transmitted postcard.

Every city also carries the **Nazarban House** — the firm's own
headquarters, a permanent tower placed deterministically in the skyline
(present from the first frame, never redeveloped). It wears the same
atomic-starburst crest and a lit `NAZARBAN` nameplate in every age, both
taking the current era's palette, with an electron orbiting the mark —
the thinking machine at work. Because it lives on the canvas, it rides
along in every transmitted postcard. The House stays behind glass (no
click); its story is told by the hatch dossier. See `drawNazarbanCrest`
and the designation block in `js/city.js`. The story lives in `ERAS`
(`js/city.js`), keyed to the render themes; deep-link any age with
`?style=cyberpunk`. Five further ages (dieselpunk, clockpunk, decopunk,
biopunk, nanopunk) ship in `ERAS`/`THEMES` for `?style=` use — each with
its own signature traffic (a prop plane, an ornithopter and montgolfier,
a courier moth, a nano swarm, a horse-drawn trap). Turning the dial
retunes the set — static, one pass of the vertical hold, a flash — and
the valve audio changes voice with the age (piston thud for steam, data
chatter for the wired age, near-silence and key taps for the present).
The street furniture keeps to its own age — the pneumatic tube, saucer
taxi, jetpack commuters, mechanical man, milk round, drive-in and the
rest of the Googie wardrobe belong to 1958 (and its 1939 cousin), while
satellites only cross skies that have launched any — and each age owns
its night sky: a satellite train for the present, drawn constellations
for clockwork, the milky way over solarpunk, paper lanterns rising over
the woven age. 1984 lies under a warm smog bank with a traffic
helicopter and an evening airliner; 2050 anchors a space elevator at the
edge of town, climber inching up the ribbon, with a station crossing the
night overhead.

Larger skies keep their own calendar: August and December bring meteor
showers, every town has a named comet on a long civic orbit (COMET
⟨CITYNAME⟩, once a generation), the moon keeps phases with the months —
and once in a great while the moon crosses the sun, the streets go
uncanny-dark, the window lights come on, and the whole town stops to
watch. The town also handles its own small emergencies: a rooftop fire
brings the brigade out (bell, ladder truck, hose arc — rain does half
the work), and a grid fault drops every window at once before power
returns block by block — the Nazarban House, naturally, never blinks.
About a sixth of flat seeds are **river towns**: a canal crosses Main
Street under a stone bridge, a barge bobs at its mooring, lamps glint on
the water after dark — and in the iced months the river freezes and the
skaters come out.

## Files

- `index.html` — page markup (console + postcard overlay)
- `css/styles.css` — all styling (palette tokens in `:root`)
- `js/city.js` — the living city: seeded generation, growth, weather,
  time of day, calendar, ambient life, bulletin wire
- `js/municitron.js` — console logic (knobs, lever, gauge, transmit, coin,
  machine personality)
- `js/postcard.js` — composes and downloads the postcard PNG (and pastes
  a copy into the album)
- `js/album.js` — the postcard album: every transmitted card, newest
  first, a dozen kept (FORMS dial · ALBUM)
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

## The foreign service — commission a REAL town

`?town=marrakesh` (or type **VISIT** on the console and spell a name —
`springfield, illinois` disambiguates with a comma) patches the M-58
into the international survey wire: Open-Meteo's free geocoding and
forecast services, called straight from the browser — no API key, no
backend, still a static deploy, and everything degrades to the local
simulation if the wire is down.

What the survey decides (`js/hometown.js`):

- the town's **name is its seed** (FNV-1a hash), so every visitor to
  `?town=marrakesh` stands in the same city — and the share URL is just
  the town's name
- **elevation places it**: sea-level towns face the harbor, mountain
  towns climb the hillside, the rest keep the prairie (and may still
  luck into a river)
- the **real census figure calibrates the register**: density scales so
  the odometer climbs toward the town's actual population and settles
  there; landmark milestones keep their fraction of the journey (the
  register carries six drums — a metropolis past 999,999 waits outside)
- the town's **local sky drives the console**: time of day on arrival,
  live weather every 15 minutes, and a clear dark night above 60°
  latitude earns the aurora. Touch a dial yourself and that circuit
  goes manual — the commissioner outranks the survey bureau, and the
  wire says so politely.

First landing on a shared town link surveys, files the record
(localStorage) and retunes the set once — the same theatre as the
travel desk. The census record re-surveys itself weekly.

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
  PHOTO · RECORD · ALBUM) feeding a brass **PRINT** button. Almanac is Form
  CA-2; Day Log is Form DL-7, a ticker-tape PNG of everything the
  municipal wire carried; Wire Photo re-shoots the canvas as a duotone
  press photograph with scanlines, crop marks and a typeset caption;
  Record is the commissioner's Form CR-5; Album opens the postcard
  collection — every card this console has transmitted, era-stamped,
  click one to revisit the city that mailed it. Every printed form
  takes the current era's letterhead.
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
breathing zoom anchored at the ground line, pointer parallax in both
axes (the sky drifts least, the street the most), an idle wander when
the mouse is away, and a gentle push-in whenever a ceremony gives the
town something to watch. Poster clouds cross every sky and darken into
storm cells, chimney
smoke leans with the wind, a slow gust leans the rain and drifts the
snow, lightning cracks over full rain (with thunder on the valve
audio), wet streets reflect the lamps and doorways — raindrop rings
widening on the asphalt — and snow settles on every rooftop and the
monorail beam. The distant back row repaints into a cached sheet a few
times a second, so the busiest eras still idle smoothly. The NEWSREEL
camera opens every reel on an era-stamped title card with a
film-leader sweep.

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

For technicians: typing `VISIT` opens the foreign service desk (a real
town, by name, printed keystroke by keystroke on the wire), typing
`NAZARBAN` summons the factory test pattern,
typing `TELECAST` switches the whole scene to a KNAZ-TV evening
broadcast (scanlines, rolling bar, station bug), and a certain knob
ritual (RAIN, SNOW, RAIN, AURORA) summons something else.
