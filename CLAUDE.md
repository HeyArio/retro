# MUNICITRON — Municipal Simulation Unit, Model M-58

A free web toy: a 1958-styled control console (already built, do not
restyle it) driving a live procedural city on the canvas above it.
Fictional manufacturer: Nazarban Instrument Works, est. 1958.

## Hard rules
- Vanilla JS + Canvas 2D. No frameworks, no build step, no backend.
  Must deploy as static files.
- The console HTML/CSS is FINISHED. Never modify its visual design;
  only add JS hooks to existing elements.
- Canvas art direction must match the console: cream sky (#E8DCC0),
  teal-family buildings (#1E4744 range), brass (#C9A227) and burnt
  orange (#D96F32) accents only. Flat shapes, no gradients on
  buildings — mid-century poster style, not pixel art.
- Deterministic seeded RNG for city generation (each visitor gets a
  seed; same seed = same city).
- requestAnimationFrame loop; must idle smoothly at 60fps; respect
  prefers-reduced-motion (reduce animation, keep the city).
- Handle devicePixelRatio so the canvas is crisp on retina.

## Controls → simulation contract
- WEATHER knob: CLEAR / RAIN / SNOW / AURORA (visual particle +
  sky effects)
- TIME OF DAY: shifts sky palette + window lights
- GROWTH lever: DORMANT (paused) / STEADY / BOOM (build rate)
- CENSUS REGISTER: odometer animates as population grows
- TRANSMIT POSTCARD: composes current canvas into the postcard
  frame (offscreen canvas) and downloads a PNG:
  "GREETINGS FROM <cityname> — POP. <n> — TRANSMITTED VIA MUNICITRON"
- COIN SLOT: opens Ko-fi link (placeholder URL for now)