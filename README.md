# MUNICITRON M-58

A 1958 municipal simulation console by Nazarban Instrument Works.
Static frontend — no build step, no dependencies.

## Files

- `index.html` — page markup (console + postcard overlay)
- `css/styles.css` — all styling (palette tokens in `:root`)
- `js/municitron.js` — console logic (knobs, lever, gauge, transmit, coin)

## Run

Open `index.html` in any browser, or serve the folder:

    npx serve .

## Controls

- **WEATHER** knob — click to cycle CLEAR / RAIN / SNOW / AURORA
- **TIME OF DAY** dial — click to advance (sun/moon window)
- **GROWTH** lever — click DORMANT / STEADY / BOOM; drives the population ticker
- **POPULATION** gauge — rolling odometer + needle, updates live
- **TRANSMIT POSTCARD** — outputs the postcard overlay (city name is editable, ESC to close)
- **Coin slot** — click to blink the acknowledgment lamp

The simulation viewport (top two-thirds) is an empty `<canvas id="sim-canvas">`,
ready for the live simulation to be wired in.
"# retro" 
