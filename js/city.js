/* ==========================================================================
   MUNICITRON M-58 — city renderer
   Nazarban Instrument Works · Est. 1958

   Phase 1: canvas foundation — DPR-aware backing store, mulberry32 seeded
   RNG (?seed=N reproduces a city), rAF loop, flat poster-style skyline.

   Phase 2: growth simulation — the console's GROWTH lever sets the build
   rate; buildings rise from the ground line; population derives from the
   built city and is broadcast for the census register.

   Phase 3: time of day — the TIME dial shifts the sky palette, moves a
   sun/moon disc, fades stars in, and drives the window-light schedules.

   Phase 4: weather — RAIN (slanted streaks, overcast tint), SNOW (drifting
   flakes, pale tint, snow settles on the ground band), AURORA (waving
   ribbons; darkens the sky toward night at any hour so it always reads).
   Particles use a second seeded rng stream so the city stream — and
   therefore the city itself — is untouched by weather.

   Review pass: windows are ALWAYS flat brass dots (the approved poster
   look); "lit" adds a flat halo glow on top per the time schedules.
   Time-of-day blending rebuilt on eased per-time weights — same
   architecture as weather — so knob/dial spamming always blends smoothly.
   Population tuned to town scale and the register never fully settles.

   Content pass: visible construction (cranes, wrecking balls, dust), a
   civic calendar (seasons, string lights, Founders' Day fireworks), a
   municipal park, wildlife and visitors (birds, balloons, rainbow, the
   object), the town wire's storylines, benefactor streetlamps, the
   factory test pattern, and a localStorage municipal ledger.

   Console ↔ city contract (DOM CustomEvents on document):
   - listens  'municitron:growth'      detail {index, name}  0=DORMANT 1=STEADY 2=BOOM
   - listens  'municitron:time'        detail {index, name}  0=MIDNIGHT … 7=NIGHT
   - listens  'municitron:weather'     detail {index, name}  0=CLEAR 1=RAIN 2=SNOW 3=AURORA
   - listens  'municitron:coin'        (streetlamps, salute)
   - listens  'municitron:certificate' / 'municitron:certificate-denied'
   - listens  'municitron:testpattern' (typed code NAZARBAN)
   - listens  'municitron:ufo'         (also self-dispatched on its own timer)
   - emits    'municitron:population'  detail <int>
   - emits    'municitron:landmark'    detail {kind, title}
   - emits    'municitron:fireworks'   (a show is starting)
   ========================================================================== */

(function () {
  'use strict';

  /* ---------------- palette — must stay in step with css/styles.css ---- */

  /* WORLD OF TOMORROW — atomic-age Googie palette. Deep saturated teals,
     neon gold/coral window light, electric cyan signage, dramatic skies. */
  var TEALS      = ['#0F4F4B', '#166A61', '#0A3C39'];
  var TEAL_TRIM  = '#082B29';
  var BRASS      = '#FFC94A';                     // neon gold (windows / accents)
  var ORANGE     = '#FF6B3D';                     // hot atomic coral-tangerine
  var CREAM_HI   = '#FBF3DE';
  var NEON_CYAN  = '#3FE0D8';                     // electric turquoise signage
  var GLOW_BRASS = 'rgba(255, 201, 74, 0.55)';
  var GLOW_ORANGE = 'rgba(255, 107, 61, 0.55)';
  var GLOW_CYAN  = 'rgba(63, 224, 216, 0.5)';
  var NEON_PINK  = '#FF5A96';                     // hot magenta neon (Atom-City accent)
  var GLOW_PINK  = 'rgba(255, 90, 150, 0.5)';

  /* logical drawing space — everything renders in these coordinates and
     is mapped to the real backing store with a single setTransform.
     The WIDTH is fixed (the city plan lives in it); the HEIGHT adapts
     to the viewer's screen: tall screens get more sky, short screens
     crop the tallest spires. The ground line rides the bottom; sky
     furniture scales into whatever sky there is via SKY_K. */
  var VIEW_W = 1600;
  var VIEW_H = 600;
  var GROUND_Y = 552;
  var SKY_K = 1;                                  // GROUND_Y / 552

  document.addEventListener('municitron:viewport', function (e) {
    var h = e.detail && e.detail.h;
    if (!h || h === VIEW_H) return;
    VIEW_H = h;
    GROUND_Y = VIEW_H - 48;
    SKY_K = GROUND_Y / 552;
    if (typeof onViewportChange === 'function') onViewportChange();
  });

  /* ---------------- simulation tuning ---------------- */

  var INITIAL_BUILT   = 5;                  // buildings standing at power-on (front + back row)
  var BG_WEIGHT       = 0.3;                // back-row contribution to population
  var DENSIFY_PACE    = 1.6;                // spawn-interval multiplier for replacements
  var RAIL_Y          = 448;                // monorail beam height (kept 104 above ground)
  var TRAIN_LEN       = 170;
  var TRAIN_SPEED     = 230;                // logical px/s
  var LANDMARK_RISE   = 5;                  // s for a commissioned landmark to reveal
  var SPAWN_INTERVAL  = [Infinity, 5.0, 1.3]; // s between new builds, per lever
  var RISE_DURATION   = 2.6;                // s for a building to top out
  var DENSITY         = 0.06;               // town numbers, not metropolis numbers
  var AMBIENT_RATE    = [0, 2, 9];          // people/s — register never settles
  var POP_MAX         = 999999;             // census register is 6 drums
  var TIME_FADE       = 1.6;                // s to crossfade a time-of-day change
  var WEATHER_FADE    = 1.2;                // s to crossfade a weather change

  /* ---------------- time-of-day palettes ------------------------------- */
  /* Indices follow the console dial: MIDNIGHT, DAWN, MORNING, NOON,
     AFTERNOON, DUSK, EVENING, NIGHT. Skies are flat in-family tints:
     cream through burnt-orange cream into deep teal. `lit` is the
     fraction of window schedules glowing; `cel` follows the dial's
     glyphs (sun for dawn→afternoon, moon otherwise). */

  var TIMES = [
    { sky: '#0F1230', lit: 0.62, star: 1.0,  cel: { kind: 'moon', x: 430,  y: 170, r: 38, color: CREAM_HI } },
    { sky: '#F4995F', lit: 0.35, star: 0.05, cel: { kind: 'sun',  x: 300,  y: 400, r: 56, color: ORANGE   } },
    { sky: '#F0CBA0', lit: 0.45, star: 0.0,  cel: { kind: 'sun',  x: 460,  y: 210, r: 46, color: BRASS    } },
    { sky: '#F6DEC0', lit: 0.28, star: 0.0,  cel: { kind: 'sun',  x: 800,  y: 120, r: 46, color: BRASS    } },
    { sky: '#F2C592', lit: 0.40, star: 0.0,  cel: { kind: 'sun',  x: 1150, y: 210, r: 46, color: BRASS    } },
    { sky: '#6E3F66', lit: 0.75, star: 0.2,  cel: { kind: 'sun',  x: 1300, y: 400, r: 40, color: BRASS    } },
    { sky: '#3A2E6E', lit: 0.95, star: 0.6,  cel: { kind: 'moon', x: 1240, y: 210, r: 38, color: CREAM_HI } },
    { sky: '#141636', lit: 0.92, star: 1.0,  cel: { kind: 'moon', x: 800,  y: 140, r: 38, color: CREAM_HI } }
  ];

  /* ---------------- weather ------------------------------------------- */
  /* Indices follow the console knob: CLEAR, RAIN, SNOW, AURORA.
     `tint`/`amt` pull the current sky toward an in-family overcast,
     pale-snow, or deep-night color by that fraction at full intensity. */

  var WEATHERS = [
    { tint: null },
    { tint: '#2A4460', amt: 0.42 },
    { tint: '#DCE6EA', amt: 0.45 },
    { tint: '#0A1730', amt: 0.62 }
  ];

  /* ---------------- helpers ---------------- */

  function hexToRgb(hex) {
    var n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function mixRgb(a, b, t) {
    return [
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
      a[2] + (b[2] - a[2]) * t
    ];
  }

  function rgbStr(c) {
    return 'rgb(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ')';
  }

  function easeOutCubic(p) {
    var q = 1 - p;
    return 1 - q * q * q;
  }

  var i;
  for (i = 0; i < TIMES.length; i++) {
    TIMES[i].skyRgb = hexToRgb(TIMES[i].sky);
    TIMES[i].cel.rgb = hexToRgb(TIMES[i].cel.color);
  }
  for (i = 1; i < WEATHERS.length; i++) WEATHERS[i].tintRgb = hexToRgb(WEATHERS[i].tint);
  var TRIM_RGB = hexToRgb(TEAL_TRIM);
  var CREAM_RGB = hexToRgb('#E8DCC0');
  var CREAMHI_RGB = hexToRgb(CREAM_HI);
  var DEEP_RGB = hexToRgb('#0D211E');

  // back-row silhouettes: the console teals lifted toward cream — flat
  // constants that read as atmospheric distance on every sky
  var BG_TEALS = [];
  for (i = 0; i < TEALS.length; i++) {
    BG_TEALS.push(rgbStr(mixRgb(hexToRgb(TEALS[i]), CREAM_RGB, 0.32)));
  }

  /* ---------------- seeded rng ---------------- */

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ?seed=0 is a real seed; anything non-numeric falls back to random
  var params = new URLSearchParams(window.location.search);
  var seedRaw = params.get('seed');
  var seedNum = (seedRaw === null || seedRaw === '') ? NaN : Number(seedRaw);
  var seed = isFinite(seedNum) ? (seedNum >>> 0) : (Math.random() * 0x100000000) >>> 0;
  var rng = mulberry32(seed);

  /* ---------------- city plan (pure, from rng only) -------------------- */
  /* The full build-out is planned up front; the lever only controls how
     fast the plan is realized, so one seed always yields one city. The
     rng is never consumed at runtime. */

  function generatePlan() {
    var lots = [];
    var bg = [];
    var x = 0;
    var b, i;

    // window dots: an irregular subset of a facade grid exists (poster
    // look), drawn as brass dots at ALL times; each pane also gets a
    // baked schedule threshold — when the time's `lit` level exceeds
    // it, a flat halo glow switches on behind the dot. Pane y is stored
    // RELATIVE TO THE GROUND LINE so a resizing viewport can't strand
    // the windows off their buildings.
    function makeWindows(bx, bw, bh) {
      var panes = [];
      var colSpace = 20, rowSpace = 24, inset = 15;
      var cols = Math.max(2, Math.floor((bw - inset * 2) / colSpace));
      var rows = Math.max(2, Math.floor((bh - inset * 2 - 8) / rowSpace));
      var gridW = (cols - 1) * colSpace;
      var gridH = (rows - 1) * rowSpace;
      var x0 = bx + Math.round((bw - gridW) / 2);
      var y0 = -bh + inset + Math.round((bh - inset * 2 - gridH) / 2);
      for (var r = 0; r < rows; r++) {
        for (var c = 0; c < cols; c++) {
          if (rng() < 0.40) continue;             // no pane on this grid cell
          panes.push({
            x: x0 + c * colSpace,
            y: y0 + r * rowSpace,                 // offset from GROUND_Y (negative)
            threshold: rng(),
            accent: rng() < 0.05
          });
        }
      }
      return panes;
    }

    // ---- harbor towns: about a third of seeds face the water ----
    // one end of the street becomes a bay: quay, pier, lighthouse, and
    // a ferry — everything civic parcels itself onto the land side
    var harbor = null;
    if (rng() < 0.35) {
      harbor = { side: rng() < 0.5 ? 1 : -1 };    // 1 = water on the right
      harbor.shore = harbor.side === 1 ? 1140 + rng() * 140 : 320 + rng() * 140;
      harbor.lightX = harbor.side === 1 ? VIEW_W - 70 - rng() * 40 : 70 + rng() * 40;
    }
    var landL = harbor && harbor.side === -1 ? harbor.shore + 24 : 0;
    var landR = harbor && harbor.side === 1 ? harbor.shore - 24 : VIEW_W;
    var span = landR - landL;

    // ---- hillside towns: the inland alternative to a bay ----
    // a big lifted-teal hill climbs out of one end of the scene behind
    // the back row, dotted with cottages and served by a funicular
    var hill = null;
    if (!harbor && rng() < 0.4) {
      hill = {
        side: rng() < 0.5 ? -1 : 1,
        h: 170 + rng() * 90,
        w: 420 + rng() * 220,
        houses: []
      };
      var houseCount = 5 + Math.floor(rng() * 4);
      for (i = 0; i < houseCount; i++) {
        hill.houses.push({
          t: 0.22 + rng() * 0.66,                 // fraction up the slope
          w: 10 + rng() * 6,
          lit: rng()                              // window schedule threshold
        });
      }
    }

    // ---- landmark plazas, chosen before the street is parceled ----
    // three civic zones stay clear of front-row lots so commissioned
    // landmarks stand in the open instead of hiding behind towers; each
    // reserves only what its landmark actually needs at ground level
    var zones = [
      landL + span * (0.14 + rng() * 0.09),
      landL + span * (0.46 + rng() * 0.08),
      landL + span * (0.80 + rng() * 0.09)
    ];
    var ZONE_HALVES = [62, 76, 80];               // saucer / rocket / atom footprints
    for (i = zones.length - 1; i > 0; i--) {
      var zj = Math.floor(rng() * (i + 1));
      var zt = zones[i]; zones[i] = zones[zj]; zones[zj] = zt;
    }
    var PARK_HALF = 66;
    var DRIVEIN_HALF = 80;                        // the future fairground

    // ---- the municipal park: one green gap the street builds around ----
    var parkX = landL + span * (0.2 + rng() * 0.6);
    for (i = 0; i < 20; i++) {
      var pOK = true;
      for (var pz = 0; pz < zones.length; pz++) {
        if (Math.abs(parkX - zones[pz]) < ZONE_HALVES[pz] + PARK_HALF + 10) pOK = false;
      }
      if (pOK) break;
      parkX = landL + span * (0.2 + rng() * 0.6);
    }
    var park = { x: parkX, trees: [], shrubs: [] };
    var treeCount = 4 + Math.floor(rng() * 3);
    for (i = 0; i < treeCount; i++) {
      var tr = 9 + rng() * 7;
      var blossoms = [];
      for (var bl = 0; bl < 3; bl++) {
        blossoms.push([(rng() * 2 - 1) * tr * 0.6, -(rng() * tr * 0.6)]);
      }
      park.trees.push({
        x: parkX - 52 + i * (104 / (treeCount - 1)) + (rng() * 10 - 5),
        r: tr,
        blossoms: blossoms
      });
    }
    // the fountain takes one side of the bandstand, the bench the other
    var fountainSide = rng() < 0.5 ? -1 : 1;
    park.fountain = parkX + fountainSide * 48;
    park.bench = parkX - fountainSide * 44;
    for (i = 0; i < 3; i++) {
      park.shrubs.push({ x: parkX - 62 + rng() * 124, r: 4 + rng() * 3.5 });
    }

    // ---- the drive-in: every town has one; at 36,000 souls the lot is
    // recommissioned as the permanent fairground and the wheel goes up
    var driveIn = { x: landL + span * 0.5 };
    for (i = 0; i < 24; i++) {
      var dx = landL + span * (0.22 + rng() * 0.55);
      var dOK = Math.abs(dx - parkX) > PARK_HALF + DRIVEIN_HALF + 10;
      for (var dz = 0; dz < zones.length && dOK; dz++) {
        if (Math.abs(dx - zones[dz]) < ZONE_HALVES[dz] + DRIVEIN_HALF + 10) dOK = false;
      }
      if (dOK) { driveIn.x = dx; break; }
    }

    var obstacles = [];
    for (i = 0; i < zones.length; i++) obstacles.push({ x: zones[i], half: ZONE_HALVES[i] });
    obstacles.push({ x: parkX, half: PARK_HALF });
    obstacles.push({ x: driveIn.x, half: DRIVEIN_HALF });

    // ---- river towns: a canal crosses Main Street under a stone bridge.
    // Rivers draw on their own rng stream so every harbor and hill seed
    // keeps its exact skyline; the flat seeds that gain a river redevelop
    // once, deterministically, around the water.
    var rngR = mulberry32(seed ^ 0x63641362);
    var river = null;
    if (!harbor && !hill && rngR() < 0.5) {
      var RIVER_HALF = 46;
      for (i = 0; i < 24; i++) {
        var rvx = landL + span * (0.18 + rngR() * 0.64);
        var rOK = Math.abs(rvx - parkX) > PARK_HALF + RIVER_HALF + 12 &&
                  Math.abs(rvx - driveIn.x) > DRIVEIN_HALF + RIVER_HALF + 12;
        for (var rz = 0; rz < zones.length && rOK; rz++) {
          if (Math.abs(rvx - zones[rz]) < ZONE_HALVES[rz] + RIVER_HALF + 12) rOK = false;
        }
        if (rOK) { river = { x: rvx, half: RIVER_HALF }; break; }
      }
      if (river) obstacles.push({ x: river.x, half: river.half + 14 });
    }

    function clearOfPlazas(px, pw) {
      for (var z = 0; z < obstacles.length; z++) {
        if (px < obstacles[z].x + obstacles[z].half && px + pw > obstacles[z].x - obstacles[z].half) {
          px = obstacles[z].x + obstacles[z].half + 8;
          z = -1;                                 // recheck all zones from the new x
        }
      }
      return px;
    }

    // room from px to the nearest reservation ahead of it
    function gapAt(px) {
      var g = landR - 20 - px;
      for (var z = 0; z < obstacles.length; z++) {
        var start = obstacles[z].x - obstacles[z].half;
        if (start >= px && start - px < g) g = start - px;
      }
      return g;
    }

    // ---- front row ----
    x = landL + 30 + Math.floor(rng() * 40);
    while (true) {
      var w = 70 + Math.floor(rng() * 65);        // 70–134
      // if a full lot won't fit before the next civic reservation, put a
      // narrow shopfront in whatever room the gap actually has
      var pushed = clearOfPlazas(x, w);
      if (pushed !== x) {
        var avail = (clearOfPlazas(x, 1) === x) ? gapAt(x) - 6 : 0;
        if (avail >= 50) w = Math.floor(Math.min(avail, 54 + rng() * 18));
        else x = pushed;
      }
      if (x + w > landR - 20) break;
      b = {
        x: x,
        w: w,
        h: w < 70 ? 110 + Math.floor(rng() * 110) // narrow shopfronts stay low
                  : 150 + Math.floor(rng() * 250),
        color: TEALS[Math.floor(rng() * TEALS.length)],
        cap: rng() < 0.5,                         // darker parapet slab
        door: rng() < 0.3,                        // burnt-orange door accent
        canopy: rng() < 0.4,                      // cantilevered Googie entry
        accent: Math.floor(rng() * 3),            // crown/neon hue: 0 cyan · 1 pink · 2 orange
        roofOrange: rng() < 0.3,                  // burnt-orange swooping roof (a la the image)
        jitter: 0.6 + rng() * 0.8,                // spawn-interval variation
        litBias: (rng() - 0.5) * 0.12,            // lights up early or late at dusk
        chimney: rng() < 0.35 ? 0.2 + rng() * 0.6 : 0,   // stack position (0 = none)
        progress: 0,                              // 0 pending → 1 topped out
        rising: false,
        demolishing: false,
        windows: []
      };
      lots.push(b);
      x += w + 14 + Math.floor(rng() * 24);
    }

    // every front-row lot gets a Googie roofline of its own — narrow
    // shopfronts skip the dome/folded-plate forms that need the width
    for (i = 0; i < lots.length; i++) {
      lots[i].windows = makeWindows(lots[i].x, lots[i].w, lots[i].h);
      var roofSet = lots[i].w < 66 ? [0, 0, 1, 2, 3, 4, 6] : [0, 0, 1, 2, 3, 4, 5, 6, 7];
      lots[i].roof = roofSet[Math.floor(rng() * roofSet.length)];
    }

    // ---- back row: shorter, narrower, lifted-teal silhouettes ----
    x = landL;
    while (true) {
      var w2 = 55 + Math.floor(rng() * 60);       // 55–114
      if (x + w2 > landR - 20) break;
      if (river && x + w2 > river.x - river.half - 6 && x < river.x + river.half + 6) {
        x = river.x + river.half + 10;            // the back row parts for the water
        continue;
      }
      bg.push({
        x: x,
        w: w2,
        h: 90 + Math.floor(rng() * 150),          // 90–239, below the front row
        color: BG_TEALS[Math.floor(rng() * BG_TEALS.length)],
        cap: false,
        door: false,
        jitter: 0.6 + rng() * 0.8,
        progress: 0,
        rising: false,
        demolishing: false,
        windows: []
      });
      x += w2 + 8 + Math.floor(rng() * 18);
    }
    var shift = Math.round((landR - x + 8) / 2) + 20;
    for (i = 0; i < bg.length; i++) bg[i].x += shift;

    // ---- the courthouse: one mid-rise keeps the town's stopped clock,
    // and being historic it is never redeveloped ----
    for (i = 0; i < lots.length; i++) {
      b = lots[i];
      if (b.w >= 90 && b.h >= 170 && b.h <= 310) {
        b.clock = true;
        break;
      }
    }

    // ---- densification: the city's second act ----
    // every short front-row lot gets a planned taller replacement; once
    // construction exhausts, replacements demolish-and-rise in order
    for (i = 0; i < lots.length; i++) {
      b = lots[i];
      if (b.h >= 300 || b.w < 70 || b.clock) continue;   // shopfronts stay; so does history
      var nh = Math.min(430, b.h + 90 + Math.floor(rng() * 150));
      b.next = {
        h: nh,
        color: TEALS[Math.floor(rng() * TEALS.length)],
        cap: rng() < 0.6,
        door: rng() < 0.3,
        windows: makeWindows(b.x, b.w, nh)
      };
    }

    // brass mast goes to the tallest FINAL form of the skyline
    var tallest = lots[0];
    var tallestH = 0;
    for (i = 0; i < lots.length; i++) {
      var finalH = lots[i].next ? lots[i].next.h : lots[i].h;
      if (finalH > tallestH) { tallestH = finalH; tallest = lots[i]; }
    }
    tallest.roof = 0;                             // the beacon tower stays flat so its spire reads
    if (tallest.next) tallest.next.mast = true; else tallest.mast = true;

    // ---- the Nazarban House: the firm's own headquarters ----
    // deterministically the tallest wide, fairly central lot that isn't
    // the beacon tower or the historic courthouse; it stands from the
    // first frame and is never redeveloped (see drawNazarbanCrest)
    var nazarLot = null, nazarScore = -1;
    var midX = landL + span / 2;
    for (i = 0; i < lots.length; i++) {
      var nl = lots[i];
      if (nl === tallest || nl.clock || nl.w < 72 || nl.h < 190) continue;
      var centrality = 1 - Math.min(1, Math.abs((nl.x + nl.w / 2) - midX) / (span / 2));
      var score = nl.h + centrality * 130;
      if (score > nazarScore) { nazarScore = score; nazarLot = nl; }
    }
    // small towns and harbors carry a thin front row; the House must still
    // stand, so fall back to the tallest available lot — even the beacon,
    // whose mast we then surrender to the crest
    if (!nazarLot) {
      for (i = 0; i < lots.length; i++) {
        var nf = lots[i];
        if (nf.clock && lots.length > 1) continue;
        if (!nazarLot || nf.h > nazarLot.h) nazarLot = nf;
      }
      if (nazarLot) {
        nazarLot.mast = false;
        if (nazarLot.next) nazarLot.next.mast = false;
      }
    }
    if (nazarLot) {
      nazarLot.nazarban = true;
      nazarLot.next = null;                       // a monument — never densified
      nazarLot.chimney = 0;                       // clean roofline for the crest
      nazarLot.roof = 0;                          // flat top so the starburst reads
      nazarLot.progress = 1;                      // already standing — predates the boom
      nazarLot.rising = false;
      nazarLot.demolishing = false;
    }

    // star field for the dark palettes
    var stars = [];
    for (i = 0; i < 84; i++) {
      stars.push({
        x: Math.floor(rng() * VIEW_W),
        y: Math.floor(rng() * (GROUND_Y - 150)),
        r: 1 + rng() * 1.4,
        a: 0.5 + rng() * 0.5,
        tw: rng() * 6.283,
        ts: 0.6 + rng() * 1.6
      });
    }

    // deterministic build order: shuffle each row, then weave the back
    // row between front-row builds so depth fills in alongside the street
    function shuffled(arr) {
      var order = arr.slice();
      for (var i = order.length - 1; i > 0; i--) {
        var j = Math.floor(rng() * (i + 1));
        var t = order[i]; order[i] = order[j]; order[j] = t;
      }
      return order;
    }
    var buildable = [];                          // the Nazarban House is never queued — it just stands
    for (i = 0; i < lots.length; i++) if (!lots[i].nazarban) buildable.push(lots[i]);
    var frontOrder = shuffled(buildable);
    var backOrder = shuffled(bg);
    var queue = [];
    var n = Math.max(frontOrder.length, backOrder.length);
    for (i = 0; i < n; i++) {
      if (i < frontOrder.length) queue.push(frontOrder[i]);
      if (i < backOrder.length) queue.push(backOrder[i]);
    }

    // replacements run in the same front-row order
    var densify = [];
    for (i = 0; i < frontOrder.length; i++) {
      if (frontOrder[i].next) densify.push(frontOrder[i]);
    }

    // ---- milestone landmarks: the city of tomorrow ----
    // they stand in the plazas reserved above; the census commissions them
    var landmarks = [
      { kind: 'saucer', title: 'OBSERVATION TOWER', threshold: 12000, x: zones[0], h: 470, progress: 0, commissioned: false },
      { kind: 'rocket', title: 'MUNICIPAL ROCKETPORT', threshold: 18000, x: zones[1], h: 420, progress: 0, commissioned: false },
      { kind: 'atom',   title: 'ATOMIC PAVILION', threshold: 26000, x: zones[2], h: 250, progress: 0, commissioned: false },
      { kind: 'wheel',  title: 'PERMANENT FAIRGROUND', threshold: 36000, x: driveIn.x, h: 190, progress: 0, commissioned: false }
    ];

    // ---- rooftop starburst signs on two lucky buildings ----
    var signed = 0;
    var guard = 0;
    while (signed < 2 && guard++ < 24) {
      var sl = lots[Math.floor(rng() * lots.length)];
      if (!sl.sign && !sl.nazarban && (sl.next ? sl.next.h : sl.h) >= 200) {
        sl.sign = true;
        if (sl.next) sl.next.sign = true;
        signed++;
      }
    }

    // one lucky building hosts an animated neon spectacular
    var spec = null, specGuard = 0;
    while (!spec && specGuard++ < 30) {
      var cand = lots[Math.floor(rng() * lots.length)];
      if (!cand.sign && !cand.mast && !cand.nazarban && (cand.next ? cand.next.h : cand.h) >= 210 && cand.w >= 66) spec = cand;
    }
    if (spec) { spec.spectacular = true; spec.roof = 0; if (spec.next) spec.next.spectacular = true; }

    // a Googie roadside sign in the foreground — WELCOME TO the town
    var welcome = { x: landL + span * (rng() < 0.5 ? 0.1 : 0.88) };
    // the atomic broadcast tower rises behind the skyline, roughly centre
    var tower = {
      x: landL + span * (0.4 + rng() * 0.2),
      h: 340 + rng() * 90,
      baseW: 56 + rng() * 24
    };
    // a glowing exhibit kiosk at the margin opposite the welcome sign
    var kiosk = { x: welcome.x < landL + span * 0.5 ? landL + span * 0.9 : landL + span * 0.1 };
    // the House of the Future stands on its own little plot
    var futureHouse = { x: landL + span * (0.26 + rng() * 0.14), side: rng() < 0.5 ? -1 : 1 };
    // a pneumatic-tube transit line strung across the skyline
    var tube = { x0: -80, x1: VIEW_W + 80 };

    return { lots: lots, bg: bg, queue: queue, densify: densify, stars: stars, landmarks: landmarks, park: park, driveIn: driveIn, harbor: harbor, hill: hill, river: river, welcome: welcome, tower: tower, kiosk: kiosk, futureHouse: futureHouse, tube: tube, landL: landL, landR: landR };
  }

  var plan = generatePlan();
  var city = plan.lots;
  var bgCity = plan.bg;
  var park = plan.park;
  var driveIn = plan.driveIn;
  var welcome = plan.welcome;
  var tower = plan.tower;
  var futureHouse = plan.futureHouse;
  var tube = plan.tube;
  var kiosk = plan.kiosk;
  var harbor = plan.harbor;
  var hill = plan.hill;
  var river = plan.river;
  var LAND_L = plan.landL;
  var LAND_R = plan.landR;
  var allBuildings = city.concat(bgCity);
  var stars = plan.stars;
  var landmarks = plan.landmarks;
  var buildQueue = plan.queue.slice();
  var denseQueue = plan.densify.slice();

  for (var k = 0; k < INITIAL_BUILT && buildQueue.length; k++) {
    buildQueue.shift().progress = 1;
  }

  /* ---------------- vertical fit: the skyline scales, never crops ------ */
  /* The plan is drawn in the original 600-tall space (ground at 552,
     tallest spire ~470). A short viewport used to decapitate the towers;
     now every planned height — buildings, replacements, window offsets,
     landmarks, the hill — carries its native `base` measure and is
     rescaled by CITY_K whenever the sky shrinks, so the whole town
     always fits under its own horizon. */

  var CITY_K = 1;

  for (i = 0; i < allBuildings.length; i++) {
    var sb = allBuildings[i];
    sb.baseH = sb.h;
    for (var wj = 0; wj < sb.windows.length; wj++) sb.windows[wj].baseY = sb.windows[wj].y;
    if (sb.next) {
      sb.next.baseH = sb.next.h;
      for (wj = 0; wj < sb.next.windows.length; wj++) sb.next.windows[wj].baseY = sb.next.windows[wj].y;
    }
  }
  for (i = 0; i < landmarks.length; i++) landmarks[i].baseH = landmarks[i].h;
  if (hill) hill.baseH = hill.h;
  if (tower) tower.baseH = tower.h;

  function applyCityScale() {
    var K = Math.min(1, GROUND_Y / 552);
    if (K === CITY_K) return;
    CITY_K = K;
    for (var i = 0; i < allBuildings.length; i++) {
      var b = allBuildings[i];
      b.h = b.baseH * K;
      for (var w = 0; w < b.windows.length; w++) b.windows[w].y = b.windows[w].baseY * K;
      if (b.next) {
        b.next.h = b.next.baseH * K;
        for (w = 0; w < b.next.windows.length; w++) b.next.windows[w].y = b.next.windows[w].baseY * K;
      }
    }
    for (i = 0; i < landmarks.length; i++) landmarks[i].h = landmarks[i].baseH * K;
    if (hill) hill.h = hill.baseH * K;
    if (tower) tower.h = tower.baseH * K;
  }

  // the low dawn/dusk discs sit near the horizon, but the skyline is
  // seed-dependent — lift them just clear of the planned FINAL roofline
  // under them so they always peek out (still deterministic, still low)
  function settleLowCelestial(cel) {
    var roofY = GROUND_Y;
    for (var i = 0; i < allBuildings.length; i++) {
      var b = allBuildings[i];
      var finalH = b.next ? b.next.h : b.h;
      if (b.x < cel.x + cel.r && b.x + b.w > cel.x - cel.r) {
        roofY = Math.min(roofY, GROUND_Y - finalH);
      }
    }
    cel.y = Math.min(cel.y, roofY - cel.r * 0.35);
  }

  // sky furniture re-seats itself whenever the sky changes size: the
  // sun and moon scale into the available headroom, then the low discs
  // settle just clear of the roofline as before
  for (i = 0; i < TIMES.length; i++) TIMES[i].cel.baseY = TIMES[i].cel.y;

  function settleSky() {
    for (var i = 0; i < TIMES.length; i++) {
      TIMES[i].cel.y = TIMES[i].cel.baseY * SKY_K;
    }
    settleLowCelestial(TIMES[1].cel);
    settleLowCelestial(TIMES[5].cel);
  }
  settleSky();

  function onViewportChange() {
    applyCityScale();
    // the beam rides the scaled skyline (never below streetlamp height)
    RAIL_Y = GROUND_Y - Math.max(62, 104 * CITY_K);
    settleSky();
    vignette = null;                              // regenerate for the new frame
    requestMeasure();
  }

  /* ---------------- city name (third rng stream) ----------------------- */
  /* Same seed = same name, always; a separate stream so naming can never
     perturb the city plan or the weather. */

  var rng3 = mulberry32(seed ^ 0x85EBCA6B);

  // shared with the sister-city lookup: same generator, different stream
  function generateName(r) {
    var ONSETS = ['KER', 'MAR', 'BEL', 'NOR', 'VAL', 'HAR', 'WIN', 'ASH',
                  'THORN', 'CRES', 'DUN', 'FAIR', 'GLEN', 'HOL', 'LOR',
                  'MER', 'OAK', 'PEN', 'ROY', 'SIL'];
    var MIDS   = ['A', 'O', 'E', 'ER', 'AR', 'EN', 'IN', 'OR', ''];
    var ENDS   = ['TON', 'FIELD', 'MONT', 'BURY', 'FORD', 'HAVEN', 'WICK',
                  'MOOR', 'DALE', 'BROOK', 'VALE', 'GATE', 'CREST', 'VIEW'];
    var SUFFIXES = ['FALLS', 'HEIGHTS', 'JUNCTION', 'MESA', 'SPRINGS',
                    'POINT', 'PARK', 'GROVE', 'TERRACE', 'FLATS'];
    function pick(a) { return a[Math.floor(r() * a.length)]; }
    var name = pick(ONSETS) + pick(MIDS) + pick(ENDS);
    if (r() < 0.5) name += ' ' + pick(SUFFIXES);
    return name;
  }

  var CITY_NAME = generateName(rng3);

  // every municipality needs a motto in confident schoolhouse Latin;
  // drawn from the naming stream AFTER the name so names are unchanged
  var CITY_MOTTO = (function () {
    var VIRTUES = ['INDUSTRIA', 'CIVITAS', 'PROGRESSUS', 'CONCORDIA',
                   'LUMEN', 'FORTITUDO', 'PROSPERITAS', 'VIGILANTIA'];
    var a = VIRTUES[Math.floor(rng3() * VIRTUES.length)];
    var b = VIRTUES[Math.floor(rng3() * VIRTUES.length)];
    while (b === a) b = VIRTUES[Math.floor(rng3() * VIRTUES.length)];
    return a + ' ET ' + b;
  })();

  /* ---------------- the municipal almanac (Form CA-2) ------------------ */
  /* Facts continue on the naming stream, AFTER name and motto, so both
     stay exactly what they were. The sister city is whoever lives at
     the next transmission number — a real, visitable seed. */

  var SISTER_SEED = (seed + 1) >>> 0;
  var SISTER_CITY = generateName(mulberry32(SISTER_SEED ^ 0x85EBCA6B));

  var ALMANAC = (function () {
    var EXPORTS = ['VACUUM TUBES', 'CIVIC PRIDE', 'CANNED PEACHES',
                   'DIRIGIBLE FITTINGS', 'GRAMOPHONE NEEDLES',
                   'DECORATIVE GRAVEL', 'PRECISION KNOBS', 'RHUBARB',
                   'POSTCARDS', 'MEASURED OPTIMISM'];
    var BIRDS  = ['CRESTED TEAL', 'BRASS FINCH', 'CIVIC PIGEON',
                  'LESSER STARLING', 'MARSH WREN', 'CLOCKTOWER SWIFT'];
    var DISHES = ['RHUBARB PIE', 'PEACH FRITTERS', 'WALLEYE SUPREME',
                  'CORN FRITTER STACK', 'ICEBOX CAKE', 'TOMATO ASPIC (AVOID)'];
    function pick(a) { return a[Math.floor(rng3() * a.length)]; }
    var e1 = pick(EXPORTS);
    var e2 = pick(EXPORTS);
    while (e2 === e1) e2 = pick(EXPORTS);
    return {
      founded: 1871 + Math.floor(rng3() * 70),
      exports: e1 + ' AND ' + e2,
      bird: pick(BIRDS),
      dish: pick(DISHES),
      rainfall: (22 + rng3() * 20).toFixed(1) + ' INCHES (DISPUTED)',
      situation: harbor ? 'HARBOR TOWN — MIND THE GULLS'
        : hill ? 'HILL TOWN — FUNICULAR SERVED'
        : river ? 'RIVER TOWN — MIND THE BRIDGE'
        : 'PRAIRIE TOWN — UNINTERRUPTED SKY',
      sister: SISTER_CITY,
      sisterSeed: SISTER_SEED
    };
  })();

  /* ---------------- the municipal ledger (localStorage) ---------------- */
  /* The ledger belongs to the commissioner, not to any one city: civic
     firsts are entered once, ever, and a returning commissioner is
     welcomed back by name of office. Fails silently where storage is
     unavailable — the toy never depends on it. */

  var memory = (function () {
    try {
      var m = JSON.parse(localStorage.getItem('municitron-m58') || '{}');
      if (!m.records) m.records = {};
      if (!m.tally) m.tally = {};                 // running counts for the hatch
      if (!m.firstVisit) m.firstVisit = Date.now();
      m.visits = (m.visits || 0) + 1;
      m.prevVisit = m.lastVisit || 0;
      m.lastVisit = Date.now();
      localStorage.setItem('municitron-m58', JSON.stringify(m));
      return m;
    } catch (err) { return null; }
  })();

  function recordFirst(key, notice) {
    if (!memory || memory.records[key]) return;
    memory.records[key] = new Date().toISOString();
    try { localStorage.setItem('municitron-m58', JSON.stringify(memory)); } catch (err) {}
    postBulletin('MUNICIPAL LEDGER — ' + notice);
  }

  // lifetime counters, read back through the maintenance hatch
  function tally(key) {
    if (!memory) return;
    memory.tally[key] = (memory.tally[key] || 0) + 1;
    try { localStorage.setItem('municitron-m58', JSON.stringify(memory)); } catch (err) {}
  }

  /* ---------------- weather particles (separate rng stream) ------------ */

  var rng2 = mulberry32(seed ^ 0x9E3779B9);

  var rain = [];
  for (i = 0; i < 130; i++) {
    rain.push({
      x: rng2() * VIEW_W,
      y: rng2() * GROUND_Y,
      l: 14 + rng2() * 12,
      v: 620 + rng2() * 320
    });
  }

  var snow = [];
  for (i = 0; i < 90; i++) {
    snow.push({
      x: rng2() * VIEW_W,
      y: rng2() * GROUND_Y,
      r: 1.8 + rng2() * 1.8,
      v: 42 + rng2() * 46,
      ph: rng2() * 6.283,
      amp: 10 + rng2() * 18,
      f: 0.5 + rng2() * 0.9
    });
  }

  // poster clouds: proper flat-bottomed cumulus — a chain of half-circle
  // lobes (small, big, small) closed along one baseline, so the shape
  // reads as a single silhouette instead of glued circles. `fy` is a
  // fraction of the sky, so clouds spread into any sky height.
  var clouds = [];
  for (i = 0; i < 6; i++) {
    var lobes = [];
    var lobeN = 3 + Math.floor(rng2() * 3);
    var R = 15 + rng2() * 12;
    var lx = 0;
    for (var pj = 0; pj < lobeN; pj++) {
      var lr = R * (0.45 + 0.55 * Math.sin(Math.PI * (pj + 0.5) / lobeN)) + rng2() * 3;
      if (pj > 0) lx += (lobes[pj - 1].r + lr) * 0.72;
      lobes.push({ dx: lx, r: lr });
    }
    clouds.push({
      x: rng2() * VIEW_W,
      fy: 0.06 + rng2() * 0.38,                   // fraction of the sky height
      v: 6 + rng2() * 10,
      s: 0.8 + rng2() * 0.8,
      lobes: lobes
    });
  }

  var AURORA_RIBBONS = [
    { base: 128, amp: 34, th: 48, f: 0.0052, sp: 1.0,  color: '63,224,216',  a: 0.5  },
    { base: 178, amp: 38, th: 42, f: 0.0043, sp: 0.7,  color: '255,90,150',  a: 0.4  },
    { base: 100, amp: 26, th: 32, f: 0.0065, sp: 1.4,  color: '255,201,74',  a: 0.32 }
  ];

  /* ---------------- ambient traffic (fourth rng stream) ---------------- */
  /* Monorail departures and Sputnik passes are scheduled at runtime from
     their own stream, so ambient life can never perturb the city. */

  var rng4 = mulberry32(seed ^ 0xC2B2AE35);

  /* ---------------- civic events (fifth rng stream) --------------------- */
  /* Construction dust, fireworks, wildlife and other one-off spectacle
     draw from their own stream so they can never perturb the ambient
     traffic schedules above. */

  var rng6 = mulberry32(seed ^ 0x27D4EB2F);

  var monorail = { x: 0, dir: 1, active: false, timer: 5 + rng4() * 8 };
  var sputnik = { p: 0, active: false, timer: 18 + rng4() * 30 };
  var airship = { x: 0, y: 0, dir: 1, active: false, timer: 45 + rng4() * 80 };
  var ferry = { x: 0, dir: 1, active: false, timer: 16 + rng4() * 30 };
  var funi = { p: 0, dir: 1, moving: false, timer: 6 + rng4() * 10 };
  var milk = { x: 0, dir: 1, active: false, timer: 20 + rng4() * 40 };
  var aircars = [];
  for (i = 0; i < 5; i++) {
    aircars.push({ active: false, timer: 3 + rng4() * 16, x: 0, y: 0, dir: 1,
                   v: 100 + rng4() * 80, tone: Math.floor(rng4() * 3), lane: i });
  }
  var planet = { fx: 0.16 + rng4() * 0.12, fy: 92 + rng4() * 42, r: 40 + rng4() * 16,
                 color: rng4() < 0.5 ? '#B5896B' : '#8FA6B0', tilt: -0.3 - rng4() * 0.22 };
  var icedLevel = 0;                              // eased harbor-freeze blend
  var rocketFX = { phase: 0, t: 0, timer: 22 + rng4() * 38, y: 0 };   // rocketport launches
  var robot = { active: false, timer: 16 + rng6() * 34, x: 0, dir: 1, v: 15 + rng6() * 6, ph: 0 };   // MECHANICAL MAN
  var taxi = { phase: 0, timer: 24 + rng4() * 40, t: 0, x: 0, y: 0, dir: 1, padX: 0 };   // flying-saucer taxi

  /* ---------------- civic incidents ----------------------------------- */
  /* Small emergencies the town handles itself: a rooftop fire brings the
     brigade (bell, ladder truck, hose arc — rain helps), and a power
     outage drops every window at once, then restores block by block in
     a wave. Both leave a record and a bulletin; neither leaves a mark. */
  var fire = { phase: 0, timer: 110 + rng6() * 150, t: 0, b: null, truckX: 0, dir: 1, burn: 0 };
  var outage = { phase: 0, timer: 160 + rng6() * 240, t: 0, frontX: 0 };

  // harbor towns keep their traffic on the land side of the quay
  var CAR_L = harbor && harbor.side === -1 ? harbor.shore + 10 : -30;
  var CAR_R = harbor && harbor.side === 1 ? harbor.shore - 10 : VIEW_W + 30;

  var cars = [];
  for (i = 0; i < 14; i++) {
    cars.push({
      active: false,
      timer: 1 + rng4() * 8,
      x: 0,
      dir: 1,
      v: 60 + rng4() * 55,
      len: 22 + rng4() * 10
    });
  }

  var flickTimer = 0.8;                           // individual window lights

  /* ---------------- wildlife & visitors (civic events stream) ---------- */

  var birds = [];                                 // at most two flocks aloft
  var birdTimer = 20 + rng6() * 40;
  var jets = [];                                  // rocket-belt commuters
  var jetTimer = 26 + rng6() * 44;
  var parade = { active: false, x: 0, dir: 1 };   // Founders' Day procession

  // the band forms up: Founders' Day calls it every July, and the
  // PARADE key on the auxiliary rail doesn't wait for the calendar
  function startParade(notice) {
    if (reducedMotion.matches || parade.active) return;
    parade.dir = harbor ? (harbor.side === 1 ? -1 : 1) : 1;
    // the band forms up at the near edge of Main Street and marches on
    // in view — no long walk-in from off-screen, so pressing PARADE
    // shows the head of the column at once
    parade.x = parade.dir === 1 ? LAND_L + 20 : LAND_R - 20;
    parade.active = true;
    flashNotice(notice);
  }
  var kite = { active: false, timer: 24 + rng6() * 40, until: 0, ph: 0, anchor: 0 };

  // the citizens: strollers (some with hats, some walking Comet),
  // scaled to the census and thinned after dark
  var folks = [];
  for (i = 0; i < 8; i++) {
    folks.push({
      active: false,
      timer: 4 + rng6() * 22,
      x: 0,
      dir: 1,
      v: 13 + rng6() * 9,
      hat: rng6() < 0.55,
      dog: rng6() < 0.25,
      ph: rng6() * 6.283
    });
  }

  // autumn leaves off the park trees, and the odd falling star
  var leaves = [];
  var shoot = { t: 0, x: 0, y: 0, dx: 0, dy: 0, timer: 50 + rng6() * 90 };

  /* ---------------- the sky calendar --------------------------------- */
  /* Larger skies on their own seeded stream (rng7): August and December
     bring meteor showers (the falling stars come in flurries), every
     town has a named comet on a long civic orbit, the moon keeps
     phases, and once in a great while the moon crosses the sun and the
     whole town stops to watch. */
  var rng7 = mulberry32(seed ^ 0x94D049BB);
  var COMET_NAME = 'COMET ' + CITY_NAME.split(/[ -]/)[0].toUpperCase();
  var comet = { active: false, timer: 140 + rng7() * 200, x: 0, y: 0, vx: 0, vy: 0, dur: 0, t: 0 };
  var eclipse = { active: false, timer: 200 + rng7() * 260, t: 0, dur: 16 };
  var meteorTimer = 2 + rng7() * 6;

  function eclipseCover() {
    if (!eclipse.active) return 0;
    var p = eclipse.t / eclipse.dur;              // 0 → 1 across the pass
    return Math.max(0, 1 - Math.abs(p - 0.5) * 4);   // full cover mid-pass
  }

  // mail from the sister city: a little postcard of THEIR skyline,
  // sketched from the sister seed, slides in now and then
  var mailArt = (function () {
    var r = mulberry32(SISTER_SEED ^ 0xDEADBEE1);
    var bars = [];
    var x = 6;
    while (x < 150) {
      var w = 10 + r() * 16;
      bars.push({ x: x, w: w, h: 14 + r() * 40, c: Math.floor(r() * 3) });
      x += w + 3;
    }
    return { bars: bars, sunX: 30 + r() * 100 };
  })();
  var mail = { phase: 0, t: 0, timer: 110 + rng6() * 140 };   // 0 idle → in → hold → out

  // hands-on city: floating notes from the bandstand, the drive-in's
  // reel selector, and a throttle for aimed fireworks
  var notes = [];
  var reelShift = 0;
  var whistleT = 0;                               // noon whistle: folks stand still

  // KNAZ-TV: the telecast overlay (typed code on the console)
  var telecast = false;
  document.addEventListener('municitron:telecast', function () {
    telecast = !telecast;
    postBulletin(telecast ? 'KNAZ-TV TELECAST COMMENCING — ADJUST AERIAL'
                          : 'TELECAST CONCLUDED — RETURN TO YOUR EVENING');
    if (telecast) recordFirst('telecast', 'FIRST TELECAST TUNED');
  });
  var regatta = { active: false, timer: 140 + rng6() * 220, dir: 1, balloons: [] };
  var ufo = { active: false, timer: 300 + rng6() * 600, x: 0, y: 90, dir: 1 };
  var rainbow = 0;                                // alpha of the after-rain arc
  var prevRain = 0;

  function spawnFlock(x, y, dir) {
    if (birds.length >= 2 || reducedMotion.matches) return;
    var count = 5 + Math.floor(rng6() * 5);
    var members = [];
    for (var i = 0; i < count; i++) {
      members.push({
        dx: -i * 13,                              // trailing V formation
        dy: (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 7,
        ph: rng6() * 6.283
      });
    }
    birds.push({ x: x, y: y, dir: dir, v: 90 + rng6() * 40, members: members });
  }

  function launchRegatta() {
    regatta.active = true;
    regatta.dir = rng6() < 0.5 ? -1 : 1;
    regatta.balloons = [];
    var count = 3 + Math.floor(rng6() * 3);
    var base = regatta.dir === 1 ? -80 : VIEW_W + 80;
    var hues = ['#235450', ORANGE, BRASS];
    for (var i = 0; i < count; i++) {
      regatta.balloons.push({
        x: base - regatta.dir * i * (70 + rng6() * 50),
        y: (90 + rng6() * 160) * SKY_K,
        r: 16 + rng6() * 7,
        drift: 10 + rng6() * 8,
        ph: rng6() * 6.283,
        amp: 6 + rng6() * 8,
        f: 0.3 + rng6() * 0.4,
        color: hues[i % 3]
      });
    }
    postBulletin('BALLOON REGATTA PASSING — WAVE FROM THE ROOFTOPS');
  }

  // technicians know a knob sequence that summons this (see console)
  document.addEventListener('municitron:ufo', function () {
    if (ufo.active || reducedMotion.matches) return;
    ufo.active = true;
    ufo.dir = rng6() < 0.5 ? -1 : 1;
    ufo.x = ufo.dir === 1 ? -60 : VIEW_W + 60;
    ufo.y = (80 + rng6() * 60) * SKY_K;
    postBulletin('OBJECT REPORTED OVER NORTHERN DISTRICT — OFFICIALS DECLINE COMMENT');
    recordFirst('object', 'FIRST UNEXPLAINED OBJECT LOGGED');
  });

  // demolition dust: flat cream puffs shaken loose by the wrecking crews
  var dust = [];
  var DUST_MAX = 80;

  function puffDust(x, y) {
    if (dust.length >= DUST_MAX) return;
    dust.push({
      x: x,
      y: y,
      r: 4 + rng6() * 6,
      vy: -(14 + rng6() * 20),
      vr: 9 + rng6() * 7,
      life: 0
    });
  }

  /* ---------------- atmosphere: smoke, lightning, parallax ------------- */

  // chimney smoke: flat rising puffs, leaning with the prevailing wind
  var smoke = [];
  var SMOKE_MAX = 70;
  var smokeTimer = 0.6;

  // a storm cell throws a bolt now and then while RAIN is fully dialed in
  var lightning = { t: 0, cool: 9 + rng6() * 14, pts: null };

  function makeBolt() {
    var pts = [];
    var x = 220 + rng6() * 1160;
    var y = 30;
    pts.push([x, y]);
    while (y < GROUND_Y - 160) {
      y += 36 + rng6() * 26;
      x += (rng6() * 2 - 1) * 34;
      pts.push([x, y]);
    }
    return pts;
  }

  // pointer parallax + idle drift: the camera's sideways interest.
  // Layers translate by parX × their depth factor in drawScene.
  var parX = 0;
  var parTarget = 0;
  var parY = 0;
  var parTargetY = 0;
  var lastPointer = -100;
  window.addEventListener('pointermove', function (e) {
    var w = window.innerWidth || 1;
    var h = window.innerHeight || 1;
    parTarget = ((e.clientX / w) - 0.5) * 24;
    parTargetY = ((e.clientY / h) - 0.5) * 9;
    lastPointer = effT;
  }, { passive: true });

  // a low prairie wind: rain slants, snow drifts and the puddles ring
  // with the same slow gusts, so the whole sky agrees about the weather
  var gust = 0;

  // ceremonies lean the camera in: a slight push on the breathing zoom
  // whenever the town has something to watch, decaying over a few beats
  var camPush = 0;
  var camPushSm = 0;
  ['municitron:parade', 'municitron:salute', 'municitron:concert',
   'municitron:whistle'].forEach(function (ev) {
    document.addEventListener(ev, function () { camPush = 1; });
  });

  // the era retune: swapping ages rolls the picture like a set being
  // struck — static, one pass of the vertical hold, a flash, then the
  // new age settles (drawEraFX; applyTheme arms it)
  var eraFX = { t: 0, dur: 0.9 };
  var themeBooted = false;

  // the newsreel leader: a film-style title card the camera records
  // over the first moments of every reel (drawNewsreelCard)
  var newsreelCard = 0;

  /* ---------------- civic calendar ---------------- */
  /* Sixteen real seconds to a civic month; the seasons turn even while
     the lever is DORMANT — time passes in a paused city too. December
     strings lights between the rooftops, October warms every window,
     July throws the Founders' Day fireworks, January rings in the year. */

  var MONTH_LEN = 16;
  var MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
                'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
  var calendar = { month: 3, year: 1958, t: 0 };   // every city opens in April 1958
  var foundersTimer = -1;                          // countdown to the July show

  // one turn of the civic calendar, with all the customs the new month
  // brings — the simulation clock calls this every 16 real seconds, and
  // a click on the rail's calendar window calls it early
  function advanceMonth() {
    calendar.month = (calendar.month + 1) % 12;
    if (calendar.month === 0) {
      calendar.year++;
      postBulletin('A HAPPY NEW YEAR — A.D. ' + calendar.year);
      startShow(6);
    } else if (calendar.month === 6) {
      postBulletin('FOUNDERS’ DAY JULY 4 — FIREWORKS ORDERED');
      foundersTimer = MONTH_LEN * 0.2;
      startParade('FOUNDERS’ DAY PARADE ON MAIN STREET — WAVE');
    } else if (calendar.month === 7) {
      postBulletin('METEOR SHOWER THIS MONTH — BLANKETS ON THE HILL');
    } else if (calendar.month === 11) {
      postBulletin('MUNICIPAL LIGHT-UP — CREWS STRINGING THE STREET');
      postBulletin('GEMINID METEORS EXPECTED — DRESS WARM');
      if (harbor) postBulletin('HARBOR ICED — FERRY SUSPENDED UNTIL THAW');
      if (river) postBulletin('RIVER ICED OVER — SKATES SHARPENED');
    } else if (calendar.month === 2) {
      postBulletin('PARK BLOSSOMS REPORTED — BRING A CAMERA');
      if (harbor) postBulletin('THAW REPORTED — FERRY SERVICE RESUMES');
      if (river) postBulletin('RIVER RUNNING FREE — BARGE RESUMES');
    } else if (calendar.month === 8) {
      postBulletin('SCHOOL RESUMES — STREETS QUIET UNTIL THREE O’CLOCK');
    } else if (calendar.month === 10) {
      postBulletin('ELECTION DAY — WEMBLY vs. WEMBLY (UNOPPOSED)');
      postBulletin('WEMBLY RE-ELECTED — MANDATE: “CONTINUE”');
    }
  }

  /* ---------------- fireworks ---------------- */
  /* Brass, burnt-orange and cream bursts over the skyline. Shows are
     started by civic occasions (Founders' Day, new year, landmarks,
     census milestones, a generous coin). */

  var fw = { shells: [], sparks: [], show: 0, launchTimer: 0 };
  var FW_COLORS = [BRASS, ORANGE, CREAM_HI];

  function startShow(sec) {
    if (reducedMotion.matches) return;
    if (fw.show <= 0) document.dispatchEvent(new CustomEvent('municitron:fireworks'));
    fw.show = Math.max(fw.show, sec);
  }

  function updateFireworks(dt) {
    var i, p;
    if (fw.show > 0) {
      fw.show -= dt;
      fw.launchTimer -= dt;
      if (fw.launchTimer <= 0 && fw.shells.length < 6) {
        fw.launchTimer = 0.35 + rng6() * 0.55;
        fw.shells.push({
          x: 240 + rng6() * 1120,
          y: GROUND_Y,
          vy: -(300 + rng6() * 130),
          burstY: (100 + rng6() * 180) * SKY_K,
          type: Math.floor(rng6() * 3),           // chrysanthemum / ring / willow
          color: FW_COLORS[Math.floor(rng6() * 3)]
        });
      }
    }
    for (i = fw.shells.length - 1; i >= 0; i--) {
      p = fw.shells[i];
      p.y += p.vy * dt;
      p.vy += 60 * dt;
      if (p.y <= p.burstY || p.vy > -50) {
        var n = p.type === 1 ? 18 : 22 + Math.floor(rng6() * 8);
        for (var s = 0; s < n && fw.sparks.length < 260; s++) {
          var ang = (s / n) * Math.PI * 2 + (p.type === 1 ? 0 : rng6() * 0.25);
          var spd = p.type === 1 ? 104 + rng6() * 8         // a crisp ring
                  : p.type === 2 ? 50 + rng6() * 70         // willow droops
                  : 60 + rng6() * 110;                      // chrysanthemum
          fw.sparks.push({
            x: p.x, y: p.y,
            vx: Math.cos(ang) * spd,
            vy: Math.sin(ang) * spd,
            g: p.type === 2 ? 130 : p.type === 1 ? 30 : 70,
            s: 1.2 + rng6() * 1.1,
            life: 0,
            max: p.type === 2 ? 1.6 + rng6() * 0.6 : 1.0 + rng6() * 0.5,
            color: p.type === 2 ? BRASS : p.color
          });
        }
        if (fw.sparks.length < 260) {                       // the core flash
          fw.sparks.push({ x: p.x, y: p.y, flash: true, life: 0, max: 0.16 });
        }
        fw.shells.splice(i, 1);
      }
    }
    for (i = fw.sparks.length - 1; i >= 0; i--) {
      p = fw.sparks[i];
      if (!p.flash) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += p.g * dt;
      }
      p.life += dt;
      if (p.life > p.max) fw.sparks.splice(i, 1);
    }
  }

  /* ---------------- municipal bulletin ---------------- */
  /* A one-line civic wire service on the ground band. Runs on its own
     clock so notices post even while the lever is DORMANT. */

  var bulletin = { current: null, until: 0, clock: 0, queue: [] };
  var dayLog = [];                                // everything the wire carried,
                                                  // stamped with the civic date
  function postBulletin(msg) {
    if (bulletin.queue.length < 4 && bulletin.queue.indexOf(msg) === -1) {
      bulletin.queue.push(msg);
      dayLog.push({ month: calendar.month, year: calendar.year, msg: msg });
      if (dayLog.length > 24) dayLog.shift();
    }
  }

  // a commissioner's order jumps the wire: its notice shows at once
  // rather than waiting its turn behind whatever was scrolling, so the
  // console confirms the instant a ceremony key is pressed
  function flashNotice(msg) {
    dayLog.push({ month: calendar.month, year: calendar.year, msg: msg });
    if (dayLog.length > 24) dayLog.shift();
    bulletin.current = msg;
    bulletin.started = bulletin.clock;
    bulletin.until = bulletin.clock + 6.5;
  }

  var WEATHER_NOTICES = [
    'SKIES CLEAR — ALL FORMS NOMINAL',
    'FORECAST: RAIN — CARRY FORM RB-2',
    'FORECAST: SNOW — PLOWS DISPATCHED',
    'AURORA WATCH IN EFFECT — LOOK UP'
  ];

  /* ---------------- the municipal wire (sixth rng stream) -------------- */
  /* A slow drip of civic life between official notices. The town has
     recurring characters: Mayor Wembly (perpetually campaigning), the
     Grebbsville rivalry, the courthouse clock nobody can wind, and the
     Ladies' Garden Auxiliary. Lines post from a shuffled deck so the
     whole paper is read before any story repeats. */

  var rng5 = mulberry32(seed ^ 0x85EBCA77);

  var WIRE_LINES = [
    'MAYOR WEMBLY DECLARES THIS "A FINE TOWN, GETTING FINER"',
    'MAYOR WEMBLY DENIES RUMORS — DECLINES TO SAY WHICH ONES',
    'MAYOR WEMBLY TO SEEK RE-ELECTION — OPPONENT YET TO BE FOUND',
    'MAYOR WEMBLY CUTS RIBBON — SECOND RIBBON ORDERED',
    'COURTHOUSE CLOCK STILL STOPPED — KEY REMAINS MISSING',
    'COURTHOUSE CLOCK KEY REPORTEDLY SEEN IN A COAT POCKET, 1949',
    'CLOCK COMMITTEE VOTES TO FORM A SECOND COMMITTEE',
    'GREBBSVILLE CLAIMS LARGER GAZEBO — CLAIM DISPUTED',
    'ANNUAL GREBBSVILLE MATCH ENDS IN PROTEST, AGAIN',
    'GREBBSVILLE PAPER PRINTS UNKIND WORDS — SUBSCRIPTION CANCELED',
    'LADIES’ GARDEN AUXILIARY ANNOUNCES TULIP OFFENSIVE',
    'GARDEN AUXILIARY DEFEATS BEETLES — VICTORY TEA SUNDAY',
    'BAND CONCERT SUNDAY AT THE PAVILION — BRING A HAT',
    'LOST: ONE DOG, ANSWERS TO "COMET" — REWARD: GRATITUDE',
    'FOUND: ONE DOG, WILL NOT STOP ANSWERING',
    'BARBERSHOP QUARTET SEEKS FIFTH MEMBER FOR SAFETY',
    'LIBRARY REPORTS RECORD QUIET — LIBRARIAN COMMENDED',
    'MILKMAN COMPLETES ROUTE IN RECORD TIME — HORSE CREDITED',
    'SODA FOUNTAIN INTRODUCES FOURTH FLAVOR — LINES EXPECTED',
    'PICTURE PALACE HELD OVER: "ROCKET GIRLS OF SATURN"',
    'BOWLING LEAGUE STANDINGS UNCHANGED — TENSION MOUNTS',
    'SCHOOL SPELLING BEE WON ON THE WORD "MUNICIPAL"',
    'STREET SWEEPER WAVES BACK — CITIZENS DELIGHTED',
    'PIGEON COUNCIL CONVENES ON COURTHOUSE LEDGE',
    'ZONING BOARD APPROVES ITSELF ANOTHER MEETING',
    'FIRE BRIGADE RESCUES CAT — CAT UNGRATEFUL',
    'CIVIL DEFENSE DRILL POSTPONED — SIREN ON LOAN TO GREBBSVILLE',
    'NAZARBAN FIELD ENGINEER PRAISES LOCAL DIALS',
    'TELEPHONE EXCHANGE ADDS DIGIT — OPERATORS BRACE',
    'BUS LINE EXTENDS TO THE NEW DISTRICT — NICKEL FARE HOLDS',
    'HARDWARE STORE SELLS OUT OF LADDERS — NO EXPLANATION',
    'WEATHER BUREAU APOLOGIZES FOR TUESDAY',
    'AMATEUR ASTRONOMERS MEET FRIDAY — SKY EXPECTED',
    'DINER PIE OF THE WEEK: RHUBARB, REGRETTABLY',
    'STAMP CLUB DECLARES POSTCARD RENAISSANCE UNDERWAY',
    'DRIVE-IN DOUBLE FEATURE FRIDAY — SOUND VIA WINDOW SPEAKER',
    'FAIRGROUND WHEEL INSPECTED — DECLARED "ROUND"',
    'SISTER CITY ' + SISTER_CITY + ' SENDS CORDIAL REGARDS',
    'CLICK THE CITY PLATE FOR THE MUNICIPAL ALMANAC — FORM CA-2',
    'KITE SEASON OPEN — MIND THE WIRES',
    'COURTHOUSE CLOCK STILL SAYS 3:47 — CORRECT TWICE DAILY',
    'PIGEONS RELOCATE TO LIBRARY LEDGE — LIBRARIAN UNMOVED',
    'MOOSE LODGE PANCAKE BREAKFAST DECLARED "ADEQUATE PLUS"',
    'PAPERBOY SETS DISTANCE RECORD — WINDOW UNBROKEN',
    'KNAZ-TV TEST BROADCAST TONIGHT — ADJUST YOUR AERIALS',
    'SODA JERK PROMOTED TO SODA FOREMAN',
    'ZONING BOARD DISCOVERS MAP WAS UPSIDE DOWN SINCE MARCH',
    'CHESS IN THE PARK RESUMES — PIGEON TAKES QUEEN',
    'STREET SWEEPER REQUESTS SECOND BROOM — UNDER REVIEW',
    'COMET SEEN CHASING THE STREET SWEEPER — BOTH DELIGHTED',
    'ARROW KEYS NOW OPERATE THE DIALS — THE FUTURE ARRIVES',
    'FORM MR-1 IN EFFECT — THE TOWN MAY ASK SMALL FAVORS',
    'MILK ROUND EXPANDS TO THE NEW DISTRICT — HORSE CONSULTED',
    'TYPE LEDGER FOR YOUR COMMISSIONER’S RECORD — FORM CR-5',
    'POSTMASTER REPORTS MAIL FROM ABROAD — HOW EXOTIC'
  ];
  if (hill) {
    WIRE_LINES.push('FUNICULAR RUNNING SWEETLY — GREASE COMMENDED');
    WIRE_LINES.push('HILLSIDE RESIDENTS REPORT SPLENDID VIEWS, MILD SMUGNESS');
  }
  if (harbor) {
    WIRE_LINES.push('TIDE TABLES POSTED AT THE PIER — ARGUE ELSEWHERE');
  }

  /* ---------------- municipal requests (Form MR-1) --------------------- */
  /* Every so often the town asks a favor of whoever is at the console.
     Honoring one earns thanks in character; every third favor gets a
     key to the city and a salute in the sky. Ignoring one is fine —
     the request is withdrawn with no hard feelings. */

  var REQUESTS = [
    { text: 'GARDEN AUXILIARY PETITIONS FOR RAIN — DIAL RAIN',
      done: 'RAIN DELIVERED — TULIPS JUBILANT',
      ok: function () { return weatherTo === 1; } },
    { text: 'LAUNDRY DAY PROCLAIMED — CLEAR SKIES REQUESTED',
      done: 'SKIES CLEARED — LINENS FLYING',
      ok: function () { return weatherTo === 0; } },
    { text: 'CHILDREN PETITION FOR SNOW — SLEDS OILED AND READY',
      done: 'SNOW DELIVERED — SCHOOL CANCELS ITSELF',
      ok: function () { return weatherTo === 2; } },
    { text: 'ASTRONOMY CLUB REQUESTS AURORA — BLANKETS DEPLOYED',
      done: 'AURORA ARRANGED — GASPS REPORTED',
      ok: function () { return weatherTo === 3; } },
    { text: 'OBSERVATORY REQUESTS DARKNESS — DIAL TOWARD NIGHT',
      done: 'DARKNESS PROVIDED — SATURN LOCATED',
      ok: function () { return timeTo === 0 || timeTo === 7; } },
    { text: 'NIGHT SHIFT ENDS — MORNING RESPECTFULLY DEMANDED',
      done: 'MORNING SUPPLIED — COFFEE VICTORIOUS',
      ok: function () { return timeTo >= 1 && timeTo <= 3; } },
    { text: 'PHOTOGRAPHY CLUB REQUESTS A GOOD SUNSET — DIAL DUSK',
      done: 'SUNSET STAGED — FILM SPENT',
      ok: function () { return timeTo === 5; } },
    { text: 'COUNCIL DEMANDS PROGRESS — LEVER TO BOOM, PLEASE',
      done: 'BOOM ENACTED — HAMMERS SINGING',
      ok: function () { return growthIndex === 2; } },
    { text: 'QUIET HOURS PETITION — A MOMENT OF DORMANT, PLEASE',
      done: 'QUIET OBSERVED — THE TOWN EXHALES',
      ok: function () { return growthIndex === 0; } },
    { text: 'POSTMASTER REQUESTS A POSTCARD — TRANSMIT ONE, PLEASE',
      done: 'POSTCARD FILED — POSTMASTER WEEPS WITH JOY',
      ok: function () { return lastTransmit >= request.openedAt; } }
  ];

  var request = { def: null, until: 0, openedAt: 0, timer: 70 + rng5() * 60 };

  function bumpGratitude() {
    var n = 1;
    if (memory) {
      memory.gratitude = (memory.gratitude || 0) + 1;
      n = memory.gratitude;
      try { localStorage.setItem('municitron-m58', JSON.stringify(memory)); } catch (err) {}
    }
    recordFirst('request', 'FIRST CIVIC REQUEST HONORED');
    if (n % 3 === 0) {
      postBulletin(n === 3 ? 'KEY TO THE CITY ORDERED — ENGRAVER NOTIFIED'
                 : n === 6 ? 'SECOND KEY ORDERED — FIRST KEY MISLAID'
                 : 'ANOTHER KEY TO THE CITY — START A DRAWER');
      startShow(4);
    }
  }

  var wireDeck = [];
  var wireTimer = 18 + rng5() * 20;

  function nextWireLine() {
    if (!wireDeck.length) {
      for (var i = 0; i < WIRE_LINES.length; i++) wireDeck.push(i);
      for (i = wireDeck.length - 1; i > 0; i--) {
        var j = Math.floor(rng5() * (i + 1));
        var t = wireDeck[i]; wireDeck[i] = wireDeck[j]; wireDeck[j] = t;
      }
    }
    return WIRE_LINES[wireDeck.pop()];
  }
  var weatherBooted = false;
  var densifyNoticed = false;
  var nextCensusNotice = 10000;

  /* ---------------- simulation state ---------------- */

  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  var growthIndex = 1;                            // STEADY until console says otherwise
  var spawnTimer = 2.0;
  var ambientPop = 0;
  var displayedPop = -1;                          // forces first census broadcast
  var lastEmitted = -1;

  // eased weight per dial position — same architecture for both controls,
  // so any spam pattern on the console blends smoothly (primary use case)
  var timeTo = 2;                                 // MORNING, matching the console
  var timeLevel = [0, 0, 1, 0, 0, 0, 0, 0];
  var weatherTo = 0;                              // CLEAR, matching the console
  var weatherLevel = [1, 0, 0, 0];
  var effT = 0;                                   // clock for aurora waves + snow sway

  document.addEventListener('municitron:growth', function (e) {
    growthIndex = e.detail.index;
  });

  // before the first frame (a shared ?t=&w= link restoring a scene),
  // snap straight to the target instead of crossfading from the default
  document.addEventListener('municitron:time', function (e) {
    timeTo = e.detail.index;
    if (!lastTime) {
      for (var i = 0; i < 8; i++) timeLevel[i] = (i === timeTo) ? 1 : 0;
    }
  });

  document.addEventListener('municitron:weather', function (e) {
    weatherTo = e.detail.index;
    if (!lastTime) {
      for (var i = 0; i < 4; i++) weatherLevel[i] = (i === weatherTo) ? 1 : 0;
    }
    if (weatherBooted) {
      postBulletin(WEATHER_NOTICES[weatherTo]);
      if (weatherTo === 2) recordFirst('snow', 'FIRST SNOWFALL WITNESSED');
      if (weatherTo === 3) recordFirst('aurora', 'FIRST AURORA WITNESSED');
      // a change in the sky startles a rooftop flock
      var roost = city[Math.floor(rng6() * city.length)];
      if (roost.progress === 1 && rng6() < 0.6) {
        spawnFlock(roost.x + roost.w / 2, GROUND_Y - roost.h - 12, rng6() < 0.5 ? -1 : 1);
      }
    }
    weatherBooted = true;
  });

  var lastTransmit = -1;
  document.addEventListener('municitron:transmit', function () {
    postBulletin('POSTCARD TRANSMITTED — FORM PC-1 FILED');
    lastTransmit = bulletin.clock;
    tally('postcards');
  });

  // technicians' knob ritual: RAIN, SNOW, RAIN, AURORA summons the object
  var weatherHist = [];
  document.addEventListener('municitron:weather', function (e) {
    weatherHist.push(e.detail.index);
    if (weatherHist.length > 4) weatherHist.shift();
    if (weatherHist.join(',') === '1,2,1,3') {
      weatherHist.length = 0;
      document.dispatchEvent(new CustomEvent('municitron:ufo'));
    }
  });

  // demonstration captions preempt whatever the wire was saying
  document.addEventListener('municitron:caption', function (e) {
    bulletin.current = String(e.detail || '');
    bulletin.started = bulletin.clock;
    bulletin.until = bulletin.clock + 4.5;
  });

  // the commissioner's record desk (see js/record.js)
  document.addEventListener('municitron:record', function () {
    postBulletin('COMMISSIONER’S RECORD ISSUED — FORM CR-5');
    recordFirst('record', 'FIRST SELF-AUDIT REQUESTED');
  });

  // the factory test pattern (typed maintenance code on the console)
  var testPattern = 0;
  document.addEventListener('municitron:testpattern', function () {
    testPattern = 4;
    postBulletin('NAZARBAN TEST PATTERN PT-1 — CALIBRATION IN PROGRESS');
  });

  // a coin in the slot buys the town something real: the first funds the
  // streetlamps, every coin after that gets a small salute in the sky
  var streetlamps = false;
  document.addEventListener('municitron:coin', function () {
    if (!streetlamps) {
      streetlamps = true;
      postBulletin('ANONYMOUS BENEFACTOR FUNDS NEW STREETLAMPS — THANK YOU');
    } else {
      postBulletin('ANOTHER KIND CITIZEN — THE TOWN SALUTES YOU');
    }
    recordFirst('benefaction', 'FIRST BENEFACTION ENTERED');
    tally('coins');
    startShow(3);
  });

  // the almanac desk and the newsreel camera acknowledge their orders
  document.addEventListener('municitron:almanac', function () {
    postBulletin('MUNICIPAL ALMANAC ISSUED — FORM CA-2');
    recordFirst('almanac', 'FIRST ALMANAC CONSULTED');
  });
  document.addEventListener('municitron:newsreel', function () {
    postBulletin('NEWSREEL CAMERA ROLLING — LOOK CIVIC');
    newsreelCard = 1.5;                           // the reel opens on its title
  });
  document.addEventListener('municitron:newsreel-done', function () {
    postBulletin('NEWSREEL DEVELOPED — SCREENING IN THE LOBBY');
    recordFirst('newsreel', 'FIRST NEWSREEL FILMED');
    tally('newsreels');
  });

  // the census gauge issues incorporation papers (see js/certificate.js)
  document.addEventListener('municitron:certificate', function () {
    postBulletin('CERTIFICATE OF INCORPORATION ISSUED — FRAME IT PROUDLY');
    recordFirst('incorporation', 'FIRST INCORPORATION FILED');
    startShow(4);
  });
  document.addEventListener('municitron:certificate-denied', function () {
    postBulletin('INCORPORATION REQUIRES POP. 10,000 — KEEP BUILDING');
  });

  function builtMass() {
    var area = 0;
    var i;
    // census counts the PLANNED heights, so resizing the window never
    // deports anybody
    for (i = 0; i < city.length; i++) {
      area += city[i].w * (city[i].baseH || city[i].h) * easeOutCubic(city[i].progress);
    }
    for (i = 0; i < bgCity.length; i++) {
      area += bgCity[i].w * (bgCity[i].baseH || bgCity[i].h) * easeOutCubic(bgCity[i].progress) * BG_WEIGHT;
    }
    return area;
  }

  // demolition finished — the lot becomes its planned taller self
  function applyNext(b) {
    var n = b.next;
    b.h = n.h;
    b.baseH = n.baseH || n.h;
    b.color = n.color;
    b.cap = n.cap;
    b.door = n.door;
    b.windows = n.windows;
    b.mast = n.mast || false;
    b.next = null;
  }

  function easeLevels(levels, target, dt, fade) {
    var step = reducedMotion.matches ? 1 : dt / fade;
    for (var i = 0; i < levels.length; i++) {
      var goal = (i === target) ? 1 : 0;
      levels[i] += Math.max(-step, Math.min(step, goal - levels[i]));
    }
  }

  function update(dt) {
    var i, p;

    if (growthIndex > 0) {                        // DORMANT freezes construction
      spawnTimer -= dt;
      if (spawnTimer <= 0) {
        if (buildQueue.length) {
          var next = buildQueue.shift();
          queueUsed++;
          next.rising = true;
          if (reducedMotion.matches) { next.progress = 1; next.rising = false; }
          spawnTimer = SPAWN_INTERVAL[growthIndex] * next.jitter;
        } else if (denseQueue.length) {           // second act: densification
          var lot = denseQueue.shift();
          denseUsed++;
          if (reducedMotion.matches) { applyNext(lot); lot.progress = 1; }
          else { lot.demolishing = true; lot.rising = false; }
          spawnTimer = SPAWN_INTERVAL[growthIndex] * DENSIFY_PACE * lot.jitter;
          if (!densifyNoticed) {
            densifyNoticed = true;
            postBulletin('URBAN RENEWAL NOTICE — FORM D-4 POSTED');
          }
        }
      }
      for (i = 0; i < allBuildings.length; i++) {
        var b = allBuildings[i];
        if (b.demolishing) {
          b.progress = Math.max(0, b.progress - dt / (RISE_DURATION * 0.6));
          if (b.progress === 0) { applyNext(b); b.demolishing = false; b.rising = true; }
        } else if (b.rising) {
          b.progress = Math.min(1, b.progress + dt / RISE_DURATION);
          if (b.progress === 1) b.rising = false;
        }
      }
      ambientPop += AMBIENT_RATE[growthIndex] * dt;
    }

    easeLevels(timeLevel, timeTo, dt, TIME_FADE);
    easeLevels(weatherLevel, weatherTo, dt, WEATHER_FADE);

    if (!reducedMotion.matches) {
      effT += dt;
      whistleT = Math.max(0, whistleT - dt);

      // monorail: departs on its own clock, alternating direction
      if (monorail.active) {
        monorail.x += TRAIN_SPEED * dt * monorail.dir;
        if (monorail.x > VIEW_W + TRAIN_LEN + 40 || monorail.x < -TRAIN_LEN - 40) {
          monorail.active = false;
          monorail.dir = -monorail.dir;
          monorail.timer = 26 + rng4() * 38;
        }
      } else {
        monorail.timer -= dt;
        if (monorail.timer <= 0) {
          monorail.active = true;
          monorail.x = monorail.dir === 1 ? -TRAIN_LEN - 30 : VIEW_W + 30;
          if (rng4() < 0.35) {
            postBulletin('MONORAIL DEPARTING — PLATFORM ' + (monorail.dir === 1 ? '1' : '2'));
          }
        }
      }

      // sputnik: crosses high over the star field (visible when dark)
      if (sputnik.active) {
        sputnik.p += dt / 34;
        if (sputnik.p >= 1) { sputnik.active = false; sputnik.timer = 60 + rng4() * 90; }
      } else {
        sputnik.timer -= dt;
        if (sputnik.timer <= 0) { sputnik.active = true; sputnik.p = 0; }
      }

      // the Nazarban airship: a rare, slow dignitary
      if (airship.active) {
        airship.x += 26 * dt * airship.dir;
        if (airship.x > VIEW_W + 120 || airship.x < -120) {
          airship.active = false;
          airship.dir = -airship.dir;
          airship.timer = 100 + rng4() * 140;
        }
      } else {
        airship.timer -= dt;
        if (airship.timer <= 0) {
          airship.active = true;
          airship.y = (130 + rng4() * 70) * SKY_K;
          airship.x = airship.dir === 1 ? -110 : VIEW_W + 110;
        }
      }

      // flying aircars: bubble-canopy pods gliding the mid-sky lanes
      var acRun = 0;
      for (i = 0; i < aircars.length; i++) if (aircars[i].active) acRun++;
      for (i = 0; i < aircars.length; i++) {
        var ac = aircars[i];
        if (ac.active) {
          ac.x += ac.v * dt * ac.dir;
          if (ac.x < -130 || ac.x > VIEW_W + 130) { ac.active = false; ac.timer = 5 + rng4() * 13; }
        } else if (acRun < 2) {
          ac.timer -= dt;
          if (ac.timer <= 0) {
            ac.active = true; acRun++;
            ac.dir = rng4() < 0.5 ? -1 : 1;
            ac.y = (155 + rng4() * 150) * SKY_K;
            ac.v = 95 + rng4() * 85;
            ac.tone = Math.floor(rng4() * 3);
            ac.x = ac.dir === 1 ? -110 : VIEW_W + 110;
          }
        }
      }

      // the rocketport sends one up now and then
      var rl = landmarks[1];
      if (rl && rl.kind === 'rocket' && rl.commissioned && rl.progress >= 1) {
        if (rocketFX.phase === 0) {
          rocketFX.timer -= dt;
          if (rocketFX.timer <= 0) { rocketFX.phase = 1; rocketFX.t = 0; postBulletin('ROCKETPORT — COUNTDOWN COMMENCED, STAND CLEAR'); }
        } else if (rocketFX.phase === 1) {
          rocketFX.t += dt;
          if (smoke.length < SMOKE_MAX && rng6() < dt * 22) {
            smoke.push({ x: rl.x + 10 + (rng6() * 2 - 1) * 22, y: GROUND_Y - 6, r: 6 + rng6() * 5, vy: -(6 + rng6() * 8), vx: (rng6() * 2 - 1) * 12, life: 0, max: 2.2 + rng6() * 1.4 });
          }
          if (rocketFX.t > 1.3) { rocketFX.phase = 2; rocketFX.t = 0; rocketFX.y = 0; document.dispatchEvent(new CustomEvent('municitron:rocket-launch')); postBulletin('LIFT-OFF — THE ROCKETPORT REACHES FOR THE STARS'); }
        } else if (rocketFX.phase === 2) {
          rocketFX.t += dt;
          rocketFX.y += (60 + rocketFX.t * rocketFX.t * 150) * dt;
          if (smoke.length < SMOKE_MAX && rng6() < dt * 18) {
            smoke.push({ x: rl.x + 10 + (rng6() * 2 - 1) * 7, y: GROUND_Y - 40 - rocketFX.y * 0.35, r: 4 + rng6() * 3, vy: -(4 + rng6() * 5), vx: (rng6() * 2 - 1) * 6, life: 0, max: 1.8 + rng6() });
          }
          if (rocketFX.y > rl.h + 240) { rocketFX.phase = 3; rocketFX.t = 0; }
        } else {
          rocketFX.t += dt;
          if (rocketFX.t > 6) { rocketFX.phase = 0; rocketFX.timer = 40 + rng4() * 55; }
        }
      }

      // rocket-belt commuters cross the mid-sky
      if (jets.length < 2) {
        jetTimer -= dt;
        if (jetTimer <= 0) {
          jetTimer = 24 + rng6() * 44;
          var jd = rng6() < 0.5 ? -1 : 1;
          jets.push({ x: jd === 1 ? -40 : VIEW_W + 40, y: (150 + rng6() * 120) * SKY_K, dir: jd, v: 64 + rng6() * 40, ph: rng6() * 6.283, bob: 8 + rng6() * 10 });
        }
      }
      for (i = jets.length - 1; i >= 0; i--) {
        var jp = jets[i];
        jp.x += jp.v * dt * jp.dir;
        if (jp.x < -60 || jp.x > VIEW_W + 60) jets.splice(i, 1);
      }

      // the MECHANICAL MAN takes a turn down Main Street
      if (robot.active) {
        robot.ph += dt;
        robot.x += robot.v * dt * robot.dir;
        if (robot.x > CAR_R + 20 || robot.x < CAR_L - 20) { robot.active = false; robot.timer = 44 + rng6() * 60; }
      } else {
        robot.timer -= dt;
        if (robot.timer <= 0) {
          robot.active = true; robot.ph = 0;
          robot.dir = rng6() < 0.5 ? -1 : 1;
          robot.x = robot.dir === 1 ? CAR_L - 16 : CAR_R + 16;
          if (rng6() < 0.5 && eraHas('robot')) postBulletin('MECHANICAL MAN DEMONSTRATION ON MAIN STREET \u2014 QUITE SAFE');
        }
      }

      // ---- civic incidents ----
      // a rooftop fire: smolder → the brigade rides → the hose arcs → out.
      // Rain does half the brigade's work for it.
      if (fire.phase === 0) {
        fire.timer -= dt;
        if (fire.timer <= 0 && lastEmitted > 3000) {
          var fb = null, fg = 0;
          while (fg++ < 20 && !fb) {
            var cand2 = city[Math.floor(rng6() * city.length)];
            if (cand2.progress === 1 && !cand2.nazarban && cand2.h > 60 &&
                cand2.x > CAR_L + 40 && cand2.x + cand2.w < CAR_R - 40) fb = cand2;
          }
          if (fb) {
            fire.phase = 1; fire.t = 0; fire.b = fb; fire.burn = 0;
            var fcx = fb.x + fb.w / 2;
            fire.dir = fcx > (CAR_L + CAR_R) / 2 ? 1 : -1;
            fire.truckX = fire.dir === 1 ? CAR_L - 40 : CAR_R + 40;
            postBulletin('FIRE ON THE ROOFLINE — BRIGADE TURNING OUT');
            recordFirst('fire', 'FIRST FIRE ATTENDED — NO LOSSES');
            document.dispatchEvent(new CustomEvent('municitron:fire'));
          } else fire.timer = 30;
        }
      } else {
        fire.t += dt;
        var douse = 1 + weatherLevel[1] * 1.6;      // rain fights the fire too
        if (fire.phase === 1) {                     // smolder while the truck rides
          fire.burn = Math.min(1, fire.burn + dt * 0.55);
          var fdest = fire.b.x + (fire.dir === 1 ? -18 : fire.b.w + 18);
          fire.truckX += fire.dir * 120 * dt;
          if ((fire.dir === 1 && fire.truckX >= fdest) ||
              (fire.dir === -1 && fire.truckX <= fdest)) {
            fire.truckX = fdest; fire.phase = 2; fire.t = 0;
          }
        } else if (fire.phase === 2) {              // the hose does its work
          fire.burn = Math.max(0, fire.burn - dt * 0.3 * douse);
          if (fire.burn <= 0) {
            fire.phase = 3; fire.t = 0;
            postBulletin('FIRE OUT — BRIGADE COMMENDED, KETTLE ON');
          }
        } else if (fire.phase === 3 && fire.t > 2.5) {   // the brigade rolls home
          fire.phase = 0; fire.b = null;
          fire.timer = 200 + rng6() * 260;
        }
      }

      // a power outage: the grid drops all at once after dark, then
      // comes back block by block, west to east
      if (outage.phase === 0) {
        outage.timer -= dt;
        if (outage.timer <= 0) {
          if (curLit > 0.6 && lastEmitted > 4000) {
            outage.phase = 1; outage.t = 0;
            postBulletin('GRID FAULT — CITY DARK — CREWS DISPATCHED');
            recordFirst('outage', 'FIRST OUTAGE WEATHERED');
            document.dispatchEvent(new CustomEvent('municitron:outage'));
          } else outage.timer = 20;                 // try again when it's dark
        }
      } else if (outage.phase === 1) {
        outage.t += dt;
        if (outage.t > 2.4) {
          outage.phase = 2; outage.t = 0;
          outage.frontX = LAND_L > 0 ? LAND_L - 20 : -20;
        }
      } else if (outage.phase === 2) {
        outage.frontX += 170 * dt;                  // the restore wave
        if (outage.frontX > (LAND_R > 0 ? LAND_R : VIEW_W) + 40) {
          outage.phase = 0;
          outage.timer = 380 + rng6() * 420;
          postBulletin('POWER RESTORED BLOCK BY BLOCK — NAZARBAN HOUSE NEVER BLINKED');
        }
      }

      // the flying-saucer taxi calls at its pad
      if (taxi.phase === 0) {
        taxi.timer -= dt;
        if (taxi.timer <= 0) {
          taxi.phase = 1; taxi.t = 0;
          taxi.dir = rng4() < 0.5 ? -1 : 1;
          taxi.padX = LAND_L + 70 + rng4() * Math.max(40, (LAND_R - LAND_L) - 140);
          taxi.x = taxi.dir === 1 ? -60 : VIEW_W + 60;
          taxi.y = (66 + rng4() * 40) * SKY_K;
        }
      } else if (taxi.phase === 1) {
        taxi.x += (taxi.padX - taxi.x) * Math.min(1, dt * 1.4);
        if (Math.abs(taxi.x - taxi.padX) < 6) { taxi.phase = 2; taxi.t = 0; }
      } else if (taxi.phase === 2) {
        taxi.t += dt;
        taxi.y += ((GROUND_Y - 96) - taxi.y) * Math.min(1, dt * 1.7);
        if (taxi.t > 2.4) { taxi.phase = 3; taxi.t = 0; }
      } else if (taxi.phase === 3) {
        taxi.t += dt;
        if (taxi.t > 2.2) { taxi.phase = 4; taxi.t = 0; }
      } else {
        taxi.t += dt;
        taxi.y -= (36 + taxi.t * taxi.t * 60) * dt;
        taxi.x += taxi.dir * 28 * dt;
        if (taxi.y < -40) { taxi.phase = 0; taxi.timer = 30 + rng4() * 50; }
      }

      // street traffic scales with the census
      var wantCars = Math.max(2, Math.min(cars.length, Math.floor(lastEmitted / 3500)));
      var runningCars = 0;
      for (i = 0; i < cars.length; i++) if (cars[i].active) runningCars++;
      for (i = 0; i < cars.length; i++) {
        p = cars[i];
        if (p.active) {
          p.x += p.v * dt * p.dir;
          if (p.x > CAR_R + 10 || p.x + p.len < CAR_L - 10) {
            p.active = false;
            p.timer = 1 + rng4() * 7;
            runningCars--;
          }
        } else if (runningCars < wantCars) {
          p.timer -= dt;
          if (p.timer <= 0) {
            p.active = true;
            p.dir = rng4() < 0.5 ? -1 : 1;
            p.x = p.dir === 1 ? CAR_L - p.len : CAR_R;
            runningCars++;
          }
        }
      }

      // the iced months freeze whatever water the town has — harbor or
      // river — easing in and out so the freeze reads as weather, not a cut
      var iced = calendar.month === 11 || calendar.month <= 1;
      icedLevel += ((iced ? 1 : 0) - icedLevel) * Math.min(1, dt / 2);

      // the harbor ferry crosses the bay on its own schedule — except in
      // the iced months, when it stays tied up until the thaw
      if (harbor) {
        var waterL = harbor.side === 1 ? harbor.shore + 30 : -50;
        var waterR = harbor.side === 1 ? VIEW_W + 50 : harbor.shore - 30;
        if (ferry.active) {
          ferry.x += 34 * dt * ferry.dir;
          if (ferry.x > waterR + 30 || ferry.x < waterL - 30) {
            ferry.active = false;
            ferry.dir = -ferry.dir;
            ferry.timer = 40 + rng4() * 60;
          }
        } else if (!iced) {
          ferry.timer -= dt;
          if (ferry.timer <= 0) {
            ferry.active = true;
            ferry.x = ferry.dir === 1 ? waterL - 20 : waterR + 20;
            document.dispatchEvent(new CustomEvent('municitron:ferry'));
            if (rng4() < 0.4) postBulletin('FERRY DEPARTING — HOLD YOUR HAT ON DECK');
          }
        }
      }

      // the funicular: two counterbalanced cars, trips and pauses
      if (hill) {
        if (funi.moving) {
          funi.p += dt / 14 * funi.dir;
          if (funi.p >= 1 || funi.p <= 0) {
            funi.p = Math.max(0, Math.min(1, funi.p));
            funi.moving = false;
            funi.dir = -funi.dir;
            funi.timer = 10 + rng4() * 24;
          }
        } else {
          funi.timer -= dt;
          if (funi.timer <= 0) funi.moving = true;
        }
      }

      // a kite over the park in fair-weather months
      if (kite.active) {
        if (effT > kite.until) kite.active = false;
      } else {
        kite.timer -= dt;
        if (kite.timer <= 0) {
          kite.timer = 40 + rng6() * 70;
          var fair = calendar.month >= 2 && calendar.month <= 8 &&
                     weatherLevel[1] < 0.3 && weatherLevel[2] < 0.3 &&
                     (timeLevel[2] + timeLevel[3] + timeLevel[4]) > 0.5;
          if (fair) {
            kite.active = true;
            kite.until = effT + 26 + rng6() * 18;
            kite.ph = rng6() * 6.283;
            kite.anchor = park.x + (rng6() < 0.5 ? -34 : 34);
          }
        }
      }

      // one window light somewhere flips on/off now and then
      flickTimer -= dt;
      if (flickTimer <= 0) {
        flickTimer = 0.4 + rng4() * 0.7;
        var lot = city[Math.floor(rng4() * city.length)];
        if (lot.progress === 1 && lot.windows.length) {
          var pane = lot.windows[Math.floor(rng4() * lot.windows.length)];
          pane.flickUntil = effT + 1.5 + rng4() * 3.5;
        }
      }

      updateFireworks(dt);

      // clouds drift; smoke rises from whichever stacks are drawing
      for (i = 0; i < clouds.length; i++) {
        clouds[i].x += clouds[i].v * dt;
        if (clouds[i].x > VIEW_W + 130) clouds[i].x = -130;
      }
      smokeTimer -= dt;
      if (smokeTimer <= 0) {
        smokeTimer = 0.35 + rng6() * 0.5;
        var sb = city[Math.floor(rng6() * city.length)];
        if (sb.chimney && sb.progress === 1 && smoke.length < SMOKE_MAX && eraHas('smoke')) {
          smoke.push({
            x: sb.x + sb.chimney * sb.w,
            y: GROUND_Y - sb.h - 14,
            r: 3 + rng6() * 2.5,
            vy: -(9 + rng6() * 7),
            vx: -4 - 5 * weatherLevel[1],
            life: 0,
            max: 3 + rng6() * 2
          });
        }
      }
      for (i = smoke.length - 1; i >= 0; i--) {
        p = smoke[i];
        p.life += dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.r += 1.8 * dt;
        if (p.life > p.max) smoke.splice(i, 1);
      }

      // lightning while the storm is fully dialed in
      if (lightning.t > 0) lightning.t -= dt;
      if (weatherLevel[1] > 0.7) {
        lightning.cool -= dt;
        if (lightning.cool <= 0) {
          lightning.cool = 9 + rng6() * 14;
          lightning.t = 0.32;
          lightning.pts = makeBolt();
          document.dispatchEvent(new CustomEvent('municitron:lightning'));
        }
      }

      // parallax follows the pointer; after six idle seconds the camera
      // wanders on its own so the scene breathes untouched
      if (effT - lastPointer > 6) {
        parTarget = Math.sin(effT * 0.06) * 7;
        parTargetY = Math.sin(effT * 0.043) * 3;
      }
      parX += (parTarget - parX) * Math.min(1, dt * 2.5);
      parY += (parTargetY - parY) * Math.min(1, dt * 2.5);
      gust = Math.sin(effT * 0.13) * 0.6 + Math.sin(effT * 0.047) * 0.4;
      if (camPush > 0) camPush = Math.max(0, camPush - dt / 3.2);
      camPushSm += (camPush - camPushSm) * Math.min(1, dt * 2.2);
      if (eraFX.t > 0) eraFX.t = Math.max(0, eraFX.t - dt);
      if (newsreelCard > 0) newsreelCard = Math.max(0, newsreelCard - dt);

      // the parade marches until its tail clears the far edge
      if (parade.active) {
        parade.x += 34 * dt * parade.dir;
        if (parade.dir === 1 ? parade.x - 170 > VIEW_W + 20
                             : parade.x + 170 < -20) {
          parade.active = false;
        }
      }

      // birds commute at dawn and dusk
      birdTimer -= dt;
      if (birdTimer <= 0) {
        birdTimer = 26 + rng6() * 50;
        if (timeLevel[1] > 0.5 || timeLevel[5] > 0.5) {
          var bdir = rng6() < 0.5 ? -1 : 1;
          spawnFlock(bdir === 1 ? -60 : VIEW_W + 60, (140 + rng6() * 120) * SKY_K, bdir);
        }
      }
      for (i = birds.length - 1; i >= 0; i--) {
        p = birds[i];
        p.x += p.v * dt * p.dir;
        if (p.x < -220 || p.x > VIEW_W + 220) birds.splice(i, 1);
      }

      // the balloon regatta: a rare, slow procession
      if (regatta.active) {
        var allOut = true;
        for (i = 0; i < regatta.balloons.length; i++) {
          p = regatta.balloons[i];
          p.x += p.drift * dt * regatta.dir;
          if (p.x > -100 && p.x < VIEW_W + 100) allOut = false;
        }
        if (allOut) {
          regatta.active = false;
          regatta.timer = 200 + rng6() * 300;
        }
      } else {
        regatta.timer -= dt;
        if (regatta.timer <= 0) launchRegatta();
      }

      // the object officials decline to comment on
      if (ufo.active) {
        ufo.x += 260 * dt * ufo.dir;
        if (ufo.x < -80 || ufo.x > VIEW_W + 80) {
          ufo.active = false;
          ufo.timer = 500 + rng6() * 700;
        }
      } else {
        ufo.timer -= dt;
        if (ufo.timer <= 0) document.dispatchEvent(new CustomEvent('municitron:ufo'));
      }

      // the milk truck makes its rounds at first light
      if (milk.active) {
        milk.x += 46 * dt * milk.dir;
        if (milk.x > CAR_R + 20 || milk.x < CAR_L - 40) {
          milk.active = false;
          milk.timer = 60 + rng4() * 90;
        }
      } else if (timeLevel[1] + timeLevel[2] > 0.5) {
        milk.timer -= dt;
        if (milk.timer <= 0) {
          milk.active = true;
          milk.dir = rng4() < 0.5 ? -1 : 1;
          milk.x = milk.dir === 1 ? CAR_L - 30 : CAR_R + 4;
          document.dispatchEvent(new CustomEvent('municitron:milk'));
        }
      }

      // citizens stroll while the town is awake — and stop for fireworks
      // (or wherever they stand when the noon whistle blows)
      var gawking = fw.show > 0 || fw.sparks.length > 0 || whistleT > 0 || eclipseCover() > 0.4;
      var wantFolks = Math.max(1, Math.min(folks.length, 1 + Math.floor(lastEmitted / 6000)));
      if (timeTo === 0 || timeTo === 6 || timeTo === 7) wantFolks = Math.min(wantFolks, 2);
      var walking = 0;
      for (i = 0; i < folks.length; i++) if (folks[i].active) walking++;
      for (i = 0; i < folks.length; i++) {
        p = folks[i];
        if (p.active) {
          if (!gawking) p.x += p.v * dt * p.dir;
          if (p.x > CAR_R + 14 || p.x < CAR_L - 14) {
            p.active = false;
            p.timer = 6 + rng6() * 26;
            walking--;
          }
        } else if (walking < wantFolks) {
          p.timer -= dt;
          if (p.timer <= 0) {
            p.active = true;
            p.dir = rng6() < 0.5 ? -1 : 1;
            p.x = p.dir === 1 ? CAR_L - 8 : CAR_R + 8;
            walking++;
          }
        }
      }

      // autumn: leaves come off the park trees
      var autumn = calendar.month >= 8 && calendar.month <= 10;
      if (autumn && leaves.length < 26 && rng6() < dt * 1.4) {
        var lt = park.trees[Math.floor(rng6() * park.trees.length)];
        leaves.push({
          x: lt.x + (rng6() * 2 - 1) * lt.r * 0.8,
          y: GROUND_Y - 16 - lt.r * 0.8,
          vy: 10 + rng6() * 10,
          ph: rng6() * 6.283,
          f: 1 + rng6() * 1.5,
          amp: 8 + rng6() * 10,
          settle: 0,
          color: rng6() < 0.6 ? ORANGE : BRASS
        });
      }
      for (i = leaves.length - 1; i >= 0; i--) {
        p = leaves[i];
        if (p.settle > 0) {
          p.settle -= dt;
          if (p.settle <= 0) leaves.splice(i, 1);
        } else {
          p.y += p.vy * dt;
          if (p.y >= GROUND_Y - 2) {
            p.x += Math.sin(effT * p.f + p.ph) * p.amp;   // freeze where it swayed
            p.amp = 0;
            p.y = GROUND_Y - 2;
            p.settle = 2.2;
          }
        }
      }

      // mail call: the sister city writes
      if (mail.phase === 0) {
        mail.timer -= dt;
        if (mail.timer <= 0) {
          mail.phase = 1;
          mail.t = 0;
          postBulletin('MAIL FROM ' + SISTER_CITY + ' — POSTMARKED Nº ' +
                       SISTER_SEED.toString(16).toUpperCase());
          document.dispatchEvent(new CustomEvent('municitron:mail'));
        }
      } else {
        mail.t += dt;
        if (mail.phase === 1 && mail.t >= 0.8) { mail.phase = 2; mail.t = 0; }
        else if (mail.phase === 2 && mail.t >= 8) { mail.phase = 3; mail.t = 0; }
        else if (mail.phase === 3 && mail.t >= 0.8) {
          mail.phase = 0;
          mail.timer = 260 + rng6() * 240;
        }
      }

      // concert notes drift up from the bandstand and fade
      for (i = notes.length - 1; i >= 0; i--) {
        p = notes[i];
        p.life += dt;
        p.y -= p.vy * dt;
        if (p.life > p.max) notes.splice(i, 1);
      }

      // once in a while, a falling star — and in the shower months
      // (August, December) they come in flurries a few seconds apart
      var showerMonth = calendar.month === 7 || calendar.month === 11;
      if (shoot.t > 0) shoot.t -= dt;
      else {
        shoot.timer -= dt;
        if (showerMonth) {
          meteorTimer -= dt;
          if (meteorTimer <= 0) { meteorTimer = 2.5 + rng7() * 6; shoot.timer = 0; }
        }
        if (shoot.timer <= 0) {
          shoot.timer = 60 + rng6() * 120;
          shoot.t = 0.5;
          shoot.x = 150 + rng6() * 1150;
          shoot.y = (40 + rng6() * 120) * SKY_K;
          shoot.dx = (rng6() < 0.5 ? -1 : 1) * (200 + rng6() * 90);
          shoot.dy = 70 + rng6() * 50;
        }
      }

      // the town's own comet, on its long civic orbit
      if (comet.active) {
        comet.t += dt;
        comet.x += comet.vx * dt;
        comet.y += comet.vy * dt;
        if (comet.t >= comet.dur) {
          comet.active = false;
          comet.timer = 300 + rng7() * 400;
        }
      } else {
        comet.timer -= dt;
        if (comet.timer <= 0) {
          comet.active = true;
          comet.t = 0;
          comet.dur = 70 + rng7() * 30;
          var fromL = rng7() < 0.5;
          comet.x = fromL ? -60 : VIEW_W + 60;
          comet.y = (46 + rng7() * 60) * SKY_K;
          comet.vx = (fromL ? 1 : -1) * (VIEW_W + 120) / comet.dur;
          comet.vy = 8 / comet.dur;
          postBulletin(COMET_NAME + ' VISIBLE TONIGHT — ONCE A GENERATION');
          recordFirst('comet', 'FIRST COMET OBSERVED — ' + COMET_NAME);
        }
      }

      // and once in a great while, the moon crosses the sun
      if (eclipse.active) {
        eclipse.t += dt;
        if (eclipse.t >= eclipse.dur) {
          eclipse.active = false;
          eclipse.timer = 500 + rng7() * 500;
          postBulletin('ECLIPSE CONCLUDED — COMMERCE RESUMES');
        }
      } else {
        eclipse.timer -= dt;
        // only begin in full day and fair weather, so the covered sun shows
        if (eclipse.timer <= 0 && timeTo === 3 && timeLevel[3] > 0.9 &&
            weatherLevel[1] < 0.3 && weatherLevel[2] < 0.3) {
          eclipse.active = true;
          eclipse.t = 0;
          postBulletin('SOLAR ECLIPSE IN PROGRESS — DO NOT LOOK DIRECTLY');
          recordFirst('eclipse', 'FIRST ECLIPSE STOOD UNDER');
          document.dispatchEvent(new CustomEvent('municitron:eclipse'));
        }
      }

      // a rainbow when rain hands the sky back to daylight
      if (prevRain > 0.55 && weatherLevel[1] <= 0.55 && weatherTo === 0 &&
          timeTo >= 1 && timeTo <= 5) {
        rainbow = 1;
      }
      prevRain = weatherLevel[1];
      rainbow = Math.max(0, rainbow - dt / 26);

      // wrecking crews kick up dust at the shrinking roofline
      for (i = 0; i < city.length; i++) {
        var dz = city[i];
        if (dz.demolishing && rng6() < dt * 14) {
          puffDust(dz.x + rng6() * dz.w, GROUND_Y - dz.h * easeOutCubic(dz.progress));
        }
      }
      for (i = dust.length - 1; i >= 0; i--) {
        p = dust[i];
        p.life += dt;
        p.y += p.vy * dt;
        p.r += p.vr * dt;
        if (p.life > 1.1) dust.splice(i, 1);
      }

      if (weatherLevel[1] > 0.01) {
        for (i = 0; i < rain.length; i++) {
          p = rain[i];
          p.y += p.v * dt;
          p.x -= p.v * 0.22 * dt;
          if (p.y > GROUND_Y) { p.y -= GROUND_Y + 24; }
          if (p.x < -30) p.x += VIEW_W + 60;
        }
      }
      if (weatherLevel[2] > 0.01) {
        for (i = 0; i < snow.length; i++) {
          p = snow[i];
          p.y += p.v * dt;
          if (p.y > GROUND_Y - 2) { p.y -= GROUND_Y + 10; }
        }
      }
    }

    var target = Math.min(POP_MAX, builtMass() * DENSITY + ambientPop);

    // the census commissions landmarks; the console's XMIT lamp salutes
    for (i = 0; i < landmarks.length; i++) {
      var L = landmarks[i];
      if (!L.commissioned && growthIndex > 0 && target >= L.threshold) {
        L.commissioned = true;
        postBulletin(L.title + ' COMMISSIONED — FORM 7-B FILED');
        if (L.kind === 'wheel') postBulletin('DRIVE-IN MAKES ROOM — LAST PICTURE FRIDAY');
        recordFirst('landmark', 'FIRST LANDMARK COMMISSIONED');
        startShow(5);
        document.dispatchEvent(new CustomEvent('municitron:landmark', {
          detail: { kind: L.kind, title: L.title }
        }));
      }
      if (L.commissioned && L.progress < 1 && growthIndex > 0) {
        L.progress = reducedMotion.matches ? 1 : Math.min(1, L.progress + dt / LANDMARK_RISE);
      }
    }

    if (displayedPop < 0 || reducedMotion.matches) displayedPop = target;
    else displayedPop += (target - displayedPop) * Math.min(1, dt * 2);

    var whole = Math.floor(displayedPop);
    if (whole !== lastEmitted) {
      lastEmitted = whole;
      window.MUNICITRON_CITY.population = whole;
      document.dispatchEvent(new CustomEvent('municitron:population', { detail: whole }));
      if (whole >= nextCensusNotice) {
        postBulletin('CENSUS MILESTONE — POP. ' + nextCensusNotice.toLocaleString('en-US'));
        nextCensusNotice += 10000;
        startShow(4);
      }
    }

    if (testPattern > 0) testPattern -= dt;

    // file the growth ledger every so often
    saveTimer -= dt;
    if (saveTimer <= 0) {
      saveTimer = 8;
      saveCity();
    }

    // the civic calendar turns on its own clock, DORMANT or not
    calendar.t += dt;
    if (calendar.t >= MONTH_LEN) {
      calendar.t -= MONTH_LEN;
      advanceMonth();
    }
    if (foundersTimer >= 0) {
      foundersTimer -= dt;
      if (foundersTimer < 0) startShow(10);
    }

    // the town's open request, if any, watched on the wire's clock
    if (request.def) {
      if (request.def.ok()) {
        postBulletin(request.def.done);
        bumpGratitude();
        request.def = null;
        request.timer = 90 + rng5() * 90;
      } else if (bulletin.clock > request.until) {
        postBulletin('REQUEST WITHDRAWN — NO HARD FEELINGS');
        request.def = null;
        request.timer = 80 + rng5() * 80;
      }
    } else if (weatherBooted) {
      request.timer -= dt;
      if (request.timer <= 0) {
        request.openedAt = bulletin.clock;        // before the eligibility scan
        var open = [];
        for (i = 0; i < REQUESTS.length; i++) {
          if (!REQUESTS[i].ok()) open.push(REQUESTS[i]);
        }
        if (open.length) {
          request.def = open[Math.floor(rng5() * open.length)];
          request.until = bulletin.clock + 55;
          postBulletin('REQUEST: ' + request.def.text);
        } else {
          request.timer = 40;
        }
      }
    }

    // the town wire files a story when the board is quiet
    wireTimer -= dt;
    if (wireTimer <= 0) {
      wireTimer = 24 + rng5() * 36;
      if (!bulletin.queue.length) {
        var eraPool = ERA_WIRE[STYLE];               // the wire speaks the age
        postBulletin(eraPool && rng5() < 0.4
          ? eraPool[Math.floor(rng5() * eraPool.length)]
          : nextWireLine());
      }
    }

    // rotate the bulletin wire (its own clock — runs even in DORMANT)
    bulletin.clock += dt;
    if (bulletin.current && bulletin.clock > bulletin.until) bulletin.current = null;
    if (!bulletin.current && bulletin.queue.length) {
      bulletin.current = bulletin.queue.shift();
      bulletin.started = bulletin.clock;
      bulletin.until = bulletin.clock + 6.5;
    }
  }

  /* ---------------- persistent growth (localStorage, per seed) --------- */
  /* A returning commissioner finds their city as they left it: the same
     plan (that's the seed's job) grown to where it was. Stored per seed
     so shared links still start young for new visitors. */

  var CITY_KEY = 'municitron-m58-city-' + seed;
  var queueUsed = 0;
  var denseUsed = 0;
  var saveTimer = 8;

  function saveCity() {
    try {
      localStorage.setItem(CITY_KEY, JSON.stringify({
        q: queueUsed,
        d: denseUsed,
        ap: Math.round(ambientPop),
        cm: calendar.month,
        cy: calendar.year
      }));
    } catch (err) { /* storage may be unavailable; the toy shrugs */ }
  }

  var restoredCity = (function () {
    try {
      var s = JSON.parse(localStorage.getItem(CITY_KEY) || 'null');
      if (!s || !s.q) return false;
      var n = Math.min(s.q, buildQueue.length);
      for (var i = 0; i < n; i++) buildQueue.shift().progress = 1;
      queueUsed = n;
      var d = Math.min(s.d || 0, denseQueue.length);
      for (i = 0; i < d; i++) {
        var lot = denseQueue.shift();
        applyNext(lot);
        lot.progress = 1;
      }
      denseUsed = d;
      ambientPop = s.ap || 0;
      if (s.cm != null) { calendar.month = s.cm; calendar.year = s.cy || 1958; }
      // commission anything the restored census already earned — quietly
      var t = builtMass() * DENSITY + ambientPop;
      for (i = 0; i < landmarks.length; i++) {
        if (t >= landmarks[i].threshold) {
          landmarks[i].commissioned = true;
          landmarks[i].progress = 1;
        }
      }
      return true;
    } catch (err) { return false; }
  })();
  if (restoredCity) postBulletin('CITY RECORDS RESTORED — GROWTH ON FILE');

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') saveCity();
  });

  /* ---------------- canvas / dpr ---------------- */

  var canvas = document.getElementById('sim-canvas');
  // the sky fill covers every pixel every frame, so an opaque context
  // lets the browser skip alpha compositing the canvas into the page
  var ctx = canvas.getContext('2d', { alpha: false });

  /* ---------------- the city behind glass ---------------- */
  /* The canvas is an exhibit, not a control surface — every civic
     service is worked from the console below (the auxiliary rail
     carries what the plate, bandstand and sky clicks used to do). */

  document.addEventListener('municitron:concert', function () {
    flashNotice('CONCERT IN THE PARK — THE BANDSTAND STRIKES UP');
    if (reducedMotion.matches) return;
    var glyphs = ['♪', '♫', '♩'];
    for (var n = 0; n < 5 && notes.length < 18; n++) {
      notes.push({
        x: park.x - 14 + rng6() * 28,
        y: GROUND_Y - 40 - rng6() * 8,
        vy: 14 + rng6() * 8,
        ph: rng6() * 6.283,
        life: 0,
        max: 2.2 + rng6() * 0.8,
        g: glyphs[Math.floor(rng6() * 3)]
      });
    }
  });

  // the SALUTE key: a short commissioned fireworks show, plus a ripple
  // of window lights — the town comes out to watch
  document.addEventListener('municitron:salute', function () {
    flashNotice('FIREWORKS SALUTE — THE TOWN TURNS OUT TO WATCH');
    startShow(5);
    for (var i = 0; i < city.length; i++) {
      var wins = city[i].windows;
      for (var w = 0; w < wins.length; w++) {
        if (rng6() < 0.25) wins[w].flickUntil = effT + 0.3 + rng6() * 2.2;
      }
    }
  });

  // the REEL key advances the drive-in's picture
  document.addEventListener('municitron:reel', function () {
    reelShift++;
  });

  // the PARADE key: the band doesn't wait for July
  document.addEventListener('municitron:parade', function () {
    startParade('PARADE ORDERED — THE BAND FORMS UP ON MAIN STREET');
    tally('parades');
  });

  // the DAY LOG key prints the wire's recent traffic (js/daylog.js
  // composes Form DL-7); the printing itself makes the wire, of course
  document.addEventListener('municitron:daylog', function () {
    postBulletin('DAY LOG PRINTED — FORM DL-7');
  });

  // the calendar window doubles as a dial: a click turns the month
  // early, customs and all
  document.addEventListener('municitron:season', function () {
    calendar.t = 0;
    advanceMonth();
  });

  // the WHISTLE key: the fire station marks noon whenever the
  // commissioner says it's noon — folks stop mid-stride, a rooftop
  // flock objects, and every boiler in town lets off steam
  document.addEventListener('municitron:whistle', function () {
    flashNotice('NOON WHISTLE — LUNCH PAILS OPEN ACROSS TOWN');
    if (reducedMotion.matches) return;
    whistleT = 3;
    var roost = city[Math.floor(rng6() * city.length)];
    if (roost.progress === 1) {
      spawnFlock(roost.x + roost.w / 2, GROUND_Y - roost.h - 12, rng6() < 0.5 ? -1 : 1);
    }
    for (var s = 0; s < city.length; s++) {
      var sb = city[s];
      if (!sb.chimney || sb.progress !== 1 || !eraHas('smoke')) continue;
      for (var n = 0; n < 3 && smoke.length < SMOKE_MAX; n++) {
        smoke.push({
          x: sb.x + sb.chimney * sb.w,
          y: GROUND_Y - sb.h - 14 - n * 8,
          r: 4 + rng6() * 3,
          vy: -(16 + rng6() * 10),
          vx: -4 - 5 * weatherLevel[1],
          life: 0,
          max: 2 + rng6() * 1.5
        });
      }
    }
  });

  // the WIRE PHOTO desk acknowledges its order (js/wirephoto.js prints)
  document.addEventListener('municitron:wirephoto', function () {
    postBulletin('WIRE PHOTO DISPATCHED — HOLD FOR THE EVENING EDITION');
  });

  // the FORMS dial's fifth detent: the postcard album (js/album.js opens
  // the book; the wire just notes the occasion)
  document.addEventListener('municitron:album', function () {
    postBulletin('POSTCARD ALBUM OPENED — EVERY CARD ACCOUNTED FOR');
  });

  // the canvas lives inside the CSS transform-scaled machine, so the
  // on-screen size is rect × dpr; measuring forces a layout read, so we
  // only re-measure for a few frames after the events that can change it
  // (the same triggers the console's fit() listens to)
  var measureFrames = 3;
  function requestMeasure() { measureFrames = 3; }
  window.addEventListener('resize', requestMeasure);
  window.addEventListener('load', requestMeasure);
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(requestMeasure).observe(document.documentElement);
  }

  function fitBackingStore() {
    var rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    // flat poster shapes gain nothing above 2× — capping the backing
    // store keeps 3×-density screens at a quarter of the pixel work
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = Math.round(rect.width * dpr);
    var h = Math.round(rect.height * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    return true;
  }

  /* ---------------- drawing ---------------- */

  function dotPath(x, y, r) {
    ctx.moveTo(x + r, y);
    ctx.arc(x, y, r, 0, Math.PI * 2);
  }

  // an upright rounded-corner window pane, centered on (x, y); falls
  // back to a square-cornered pane where Path2D.roundRect is missing
  var HAS_RRECT = typeof Path2D !== 'undefined' && !!Path2D.prototype.roundRect;
  function panePath(path, x, y, w, h) {
    if (HAS_RRECT) path.roundRect(x - w / 2, y - h / 2, w, h, w * 0.3);
    else path.rect(x - w / 2, y - h / 2, w, h);
  }

  function drawCelestial(cel, alpha, sky) {
    if (alpha <= 0.01) return;
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.fillStyle = cel.color;
    ctx.beginPath();
    ctx.arc(cel.x, cel.y, cel.r, 0, Math.PI * 2);
    ctx.fill();
    if (cel.kind === 'moon') {                    // phases: punch with sky color
      // the punch disc slides with the calendar — new crescent, quarter,
      // gibbous, and clear of the face entirely on full-moon months
      var ph = ((calendar.month % 4) + calendar.t) / 4;   // 0→1 lunation
      var off = 0.38 + ph * 1.9;                  // slides off to the right
      if (off < 1.86) {
        ctx.fillStyle = sky;
        ctx.beginPath();
        ctx.arc(cel.x + cel.r * off, cel.y - cel.r * 0.22, cel.r * 0.86, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (cel.kind === 'sun') {                     // the eclipse, when it comes
      var cov = eclipseCover();
      if (cov > 0.01) {
        var p = eclipse.t / eclipse.dur;
        ctx.fillStyle = sky;
        ctx.beginPath();                          // the moon disc crossing
        ctx.arc(cel.x + cel.r * 2.4 * (0.5 - p) * 2, cel.y - cel.r * 0.1, cel.r * 0.98, 0, Math.PI * 2);
        ctx.fill();
        if (cov > 0.75) {                         // corona at totality
          ctx.strokeStyle = 'rgba(242, 233, 210, ' + ((cov - 0.75) * 2.4).toFixed(3) + ')';
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.arc(cel.x, cel.y, cel.r + 3, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawAurora(alpha) {
    if (alpha <= 0.01) return;
    for (var r = 0; r < AURORA_RIBBONS.length; r++) {
      var rb = AURORA_RIBBONS[r];
      ctx.fillStyle = 'rgba(' + rb.color + ',' + (rb.a * alpha).toFixed(3) + ')';
      ctx.beginPath();
      var x;
      for (x = 0; x <= VIEW_W; x += 50) {
        var y = rb.base * SKY_K + Math.sin(x * rb.f + effT * rb.sp) * rb.amp
                        + Math.sin(x * rb.f * 2.3 + effT * rb.sp * 1.6) * rb.amp * 0.35;
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      for (x = VIEW_W; x >= 0; x -= 50) {
        var y2 = rb.base * SKY_K + rb.th
               + Math.sin(x * rb.f * 1.3 + effT * rb.sp * 0.8) * 9
               + Math.sin(x * rb.f + effT * rb.sp) * rb.amp
               + Math.sin(x * rb.f * 2.3 + effT * rb.sp * 1.6) * rb.amp * 0.35;
        ctx.lineTo(x, y2);
      }
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawRain(alpha, skyLum) {
    if (alpha <= 0.01 || reducedMotion.matches) return;
    ctx.strokeStyle = skyLum > 0.45 ? 'rgba(22,51,47,0.55)' : 'rgba(232,220,192,0.45)';
    ctx.lineWidth = 2;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    for (var i = 0; i < rain.length; i++) {
      var p = rain[i];
      if (p.y < -30) continue;
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - (0.22 + gust * 0.34) * p.l, p.y + p.l);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function drawSnow(alpha) {
    if (alpha <= 0.01 || reducedMotion.matches) return;
    ctx.fillStyle = CREAM_HI;
    ctx.globalAlpha = alpha * 0.95;
    ctx.beginPath();
    for (var i = 0; i < snow.length; i++) {
      var p = snow[i];
      var sway = Math.sin(effT * p.f + p.ph) * p.amp + gust * 26;
      dotPath(((p.x + sway) % VIEW_W + VIEW_W) % VIEW_W, p.y, p.r);
    }
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function coloredDots(dots, r, lit, fill, glowFill) {
    var i;
    if (lit > 0.55) {
      ctx.fillStyle = glowFill;
      ctx.beginPath();
      for (i = 0; i < dots.length; i++) dotPath(dots[i][0], dots[i][1], r + 4);
      ctx.fill();
    }
    ctx.fillStyle = fill;
    ctx.beginPath();
    for (i = 0; i < dots.length; i++) dotPath(dots[i][0], dots[i][1], r);
    ctx.fill();
  }

  function brassDots(dots, r, lit) {
    coloredDots(dots, r, lit, BRASS, GLOW_BRASS);
  }

  function drawSaucer(cx, H, lit) {
    var top = GROUND_Y - H;
    var sy = top + 46;
    ctx.fillStyle = '#183B37';                    // base flare
    ctx.beginPath();
    ctx.moveTo(cx - 36, GROUND_Y);
    ctx.lineTo(cx - 4, GROUND_Y - 130);
    ctx.lineTo(cx + 4, GROUND_Y - 130);
    ctx.lineTo(cx + 36, GROUND_Y);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#1E4744';                    // shaft
    ctx.fillRect(cx - 6, sy, 12, GROUND_Y - sy);
    ctx.fillStyle = BRASS;                        // spire
    ctx.fillRect(cx - 1.5, sy - 36, 3, 24);
    ctx.beginPath(); ctx.arc(cx, sy - 38, 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = TEAL_TRIM;                    // under-disc shadow plate
    ctx.beginPath(); ctx.ellipse(cx, sy + 8, 40, 9, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = CREAM_HI;                     // the saucer
    ctx.beginPath(); ctx.ellipse(cx, sy, 54, 14, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#235450';                    // cabin dome
    ctx.beginPath(); ctx.ellipse(cx, sy - 8, 22, 11, 0, Math.PI, 0); ctx.fill();
    var dots = [];
    for (var wx = -36; wx <= 36; wx += 18) dots.push([cx + wx, sy + 2]);
    brassDots(dots, 2.5, lit);
  }

  function drawRocket(cx, H, lit) {
    var top = GROUND_Y - H;
    var bx = cx + 10;
    var lift = rocketFX.phase >= 1 ? rocketFX.y : 0;   // launch offset (ship only)
    var gone = rocketFX.phase === 3;
    ctx.fillStyle = TEAL_TRIM;                    // launch platform
    ctx.fillRect(cx - 70, GROUND_Y - 10, 140, 10);
    ctx.fillStyle = '#183B37';                    // gantry mast (retracts for launch)
    var swing = rocketFX.phase === 0 ? 0 : (rocketFX.phase === 1 ? easeOutCubic(Math.min(1, rocketFX.t / 1.3)) : 1);
    ctx.save();
    ctx.translate(-swing * 50, 0);
    ctx.globalAlpha = 1 - swing * 0.55;
    ctx.fillRect(cx - 52, top + 30, 14, GROUND_Y - top - 40);
    ctx.fillStyle = BRASS;                        // gantry rungs to the ship
    for (var yy = top + 44; yy < GROUND_Y - 20; yy += 22) {
      ctx.fillRect(cx - 56, yy, 30, 2);
    }
    if (rocketFX.phase === 1) {                   // countdown lights climb the gantry
      var litN = Math.floor((rocketFX.t / 1.3) * 5);
      for (var cl = 0; cl < 5; cl++) {
        var on = cl <= litN;
        if (on) { ctx.shadowBlur = 6; ctx.shadowColor = ORANGE; }
        ctx.fillStyle = on ? ORANGE : 'rgba(120,60,30,0.6)';
        ctx.beginPath(); ctx.arc(cx - 45, top + 42 + cl * 14, 2.6, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
      }
    }
    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.fillStyle = ORANGE;                       // fins
    if (!gone) {
    ctx.beginPath();
    ctx.moveTo(bx - 16, GROUND_Y - 64 - lift); ctx.lineTo(bx - 34, GROUND_Y - 10 - lift); ctx.lineTo(bx - 16, GROUND_Y - 10 - lift);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(bx + 16, GROUND_Y - 64 - lift); ctx.lineTo(bx + 34, GROUND_Y - 10 - lift); ctx.lineTo(bx + 16, GROUND_Y - 10 - lift);
    ctx.closePath(); ctx.fill();
    if (rocketFX.phase === 1 || rocketFX.phase === 2) {   // exhaust flame
      var fl = rocketFX.phase === 1 ? 8 + 30 * (rocketFX.t / 1.3) : 42 + Math.sin(effT * 40) * 9;
      var fbY = GROUND_Y - 10 - lift;
      ctx.fillStyle = GLOW_ORANGE;
      ctx.beginPath(); ctx.moveTo(bx - 13, fbY); ctx.quadraticCurveTo(bx, fbY + fl * 1.25, bx + 13, fbY); ctx.closePath(); ctx.fill();
      ctx.fillStyle = ORANGE;
      ctx.beginPath(); ctx.moveTo(bx - 8, fbY); ctx.quadraticCurveTo(bx, fbY + fl, bx + 8, fbY); ctx.closePath(); ctx.fill();
      ctx.fillStyle = CREAM_HI;
      ctx.beginPath(); ctx.moveTo(bx - 4, fbY); ctx.quadraticCurveTo(bx, fbY + fl * 0.6, bx + 4, fbY); ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = CREAM_HI;                     // hull
    ctx.fillRect(bx - 16, top + 62 - lift, 32, GROUND_Y - top - 72);
    ctx.fillStyle = ORANGE;                       // nose cone
    ctx.beginPath();
    ctx.moveTo(bx - 16, top + 64 - lift);
    ctx.quadraticCurveTo(bx, top + 4 - lift, bx + 16, top + 64 - lift);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#1E4744';                    // hull band
    ctx.fillRect(bx - 16, top + 92 - lift, 32, 8);
    var dots = [];
    for (var d = 0; d < 3; d++) dots.push([bx, top + 132 + d * 36 - lift]);
    brassDots(dots, 3.5, lit);
    }
  }

  function drawAtom(cx, H, lit) {
    var top = GROUND_Y - H;
    var ey = top + 52;                            // emblem nucleus
    ctx.fillStyle = TEAL_TRIM;                    // plinth
    ctx.fillRect(cx - 78, GROUND_Y - 12, 156, 12);
    ctx.fillStyle = '#1E4744';                    // dome
    ctx.beginPath(); ctx.ellipse(cx, GROUND_Y - 12, 72, 92, 0, Math.PI, 0); ctx.fill();
    ctx.fillStyle = CREAM_HI;                     // entry arch
    ctx.beginPath(); ctx.ellipse(cx, GROUND_Y - 12, 15, 26, 0, Math.PI, 0); ctx.fill();
    ctx.fillStyle = BRASS;                        // emblem support rod
    ctx.fillRect(cx - 1.5, ey + 12, 3, (GROUND_Y - 104) - (ey + 12));
    ctx.strokeStyle = BRASS;                      // electron orbits
    ctx.lineWidth = 2;
    var rots = [0, Math.PI / 3, (2 * Math.PI) / 3];
    var r;
    for (r = 0; r < 3; r++) {
      ctx.beginPath();
      ctx.ellipse(cx, ey, 38, 13, rots[r], 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = BRASS;                        // nucleus
    ctx.beginPath(); ctx.arc(cx, ey, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = ORANGE;                       // orbiting electrons
    for (r = 0; r < 3; r++) {
      var ang = effT * (0.9 + r * 0.35) + r * 2.1;
      var ex = Math.cos(ang) * 38, eyy = Math.sin(ang) * 13;
      var rot = rots[r];
      ctx.beginPath();
      ctx.arc(cx + ex * Math.cos(rot) - eyy * Math.sin(rot),
              ey + ex * Math.sin(rot) + eyy * Math.cos(rot), 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // the permanent fairground: a Ferris wheel that never stops turning
  function drawWheel(cx, H, lit) {
    var R = (H - 44) / 2;
    var cy = GROUND_Y - 24 - R;
    var ang = reducedMotion.matches ? 0.3 : effT * 0.12;
    var i, ga, gx, gy;

    ctx.fillStyle = TEAL_TRIM;                    // plinth
    ctx.fillRect(cx - 64, GROUND_Y - 10, 128, 10);
    ctx.fillStyle = '#183B37';                    // A-frame legs
    ctx.beginPath();
    ctx.moveTo(cx - 4, cy); ctx.lineTo(cx - 48, GROUND_Y - 10); ctx.lineTo(cx - 34, GROUND_Y - 10);
    ctx.lineTo(cx - 1, cy + 8);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx + 4, cy); ctx.lineTo(cx + 48, GROUND_Y - 10); ctx.lineTo(cx + 34, GROUND_Y - 10);
    ctx.lineTo(cx + 1, cy + 8);
    ctx.closePath(); ctx.fill();

    ctx.strokeStyle = '#1E4744';                  // eight spokes
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (i = 0; i < 8; i++) {
      ga = ang + i * Math.PI / 4;
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(ga) * R, cy + Math.sin(ga) * R);
    }
    ctx.stroke();
    ctx.strokeStyle = BRASS;                      // double rim
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 1.2;
    ctx.globalAlpha = 0.7;
    ctx.beginPath(); ctx.arc(cx, cy, R - 8, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;

    var glow = [];
    for (i = 0; i < 8; i++) {                     // gondolas swing upright
      ga = ang + i * Math.PI / 4;
      gx = cx + Math.cos(ga) * R;
      gy = cy + Math.sin(ga) * R;
      ctx.strokeStyle = TEAL_TRIM;
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(gx, gy + 5); ctx.stroke();
      ctx.fillStyle = i % 2 ? ORANGE : CREAM_HI;
      ctx.beginPath();                            // round-bottomed bucket
      ctx.moveTo(gx - 7, gy + 5);
      ctx.lineTo(gx + 7, gy + 5);
      ctx.quadraticCurveTo(gx + 6, gy + 12, gx, gy + 12.5);
      ctx.quadraticCurveTo(gx - 6, gy + 12, gx - 7, gy + 5);
      ctx.closePath(); ctx.fill();
      glow.push([gx, gy + 8]);
    }
    if (lit > 0.55) {                             // carnival lights at night
      ctx.fillStyle = GLOW_BRASS;
      ctx.beginPath();
      for (i = 0; i < glow.length; i++) dotPath(glow[i][0], glow[i][1], 8);
      ctx.fill();
    }
    ctx.fillStyle = BRASS;                        // hub
    ctx.beginPath(); ctx.arc(cx, cy, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = ORANGE;
    ctx.beginPath(); ctx.arc(cx, cy, 2.5, 0, Math.PI * 2); ctx.fill();
  }

  // the drive-in: a cleared lot, a big screen, and on good nights a
  // picture nobody in the front row will describe the same way twice
  function drawDriveIn(litLevel) {
    if (!driveIn || !eraHas('driveIn')) return;
    var x = driveIn.x;
    var showing = litLevel > 0.6;
    var wheelUp = landmarks[3].progress > 0;      // the fairground took the lot

    if (!wheelUp) {
      if (showing && !reducedMotion.matches) {    // spill light on the lot
        ctx.fillStyle = 'rgba(242, 233, 210, 0.07)';
        ctx.beginPath();
        ctx.moveTo(x - 51, GROUND_Y - 88);
        ctx.lineTo(x + 51, GROUND_Y - 88);
        ctx.lineTo(x + 78, GROUND_Y);
        ctx.lineTo(x - 78, GROUND_Y);
        ctx.closePath(); ctx.fill();
      }
      ctx.fillStyle = TEAL_TRIM;                  // screen legs
      ctx.fillRect(x - 46, GROUND_Y - 28, 6, 28);
      ctx.fillRect(x + 40, GROUND_Y - 28, 6, 28);
      ctx.fillStyle = '#183B37';                  // screen frame
      ctx.fillRect(x - 55, GROUND_Y - 94, 110, 68);
      if (!reducedMotion.matches) {              // the picture always rolls
        var reel = Math.floor(effT / 2.8) + reelShift;
        var fields = ['#235450', ORANGE, '#1E4744', BRASS];
        var f1 = fields[((reel % 4) + 4) % 4];
        var f2 = fields[(((reel + 2) % 4) + 4) % 4];
        ctx.globalAlpha = 0.92 + 0.08 * Math.sin(effT * 30); // projector flutter
        ctx.fillStyle = f1;                       // the scene
        ctx.fillRect(x - 51, GROUND_Y - 88, 102, 56);
        ctx.fillStyle = f2;                       // its horizon
        ctx.fillRect(x - 51, GROUND_Y - 48, 102, 3);
        ctx.beginPath();                          // the abstract lead
        ctx.arc(x - 41 + ((effT * 9) % 82), GROUND_Y - 62, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#10201D';                // letterbox bars
        ctx.fillRect(x - 51, GROUND_Y - 88, 102, 5);
        ctx.fillRect(x - 51, GROUND_Y - 37, 102, 5);
        ctx.globalAlpha = 1;
      } else {                                    // matinée-blank cream
        ctx.fillStyle = showing ? CREAM_HI : '#E8DCC0';
        ctx.fillRect(x - 51, GROUND_Y - 90, 102, 60);
      }
      var mq = [];                                // marquee bulbs on the hood
      for (var mb = -44; mb <= 44; mb += 11) mq.push([x + mb, GROUND_Y - 97]);
      brassDots(mq, 1.6, showing ? 1 : 0);
    }

    ctx.fillStyle = TEAL_TRIM;                    // the audience, parked:
    var lot = [-38, -8, 22];                      // little fastback coupes
    for (var ci = 0; ci < lot.length; ci++) {
      var px = x + lot[ci];
      ctx.beginPath();
      ctx.moveTo(px, GROUND_Y - 1.5);
      ctx.lineTo(px, GROUND_Y - 4);
      ctx.quadraticCurveTo(px + 1, GROUND_Y - 5.2, px + 4, GROUND_Y - 5.4);
      ctx.quadraticCurveTo(px + 7, GROUND_Y - 8.2, px + 11, GROUND_Y - 8.2);
      ctx.quadraticCurveTo(px + 15, GROUND_Y - 8.2, px + 17, GROUND_Y - 5.2);
      ctx.quadraticCurveTo(px + 19.5, GROUND_Y - 4.8, px + 20, GROUND_Y - 3);
      ctx.lineTo(px + 20, GROUND_Y - 1.5);
      ctx.closePath(); ctx.fill();
      ctx.beginPath();                            // wheels under the skirts
      dotPath(px + 4.5, GROUND_Y - 1.5, 1.7);
      dotPath(px + 15.5, GROUND_Y - 1.5, 1.7);
      ctx.fill();
    }

    ctx.fillStyle = TEAL_TRIM;                    // marquee: pole + orange lozenge
    ctx.fillRect(x + 60, GROUND_Y - 34, 3, 34);
    ctx.save();
    ctx.translate(x + 61.5, GROUND_Y - 40);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = ORANGE;
    ctx.fillRect(-6, -6, 12, 12);
    ctx.restore();
    ctx.fillStyle = BRASS;
    ctx.beginPath(); ctx.arc(x + 61.5, GROUND_Y - 40, 2, 0, Math.PI * 2); ctx.fill();
  }

  // an uncommissioned plaza holds a survey board announcing what's coming
  function drawVacantSign(x, title, kind) {
    var pw = 100, ph = 30, py = GROUND_Y - 60;
    ctx.fillStyle = TEAL_TRIM;                    // survey stakes
    ctx.fillRect(x - pw / 2 + 8, py + ph, 3, 30);
    ctx.fillRect(x + pw / 2 - 11, py + ph, 3, 30);
    ctx.fillStyle = CREAM_HI;                     // the board
    ctx.fillRect(x - pw / 2, py, pw, ph);
    ctx.fillStyle = ORANGE;                       // header ribbon
    ctx.fillRect(x - pw / 2, py, pw, 10);
    ctx.strokeStyle = TEAL_TRIM; ctx.lineWidth = 2;
    ctx.strokeRect(x - pw / 2, py, pw, ph);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '1px';
    ctx.fillStyle = CREAM_HI;
    ctx.font = '700 6.5px Jost, Futura, sans-serif';
    ctx.fillText('FUTURE SITE OF', x, py + 5.5);
    ctx.fillStyle = TEAL_TRIM;                    // the promised landmark, sized to fit
    var tfs = 9;
    ctx.font = '700 ' + tfs + 'px Jost, Futura, sans-serif';
    var t = title || 'A CIVIC WONDER';
    while (ctx.measureText(t).width > pw - 12 && tfs > 5.5) { tfs -= 0.5; ctx.font = '700 ' + tfs + 'px Jost, Futura, sans-serif'; }
    ctx.fillText(t, x, py + 20);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.strokeStyle = BRASS; ctx.lineWidth = 1.1; ctx.lineCap = 'round';   // artist's-impression starburst
    ctx.beginPath();
    for (var s = 0; s < 8; s++) { var a = s * Math.PI / 4, rr = s % 2 ? 2.5 : 5; ctx.moveTo(x - pw / 2 + 10, py - 4); ctx.lineTo(x - pw / 2 + 10 + Math.cos(a) * rr, py - 4 + Math.sin(a) * rr); }
    ctx.stroke(); ctx.lineCap = 'butt';
  }

  // era-specific accents layered onto the commissioned landmarks
  function drawLandmarkEra(L, litLevel) {
    var s = STYLE; if (s === 'atompunk') return;
    var x = L.x, top = GROUND_Y - L.h * easeOutCubic(L.progress), night = litLevel > 0.5, i;
    if (s === 'cyberpunk') {
      if (!reducedMotion.matches) {
        ctx.fillStyle = glowRGBA(NEON_CYAN, 0.10);
        for (i = 0; i < 5; i++) { var sy = top + ((effT * 40 + i * 60) % Math.max(1, GROUND_Y - top)); ctx.fillRect(x - 60, sy, 120, 1.5); }
      }
      if (night) { ctx.shadowBlur = 8; ctx.shadowColor = NEON_PINK; }
      ctx.strokeStyle = glowRGBA(NEON_PINK, night ? 0.8 : 0.35); ctx.lineWidth = 2;
      var bk = 12;
      ctx.beginPath();
      ctx.moveTo(x - 62, GROUND_Y - 2 - bk); ctx.lineTo(x - 62, GROUND_Y - 2); ctx.lineTo(x - 62 + bk, GROUND_Y - 2);
      ctx.moveTo(x + 62, GROUND_Y - 2 - bk); ctx.lineTo(x + 62, GROUND_Y - 2); ctx.lineTo(x + 62 - bk, GROUND_Y - 2);
      ctx.stroke(); ctx.shadowBlur = 0;
      ctx.fillStyle = glowRGBA(NEON_CYAN, 0.6); ctx.fillRect(x - 62, GROUND_Y - 3, 124, 1.6);
    } else if (s === 'steampunk') {
      drawGear(x - 42, GROUND_Y - 14, 16, 10, effT * 0.4, 'rgba(224,169,78,0.7)');
      drawGear(x + 44, GROUND_Y - 12, 12, 8, -effT * 0.5, 'rgba(198,96,42,0.6)');
      ctx.fillStyle = BRASS; for (var rx = x - 54; rx <= x + 54; rx += 12) { ctx.beginPath(); ctx.arc(rx, GROUND_Y - 4, 1.4, 0, Math.PI * 2); ctx.fill(); }
      if (!reducedMotion.matches) { ctx.fillStyle = 'rgba(232,222,200,0.28)'; var puy = top - ((effT * 16) % 30); ctx.beginPath(); ctx.arc(x + 22, puy, 5, 0, Math.PI * 2); ctx.fill(); }
    } else if (s === 'solarpunk') {
      ctx.fillStyle = '#2E7D4F'; for (i = -1; i <= 1; i++) { ctx.beginPath(); ctx.arc(x + i * 42, GROUND_Y, 8 + (i === 0 ? 3 : 0), Math.PI, 0); ctx.fill(); }
      ctx.fillStyle = '#3E9A63'; for (var gx = x - 52; gx <= x + 52; gx += 9) { ctx.beginPath(); ctx.arc(gx, GROUND_Y - 2, 2.5, Math.PI, 0); ctx.fill(); }
    } else if (s === 'silkpunk') {
      for (i = -1; i <= 1; i += 2) {
        var lx = x + i * 46;
        ctx.strokeStyle = TEAL_TRIM; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(lx, top + 6); ctx.lineTo(lx, top + 18); ctx.stroke();
        if (night) { ctx.shadowBlur = 6; ctx.shadowColor = ORANGE; }
        ctx.fillStyle = night ? glowRGBA(ORANGE, 0.9) : ORANGE; ctx.beginPath(); ctx.ellipse(lx, top + 22, 4, 6, 0, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
      }
    }
  }

  // commissioned landmarks reveal bottom-up behind a construction curtain
  function drawLandmark(L, litLevel) {
    // the wheel's lot is the drive-in until the day it isn't
    if (L.progress <= 0) { if (L.kind !== 'wheel') drawVacantSign(L.x, L.title, L.kind); return; }
    var revealH = L.h * easeOutCubic(L.progress) + 44;   // headroom for spires
    if (L.kind === 'rocket' && rocketFX.phase >= 2) revealH += rocketFX.y + 80;   // room for the launch
    ctx.save();
    ctx.beginPath();
    ctx.rect(L.x - 115, GROUND_Y - revealH, 230, revealH);
    ctx.clip();
    if (L.kind === 'saucer') drawSaucer(L.x, L.h, litLevel);
    else if (L.kind === 'rocket') drawRocket(L.x, L.h, litLevel);
    else if (L.kind === 'wheel') drawWheel(L.x, L.h, litLevel);
    else drawAtom(L.x, L.h, litLevel);
    drawLandmarkEra(L, litLevel);
    ctx.restore();
  }

  function drawMonorail(litLevel) {
    ctx.fillStyle = TEAL_TRIM;                    // pylons
    for (var px = 90; px < VIEW_W + 40; px += 260) {
      ctx.fillRect(px - 5, RAIL_Y + 5, 10, GROUND_Y - RAIL_Y - 5);
    }
    ctx.fillRect(0, RAIL_Y, VIEW_W, 7);           // beam
    ctx.fillStyle = BRASS;
    ctx.fillRect(0, RAIL_Y - 2, VIEW_W, 2);       // brass running rail
    if (weatherLevel[2] > 0.05) {                 // snow settles on the beam
      ctx.globalAlpha = weatherLevel[2] * 0.9;
      ctx.fillStyle = CREAM_HI;
      ctx.fillRect(0, RAIL_Y - 4, VIEW_W, 2.5);
      ctx.globalAlpha = 1;
    }

    if (!monorail.active || reducedMotion.matches) return;
    var x = monorail.x;
    var d = monorail.dir;
    var y = RAIL_Y - 26;                          // roofline
    var noseX = d === 1 ? x + TRAIN_LEN : x;      // leading end
    var tailX = d === 1 ? x : x + TRAIN_LEN;
    var night = litLevel > 0.55;
    if (STYLE !== 'atompunk') { drawTrainEra(STYLE, x, d, night); return; }

    if (night) {                                  // headlight throw, cast ahead
      ctx.fillStyle = 'rgba(242, 233, 210, 0.10)';
      ctx.beginPath();
      ctx.moveTo(noseX - d * 4, y + 13);
      ctx.lineTo(noseX + d * 58, y + 6);
      ctx.lineTo(noseX + d * 58, y + 22);
      ctx.closePath(); ctx.fill();
    }

    // hull: a long raked nose easing over the canopy into a flat roof,
    // rounded tail, skirt riding just above the brass rail
    ctx.beginPath();
    ctx.moveTo(tailX, y + 24);
    ctx.lineTo(noseX - d * 30, y + 24);
    ctx.quadraticCurveTo(noseX - d * 6, y + 23, noseX, y + 14);   // chin
    ctx.quadraticCurveTo(noseX - d * 3, y + 5, noseX - d * 16, y + 2);  // windshield rake
    ctx.quadraticCurveTo(noseX - d * 26, y, noseX - d * 40, y);   // canopy → roof
    ctx.lineTo(tailX + d * 9, y);
    ctx.quadraticCurveTo(tailX, y, tailX, y + 9);                 // rounded tail
    ctx.closePath();
    ctx.fillStyle = CREAM_HI;
    ctx.fill();
    ctx.strokeStyle = TEAL_TRIM;                  // keeps it crisp on any sky
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.lineJoin = 'miter';

    ctx.save();                                   // livery, clipped to the hull
    ctx.clip();
    ctx.fillStyle = ORANGE;                       // swept nose blade
    ctx.beginPath();
    ctx.moveTo(noseX + d * 2, y);
    ctx.lineTo(noseX + d * 2, y + 26);
    ctx.lineTo(noseX - d * 26, y + 26);
    ctx.quadraticCurveTo(noseX - d * 12, y + 16, noseX - d * 20, y);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#1E4744';                    // beltline under the glass
    ctx.fillRect(x - 4, y + 17, TRAIN_LEN + 8, 3);

    // one continuous window band with rounded ends, cream mullions
    var bL = (d === 1 ? x + 8 : x + 34);
    var bR = (d === 1 ? x + TRAIN_LEN - 34 : x + TRAIN_LEN - 8);
    ctx.fillStyle = night ? BRASS : '#1E4744';
    ctx.beginPath();
    ctx.moveTo(bL + 4, y + 6);
    ctx.lineTo(bR - 4, y + 6);
    ctx.quadraticCurveTo(bR, y + 6, bR, y + 10);
    ctx.quadraticCurveTo(bR, y + 14, bR - 4, y + 14);
    ctx.lineTo(bL + 4, y + 14);
    ctx.quadraticCurveTo(bL, y + 14, bL, y + 10);
    ctx.quadraticCurveTo(bL, y + 6, bL + 4, y + 6);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = CREAM_HI;
    for (var mx2 = bL + 16; mx2 < bR - 4; mx2 += 16) {
      ctx.fillRect(mx2, y + 5, 2, 10);
    }

    // windshield glass on the raked nose
    ctx.fillStyle = night ? BRASS : '#16332F';
    ctx.beginPath();
    ctx.moveTo(noseX - d * 5, y + 7);
    ctx.quadraticCurveTo(noseX - d * 6, y + 4, noseX - d * 14, y + 3.5);
    ctx.lineTo(noseX - d * 16, y + 10);
    ctx.quadraticCurveTo(noseX - d * 10, y + 10, noseX - d * 5, y + 7);
    ctx.closePath(); ctx.fill();
    ctx.restore();

    if (night) {                                  // the band glows gently
      ctx.fillStyle = GLOW_BRASS;
      ctx.fillRect(bL - 3, y + 3, bR - bL + 6, 14);
    }

    ctx.fillStyle = TEAL_TRIM;                    // bogies gripping the beam
    ctx.fillRect(x + TRAIN_LEN * 0.18, y + 24, 16, 4);
    ctx.fillRect(x + TRAIN_LEN * 0.72, y + 24, 16, 4);
  }

  function drawCars(litLevel) {
    if (reducedMotion.matches) return;
    var parade = calendar.month === 6;            // Founders' Day pennants
    var night = litLevel > 0.55;
    for (var i = 0; i < cars.length; i++) {
      var p = cars[i];
      if (!p.active) continue;
      if (STYLE !== 'atompunk') { drawCarEra(STYLE, p, litLevel > 0.55); continue; }
      var d = p.dir;
      var carColor = CAR_COLORS[i % CAR_COLORS.length];
      var L = p.len;
      var y = GROUND_Y - 9;                       // beltline height
      var nose = d === 1 ? p.x + L : p.x;
      var tail = d === 1 ? p.x : p.x + L;
      var fw2 = p.x + L * (d === 1 ? 0.76 : 0.24);   // front wheel
      var rw = p.x + L * (d === 1 ? 0.22 : 0.78);    // rear wheel

      if (night) {                                // headlight throw
        ctx.fillStyle = 'rgba(242, 233, 210, 0.10)';
        ctx.beginPath();
        ctx.moveTo(nose - d * 2, y + 4);
        ctx.lineTo(nose + d * 30, y + 2);
        ctx.lineTo(nose + d * 30, y + 9);
        ctx.closePath(); ctx.fill();
      }

      ctx.fillStyle = TEAL_TRIM;                  // wheels down on the road
      ctx.beginPath();
      dotPath(fw2, GROUND_Y - 2.6, 2.6);
      dotPath(rw, GROUND_Y - 2.6, 2.6);
      ctx.fill();
      ctx.fillStyle = CREAM_HI;                   // hubcaps
      ctx.beginPath();
      dotPath(fw2, GROUND_Y - 2.6, 0.9);
      dotPath(rw, GROUND_Y - 2.6, 0.9);
      ctx.fill();

      // lower body: long hood dipping to the bumper, tail fin swept up,
      // skirts notched over the wheels by drawing body above them
      ctx.fillStyle = carColor;
      ctx.beginPath();
      ctx.moveTo(tail, y + 6);
      ctx.lineTo(tail, y - 4.5);                  // fin tip
      ctx.quadraticCurveTo(tail + d * 3, y - 1.5, tail + d * 9, y - 0.5);
      ctx.lineTo(nose - d * 12, y - 0.5);         // beltline
      ctx.quadraticCurveTo(nose - d * 3, y - 0.5, nose, y + 2);   // hood fall
      ctx.lineTo(nose, y + 6);                    // grille face
      ctx.closePath(); ctx.fill();

      // greenhouse: curved roof, glass lit at night
      var c0 = p.x + L * (d === 1 ? 0.26 : 0.36);
      var c1 = p.x + L * (d === 1 ? 0.64 : 0.74);
      ctx.beginPath();
      ctx.moveTo(c0, y - 0.5);
      ctx.quadraticCurveTo(c0 + d * 2, y - 5.5, (c0 + c1) / 2, y - 5.5);
      ctx.quadraticCurveTo(c1 - d * 4, y - 5.5, c1, y - 0.5);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = night ? BRASS : '#4a6f6a';  // the glass itself
      ctx.beginPath();
      ctx.moveTo(c0 + d * 2.2, y - 0.8);
      ctx.quadraticCurveTo(c0 + d * 3.6, y - 4.2, (c0 + c1) / 2, y - 4.2);
      ctx.quadraticCurveTo(c1 - d * 5, y - 4.2, c1 - d * 2.6, y - 0.8);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = TEAL_TRIM;                  // B-pillar
      ctx.fillRect((c0 + c1) / 2 - 0.8, y - 4.2, 1.6, 3.6);

      ctx.fillStyle = BRASS;                      // chrome spear + bumpers
      ctx.fillRect(Math.min(tail, nose) + 3, y + 1.4, L - 6, 1);
      ctx.fillRect(nose - d * 1.5 - (d === 1 ? 0 : 1.5), y + 4.6, 3, 1.4);
      ctx.fillStyle = ORANGE;                     // taillight on the fin
      ctx.beginPath(); ctx.arc(tail + d * 0.8, y - 3.2, 1.3, 0, Math.PI * 2); ctx.fill();
      if (night) {                                // headlight jewel
        ctx.fillStyle = CREAM_HI;
        ctx.beginPath(); ctx.arc(nose - d * 1.2, y + 2.6, 1.5, 0, Math.PI * 2); ctx.fill();
      }
      if (parade) {                               // a pennant whips from the aerial
        var ax = c1 - d * 2;
        ctx.strokeStyle = TEAL_TRIM;
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.moveTo(ax, y - 5);
        ctx.quadraticCurveTo(ax - d * 1, y - 9, ax - d * 0.5, y - 13);
        ctx.stroke();
        ctx.fillStyle = ORANGE;
        ctx.beginPath();
        ctx.moveTo(ax - d * 0.5, y - 13);
        ctx.lineTo(ax - d * 6.5, y - 11.5 + Math.sin(effT * 8 + i) * 0.8);
        ctx.lineTo(ax - d * 0.5, y - 10);
        ctx.closePath(); ctx.fill();
      }
    }
  }

  // a lively crowd: coats in varied poster tones over a shared silhouette
  var FOLK_COATS = ['#0E3F3C', '#1B6157', '#C24E22', '#C79A2E', '#0A2F2C', '#D8CBA6'];
  var SKIN = '#E6C6A0';
  // the town's automobiles in candy colors; chrome and dark tyres stay shared
  var CAR_COLORS = ['#E7A8B0', '#9FC9B7', '#E8DCC0', '#E19A7C', '#7FB0A8', '#E9C979'];

  // one flat mid-century figure, facing travel: swing-coat torso, striding
  // legs with feet, an arm swinging opposite the lead leg, round head and an
  // optional fedora. stride is -1..1 (walk phase); returns the bobbed ground y.
  function drawPerson(x, gy, stride, d, coat, hat, hatColor, gawk) {
    var s = stride;
    var y = gy - Math.abs(s) * 0.9;
    var hipY = y - 6;

    ctx.strokeStyle = TEAL_TRIM;                  // legs
    ctx.lineWidth = 1.8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, hipY); ctx.lineTo(x + s * 2.6, y);
    ctx.moveTo(x, hipY); ctx.lineTo(x - s * 2.6, y);
    ctx.stroke();
    ctx.lineWidth = 1.6;                          // feet, pointing forward
    ctx.beginPath();
    ctx.moveTo(x + s * 2.6, y); ctx.lineTo(x + s * 2.6 + d * 2.2, y);
    ctx.moveTo(x - s * 2.6, y); ctx.lineTo(x - s * 2.6 + d * 2.2, y);
    ctx.stroke();
    ctx.lineCap = 'butt';

    ctx.fillStyle = coat;                         // swing-coat torso
    ctx.beginPath();
    ctx.moveTo(x - 2.6, hipY + 1);
    ctx.lineTo(x + 2.6, hipY + 1);
    ctx.lineTo(x + 1.9, y - 12.5);
    ctx.lineTo(x - 1.9, y - 12.5);
    ctx.closePath(); ctx.fill();

    ctx.strokeStyle = coat;                       // arm swings opposite lead leg
    ctx.lineWidth = 1.7;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y - 11);
    ctx.lineTo(x - s * 2.2, y - 6);
    ctx.stroke();
    ctx.lineCap = 'butt';

    var lean = gawk ? d * 0.9 : 0;                // head (tips back to gawk)
    var headY = y - 14.6 - (gawk ? 0.6 : 0);
    ctx.fillStyle = SKIN;
    ctx.beginPath(); ctx.arc(x + lean, headY, 2.1, 0, Math.PI * 2); ctx.fill();

    if (hat) {                                    // fedora: crown + brim
      ctx.fillStyle = hatColor || TEAL_TRIM;
      ctx.beginPath();
      ctx.moveTo(x - 1.7 + lean, headY - 1.3);
      ctx.lineTo(x - 1.2 + lean, headY - 3.7);
      ctx.lineTo(x + 1.6 + lean, headY - 3.7);
      ctx.lineTo(x + 1.9 + lean, headY - 1.3);
      ctx.closePath(); ctx.fill();
      ctx.fillRect(x - 3.3 + lean + d * 0.4, headY - 1.6, 6.4, 1);
    }
    return y;
  }

  // a marcher wears the town's anatomy in a band-uniform teal coat, cap in
  // the given accent; the parade code adds the instrument at the returned y
  function drawMarcher(mx, bob, stride, capColor) {
    if (STYLE !== 'atompunk') return drawPersonEra(STYLE, mx, GROUND_Y, stride, parade.dir, curLit > 0.55);
    return drawPerson(mx, GROUND_Y, stride, parade.dir, '#12514B', true, capColor, false);
  }

  // the Founders' Day procession: flag bearer, marching band, a float
  function drawParade() {
    if (!parade.active || reducedMotion.matches) return;
    var d = parade.dir;
    var hx = parade.x;
    var i, mx, bob, stride;

    // flag bearer leads, banner rippling from a raked staff
    bob = Math.abs(Math.sin(effT * 9)) * 1.2;
    stride = Math.sin(effT * 9) * d;
    drawMarcher(hx, bob, stride, ORANGE);
    ctx.strokeStyle = BRASS;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(hx + d * 2, GROUND_Y - 9 - bob);
    ctx.lineTo(hx + d * 5, GROUND_Y - 30 - bob);
    ctx.stroke();
    var w1 = Math.sin(effT * 7) * 1.4;            // the cloth waves
    ctx.fillStyle = ORANGE;
    ctx.beginPath();
    ctx.moveTo(hx + d * 5, GROUND_Y - 30 - bob);
    ctx.quadraticCurveTo(hx + d * 12, GROUND_Y - 30.5 - bob + w1,
                         hx + d * 18, GROUND_Y - 28.5 - bob - w1);
    ctx.lineTo(hx + d * 12, GROUND_Y - 26.5 - bob);
    ctx.quadraticCurveTo(hx + d * 9, GROUND_Y - 25 - bob - w1,
                         hx + d * 5, GROUND_Y - 24 - bob);
    ctx.closePath(); ctx.fill();

    // eight bandsmen, horns catching whatever light there is
    for (i = 0; i < 8; i++) {
      mx = hx - d * (22 + i * 12);
      bob = Math.abs(Math.sin(effT * 9 + i * 1.1)) * 1.2;
      stride = Math.sin(effT * 9 + i * 1.1) * d;
      var my = drawMarcher(mx, bob, stride, i % 2 ? BRASS : CREAM_HI);
      if (i % 2) {                                // trumpet at the lips
        ctx.strokeStyle = BRASS;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(mx + d * 1.5, my - 11.5);
        ctx.lineTo(mx + d * 5.5, my - 11);
        ctx.stroke();
        ctx.fillStyle = BRASS;                    // the bell flares
        ctx.beginPath();
        ctx.moveTo(mx + d * 5.5, my - 12.6);
        ctx.lineTo(mx + d * 7.5, my - 11);
        ctx.lineTo(mx + d * 5.5, my - 9.4);
        ctx.closePath(); ctx.fill();
      } else {                                    // snare at the waist
        ctx.fillStyle = CREAM_HI;
        ctx.fillRect(mx + d * 1.6, my - 7.6, 3.4, 2.6);
        ctx.fillStyle = TEAL_TRIM;
        ctx.fillRect(mx + d * 1.6, my - 6.4, 3.4, 0.6);
      }
    }

    // the float brings up the rear: skirted platform with scalloped
    // bunting, a slow-turning starburst standard, one waving rider
    var fx2 = hx - d * 132;
    ctx.fillStyle = TEAL_TRIM;                    // wheels
    ctx.beginPath();
    dotPath(fx2 - 11, GROUND_Y - 3, 3); dotPath(fx2 + 11, GROUND_Y - 3, 3);
    ctx.fill();
    ctx.fillStyle = CREAM_HI;                     // hubs
    ctx.beginPath();
    dotPath(fx2 - 11, GROUND_Y - 3, 1); dotPath(fx2 + 11, GROUND_Y - 3, 1);
    ctx.fill();
    ctx.fillStyle = ORANGE;                       // platform deck
    ctx.beginPath();
    ctx.moveTo(fx2 - 19, GROUND_Y - 11);
    ctx.lineTo(fx2 + 19, GROUND_Y - 11);
    ctx.quadraticCurveTo(fx2 + 21, GROUND_Y - 11, fx2 + 21, GROUND_Y - 8.5);
    ctx.lineTo(fx2 + 21, GROUND_Y - 6);
    ctx.lineTo(fx2 - 21, GROUND_Y - 6);
    ctx.lineTo(fx2 - 21, GROUND_Y - 8.5);
    ctx.quadraticCurveTo(fx2 - 21, GROUND_Y - 11, fx2 - 19, GROUND_Y - 11);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = CREAM_HI;                     // scalloped bunting skirt
    ctx.beginPath();
    for (var sc = -3; sc <= 3; sc++) {
      ctx.moveTo(fx2 + sc * 6 + 3, GROUND_Y - 6);
      ctx.arc(fx2 + sc * 6, GROUND_Y - 6, 3, 0, Math.PI);
    }
    ctx.fill();
    ctx.strokeStyle = BRASS;                      // the standard turns slowly
    ctx.lineWidth = 1.4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(fx2, GROUND_Y - 11);
    ctx.lineTo(fx2, GROUND_Y - 27);
    var spin = effT * 1.1;
    for (i = 0; i < 8; i++) {
      var pa = spin + i * Math.PI / 4;
      ctx.moveTo(fx2 + Math.cos(pa) * 2.5, GROUND_Y - 29 + Math.sin(pa) * 2.5);
      ctx.lineTo(fx2 + Math.cos(pa) * 7, GROUND_Y - 29 + Math.sin(pa) * 7);
    }
    ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.fillStyle = ORANGE;
    ctx.beginPath(); ctx.arc(fx2, GROUND_Y - 29, 1.8, 0, Math.PI * 2); ctx.fill();
    drawMarcher(fx2 + d * 13, 0, 0, ORANGE);      // the beauty queen, waving
  }

  /* the hillside: a lifted-teal slope behind the back row, cottages
     with scheduled windows, and a counterbalanced funicular */

  var HILL_FILL = hill ? rgbStr(mixRgb(hexToRgb(TEALS[1]), CREAM_RGB, 0.42)) : null;
  var HILL_TRACK = hill ? rgbStr(mixRgb(TRIM_RGB, CREAM_RGB, 0.3)) : null;

  function hillXY(u) {
    var x = hill.side === 1 ? VIEW_W - hill.w + u * hill.w : hill.w - u * hill.w;
    var s = u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u);
    return [x, GROUND_Y - hill.h * s];
  }

  function drawHill(litLevel) {
    if (!hill) return;
    var i, u, pt;

    ctx.fillStyle = HILL_FILL;                    // the slope itself
    ctx.beginPath();
    pt = hillXY(0);
    ctx.moveTo(pt[0], GROUND_Y + 40);
    for (u = 0; u <= 1.001; u += 0.05) {
      pt = hillXY(u);
      ctx.lineTo(pt[0], pt[1]);
    }
    ctx.lineTo(hill.side === 1 ? VIEW_W + 90 : -90, pt[1]);
    ctx.lineTo(hill.side === 1 ? VIEW_W + 90 : -90, GROUND_Y + 40);
    ctx.closePath();
    ctx.fill();
    if (weatherLevel[2] > 0.05) {                 // snow pales the slope
      ctx.globalAlpha = weatherLevel[2] * 0.45;
      ctx.fillStyle = CREAM_HI;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    ctx.strokeStyle = HILL_TRACK;                 // funicular right-of-way
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (u = 0.08; u <= 0.92; u += 0.06) {
      pt = hillXY(u);
      if (u < 0.09) ctx.moveTo(pt[0], pt[1] - 2); else ctx.lineTo(pt[0], pt[1] - 2);
    }
    ctx.stroke();

    // two counterbalanced cars, one up while the other comes down
    var cars2 = [0.08 + funi.p * 0.84, 0.92 - funi.p * 0.84];
    for (i = 0; i < 2; i++) {
      var a = hillXY(cars2[i]);
      var b = hillXY(cars2[i] + 0.03);
      var ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      ctx.save();
      ctx.translate(a[0], a[1] - 4);
      ctx.rotate(ang);
      ctx.fillStyle = CREAM_HI;                   // stepped little cabin
      ctx.fillRect(-8, -7, 16, 7);
      ctx.fillStyle = '#235450';
      ctx.fillRect(-8, -2.5, 16, 2.5);
      ctx.fillStyle = BRASS;
      ctx.beginPath();
      dotPath(-4, -4.5, 1.3); dotPath(0, -4.5, 1.3); dotPath(4, -4.5, 1.3);
      ctx.fill();
      ctx.restore();
    }

    // summit station and its beacon
    var top = hillXY(0.95);
    ctx.fillStyle = HILL_TRACK;
    ctx.fillRect(top[0] - 9, top[1] - 9, 18, 8);
    ctx.fillStyle = CREAM_HI;
    ctx.fillRect(top[0] - 11, top[1] - 12, 22, 3);
    ctx.fillStyle = BRASS;
    ctx.fillRect(top[0] - 1, top[1] - 26, 2, 14);
    if (litLevel > 0.55 && Math.sin(effT * 3) > 0) {
      ctx.fillStyle = GLOW_BRASS;
      ctx.beginPath(); ctx.arc(top[0], top[1] - 28, 6, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = ORANGE;
    ctx.beginPath(); ctx.arc(top[0], top[1] - 28, 2.2, 0, Math.PI * 2); ctx.fill();

    // cottages along the slope, windows on their own schedules
    for (i = 0; i < hill.houses.length; i++) {
      var hh = hill.houses[i];
      pt = hillXY(hh.t);
      var hw = hh.w;
      ctx.fillStyle = BG_TEALS[i % BG_TEALS.length];
      ctx.fillRect(pt[0] - hw / 2, pt[1] - 9, hw, 9);
      ctx.beginPath();                            // gable
      ctx.moveTo(pt[0] - hw / 2 - 1.5, pt[1] - 9);
      ctx.lineTo(pt[0], pt[1] - 15);
      ctx.lineTo(pt[0] + hw / 2 + 1.5, pt[1] - 9);
      ctx.closePath(); ctx.fill();
      if (hh.lit < litLevel) {                    // someone is home
        ctx.fillStyle = GLOW_BRASS;
        ctx.beginPath(); ctx.arc(pt[0], pt[1] - 4.5, 4, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = BRASS;
      ctx.beginPath(); ctx.arc(pt[0], pt[1] - 4.5, 1.6, 0, Math.PI * 2); ctx.fill();
    }
  }

  // the citizens: little striding figures, hats raised to nobody in
  // particular, one or two walking Comet on a leash
  function drawFolks() {
    if (reducedMotion.matches) return;
    var gawk = fw.show > 0 || fw.sparks.length > 0 ||  // stopped for the show
               whistleT > 0;                           // or for the whistle
    for (var i = 0; i < folks.length; i++) {
      var p = folks[i];
      if (!p.active) continue;
      var stride = gawk ? 0 : Math.sin(effT * 8 + p.ph) * p.dir;
      var coat = FOLK_COATS[i % FOLK_COATS.length];
      var y = STYLE !== 'atompunk'
        ? drawPersonEra(STYLE, p.x, GROUND_Y, stride, p.dir, curLit > 0.55)
        : drawPerson(p.x, GROUND_Y, stride, p.dir, coat, p.hat, TEAL_TRIM, gawk);
      if (p.dog) {                                // Comet, at heel
        var dx2 = p.x - p.dir * 8;
        ctx.strokeStyle = TEAL_TRIM;
        ctx.lineWidth = 0.8;
        ctx.globalAlpha = 0.6;
        ctx.beginPath();
        ctx.moveTo(p.x + p.dir * 1, y - 6);
        ctx.quadraticCurveTo((p.x + dx2) / 2, y - 2, dx2, y - 3.5);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = TEAL_TRIM;
        ctx.fillRect(dx2 - 2.5, y - 3.5, 5, 2.2);
        ctx.beginPath(); ctx.arc(dx2 + p.dir * 3, y - 3.6, 1.4, 0, Math.PI * 2); ctx.fill();
        ctx.fillRect(dx2 - p.dir * 3 - 0.5, y - 5.5 + Math.sin(effT * 12) * 0.7, 1, 2.5);
      }
    }
  }

  function drawLeaves() {
    if (reducedMotion.matches || !leaves.length) return;
    for (var i = 0; i < leaves.length; i++) {
      var p = leaves[i];
      var lx = p.x + (p.amp ? Math.sin(effT * p.f + p.ph) * p.amp : 0);
      ctx.globalAlpha = p.settle > 0 ? Math.min(0.9, p.settle / 2.2) : 0.9;
      ctx.fillStyle = p.color;
      ctx.save();
      ctx.translate(lx, p.y);
      ctx.rotate(Math.sin(effT * p.f + p.ph) * 0.7);
      ctx.beginPath();
      ctx.ellipse(0, 0, 2.6, 1.4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  function drawShootingStar(starLevel) {
    if (shoot.t <= 0 || starLevel <= 0.4 || reducedMotion.matches) return;
    var p = 1 - shoot.t / 0.5;
    var hx = shoot.x + shoot.dx * p;
    var hy = shoot.y + shoot.dy * p;
    var len = Math.min(34, p * 90);
    var norm = Math.sqrt(shoot.dx * shoot.dx + shoot.dy * shoot.dy);
    ctx.strokeStyle = CREAM_HI;
    ctx.lineWidth = 1.6;
    ctx.globalAlpha = Math.min(1, shoot.t / 0.18) * starLevel * 0.9;
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(hx - shoot.dx / norm * len, hy - shoot.dy / norm * len);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // the town's comet: a bright head, a long two-part tail, always
  // pointed away from where the sun would be
  function drawComet(starLevel) {
    if (!comet.active || starLevel <= 0.3 || reducedMotion.matches) return;
    var a = Math.min(1, comet.t / 4, (comet.dur - comet.t) / 4) * starLevel;
    var dir = comet.vx > 0 ? -1 : 1;              // tail trails the motion
    ctx.globalAlpha = a * 0.85;
    var tg = ctx.createLinearGradient(comet.x, comet.y, comet.x + dir * 90, comet.y - 14);
    tg.addColorStop(0, 'rgba(242, 233, 210, 0.8)');
    tg.addColorStop(1, 'rgba(242, 233, 210, 0)');
    ctx.strokeStyle = tg;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(comet.x, comet.y);
    ctx.lineTo(comet.x + dir * 90, comet.y - 14);
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.globalAlpha = a * 0.5;
    ctx.beginPath();
    ctx.moveTo(comet.x, comet.y);
    ctx.lineTo(comet.x + dir * 70, comet.y + 6);
    ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.globalAlpha = a;
    ctx.shadowBlur = 9; ctx.shadowColor = CREAM_HI;
    ctx.fillStyle = CREAM_HI;
    ctx.beginPath();
    ctx.arc(comet.x, comet.y, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }

  function drawNotes() {
    if (reducedMotion.matches || !notes.length) return;
    ctx.font = '600 15px Jost, Futura, sans-serif';
    ctx.textAlign = 'center';
    for (var i = 0; i < notes.length; i++) {
      var p = notes[i];
      ctx.globalAlpha = Math.max(0, 0.9 * (1 - p.life / p.max));
      var nCol = STYLE === 'cyberpunk' ? NEON_CYAN : STYLE === 'solarpunk' ? '#3E9A63' : STYLE === 'silkpunk' ? ORANGE : BRASS;
      if (STYLE === 'cyberpunk') { ctx.shadowBlur = 6; ctx.shadowColor = nCol; }
      ctx.fillStyle = nCol;
      var ng = STYLE === 'cyberpunk' ? '\u25C8' : STYLE === 'solarpunk' ? '\u2740' : STYLE === 'silkpunk' ? '\u2767' : p.g;
      ctx.fillText(ng, p.x + Math.sin(effT * 2.2 + p.ph) * 5, p.y);
      ctx.shadowBlur = 0;
    }
    ctx.textAlign = 'left';
    ctx.globalAlpha = 1;
  }

  // a kite over the park in fair-weather months
  function drawKite() {
    if (!kite.active || reducedMotion.matches) return;
    var kx = kite.anchor + Math.sin(effT * 0.5 + kite.ph) * 32;
    var ky = GROUND_Y - 92 - Math.sin(effT * 0.34 + kite.ph) * 18;

    ctx.strokeStyle = TEAL_TRIM;                  // the string, sagging
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.moveTo(kite.anchor, GROUND_Y - 4);
    ctx.quadraticCurveTo(kite.anchor + (kx - kite.anchor) * 0.3, ky + 60, kx, ky);
    ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.save();                                   // the diamond, sail bowed
    ctx.translate(kx, ky);                        // taut by the wind
    ctx.rotate(Math.sin(effT * 0.9 + kite.ph) * 0.2);
    ctx.fillStyle = ORANGE;
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.quadraticCurveTo(5.4, -4.5, 6.5, 0);
    ctx.quadraticCurveTo(5.2, 5.5, 0, 11);
    ctx.quadraticCurveTo(-5.2, 5.5, -6.5, 0);
    ctx.quadraticCurveTo(-5.4, -4.5, 0, -9);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = TEAL_TRIM;                  // spars
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, -9); ctx.lineTo(0, 11);
    ctx.moveTo(-6.5, 0); ctx.lineTo(6.5, 0);
    ctx.stroke();

    var s1 = Math.sin(effT * 2.4 + kite.ph);      // ribbon tail streaming
    var s2 = Math.sin(effT * 2.4 + kite.ph + 1.3);
    ctx.strokeStyle = TEAL_TRIM;
    ctx.lineWidth = 0.9;
    ctx.globalAlpha = 0.75;
    ctx.beginPath();
    ctx.moveTo(0, 11);
    ctx.quadraticCurveTo(s1 * 4.5, 18, s2 * 5.5, 25);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = CREAM_HI;                     // bow ties on the ribbon
    for (var tb = 1; tb <= 3; tb++) {
      var tt = tb / 3;
      var bxk = (1 - tt) * (1 - tt) * 0 + 2 * (1 - tt) * tt * s1 * 4.5 + tt * tt * s2 * 5.5;
      var byk = (1 - tt) * (1 - tt) * 11 + 2 * (1 - tt) * tt * 18 + tt * tt * 25;
      ctx.save();
      ctx.translate(bxk, byk);
      ctx.rotate(s1 * 0.6 + tb);
      ctx.beginPath();
      ctx.ellipse(0, 0, 2.3, 1.1, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  // the bay: water in the ground band, a pier, a moored sloop, the
  // lighthouse on its rock, and the ferry when it runs
  /* ---------------- the river (fourth terrain) ------------------------- */
  /* A canal crosses Main Street under a stone bridge: a current that
     runs toward the fore, a moored barge that bobs, lamp glints after
     dark — and in the iced months the water freezes and the skaters
     come out. Rendered after the era ground so the water always wins. */

  var skaters = [
    { r: 14, sp: 0.9, ph: 0 },
    { r: 9,  sp: -1.3, ph: 2.1 }
  ];

  function drawRiver(skyRgb, starLevel) {
    if (!river) return;
    var L = river.x - river.half, R = river.x + river.half;
    var by = GROUND_Y, bh = VIEW_H - GROUND_Y + 26;
    var i;

    var waterRgb = mixRgb(hexToRgb('#1D4E52'), skyRgb, 0.14);
    waterRgb = mixRgb(waterRgb, CREAMHI_RGB, icedLevel * 0.3);
    ctx.fillStyle = rgbStr(waterRgb);
    ctx.fillRect(L, by, R - L, bh);

    ctx.save();
    ctx.beginPath(); ctx.rect(L, by, R - L, bh); ctx.clip();

    if (icedLevel < 0.98) {                       // the current, running to the fore
      ctx.strokeStyle = 'rgba(242, 233, 210, 0.38)';
      ctx.lineWidth = 1.4;
      ctx.globalAlpha = 1 - icedLevel;
      ctx.beginPath();
      for (i = 0; i < 5; i++) {
        var colX = L + 8 + i * ((R - L - 16) / 4);
        var drift = reducedMotion.matches ? 0 : (effT * (10 + (i % 3) * 5)) % 24;
        for (var wy3 = by + 2 + drift - 24; wy3 < by + bh; wy3 += 24) {
          if (wy3 < by + 2) continue;
          ctx.moveTo(colX - 5, wy3);
          ctx.lineTo(colX + 5, wy3);
        }
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    if (starLevel > 0.3 && icedLevel < 0.5) {     // lamp glints on open water
      ctx.globalAlpha = 0.3 * starLevel;
      ctx.fillStyle = BRASS;
      ctx.fillRect(river.x - 18, by + 4, 2.4, 20);
      ctx.fillStyle = ORANGE;
      ctx.fillRect(river.x + 14, by + 6, 2.4, 16);
      ctx.globalAlpha = 1;
    }

    if (icedLevel > 0.02) {                       // frozen over
      ctx.fillStyle = CREAM_HI;
      ctx.globalAlpha = icedLevel * 0.8;
      ctx.fillRect(L, by, R - L, bh);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(30, 71, 68, 0.25)'; // skate tracks
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(river.x, by + 22, river.half * 0.5, 8, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(river.x - 6, by + 30, river.half * 0.3, 5, 0, 0, Math.PI * 2);
      ctx.stroke();
      if (icedLevel > 0.6 && !reducedMotion.matches && starLevel < 0.5) {
        for (i = 0; i < skaters.length; i++) {    // the skaters, mid-glide
          var sk = skaters[i];
          var a = effT * sk.sp + sk.ph;
          var sx3 = river.x + Math.cos(a) * sk.r * 1.6;
          var sy4 = by + 22 + (i ? 8 : 0) + Math.sin(a) * sk.r * 0.4;
          ctx.strokeStyle = TEAL_TRIM; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(sx3, sy4 - 4); ctx.lineTo(sx3 - Math.cos(a) * 3, sy4);
          ctx.stroke(); ctx.lineCap = 'butt';
          ctx.fillStyle = ORANGE;
          ctx.fillRect(sx3 - 1.6, sy4 - 9.5, 3.2, 6);
          ctx.fillStyle = SKIN;
          ctx.beginPath(); ctx.arc(sx3, sy4 - 11, 1.8, 0, Math.PI * 2); ctx.fill();
        }
      }
    }
    ctx.restore();

    if (icedLevel < 0.5) {                        // the barge, moored off the bridge
      var bob = reducedMotion.matches ? 0 : Math.sin(effT * 0.9) * 1.2;
      var bx2 = river.x + river.half * 0.35, byb = by + 26 + bob;
      ctx.fillStyle = mixHex(TEALS[0], '#101010', 0.2);
      ctx.beginPath();
      ctx.moveTo(bx2 - 16, byb); ctx.lineTo(bx2 + 16, byb);
      ctx.lineTo(bx2 + 12, byb + 7); ctx.lineTo(bx2 - 12, byb + 7);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = ORANGE; ctx.fillRect(bx2 - 16, byb, 32, 1.6);
      ctx.fillStyle = TEAL_TRIM; ctx.fillRect(bx2 - 4, byb - 5, 8, 5);
      ctx.fillStyle = curLit > 0.55 ? glowRGBA(BRASS, 0.9) : CREAM_HI;
      ctx.fillRect(bx2 - 2.4, byb - 3.8, 2, 2);
    }

    // the stone bridge carries Main Street over the water
    ctx.fillStyle = 'rgba(6, 20, 18, 0.55)';      // arch shadow under the deck
    ctx.beginPath();
    ctx.moveTo(river.x - river.half * 0.6, by + 4);
    ctx.quadraticCurveTo(river.x, by + 26, river.x + river.half * 0.6, by + 4);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = TEAL_TRIM;                    // the deck
    ctx.fillRect(L - 6, by - 2, R - L + 12, 6);
    ctx.fillStyle = BRASS;                        // the brass course carries through
    ctx.fillRect(L - 6, by - 3, R - L + 12, 1.4);
    ctx.strokeStyle = TEAL_TRIM; ctx.lineWidth = 1.4;   // the railing
    ctx.beginPath();
    ctx.moveTo(L - 4, by - 9); ctx.lineTo(R + 4, by - 9);
    for (i = 0; i <= 6; i++) {
      var px2 = L - 4 + (R - L + 8) * i / 6;
      ctx.moveTo(px2, by - 9); ctx.lineTo(px2, by - 2);
    }
    ctx.stroke();
  }

  function drawHarbor(skyRgb, starLevel) {
    if (!harbor) return;
    var wL = harbor.side === 1 ? harbor.shore : -80;
    var wR = harbor.side === 1 ? VIEW_W + 80 : harbor.shore;
    var i, wx;

    var waterRgb = mixRgb(hexToRgb('#235450'), skyRgb, 0.28);
    waterRgb = mixRgb(waterRgb, CREAMHI_RGB, icedLevel * 0.3);   // winter pallor
    ctx.fillStyle = rgbStr(waterRgb);
    ctx.fillRect(wL, GROUND_Y, wR - wL, VIEW_H - GROUND_Y);

    ctx.save();                                   // drifting wave dashes
    ctx.beginPath();
    ctx.rect(wL, GROUND_Y, wR - wL, VIEW_H - GROUND_Y);
    ctx.clip();
    ctx.strokeStyle = 'rgba(242, 233, 210, 0.28)';
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 1 - icedLevel;              // waves fade as the ice takes
    ctx.beginPath();
    var rows = [10, 22, 34];
    for (i = 0; i < rows.length; i++) {
      var drift = reducedMotion.matches ? 0 : (effT * (6 + i * 3)) % 46;
      for (wx = wL - 46 + drift + i * 15; wx < wR; wx += 46) {
        ctx.moveTo(wx, GROUND_Y + rows[i]);
        ctx.lineTo(wx + 14, GROUND_Y + rows[i]);
      }
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    if (icedLevel > 0.02) {                       // pack ice in the iced months
      ctx.fillStyle = CREAM_HI;
      ctx.globalAlpha = icedLevel * 0.85;
      ctx.beginPath();
      for (i = 0; i < 7; i++) {
        var fx3 = wL + 30 + i * ((wR - wL - 60) / 6) +
                  (reducedMotion.matches ? 0 : Math.sin(effT * 0.1 + i * 1.7) * 5);
        var fw3 = 24 + ((i * 37) % 26);
        ctx.rect(fx3 - fw3 / 2, GROUND_Y + 8 + (i % 3) * 11, fw3, 5);
      }
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    // the pier reaches out from the quay
    var pd = harbor.side;                         // 1: pier points right
    var px0 = harbor.shore - pd * 4;
    ctx.fillStyle = TEAL_TRIM;
    ctx.fillRect(Math.min(px0, px0 + pd * 66), GROUND_Y - 3, 66, 4);
    for (i = 0; i < 3; i++) {
      ctx.fillRect(px0 + pd * (12 + i * 22) - 1.5, GROUND_Y, 3, 14);
    }

    // a fisherman works the end of the pier when the water is open
    if (starLevel < 0.4 && icedLevel < 0.5) {
      var fpx = px0 + pd * 58;
      ctx.fillStyle = TEAL_TRIM;
      ctx.fillRect(fpx - 1.6, GROUND_Y - 11.5, 3.2, 8);       // seated, patient
      ctx.beginPath(); ctx.arc(fpx, GROUND_Y - 13.5, 1.9, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = TEAL_TRIM;                            // the rod
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(fpx + pd * 2, GROUND_Y - 9);
      ctx.lineTo(fpx + pd * 16, GROUND_Y - 20);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(242, 233, 210, 0.4)';           // the line
      ctx.beginPath();
      ctx.moveTo(fpx + pd * 16, GROUND_Y - 20);
      ctx.lineTo(fpx + pd * 16, GROUND_Y + 6);
      ctx.stroke();
      ctx.fillStyle = ORANGE;                                 // the float
      ctx.beginPath();
      ctx.arc(fpx + pd * 16, GROUND_Y + 6 +
        (reducedMotion.matches ? 0 : Math.sin(effT * 2.1) * 1.2), 1.4, 0, Math.PI * 2);
      ctx.fill();
      if (!reducedMotion.matches && Math.sin(effT * 0.31) > 0.975) {   // a bite!
        ctx.fillStyle = CREAM_HI;
        ctx.beginPath();
        dotPath(fpx + pd * 16 - 3, GROUND_Y + 4, 1.2);
        dotPath(fpx + pd * 16 + 3, GROUND_Y + 3, 1);
        dotPath(fpx + pd * 16, GROUND_Y + 1, 1.3);
        ctx.fill();
      }
    }

    // a moored sloop bobs by the pier
    var mbx = harbor.shore + pd * 92;
    var mby = reducedMotion.matches ? 0 : Math.sin(effT * 1.4) * 1.5;
    ctx.fillStyle = TEAL_TRIM;                    // hull
    ctx.beginPath();
    ctx.moveTo(mbx - 14, GROUND_Y + 2 + mby);
    ctx.lineTo(mbx + 14, GROUND_Y + 2 + mby);
    ctx.lineTo(mbx + 9, GROUND_Y + 8 + mby);
    ctx.lineTo(mbx - 9, GROUND_Y + 8 + mby);
    ctx.closePath(); ctx.fill();
    ctx.fillRect(mbx - 0.75, GROUND_Y - 22 + mby, 1.5, 24);   // mast
    ctx.fillStyle = CREAM_HI;                     // furled sail
    ctx.beginPath();
    ctx.moveTo(mbx + 1, GROUND_Y - 20 + mby);
    ctx.lineTo(mbx + 9, GROUND_Y - 2 + mby);
    ctx.lineTo(mbx + 1, GROUND_Y - 2 + mby);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = ORANGE;                       // masthead pennant
    var mpw = reducedMotion.matches ? 0 : Math.sin(effT * 3) * 0.7;
    ctx.beginPath();
    ctx.moveTo(mbx, GROUND_Y - 22 + mby);
    ctx.lineTo(mbx + 8, GROUND_Y - 20.5 + mby + mpw);
    ctx.lineTo(mbx, GROUND_Y - 19 + mby);
    ctx.closePath(); ctx.fill();

    // the lighthouse on its rock
    var lx = harbor.lightX;
    ctx.fillStyle = TEAL_TRIM;                    // the rock
    ctx.beginPath(); ctx.arc(lx, GROUND_Y + 12, 20, Math.PI, Math.PI * 2); ctx.fill();
    if (starLevel > 0.35 && !reducedMotion.matches) {   // sweeping beam
      var ba = -Math.PI / 2 + Math.sin(effT * 0.45) * 0.9;  // swings across the sky
      ctx.fillStyle = 'rgba(242, 233, 210, 0.10)';
      ctx.beginPath();
      ctx.moveTo(lx, GROUND_Y - 44);
      ctx.lineTo(lx + Math.cos(ba - 0.04) * 320, GROUND_Y - 44 + Math.sin(ba - 0.04) * 320);
      ctx.lineTo(lx + Math.cos(ba + 0.04) * 320, GROUND_Y - 44 + Math.sin(ba + 0.04) * 320);
      ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = CREAM_HI;                     // the tower
    ctx.fillRect(lx - 7, GROUND_Y - 40, 14, 42);
    ctx.fillStyle = ORANGE;                       // two service bands
    ctx.fillRect(lx - 7, GROUND_Y - 34, 14, 6);
    ctx.fillRect(lx - 7, GROUND_Y - 18, 14, 6);
    ctx.fillStyle = TEAL_TRIM;                    // gallery + cap
    ctx.fillRect(lx - 9, GROUND_Y - 44, 18, 4);
    ctx.beginPath();
    ctx.moveTo(lx - 6, GROUND_Y - 47);
    ctx.lineTo(lx, GROUND_Y - 53);
    ctx.lineTo(lx + 6, GROUND_Y - 47);
    ctx.closePath(); ctx.fill();
    var lampOn = reducedMotion.matches || Math.sin(effT * 2.4) > -0.3;
    ctx.fillStyle = lampOn ? BRASS : '#4A3510';   // the light itself
    ctx.fillRect(lx - 4, GROUND_Y - 47, 8, 3);

    // the ferry, when it runs
    if (ferry.active && !reducedMotion.matches) {
      var fy = GROUND_Y + Math.sin(effT * 1.8) * 1;
      ctx.strokeStyle = 'rgba(242, 233, 210, 0.35)';    // wake
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(ferry.x - ferry.dir * 26, fy + 8);
      ctx.lineTo(ferry.x - ferry.dir * 44, fy + 8);
      ctx.stroke();
      ctx.fillStyle = TEAL_TRIM;                  // hull
      ctx.beginPath();
      ctx.moveTo(ferry.x - 22, fy + 2);
      ctx.lineTo(ferry.x + 22, fy + 2);
      ctx.lineTo(ferry.x + 16, fy + 10);
      ctx.lineTo(ferry.x - 16, fy + 10);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = CREAM_HI;                   // cabin
      ctx.fillRect(ferry.x - 12, fy - 6, 24, 8);
      ctx.fillStyle = ORANGE;                     // funnel
      ctx.fillRect(ferry.x + ferry.dir * 5 - 2, fy - 11, 4, 5);
      ctx.fillStyle = ORANGE;                     // boot stripe
      ctx.fillRect(ferry.x - 21, fy + 3.4, 42, 1.4);
      ctx.fillStyle = starLevel > 0.4 ? BRASS : TEAL_TRIM;   // portholes, lit after dark
      ctx.beginPath();
      dotPath(ferry.x - 6, fy - 2, 1.3); dotPath(ferry.x, fy - 2, 1.3); dotPath(ferry.x + 6, fy - 2, 1.3);
      ctx.fill();
    }
  }

  // the milk truck: a cream panel van on the dawn round — rounded roof,
  // snub cab, dairy stripe, wheels that actually meet the road
  function drawMilk(litLevel) {
    if (!milk.active || reducedMotion.matches || !eraHas('milk')) return;
    var d = milk.dir;
    var y = GROUND_Y - 12;
    var L2 = d === 1 ? milk.x : milk.x + 26;      // rear of the box
    var nose = d === 1 ? milk.x + 26 : milk.x;

    ctx.fillStyle = TEAL_TRIM;                    // wheels first
    ctx.beginPath();
    dotPath(milk.x + 5.5, GROUND_Y - 2.4, 2.4);
    dotPath(milk.x + 20.5, GROUND_Y - 2.4, 2.4);
    ctx.fill();
    ctx.fillStyle = CREAM_HI;
    ctx.beginPath();
    dotPath(milk.x + 5.5, GROUND_Y - 2.4, 0.8);
    dotPath(milk.x + 20.5, GROUND_Y - 2.4, 0.8);
    ctx.fill();

    ctx.fillStyle = CREAM_HI;                     // box with a rounded roof
    ctx.beginPath();                              // and a snub, sloped cab
    ctx.moveTo(L2, y + 9);
    ctx.lineTo(L2, y + 1);
    ctx.quadraticCurveTo(L2, y - 2, L2 + d * 3, y - 2);
    ctx.lineTo(nose - d * 8, y - 2);
    ctx.quadraticCurveTo(nose - d * 3, y - 2, nose - d * 1, y + 2);
    ctx.quadraticCurveTo(nose, y + 4, nose, y + 6);
    ctx.lineTo(nose, y + 9);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#235450';                    // windshield in the slope
    ctx.beginPath();
    ctx.moveTo(nose - d * 7, y - 0.8);
    ctx.lineTo(nose - d * 2.4, y + 2.6);
    ctx.lineTo(nose - d * 7, y + 2.6);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = ORANGE;                       // dairy livery stripe
    ctx.fillRect(milk.x + 2, y + 5, 22, 1.6);
    ctx.fillStyle = TEAL_TRIM;                    // crate of bottles aboard
    ctx.fillRect(L2 + d * 3, y + 1.4, d * 5, 2.4);
    if (litLevel > 0.55) {                        // headlight in the half-dark
      ctx.fillStyle = CREAM_HI;
      ctx.beginPath(); ctx.arc(nose - d * 0.8, y + 6, 1.5, 0, Math.PI * 2); ctx.fill();
    }
  }

  function drawAirship(litLevel) {
    if (!airship.active || reducedMotion.matches) return;
    var x = airship.x, y = airship.y;
    var d = airship.dir;                          // nose direction
    var nose = x + d * 66;
    var tail = x - d * 60;
    if (STYLE !== 'atompunk') { drawAirshipEra(STYLE, x, y, d, litLevel > 0.5); return; }

    // clean triangular tail fins
    ctx.fillStyle = TEALS[1];
    ctx.beginPath();                              // upper fin
    ctx.moveTo(tail + d * 12, y - 5);
    ctx.lineTo(tail - d * 16, y - 27);
    ctx.lineTo(tail - d * 4, y - 4);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();                              // lower fin
    ctx.moveTo(tail + d * 12, y + 5);
    ctx.lineTo(tail - d * 16, y + 27);
    ctx.lineTo(tail - d * 4, y + 4);
    ctx.closePath(); ctx.fill();

    // streamlined envelope: pointed nose, rounded tail
    ctx.fillStyle = CREAM_HI;
    ctx.beginPath();
    ctx.moveTo(nose, y);
    ctx.bezierCurveTo(nose - d * 34, y - 21, tail + d * 30, y - 20, tail, y);
    ctx.bezierCurveTo(tail + d * 30, y + 20, nose - d * 34, y + 21, nose, y);
    ctx.closePath(); ctx.fill();

    ctx.save();                                   // detail clipped to the hull
    ctx.clip();
    ctx.fillStyle = ORANGE;                       // longitudinal accent band
    ctx.fillRect(x - 74, y - 3.2, 148, 6.4);
    ctx.fillStyle = BRASS;                        // nose cone
    ctx.beginPath(); ctx.ellipse(nose, y, 17, 22, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(6, 37, 35, 0.22)';    // ring frames
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x + d * 4, y - 21); ctx.lineTo(x + d * 4, y + 21);
    ctx.moveTo(x - d * 26, y - 20); ctx.lineTo(x - d * 26, y + 20);
    ctx.stroke();
    ctx.restore();

    // suspension cables + streamlined gondola
    ctx.strokeStyle = TEALS[2]; ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(x - 11, y + 17); ctx.lineTo(x - 9, y + 25);
    ctx.moveTo(x + 11, y + 17); ctx.lineTo(x + 9, y + 25);
    ctx.stroke();
    ctx.fillStyle = TEALS[1];
    ctx.beginPath(); ctx.ellipse(x, y + 28, 16, 5.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = litLevel > 0.5 ? BRASS : TEALS[2];   // gondola windows
    ctx.beginPath();
    dotPath(x - 8, y + 28, 1.5); dotPath(x, y + 28, 1.5); dotPath(x + 8, y + 28, 1.5);
    ctx.fill();

    ctx.font = '600 8px Jost, Futura, sans-serif';    // NAZARBAN on the envelope
    if ('letterSpacing' in ctx) ctx.letterSpacing = '1.5px';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = TEALS[2];
    ctx.fillText('NAZARBAN', x - d * 2, y - 9);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  }

  function drawSearchlights(starLevel) {
    if (starLevel <= 0.35 || !eraHas('searchlights')) return;
    var beacon = null;
    for (var i = 0; i < city.length; i++) {
      if (city[i].mast && city[i].progress === 1) { beacon = city[i]; break; }
    }
    if (!beacon) return;
    var bx = beacon.x + beacon.w / 2;
    var by = GROUND_Y - beacon.h - 38;
    var alpha = 0.10 * Math.min(1, (starLevel - 0.35) / 0.4);
    ctx.fillStyle = 'rgba(242, 233, 210, ' + alpha.toFixed(3) + ')';
    var angles = [
      -1.15 + Math.sin(effT * 0.10) * 0.45,
      -1.95 + Math.sin(effT * 0.13 + 2.1) * 0.45
    ];
    for (var a = 0; a < 2; a++) {
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx + Math.cos(angles[a] - 0.035) * 540, by + Math.sin(angles[a] - 0.035) * 540);
      ctx.lineTo(bx + Math.cos(angles[a] + 0.035) * 540, by + Math.sin(angles[a] + 0.035) * 540);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawSputnik(starLevel) {
    if (!sputnik.active || reducedMotion.matches || starLevel <= 0.05 || !eraHas('sputnik')) return;
    var x = -40 + sputnik.p * (VIEW_W + 80);
    var y = (84 + sputnik.p * 52) * SKY_K;
    ctx.globalAlpha = Math.min(1, starLevel) * 0.9;
    ctx.strokeStyle = BRASS;                      // four swept, kinked antennae
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    var spread = [-11, -4, 4, 11];
    for (var an = 0; an < 4; an++) {
      ctx.moveTo(x - 2.5, y + spread[an] * 0.25);
      ctx.lineTo(x - 18, y + spread[an] * 0.7);
      ctx.lineTo(x - 31, y + spread[an]);
    }
    ctx.stroke();
    ctx.fillStyle = BRASS;                        // polished sphere
    ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = CREAM_HI;                     // specular glint
    ctx.beginPath(); ctx.arc(x - 1.3, y - 1.4, 1.3, 0, Math.PI * 2); ctx.fill();
    if (Math.sin(effT * 7) > 0.2) {               // telemetry beacon
      ctx.fillStyle = ORANGE;
      ctx.beginPath(); ctx.arc(x + 3.6, y - 2.2, 1.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawClouds(color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    for (var i = 0; i < clouds.length; i++) {
      var cl = clouds[i];
      var baseY = 34 + cl.fy * (GROUND_Y - 200);
      var first = cl.lobes[0];
      ctx.moveTo(cl.x + (first.dx - first.r) * cl.s, baseY);
      for (var j = 0; j < cl.lobes.length; j++) {   // lumpy top, one pass
        var lb = cl.lobes[j];
        ctx.arc(cl.x + lb.dx * cl.s, baseY, lb.r * cl.s, Math.PI, 0);
      }
      ctx.closePath();                              // …closed flat along the bottom
    }
    ctx.fill();
  }

  function drawSmoke(color) {
    if (reducedMotion.matches || !smoke.length) return;
    ctx.fillStyle = color;
    for (var i = 0; i < smoke.length; i++) {
      var p = smoke[i];
      ctx.globalAlpha = Math.max(0, 0.42 * (1 - p.life / p.max));
      ctx.beginPath();                            // twin-lobed puff, flat base
      ctx.moveTo(p.x - p.r * 1.15, p.y);
      ctx.arc(p.x - p.r * 0.45, p.y, p.r * 0.7, Math.PI, 0);
      ctx.arc(p.x + p.r * 0.4, p.y, p.r * 0.85, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawBolt() {
    if (lightning.t <= 0 || !lightning.pts || reducedMotion.matches) return;
    var a = lightning.t / 0.32;
    ctx.strokeStyle = CREAM_HI;
    ctx.lineWidth = 2.5;
    ctx.globalAlpha = Math.max(0, a * (0.55 + 0.45 * Math.sin(lightning.t * 80)));
    ctx.beginPath();
    for (var i = 0; i < lightning.pts.length; i++) {
      var pt = lightning.pts[i];
      if (i === 0) ctx.moveTo(pt[0], pt[1]); else ctx.lineTo(pt[0], pt[1]);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // three flat bands of the console's own colors — a poster rainbow
  function drawRainbow() {
    if (rainbow <= 0.01) return;
    var cx = VIEW_W * 0.62, cy = GROUND_Y + 170;
    var colors = [ORANGE, BRASS, CREAM_HI];
    ctx.lineWidth = 12;
    for (var i = 0; i < 3; i++) {
      ctx.strokeStyle = colors[i];
      ctx.globalAlpha = 0.28 * Math.min(1, rainbow * 3);
      ctx.beginPath();
      ctx.arc(cx, cy, 448 - i * 14, Math.PI, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawBirds(skyLum) {
    if (reducedMotion.matches || !birds.length) return;
    ctx.strokeStyle = skyLum > 0.45 ? TEAL_TRIM : CREAM_HI;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (var i = 0; i < birds.length; i++) {
      var f = birds[i];
      for (var m = 0; m < f.members.length; m++) {
        var bm = f.members[m];
        var px = f.x + bm.dx * f.dir;
        var py = f.y + bm.dy;
        var wing = Math.sin(effT * 9 + bm.ph) * 3.5;
        ctx.moveTo(px - 5, py + wing);
        ctx.lineTo(px, py);
        ctx.lineTo(px + 5, py + wing);
      }
    }
    ctx.stroke();
  }

  function drawRegatta(litLevel) {
    if (!regatta.active || reducedMotion.matches) return;
    for (var i = 0; i < regatta.balloons.length; i++) {
      var b = regatta.balloons[i];
      if (b.x < -100 || b.x > VIEW_W + 100) continue;
      var y = b.y + Math.sin(effT * b.f + b.ph) * b.amp;
      var r = b.r;
      var basketY = y + r * 1.05 + 12;

      ctx.strokeStyle = TEAL_TRIM;                // rigging
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(b.x - r * 0.34, y + r * 1.0); ctx.lineTo(b.x - 4, basketY);
      ctx.moveTo(b.x + r * 0.34, y + r * 1.0); ctx.lineTo(b.x + 4, basketY);
      ctx.stroke();

      ctx.fillStyle = b.color;                    // teardrop envelope
      ctx.beginPath();
      ctx.moveTo(b.x - r * 0.38, y + r * 1.05);
      ctx.bezierCurveTo(b.x - r * 1.15, y + r * 0.4, b.x - r * 1.05, y - r * 0.95, b.x, y - r);
      ctx.bezierCurveTo(b.x + r * 1.05, y - r * 0.95, b.x + r * 1.15, y + r * 0.4, b.x + r * 0.38, y + r * 1.05);
      ctx.closePath();
      ctx.fill();
      ctx.save();                                 // panel band, clipped to hull
      ctx.clip();
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = TEAL_TRIM;
      ctx.fillRect(b.x - r * 1.2, y + r * 0.3, r * 2.4, r * 0.3);
      ctx.globalAlpha = 1;
      ctx.restore();
      ctx.strokeStyle = TEAL_TRIM;                // two curved gores
      ctx.globalAlpha = 0.4;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(b.x - r * 0.14, y + r * 1.02);
      ctx.quadraticCurveTo(b.x - r * 0.6, y, b.x - r * 0.2, y - r * 0.97);
      ctx.moveTo(b.x + r * 0.14, y + r * 1.02);
      ctx.quadraticCurveTo(b.x + r * 0.6, y, b.x + r * 0.2, y - r * 0.97);
      ctx.stroke();
      ctx.globalAlpha = 1;

      ctx.fillStyle = BRASS;                      // basket
      ctx.fillRect(b.x - 5, basketY, 10, 7);
      ctx.fillStyle = TEAL_TRIM;
      ctx.fillRect(b.x - 5, basketY + 2.5, 10, 1.5);
      if (litLevel > 0.55) {                      // burner flame flickers
        ctx.globalAlpha = 0.55 + 0.45 * Math.sin(effT * 7 + b.ph);
        ctx.fillStyle = GLOW_ORANGE;
        ctx.beginPath(); ctx.arc(b.x, y + r * 1.08 + 3, 5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = ORANGE;
        ctx.beginPath(); ctx.arc(b.x, y + r * 1.08 + 3, 2, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  }

  function drawUfo() {
    if (!ufo.active || reducedMotion.matches) return;
    var x = ufo.x;
    var y = ufo.y + Math.sin(effT * 2.0) * 9;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.sin(effT * 1.1) * 0.05);

    ctx.fillStyle = GLOW_CYAN;                    // tractor beam
    ctx.globalAlpha = 0.28 + 0.12 * Math.sin(effT * 4);
    ctx.beginPath();
    ctx.moveTo(-6, 5); ctx.lineTo(6, 5);
    ctx.lineTo(19, 42); ctx.lineTo(-19, 42);
    ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1;

    ctx.fillStyle = TEALS[2];                     // saucer underside
    ctx.beginPath(); ctx.ellipse(0, 1.5, 33, 9, 0, 0, Math.PI); ctx.fill();
    ctx.fillStyle = CREAM_HI;                     // chrome topside
    ctx.beginPath(); ctx.ellipse(0, 1.5, 33, 9, 0, Math.PI, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = BRASS;                      // rim
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(0, 1.5, 33, 9, 0, 0, Math.PI * 2); ctx.stroke();

    ctx.fillStyle = 'rgba(63, 224, 216, 0.5)';    // glass dome
    ctx.beginPath(); ctx.ellipse(0, -2.5, 13, 10, 0, Math.PI, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = CREAM_HI; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.ellipse(0, -2.5, 13, 10, 0, Math.PI, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = 'rgba(251, 243, 222, 0.85)';  // dome glint
    ctx.beginPath(); ctx.ellipse(-4.5, -7, 3, 2, -0.5, 0, Math.PI * 2); ctx.fill();

    for (var k = 0; k < 7; k++) {                 // rim lights, sequential pulse
      var t = (k + 0.5) / 7 * Math.PI;
      var lx = Math.cos(t) * 28;
      var ly = 1.5 + Math.sin(t) * 5;
      var on = (k + Math.floor(effT * 3)) % 3 === 0;
      if (on) { ctx.shadowBlur = 7; ctx.shadowColor = BRASS; }
      ctx.fillStyle = on ? BRASS : 'rgba(255, 201, 74, 0.35)';
      ctx.beginPath(); ctx.arc(lx, ly, 1.9, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    }
    ctx.restore();
  }

  // the municipal park: bandstand, trees, seasonal dress — snow caps in
  // winter weather, orange blossoms while the calendar reads spring
  function drawPark(litLevel) {
    var i, t;
    var spring = calendar.month >= 2 && calendar.month <= 4;
    var snowAmt = weatherLevel[2];
    var bx = park.x;

    ctx.fillStyle = TEAL_TRIM;                    // bandstand plinth
    ctx.fillRect(bx - 24, GROUND_Y - 6, 48, 6);
    if (litLevel > 0.55) {                        // warm lamp under the roof
      ctx.fillStyle = GLOW_BRASS;
      ctx.beginPath(); ctx.arc(bx, GROUND_Y - 18, 13, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = BRASS;                        // posts
    ctx.fillRect(bx - 17, GROUND_Y - 26, 3, 20);
    ctx.fillRect(bx + 14, GROUND_Y - 26, 3, 20);
    ctx.fillStyle = CREAM_HI;                     // conical roof
    ctx.beginPath();
    ctx.moveTo(bx - 26, GROUND_Y - 26);
    ctx.lineTo(bx, GROUND_Y - 44);
    ctx.lineTo(bx + 26, GROUND_Y - 26);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = BRASS;                        // finial
    ctx.beginPath(); ctx.arc(bx, GROUND_Y - 46, 2.5, 0, Math.PI * 2); ctx.fill();
    for (var pf = 0; pf < 7; pf++) {              // festive pennant garland
      var pxb = bx - 24 + pf * 8;
      ctx.fillStyle = pf % 2 ? ORANGE : BRASS;
      ctx.beginPath();
      ctx.moveTo(pxb, GROUND_Y - 25);
      ctx.lineTo(pxb + 6, GROUND_Y - 25);
      ctx.lineTo(pxb + 3, GROUND_Y - 21);
      ctx.closePath(); ctx.fill();
    }

    for (i = 0; i < park.shrubs.length; i++) {    // round shrubs at ground level
      var sh = park.shrubs[i];
      if (Math.abs(sh.x - bx) < 32 || Math.abs(sh.x - park.fountain) < 24) continue;
      ctx.fillStyle = '#183B37';
      ctx.beginPath(); ctx.arc(sh.x, GROUND_Y, sh.r, Math.PI, Math.PI * 2); ctx.fill();
    }

    for (i = 0; i < park.trees.length; i++) {
      t = park.trees[i];
      if (Math.abs(t.x - bx) < 32 ||              // keep the bandstand clear
          Math.abs(t.x - park.fountain) < 22 ||   // and the fountain
          Math.abs(t.x - park.bench) < 18) continue;
      var cy = GROUND_Y - 16 - t.r * 0.8;
      ctx.fillStyle = TEAL_TRIM;                  // tapered trunk
      ctx.beginPath();
      ctx.moveTo(t.x - 2.5, GROUND_Y);
      ctx.lineTo(t.x - 1, cy + t.r * 0.4);
      ctx.lineTo(t.x + 1, cy + t.r * 0.4);
      ctx.lineTo(t.x + 2.5, GROUND_Y);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#235450';                  // three-lobed poster canopy
      ctx.beginPath();
      dotPath(t.x - t.r * 0.55, cy + t.r * 0.18, t.r * 0.72);
      dotPath(t.x + t.r * 0.55, cy + t.r * 0.18, t.r * 0.72);
      dotPath(t.x, cy - t.r * 0.28, t.r * 0.82);
      ctx.fill();
      ctx.fillStyle = '#183B37';                  // flat dappled shade
      ctx.beginPath(); ctx.arc(t.x + t.r * 0.38, cy + t.r * 0.32, t.r * 0.45, 0, Math.PI * 2); ctx.fill();
      if (snowAmt > 0.05) {                       // settled snow cap
        ctx.globalAlpha = snowAmt;
        ctx.fillStyle = CREAM_HI;
        ctx.beginPath(); ctx.arc(t.x, cy - t.r * 0.28, t.r * 0.82, Math.PI, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
      }
      if (spring) {                               // blossom season
        ctx.fillStyle = ORANGE;
        ctx.beginPath();
        for (var bl = 0; bl < t.blossoms.length; bl++) {
          dotPath(t.x + t.blossoms[bl][0], cy + t.blossoms[bl][1], 2);
        }
        ctx.fill();
      }
    }

    // the fountain: teal basin, brass rim, and a smooth cream crown of
    // water — two stroked arcs from bowl to basin, a swaying center
    // plume, a bright pulse traveling each stream, and rings widening
    // where the water lands
    var fx = park.fountain;
    ctx.fillStyle = TEAL_TRIM;
    ctx.fillRect(fx - 20, GROUND_Y - 8, 40, 8);
    ctx.fillStyle = BRASS;
    ctx.fillRect(fx - 20, GROUND_Y - 9, 40, 2);
    ctx.fillStyle = 'rgba(242, 233, 210, 0.30)';  // still water in the basin
    ctx.fillRect(fx - 17, GROUND_Y - 7, 34, 2);
    ctx.fillStyle = TEAL_TRIM;                    // pedestal + bowl
    ctx.fillRect(fx - 2.5, GROUND_Y - 21, 5, 13);
    ctx.beginPath(); ctx.ellipse(fx, GROUND_Y - 21, 9, 2.8, 0, 0, Math.PI * 2); ctx.fill();

    var still = reducedMotion.matches;
    var sway = still ? 0 : Math.sin(effT * 1.7) * 1.2;
    ctx.strokeStyle = CREAM_HI;
    ctx.lineCap = 'round';

    // the two side streams: bowl lip → apex → basin edge
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    for (i = -1; i <= 1; i += 2) {
      ctx.moveTo(fx + i * 4, GROUND_Y - 23);
      ctx.quadraticCurveTo(fx + i * (11 + sway * i * 0.4), GROUND_Y - 36,
                           fx + i * 15, GROUND_Y - 7);
    }
    ctx.stroke();

    // the center plume breathes: a taller stroke with a soft crest
    var plume = 12 + (still ? 0 : Math.sin(effT * 2.3) * 2.5);
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(fx, GROUND_Y - 22);
    ctx.quadraticCurveTo(fx + sway, GROUND_Y - 22 - plume * 0.7, fx + sway * 0.6, GROUND_Y - 22 - plume);
    ctx.stroke();
    ctx.fillStyle = CREAM_HI;                     // crest droplet, parting
    ctx.beginPath();
    ctx.ellipse(fx + sway * 0.6, GROUND_Y - 24.5 - plume, 1.5, 2.2, 0, 0, Math.PI * 2);
    ctx.fill();

    if (!still) {
      // a bright pulse rides each stream (quadratic point at t)
      var pt = (effT * 0.9) % 1;
      var mt = 1 - pt;
      ctx.globalAlpha = 0.95;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      for (i = -1; i <= 1; i += 2) {
        var qx0 = fx + i * 4, qy0 = GROUND_Y - 23;
        var qcx = fx + i * 11, qcy = GROUND_Y - 36;
        var qx1 = fx + i * 15, qy1 = GROUND_Y - 7;
        var t0 = Math.max(0, pt - 0.12), t1 = pt;
        var q = function (a, b, c, t) { var m = 1 - t; return m * m * a + 2 * m * t * b + t * t * c; };
        ctx.moveTo(q(qx0, qcx, qx1, t0), q(qy0, qcy, qy1, t0));
        ctx.lineTo(q(qx0, qcx, qx1, t1), q(qy0, qcy, qy1, t1));
      }
      ctx.stroke();

      // landing rings widen and fade where the streams touch down
      var ring = (effT * 0.8) % 1;
      ctx.globalAlpha = 0.5 * (1 - ring);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(fx - 15, GROUND_Y - 6.5, 2 + ring * 4, 0.8 + ring * 1.2, 0, 0, Math.PI * 2);
      ctx.moveTo(fx + 15 + 2 + ring * 4, GROUND_Y - 6.5);
      ctx.ellipse(fx + 15, GROUND_Y - 6.5, 2 + ring * 4, 0.8 + ring * 1.2, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.lineCap = 'butt';

    // a bench for watching all of it
    var bex = park.bench;
    ctx.fillStyle = TEAL_TRIM;
    ctx.fillRect(bex - 9, GROUND_Y - 7, 2.5, 7);
    ctx.fillRect(bex + 6.5, GROUND_Y - 7, 2.5, 7);
    ctx.fillStyle = BRASS;
    ctx.fillRect(bex - 11, GROUND_Y - 8, 22, 2.5);
    ctx.fillRect(bex - 11, GROUND_Y - 15, 2.5, 7);

    // somebody takes the bench most hours of the day
    if (litLevel < 0.7 && Math.floor(effT / 45) % 3 !== 2) {
      ctx.fillStyle = TEAL_TRIM;
      ctx.fillRect(bex - 1.5, GROUND_Y - 14.5, 3.4, 7);
      ctx.beginPath(); ctx.arc(bex, GROUND_Y - 16.5, 1.9, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(bex + 1.2, GROUND_Y - 8, 1.2, 8);
      ctx.fillRect(bex + 3.4, GROUND_Y - 8, 1.2, 8);
    }

    // deep snow raises a snowman by the bench
    if (snowAmt > 0.6) {
      var sa = (snowAmt - 0.6) / 0.4;
      var smx = bex + 22;
      ctx.globalAlpha = sa;
      ctx.fillStyle = CREAM_HI;
      ctx.beginPath();
      dotPath(smx, GROUND_Y - 5, 5);
      dotPath(smx, GROUND_Y - 12.5, 3.6);
      ctx.fill();
      ctx.fillStyle = TEAL_TRIM;                  // a proper top hat
      ctx.fillRect(smx - 4, GROUND_Y - 16, 8, 1.5);
      ctx.fillRect(smx - 2.5, GROUND_Y - 21, 5, 5);
      ctx.fillStyle = ORANGE;                     // the carrot
      ctx.beginPath(); ctx.arc(smx + 3, GROUND_Y - 12.5, 1.3, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  // December: festive strings sag between neighboring rooftops with
  // alternating brass and burnt-orange bulbs
  function drawStringLights(litLevel) {
    if (calendar.month !== 11) return;
    var dotsA = [], dotsB = [];
    var bulb = 0;
    ctx.strokeStyle = TEAL_TRIM;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (var i = 0; i < city.length - 1; i++) {
      var a = city[i], b = city[i + 1];
      if (a.progress !== 1 || b.progress !== 1) continue;
      var gap = b.x - (a.x + a.w);
      if (gap < 6 || gap > 90) continue;          // never across a plaza or the park
      if (Math.abs(a.h - b.h) > 130) continue;    // no zip-lines between mismatched roofs
      var ax = a.x + a.w - 3, ay = GROUND_Y - a.h + 4;
      var bx = b.x + 3, by = GROUND_Y - b.h + 4;
      var sagY = Math.max(ay, by) + 18;
      var cx = (ax + bx) / 2, cyq = 2 * sagY - (ay + by) / 2;
      ctx.moveTo(ax, ay);
      ctx.quadraticCurveTo(cx, cyq, bx, by);
      for (var tq = 0.2; tq <= 0.81; tq += 0.15) {
        var mt = 1 - tq;
        (bulb++ % 2 ? dotsB : dotsA).push([
          mt * mt * ax + 2 * mt * tq * cx + tq * tq * bx,
          mt * mt * ay + 2 * mt * tq * cyq + tq * tq * by + 3
        ]);
      }
    }
    ctx.stroke();
    // festive bulbs always glow a touch
    coloredDots(dotsA, 2, Math.max(litLevel, 0.6), BRASS, GLOW_BRASS);
    coloredDots(dotsB, 2, Math.max(litLevel, 0.6), ORANGE, GLOW_ORANGE);
  }

  // the benefactor's streetlamps: curved-arm posts with teardrop shades
  // that pour flat cones of light onto the street after dark
  function drawStreetlamps(litLevel) {
    if (!streetlamps) return;
    var glowing = litLevel > 0.55 && outage.phase !== 1;
    var x;
    if (glowing) {                                // light cones first, batched
      ctx.fillStyle = 'rgba(242, 233, 210, 0.09)';
      ctx.beginPath();
      for (x = 85; x < VIEW_W; x += 170) {
        if (x < LAND_L + 12 || x > LAND_R - 20) continue;
        ctx.moveTo(x + 6, GROUND_Y - 26);
        ctx.lineTo(x - 6, GROUND_Y);
        ctx.lineTo(x + 18, GROUND_Y);
      }
      ctx.fill();
    }
    for (x = 85; x < VIEW_W; x += 170) {
      if (x < LAND_L + 12 || x > LAND_R - 20) continue;
      ctx.strokeStyle = TEAL_TRIM;                // post with a curved arm
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x, GROUND_Y);
      ctx.lineTo(x, GROUND_Y - 22);
      ctx.quadraticCurveTo(x, GROUND_Y - 30, x + 7, GROUND_Y - 29);
      ctx.stroke();
      ctx.fillStyle = TEAL_TRIM;                  // base foot
      ctx.fillRect(x - 3, GROUND_Y - 2, 6, 2);
      if (glowing) {
        ctx.fillStyle = GLOW_BRASS;
        ctx.beginPath(); ctx.arc(x + 7, GROUND_Y - 26, 8, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = BRASS;                      // teardrop shade, smooth
      ctx.beginPath();
      ctx.moveTo(x + 2, GROUND_Y - 28.6);
      ctx.quadraticCurveTo(x + 7, GROUND_Y - 32, x + 12, GROUND_Y - 28.6);
      ctx.quadraticCurveTo(x + 11, GROUND_Y - 24.2, x + 7, GROUND_Y - 23.6);
      ctx.quadraticCurveTo(x + 3, GROUND_Y - 24.2, x + 2, GROUND_Y - 28.6);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = glowing ? CREAM_HI : '#235450';   // the bulb itself
      ctx.beginPath(); ctx.arc(x + 7, GROUND_Y - 24, 2, 0, Math.PI * 2); ctx.fill();
    }
  }

  // the sister city's postcard, sliding in at the corner of the glass
  function drawMail() {
    if (!mail.phase || reducedMotion.matches) return;
    var p = mail.phase === 1 ? easeOutCubic(Math.min(1, mail.t / 0.8))
          : mail.phase === 3 ? 1 - Math.min(1, mail.t / 0.8)
          : 1;
    var CW = 216, CH = 132;
    var cx0 = VIEW_W - 250;
    var cy0 = VIEW_H + 14 - p * (CH + 40);

    ctx.save();
    ctx.translate(cx0 + CW / 2, cy0 + CH / 2);
    ctx.rotate(-0.045);
    ctx.translate(-CW / 2, -CH / 2);

    ctx.fillStyle = TEAL_TRIM;                    // drop shadow slab
    ctx.fillRect(4, 5, CW, CH);
    ctx.fillStyle = CREAM_HI;                     // the card
    ctx.fillRect(0, 0, CW, CH);
    ctx.strokeStyle = '#1E4744';
    ctx.lineWidth = 2;
    ctx.strokeRect(3, 3, CW - 6, CH - 6);

    // their little skyline under their sun
    ctx.fillStyle = BRASS;
    ctx.beginPath(); ctx.arc(12 + mailArt.sunX, 38, 9, 0, Math.PI * 2); ctx.fill();
    for (var i = 0; i < mailArt.bars.length; i++) {
      var b = mailArt.bars[i];
      ctx.fillStyle = TEALS[b.c];
      ctx.fillRect(12 + b.x, 86 - b.h, b.w, b.h);
    }
    ctx.fillStyle = TEAL_TRIM;                    // their ground line
    ctx.fillRect(10, 86, CW - 52, 2.5);

    ctx.fillStyle = ORANGE;                       // the stamp, cancelled
    ctx.fillRect(CW - 34, 10, 24, 28);
    ctx.fillStyle = CREAM_HI;
    ctx.fillRect(CW - 31, 13, 18, 22);
    ctx.fillStyle = ORANGE;
    ctx.beginPath(); ctx.arc(CW - 22, 24, 6, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = TEAL_TRIM;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.arc(CW - 26, 22, 13, 0, Math.PI * 2);
    ctx.moveTo(CW - 44, 30); ctx.lineTo(CW - 6, 26);
    ctx.moveTo(CW - 44, 34); ctx.lineTo(CW - 6, 30);
    ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.fillStyle = '#1E4744';
    ctx.font = '600 11px Jost, Futura, sans-serif';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '2px';
    ctx.fillText('GREETINGS FROM', 12, 104);
    ctx.fillStyle = ORANGE;
    ctx.font = '700 14px Jost, Futura, sans-serif';
    var sn = SISTER_CITY;
    while (ctx.measureText(sn).width > CW - 24 && sn.length > 4) sn = sn.slice(0, -2);
    ctx.fillText(sn, 12, 121);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    ctx.restore();
  }

  // KNAZ-TV: scanlines, a rolling bar, corner vignette, dust on the
  // tube, and the station bug — the whole city as an evening telecast
  var scanPattern = null;
  var vignette = null;

  function drawTelecast() {
    if (!telecast) return;
    if (!scanPattern) {
      var pc = document.createElement('canvas');
      pc.width = 4;
      pc.height = 4;
      var p2 = pc.getContext('2d');
      p2.fillStyle = 'rgba(13, 33, 30, 0.18)';
      p2.fillRect(0, 3, 4, 1);
      scanPattern = ctx.createPattern(pc, 'repeat');
    }
    if (!vignette) {
      vignette = ctx.createRadialGradient(VIEW_W / 2, VIEW_H / 2, 260,
                                          VIEW_W / 2, VIEW_H / 2, 950);
      vignette.addColorStop(0, 'rgba(13, 33, 30, 0)');
      vignette.addColorStop(1, 'rgba(13, 33, 30, 0.45)');
    }
    ctx.fillStyle = scanPattern;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    if (!reducedMotion.matches) {
      var barY = ((effT * 42) % (VIEW_H + 140)) - 70;     // the rolling bar
      ctx.fillStyle = 'rgba(242, 233, 210, 0.05)';
      ctx.fillRect(0, barY, VIEW_W, 64);
      var ns = ((effT * 997) | 0) >>> 0;                  // dust on the tube
      ctx.fillStyle = 'rgba(242, 233, 210, 0.22)';
      for (var k = 0; k < 10; k++) {
        ns = (ns * 1664525 + 1013904223) >>> 0;
        ctx.fillRect((ns >>> 16) % VIEW_W, ns % VIEW_H, 2, 2);
      }
    }

    ctx.font = '600 14px Jost, Futura, sans-serif';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '3px';
    if (reducedMotion.matches || Math.sin(effT * 4) > -0.4) {
      ctx.fillStyle = ORANGE;
      ctx.beginPath(); ctx.arc(30, 32, 4, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = CREAM_HI;
    ctx.fillText('KNAZ-TV · MUNICIPAL TELECAST', 44, 37);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  }

  /* ---------------- the fire brigade ----------------------------------- */
  // flames on the roofline, the ladder truck at the curb, and a hose
  // arc that does honest work — all flat poster shapes, no gradients
  function drawFire(litLevel) {
    if (fire.phase === 0 || !fire.b) return;
    var b = fire.b;
    var top = GROUND_Y - b.h;
    var fcx = b.x + b.w / 2;
    var i;

    if (fire.burn > 0.02 && !reducedMotion.matches) {   // the flames
      var tongues = Math.max(2, Math.round(b.w / 16));
      for (i = 0; i < tongues; i++) {
        var tx = b.x + b.w * (i + 0.5) / tongues;
        var fl2 = (Math.sin(effT * 9 + i * 2.6) * 0.5 + 0.5);
        var fh = (10 + fl2 * 14) * fire.burn;
        ctx.fillStyle = ORANGE;
        ctx.beginPath();
        ctx.moveTo(tx - 5, top);
        ctx.quadraticCurveTo(tx - 2, top - fh * 0.6, tx + Math.sin(effT * 7 + i) * 3, top - fh);
        ctx.quadraticCurveTo(tx + 3, top - fh * 0.5, tx + 5, top);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = BRASS;                          // hot core
        ctx.beginPath();
        ctx.moveTo(tx - 2.4, top);
        ctx.quadraticCurveTo(tx, top - fh * 0.55, tx + Math.sin(effT * 8 + i) * 1.6, top - fh * 0.62);
        ctx.quadraticCurveTo(tx + 1.6, top - fh * 0.3, tx + 2.4, top);
        ctx.closePath(); ctx.fill();
      }
      ctx.globalAlpha = fire.burn * 0.5;                // smoke over the flames
      ctx.fillStyle = 'rgba(30, 30, 30, 0.6)';
      for (i = 0; i < 3; i++) {
        var sp2 = (effT * 14 + i * 17) % 46;
        ctx.beginPath();
        ctx.arc(fcx + Math.sin(effT + i * 2) * 8 - sp2 * 0.24, top - 14 - sp2, 5 + sp2 * 0.16, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // the ladder truck (the town's own burnt-orange)
    var txx = fire.truckX, gy2 = GROUND_Y + 20;
    var night2 = litLevel > 0.55;
    ctx.fillStyle = TEAL_TRIM;
    ctx.beginPath();
    ctx.arc(txx - 12, gy2 - 3, 3.4, 0, Math.PI * 2);
    ctx.arc(txx + 12, gy2 - 3, 3.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = ORANGE;
    ctx.fillRect(txx - 18, gy2 - 14, 36, 10);
    ctx.fillRect(fire.dir === 1 ? txx + 12 : txx - 18, gy2 - 19, 6, 5);   // cab
    ctx.fillStyle = CREAM_HI;
    ctx.fillRect(txx - 14, gy2 - 12, 28, 1.6);          // coach line
    var beacon = Math.sin(effT * 10) > 0;               // the gumball light
    if (beacon) { ctx.shadowBlur = 7; ctx.shadowColor = ORANGE; }
    ctx.fillStyle = beacon ? ORANGE : mixHex(ORANGE, TEAL_TRIM, 0.5);
    ctx.fillRect(txx - 2, gy2 - 22, 4, 3.4);
    ctx.shadowBlur = 0;
    // the ladder goes up once the truck has stopped at the curb
    if (fire.phase >= 2) {
      ctx.strokeStyle = BRASS; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(txx, gy2 - 15);
      ctx.lineTo(fcx + (fire.dir === 1 ? -b.w * 0.3 : b.w * 0.3), top + 6);
      ctx.stroke();
    }

    if (fire.phase === 2 && !reducedMotion.matches) {   // the hose arc
      var hx0 = txx, hy0 = gy2 - 16;
      var hx1 = fcx, hy1 = top - 6;
      var mx = (hx0 + hx1) / 2, my = Math.min(hy0, hy1) - 34;
      ctx.strokeStyle = 'rgba(140, 190, 200, 0.75)';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(hx0, hy0);
      ctx.quadraticCurveTo(mx, my, hx1, hy1);
      ctx.stroke();
      ctx.fillStyle = 'rgba(140, 190, 200, 0.8)';       // droplets off the crest
      for (i = 0; i < 4; i++) {
        var dp = ((effT * 1.7 + i * 0.23) % 1);
        var ox = hx0 + (hx1 - hx0) * dp + (hx1 - hx0) * 0.02;
        var oy = (1 - dp) * (1 - dp) * hy0 + 2 * (1 - dp) * dp * my + dp * dp * hy1;
        ctx.fillRect(ox - 1, oy + 3, 2, 2);
      }
    }
  }

  /* ---------------- the fire brigade ends ------------------------------ */

  // factory calibration card, straight from the Nazarban service manual
  function drawTestPattern() {
    if (testPattern <= 0) return;
    var fade = Math.min(1, testPattern / 0.3, (4 - testPattern) / 0.3);
    ctx.globalAlpha = Math.max(0, fade);
    var bars = [TEALS[0], TEALS[1], TEALS[2], TEAL_TRIM, BRASS, ORANGE, CREAM_HI, '#E8DCC0'];
    var bw = VIEW_W / bars.length;
    for (var i = 0; i < bars.length; i++) {
      ctx.fillStyle = bars[i];
      ctx.fillRect(i * bw, 0, bw + 1, VIEW_H);
    }
    ctx.strokeStyle = CREAM_HI;                   // crosshair + circle
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(VIEW_W / 2, VIEW_H / 2, 130, 0, Math.PI * 2);
    ctx.moveTo(VIEW_W / 2 - 170, VIEW_H / 2); ctx.lineTo(VIEW_W / 2 + 170, VIEW_H / 2);
    ctx.moveTo(VIEW_W / 2, VIEW_H / 2 - 170); ctx.lineTo(VIEW_W / 2, VIEW_H / 2 + 170);
    ctx.stroke();
    ctx.fillStyle = TEAL_TRIM;
    ctx.font = '600 22px Jost, Futura, sans-serif';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '6px';
    ctx.textAlign = 'center';
    ctx.fillText('NAZARBAN INSTRUMENT WORKS', VIEW_W / 2, VIEW_H / 2 - 190);
    ctx.font = '600 15px Jost, Futura, sans-serif';
    ctx.fillText('TEST PATTERN PT-1 · MODEL M-58', VIEW_W / 2, VIEW_H / 2 + 208);
    ctx.textAlign = 'left';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    ctx.globalAlpha = 1;
  }

  function drawFireworks() {
    if (reducedMotion.matches) return;
    var i, p;
    ctx.fillStyle = CREAM_HI;                     // shells climbing
    ctx.globalAlpha = 0.8;
    for (i = 0; i < fw.shells.length; i++) {
      p = fw.shells[i];
      ctx.fillRect(p.x - 1, p.y, 2, 8);
    }
    for (i = 0; i < fw.sparks.length; i++) {
      p = fw.sparks[i];
      ctx.globalAlpha = Math.max(0, 0.95 * (1 - p.life / p.max));
      if (p.flash) {                              // the burst's bright core
        ctx.fillStyle = CREAM_HI;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 15 * (1 - p.life / p.max), 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - p.s, p.y - p.s, p.s * 2, p.s * 2);
      }
    }
    ctx.globalAlpha = 1;
  }

  // a tower crane serves every front-row lot that is rising or coming
  // down — the lever's drama made visible. The hook carries a girder on
  // the way up and swings a wrecking ball on the way down.
  function drawCrane(b) {
    if (!(b.rising || b.demolishing) || b.progress >= 1 || b.progress <= 0) return;
    var h = b.h * easeOutCubic(b.progress);
    var top = GROUND_Y - h;
    var finalH = (b.next && b.demolishing) ? Math.max(b.h, b.next.h) : b.h;
    var mastTop = GROUND_Y - finalH - 46;

    var side = (Math.floor(b.x) % 2 === 0) ? -1 : 1;   // deterministic per lot
    var mastX = side === -1 ? b.x - 10 : b.x + b.w + 10;
    if (mastX < 14) { side = 1; mastX = b.x + b.w + 10; }
    if (mastX > VIEW_W - 14) { side = -1; mastX = b.x - 10; }

    var jibLen = b.w * 0.8 + 10;
    var jibTip = side === -1 ? mastX + jibLen : mastX - jibLen;   // out over the lot
    var hookX = mastX + (jibTip - mastX) * 0.72;

    ctx.fillStyle = TEAL_TRIM;                          // mast + jib + counter-jib
    ctx.fillRect(mastX - 2, mastTop, 4, GROUND_Y - mastTop);
    ctx.fillRect(Math.min(mastX, jibTip), mastTop, Math.abs(jibTip - mastX), 3);
    ctx.fillRect(side === -1 ? mastX - 26 : mastX + 2, mastTop, 24, 3);
    ctx.fillStyle = BRASS;                              // counterweight + cab
    ctx.fillRect(side === -1 ? mastX - 30 : mastX + 22, mastTop - 2, 8, 8);
    ctx.fillRect(mastX - 4, mastTop + 4, 8, 7);

    ctx.fillStyle = TEAL_TRIM;                          // apex post + tie cables
    ctx.fillRect(mastX - 1.5, mastTop - 12, 3, 12);
    ctx.strokeStyle = TEAL_TRIM;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(mastX, mastTop - 11); ctx.lineTo(jibTip, mastTop + 1.5);
    ctx.moveTo(mastX, mastTop - 11);
    ctx.lineTo(side === -1 ? mastX - 26 : mastX + 26, mastTop + 1.5);
    ctx.stroke();

    ctx.strokeStyle = TEAL_TRIM;                        // cable to the load
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(hookX, mastTop + 3);
    ctx.lineTo(hookX, top - 8);
    ctx.stroke();
    if (b.demolishing) {                                // the wrecking ball
      ctx.fillStyle = TEAL_TRIM;
      ctx.beginPath(); ctx.arc(hookX, top - 2, 7, 0, Math.PI * 2); ctx.fill();
    } else {                                            // a girder going up
      ctx.fillStyle = BRASS;
      ctx.fillRect(hookX - 2, top - 8, 4, 4);
      ctx.fillStyle = b.color;
      ctx.fillRect(hookX - 11, top - 5, 22, 5);
    }
  }

  function drawDust() {
    if (reducedMotion.matches) return;
    for (var i = 0; i < dust.length; i++) {
      var p = dust[i];
      ctx.globalAlpha = Math.max(0, 0.5 * (1 - p.life / 1.1));
      ctx.fillStyle = CREAM_HI;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /* ---------------- Googie rooflines: a distinct silhouette per lot ----- */
  /* Each front-row lot draws one archetype above its parapet, so no two
     read alike: a roadside blade, a butterfly wing, a single upsweep, a
     floating cantilever, an observation dome, a barrel vault or a
     folded-plate sawtooth. All flat poster shapes in the console palette. */

  var ROOF = { FLAT: 0, FIN: 1, BUTTERFLY: 2, UPSWEEP: 3, CANTILEVER: 4, DOME: 5, ARCH: 6, FOLDED: 7 };
  var ACCENTS   = [NEON_CYAN, NEON_PINK, ORANGE];
  var ACC_GLOW  = [GLOW_CYAN, GLOW_PINK, GLOW_ORANGE];
  var ACC_BAND  = ['rgba(63,224,216,0.55)', 'rgba(255,90,150,0.55)', 'rgba(255,107,61,0.55)'];

  function roofSide(b) { return (Math.floor(b.x) % 2 === 0) ? -1 : 1; }   // deterministic per lot

  // FLAT lots keep the old repertoire: a rooftop neon marquee, or one of
  // three sculpted crowns, chosen by the building's own hash
  function drawFlatCrown(b, top, h, litLevel) {
    var signHash = Math.abs(Math.floor(b.x * 13.7 + b.w * 3.1));
    var free = !b.mast && !b.sign && !b.chimney && !b.clock;
    if (free && b.w >= 50 && h > 30 && signHash % 3 === 0) {
      drawNeonSign(b.x + b.w / 2, top, b.w, signHash, litLevel > 0.42);
      return;
    }
    if (!free || h <= 44) return;
    var cx0 = b.x + b.w / 2, cst = signHash % 3, acc = ACCENTS[b.accent];
    if (cst === 0) {                              // stepped setback ziggurat
      ctx.fillStyle = b.color;
      ctx.fillRect(cx0 - b.w * 0.33, top - 9, b.w * 0.66, 9);
      ctx.fillRect(cx0 - b.w * 0.18, top - 17, b.w * 0.36, 8);
      ctx.fillStyle = acc;
      ctx.fillRect(cx0 - b.w * 0.18, top - 17, b.w * 0.36, 1.4);
      ctx.fillStyle = ORANGE;
      ctx.fillRect(cx0 - 1, top - 24, 2, 7);
    } else if (cst === 1) {                       // small glass dome
      var dr = Math.min(b.w * 0.36, 20);
      ctx.fillStyle = 'rgba(63, 224, 216, 0.38)';
      ctx.beginPath(); ctx.ellipse(cx0, top, dr, dr * 0.85, 0, Math.PI, Math.PI * 2); ctx.fill();
      if (litLevel > 0.5) {
        ctx.fillStyle = GLOW_CYAN;
        ctx.beginPath(); ctx.ellipse(cx0, top, dr * 0.66, dr * 0.55, 0, Math.PI, Math.PI * 2); ctx.fill();
      }
      ctx.strokeStyle = CREAM_HI; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.ellipse(cx0, top, dr, dr * 0.85, 0, Math.PI, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx0 - dr, top); ctx.lineTo(cx0 + dr, top); ctx.stroke();
    } else {                                      // penthouse + twin antenna fins
      ctx.fillStyle = b.color;
      ctx.fillRect(cx0 - b.w * 0.28, top - 12, b.w * 0.56, 12);
      ctx.fillStyle = 'rgba(6,30,28,0.3)';
      ctx.fillRect(cx0 - b.w * 0.28, top - 12, b.w * 0.56, 2);
      ctx.fillStyle = BRASS;
      ctx.fillRect(cx0 - b.w * 0.22, top - 20, 2, 8);
      ctx.fillRect(cx0 + b.w * 0.22 - 2, top - 20, 2, 8);
    }
  }

  function drawRoof(b, top, h, litLevel) {
    var cx = b.x + b.w / 2, x0 = b.x, x1 = b.x + b.w;
    var night = litLevel > 0.55;
    var acc = ACCENTS[b.accent], accGlow = ACC_GLOW[b.accent];
    var s = b.roof, side, i;
    var slab = b.roofOrange ? ORANGE : TEAL_TRIM;   // burnt-orange swooping roofs

    if (s === ROOF.FLAT) { drawFlatCrown(b, top, h, litLevel); return; }

    if (s === ROOF.FIN) {                         // roadside pylon blade
      side = roofSide(b);
      var fx = side < 0 ? x0 + b.w * 0.16 : x1 - b.w * 0.16;
      var fh = Math.max(26, Math.min(72, h * 0.28));
      var fw = Math.max(6, Math.min(11, b.w * 0.13));
      ctx.fillStyle = TEAL_TRIM;                  // mounting foot
      ctx.fillRect(fx - fw / 2 - 3, top - 3, fw + 6, 4);
      ctx.fillStyle = b.color;                    // the blade
      ctx.fillRect(fx - fw / 2, top - fh, fw, fh);
      if (night) { ctx.shadowBlur = 7; ctx.shadowColor = acc; }
      ctx.fillStyle = acc;                        // neon tube edges
      ctx.fillRect(fx - fw / 2, top - fh, 1.6, fh);
      ctx.fillRect(fx + fw / 2 - 1.6, top - fh, 1.6, fh);
      ctx.shadowBlur = 0;
      var dots = [];                              // marquee bulbs down the blade
      for (var by = top - fh + 5; by < top - 4; by += 7) dots.push([fx, by]);
      coloredDots(dots, 1.5, night ? 1 : 0, BRASS, GLOW_BRASS);
      if (night) { ctx.shadowBlur = 8; ctx.shadowColor = ORANGE; }
      ctx.fillStyle = ORANGE;                     // orb finial
      ctx.beginPath(); ctx.arc(fx, top - fh - 3, 3.2, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;

    } else if (s === ROOF.BUTTERFLY) {            // upswept winged roof
      var over = 6;
      ctx.fillStyle = slab;                       // chevron slab
      ctx.beginPath();
      ctx.moveTo(x0 - over, top - 11);
      ctx.lineTo(cx, top + 3);
      ctx.lineTo(x1 + over, top - 11);
      ctx.lineTo(x1 + over, top - 7);
      ctx.lineTo(cx, top + 7);
      ctx.lineTo(x0 - over, top - 7);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = BRASS; ctx.lineWidth = 1.6;   // brass fascia
      ctx.beginPath();
      ctx.moveTo(x0 - over, top - 11); ctx.lineTo(cx, top + 3); ctx.lineTo(x1 + over, top - 11);
      ctx.stroke();

    } else if (s === ROOF.UPSWEEP) {              // single dramatic slope
      side = roofSide(b);
      var lowY = top + 2, highY = top - Math.min(28, h * 0.12 + 12);
      var lx = side < 0 ? x0 - 4 : x1 + 4;
      var hx = side < 0 ? x1 + 8 : x0 - 8;
      ctx.fillStyle = slab;                       // sloped slab
      ctx.beginPath();
      ctx.moveTo(lx, lowY); ctx.lineTo(hx, highY);
      ctx.lineTo(hx, highY + 4.5); ctx.lineTo(lx, lowY + 4.5);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = BRASS; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(lx, lowY); ctx.lineTo(hx, highY); ctx.stroke();
      ctx.fillStyle = b.color;                    // fin past the high end
      ctx.fillRect(hx - (side < 0 ? 2.4 : 0), highY - 12, 2.4, 16);
      if (night) { ctx.shadowBlur = 8; ctx.shadowColor = ORANGE; }
      ctx.fillStyle = ORANGE;                     // beacon on the point
      ctx.beginPath(); ctx.arc(hx + (side < 0 ? -1.2 : 1.2), highY - 13, 2.4, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;

    } else if (s === ROOF.CANTILEVER) {           // floating Googie roof plane
      side = roofSide(b);
      var proj = Math.min(20, b.w * 0.34);
      var slabT = top - 7;
      var pL = side < 0 ? x0 - proj : x0 - 2;
      var pR = side < 0 ? x1 + 2 : x1 + proj;
      var lift = 3;                               // boomerang lift at the tip
      ctx.fillStyle = slab;
      ctx.beginPath();
      ctx.moveTo(pL, slabT - (side < 0 ? lift : 0));
      ctx.lineTo(pR, slabT - (side < 0 ? 0 : lift));
      ctx.lineTo(pR, slabT + 5 - (side < 0 ? 0 : lift));
      ctx.lineTo(pL, slabT + 5 - (side < 0 ? lift : 0));
      ctx.closePath(); ctx.fill();
      var tipX = side < 0 ? pL : pR;              // diagonal support strut
      ctx.strokeStyle = TEAL_TRIM; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(tipX, slabT + 4);
      ctx.lineTo(side < 0 ? x0 + 6 : x1 - 6, GROUND_Y - h * 0.35);
      ctx.stroke();
      if (night) { ctx.fillStyle = accGlow; ctx.fillRect(pL, slabT + 5, pR - pL, 2); }
      ctx.fillStyle = acc;                        // lit eave tube
      ctx.fillRect(pL, slabT + 4.4, pR - pL, 1.2);

    } else if (s === ROOF.DOME) {                 // observation dome (Starlite)
      var dr2 = Math.min(b.w * 0.5, 36);
      var domeY = top - 2;
      ctx.fillStyle = CREAM_HI;                   // drum ring
      ctx.fillRect(cx - dr2, domeY, dr2 * 2, 4);
      ctx.fillStyle = 'rgba(63, 224, 216, 0.42)'; // glass dome
      ctx.beginPath(); ctx.ellipse(cx, domeY, dr2, dr2 * 1.02, 0, Math.PI, Math.PI * 2); ctx.fill();
      if (night) {
        ctx.fillStyle = GLOW_CYAN;
        ctx.beginPath(); ctx.ellipse(cx, domeY, dr2 * 0.7, dr2 * 0.72, 0, Math.PI, Math.PI * 2); ctx.fill();
      }
      ctx.strokeStyle = CREAM_HI; ctx.lineWidth = 1.2;   // outline + meridians
      ctx.beginPath();
      ctx.ellipse(cx, domeY, dr2, dr2 * 1.02, 0, Math.PI, Math.PI * 2);
      ctx.moveTo(cx, domeY); ctx.lineTo(cx, domeY - dr2 * 1.02);
      ctx.moveTo(cx - dr2 * 0.55, domeY); ctx.lineTo(cx - dr2 * 0.55, domeY - dr2 * 0.85);
      ctx.moveTo(cx + dr2 * 0.55, domeY); ctx.lineTo(cx + dr2 * 0.55, domeY - dr2 * 0.85);
      ctx.moveTo(cx - dr2, domeY); ctx.lineTo(cx + dr2, domeY);
      ctx.stroke();
      ctx.fillStyle = BRASS;                      // finial
      ctx.fillRect(cx - 1, domeY - dr2 * 1.02 - 6, 2, 8);
      ctx.beginPath(); ctx.arc(cx, domeY - dr2 * 1.02 - 7, 2.4, 0, Math.PI * 2); ctx.fill();

    } else if (s === ROOF.ARCH) {                 // barrel-vault cap
      var ah = Math.min(b.w * 0.42, 30);
      ctx.fillStyle = b.color;
      ctx.beginPath(); ctx.ellipse(cx, top, b.w / 2, ah, 0, Math.PI, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(6,30,28,0.22)';       // shaded lee of the vault
      ctx.beginPath(); ctx.ellipse(cx, top, b.w / 2, ah, 0, Math.PI * 1.5, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = BRASS; ctx.lineWidth = 1.3;   // rib
      ctx.beginPath(); ctx.ellipse(cx, top, b.w * 0.34, ah * 0.9, 0, Math.PI, Math.PI * 2); ctx.stroke();
      if (night) { ctx.shadowBlur = 6; ctx.shadowColor = acc; }
      ctx.fillStyle = acc;                        // glowing apex tube
      ctx.fillRect(cx - b.w * 0.3, top - ah + 1, b.w * 0.6, 1.4);
      ctx.shadowBlur = 0;

    } else if (s === ROOF.FOLDED) {               // folded-plate sawtooth
      var folds = Math.max(3, Math.min(5, Math.round(b.w / 22)));
      var fw2 = b.w / folds, fh2 = Math.min(15, b.w * 0.16);
      for (i = 0; i < folds; i++) {
        var fx0 = x0 + i * fw2;
        ctx.fillStyle = b.color;                  // sunlit slope
        ctx.beginPath();
        ctx.moveTo(fx0, top); ctx.lineTo(fx0 + fw2 * 0.5, top - fh2); ctx.lineTo(fx0 + fw2 * 0.5, top);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = night ? GLOW_CYAN : 'rgba(63,224,216,0.5)';   // glazed north slope
        ctx.beginPath();
        ctx.moveTo(fx0 + fw2 * 0.5, top - fh2); ctx.lineTo(fx0 + fw2, top); ctx.lineTo(fx0 + fw2 * 0.5, top);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = BRASS; ctx.lineWidth = 1;   // ridge
        ctx.beginPath(); ctx.moveTo(fx0, top); ctx.lineTo(fx0 + fw2 * 0.5, top - fh2); ctx.stroke();
      }
    }
  }

  // a cantilevered street-level entry canopy on slim pylons \u2014 pure Googie
  function drawCanopy(b) {
    var side = roofSide(b);
    var cy = GROUND_Y - Math.min(30, b.h * 0.14 + 16);
    var cxm = b.x + b.w / 2;
    var half = Math.min(b.w * 0.42, 26);
    var proj = side < 0 ? -8 : 8;
    ctx.fillStyle = TEAL_TRIM;                    // the slab
    ctx.beginPath();
    ctx.moveTo(cxm - half + proj * 0.4, cy);
    ctx.lineTo(cxm + half + proj, cy - 1.5);
    ctx.lineTo(cxm + half + proj, cy + 3.5);
    ctx.lineTo(cxm - half + proj * 0.4, cy + 5);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = BRASS;                        // fascia trim
    ctx.fillRect(cxm - half + proj * 0.4, cy - 1, half * 2, 1.4);
    ctx.strokeStyle = TEAL_TRIM; ctx.lineWidth = 1.6;   // two slim pylons
    ctx.beginPath();
    ctx.moveTo(cxm - half * 0.5, cy + 4); ctx.lineTo(cxm - half * 0.5 - 1, GROUND_Y);
    ctx.moveTo(cxm + half * 0.6, cy + 3); ctx.lineTo(cxm + half * 0.6 + 1, GROUND_Y);
    ctx.stroke();
  }

  // the town's Googie welcome sign, a boomerang panel on two raked poles
  function drawWelcome(litLevel) {
    if (!welcome || !eraHas('welcome')) return;
    var x = welcome.x, night = litLevel > 0.55;
    var pw = 152, ph = 46, poleH = 56;
    var py = GROUND_Y - poleH - ph, px = x - pw / 2;

    ctx.strokeStyle = TEAL_TRIM; ctx.lineWidth = 3;   // twin raked poles
    ctx.beginPath();
    ctx.moveTo(x - 24, GROUND_Y); ctx.lineTo(x - 15, py + ph);
    ctx.moveTo(x + 24, GROUND_Y); ctx.lineTo(x + 15, py + ph);
    ctx.stroke();

    var skew = 11;                                // skewed boomerang panel
    ctx.fillStyle = '#0A2B29';
    ctx.beginPath();
    ctx.moveTo(px + skew, py); ctx.lineTo(px + pw, py);
    ctx.lineTo(px + pw - skew, py + ph); ctx.lineTo(px, py + ph);
    ctx.closePath(); ctx.fill();
    if (night) { ctx.shadowBlur = 8; ctx.shadowColor = NEON_PINK; }
    ctx.strokeStyle = NEON_PINK; ctx.lineWidth = 2;   // neon border
    ctx.stroke();
    ctx.shadowBlur = 0;

    if (night) { ctx.shadowBlur = 6; ctx.shadowColor = BRASS; }
    ctx.strokeStyle = BRASS; ctx.lineWidth = 1.6; ctx.lineCap = 'round';   // corner starburst
    ctx.beginPath();
    for (var s = 0; s < 8; s++) {
      var a = s * Math.PI / 4, rr = s % 2 ? 5 : 9;
      ctx.moveTo(px + 15, py - 5); ctx.lineTo(px + 15 + Math.cos(a) * rr, py - 5 + Math.sin(a) * rr);
    }
    ctx.stroke(); ctx.shadowBlur = 0; ctx.lineCap = 'butt';

    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '1.5px';
    ctx.fillStyle = CREAM_HI;
    ctx.font = '600 8px Jost, Futura, sans-serif';
    ctx.fillText('WELCOME TO', x, py + 11);
    if (night) { ctx.shadowBlur = 6; ctx.shadowColor = NEON_PINK; }
    ctx.fillStyle = night ? '#FF8FBB' : NEON_PINK;
    var nfs = 14;                                 // shrink to fit the full name
    ctx.font = '700 ' + nfs + 'px Jost, Futura, sans-serif';
    while (ctx.measureText(CITY_NAME).width > pw - 20 && nfs > 8) {
      nfs -= 0.5;
      ctx.font = '700 ' + nfs + 'px Jost, Futura, sans-serif';
    }
    ctx.fillText(CITY_NAME, x, py + 25);
    ctx.shadowBlur = 0;
    ctx.fillStyle = BRASS;
    ctx.font = '600 7px Jost, Futura, sans-serif';
    ctx.fillText('THE FUTURE IS NOW', x, py + 38);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  }

  // the atomic broadcast tower — a tapering lattice mast with a mid
  // observation deck and a spoked gyro-wheel crown; the World-of-Tomorrow
  // centrepiece, standing behind the skyline
  function drawTower(litLevel) {
    if (!tower || !eraHas('tower')) return;
    var x = tower.x, h = tower.h, night = litLevel > 0.55;
    var topY = GROUND_Y - h;
    var baseHalf = tower.baseW / 2, topHalf = 6;
    var lattice = rgbStr(mixRgb(TRIM_RGB, hexToRgb(TEALS[0]), 0.3));
    var i, t, s;
    function half(tt) { return topHalf + (baseHalf - topHalf) * Math.pow(1 - tt, 1.4); }
    function ly(tt) { return GROUND_Y - h * tt; }

    ctx.fillStyle = TEALS[2];                     // base plinth
    ctx.fillRect(x - baseHalf - 4, GROUND_Y - 26, (baseHalf + 4) * 2, 26);
    ctx.fillStyle = TEAL_TRIM;
    ctx.fillRect(x - baseHalf - 8, GROUND_Y - 6, (baseHalf + 8) * 2, 6);

    var segs = 11;
    ctx.strokeStyle = lattice; ctx.lineWidth = 1.1; ctx.globalAlpha = 0.85;
    ctx.beginPath();                              // X cross-bracing
    for (s = 0; s < segs; s++) {
      var t0 = s / segs, t1 = (s + 1) / segs;
      ctx.moveTo(x - half(t0), ly(t0)); ctx.lineTo(x + half(t1), ly(t1));
      ctx.moveTo(x + half(t0), ly(t0)); ctx.lineTo(x - half(t1), ly(t1));
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.beginPath();                              // horizontals
    for (s = 0; s <= segs; s++) { t = s / segs; ctx.moveTo(x - half(t), ly(t)); ctx.lineTo(x + half(t), ly(t)); }
    ctx.stroke();
    ctx.lineWidth = 2.4;                          // legs
    ctx.beginPath();
    for (s = 0; s <= segs; s++) { t = s / segs; if (s === 0) ctx.moveTo(x - half(t), ly(t)); else ctx.lineTo(x - half(t), ly(t)); }
    ctx.stroke();
    ctx.beginPath();
    for (s = 0; s <= segs; s++) { t = s / segs; if (s === 0) ctx.moveTo(x + half(t), ly(t)); else ctx.lineTo(x + half(t), ly(t)); }
    ctx.stroke();

    var dt = 0.52, dy = ly(dt), dHalf = half(dt) + 15;   // mid observation deck
    ctx.fillStyle = CREAM_HI;
    ctx.beginPath(); ctx.ellipse(x, dy, dHalf, 9, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = TEALS[1];
    ctx.fillRect(x - dHalf, dy - 8, dHalf * 2, 8);
    ctx.fillStyle = TEAL_TRIM;
    ctx.beginPath(); ctx.ellipse(x, dy - 8, dHalf, 6, 0, Math.PI, Math.PI * 2); ctx.fill();
    var dk = [];
    for (var wx = -dHalf + 8; wx <= dHalf - 8; wx += 9) dk.push([x + wx, dy - 3]);
    coloredDots(dk, 1.6, night ? 1 : 0, BRASS, GLOW_BRASS);
    ctx.fillStyle = BRASS; ctx.fillRect(x - dHalf, dy - 9, dHalf * 2, 1.4);

    var cyC = topY - 4;                           // the gyro-wheel crown
    if (true) {                                   // the rotating sky-diner
      var rt = 0.78, ry = ly(rt), rHalf = half(rt) + 22;
      ctx.fillStyle = TEAL_TRIM;
      ctx.fillRect(x - 5, ry, 10, ly(0.6) - ry);
      ctx.fillStyle = CREAM_HI;                   // saucer underside
      ctx.beginPath(); ctx.ellipse(x, ry + 4, rHalf, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = TEALS[1];                   // window band
      ctx.fillRect(x - rHalf, ry - 5, rHalf * 2, 9);
      ctx.fillStyle = CREAM_HI;                   // roof cap
      ctx.beginPath(); ctx.ellipse(x, ry - 5, rHalf, 6, 0, Math.PI, Math.PI * 2); ctx.fill();
      ctx.fillStyle = BRASS; ctx.fillRect(x - rHalf, ry - 6, rHalf * 2, 1.4);
      var slots = 16;                             // windows scroll to imply rotation
      for (var wi = 0; wi < slots; wi++) {
        var frac = ((wi / slots) + (reducedMotion.matches ? 0 : effT * 0.04)) % 1;
        var wxr = x - rHalf + 4 + frac * (rHalf * 2 - 8);
        var wlit = night && (Math.floor(frac * slots) % 3 !== 0);
        if (wlit) { ctx.shadowBlur = 5; ctx.shadowColor = BRASS; }
        ctx.fillStyle = wlit ? BRASS : 'rgba(6,30,28,0.4)';
        ctx.fillRect(wxr, ry - 3, 2.4, 5);
        ctx.shadowBlur = 0;
      }
    }
    ctx.strokeStyle = lattice; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, topY + 6); ctx.lineTo(x, cyC); ctx.stroke();
    var R = 26;
    if (night && !reducedMotion.matches) {        // broadcast waves
      for (i = 0; i < 3; i++) {
        var wave = ((effT * 0.5 + i / 3) % 1);
        ctx.strokeStyle = 'rgba(63,224,216,' + (0.3 * (1 - wave)).toFixed(3) + ')';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(x, cyC, R + wave * 46, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
      }
    }
    ctx.strokeStyle = BRASS; ctx.lineWidth = 2; ctx.lineCap = 'round';   // out-thrust arms
    ctx.beginPath(); ctx.moveTo(x - R - 12, cyC); ctx.lineTo(x + R + 12, cyC); ctx.stroke();
    if (night) { ctx.shadowBlur = 8; ctx.shadowColor = BRASS; }
    ctx.lineWidth = 2;                            // spoked wheel
    ctx.beginPath(); ctx.arc(x, cyC, R, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(x, cyC, R * 0.55, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    for (i = 0; i < 12; i++) { var a = i * Math.PI / 6; ctx.moveTo(x + Math.cos(a) * R * 0.55, cyC + Math.sin(a) * R * 0.55); ctx.lineTo(x + Math.cos(a) * R, cyC + Math.sin(a) * R); }
    ctx.stroke();
    ctx.shadowBlur = 0; ctx.lineCap = 'butt';
    ctx.strokeStyle = CREAM_HI; ctx.lineWidth = 1.4;   // gimbal ring
    ctx.beginPath(); ctx.ellipse(x, cyC, R * 1.05, R * 0.4, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = CREAM_HI;                     // hub
    ctx.beginPath(); ctx.arc(x, cyC, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = ORANGE;
    ctx.beginPath(); ctx.arc(x, cyC, 2.4, 0, Math.PI * 2); ctx.fill();
    if (night) { ctx.shadowBlur = 6; ctx.shadowColor = BRASS; }
    ctx.fillStyle = night ? BRASS : CREAM_HI;     // node spheres on the arms
    ctx.beginPath(); dotPath(x - R - 12, cyC, 3); dotPath(x + R + 12, cyC, 3); ctx.fill();
    ctx.shadowBlur = 0;
    if (!reducedMotion.matches) {                 // orbiting electrons
      ctx.fillStyle = ORANGE;
      for (i = 0; i < 3; i++) {
        var ea = effT * 1.1 + i * 2.094;
        ctx.beginPath(); ctx.arc(x + Math.cos(ea) * R * 1.05, cyC + Math.sin(ea) * R * 0.4, 2.4, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  // rocket-belt commuters: little figures under bubble helmets, twin
  // exhaust flames trailing, arms thrust into the World of Tomorrow
  function drawJetpacks(litLevel) {
    if (reducedMotion.matches || !jets.length || !eraHas('jetpacks')) return;
    var night = litLevel > 0.55;
    for (var i = 0; i < jets.length; i++) {
      var jp = jets[i], d = jp.dir;
      var x = jp.x, y = jp.y + Math.sin(effT * 1.6 + jp.ph) * jp.bob * 0.15;
      var fl = 5 + Math.abs(Math.sin(effT * 22 + jp.ph)) * 4;
      ctx.fillStyle = GLOW_ORANGE;                 // exhaust bloom
      ctx.beginPath(); dotPath(x - d * 3, y + 8, 3.4); dotPath(x + d * 1, y + 8, 3); ctx.fill();
      ctx.fillStyle = ORANGE;                      // twin flames
      ctx.beginPath();
      ctx.moveTo(x - d * 3 - 2, y + 6); ctx.lineTo(x - d * 3, y + 8 + fl); ctx.lineTo(x - d * 3 + 2, y + 6); ctx.closePath();
      ctx.moveTo(x + d * 1 - 2, y + 6); ctx.lineTo(x + d * 1, y + 7 + fl * 0.8); ctx.lineTo(x + d * 1 + 2, y + 6); ctx.closePath();
      ctx.fill();
      ctx.fillStyle = BRASS;                       // backpack
      ctx.fillRect(x - 3.5, y + 1, 7, 6);
      ctx.fillStyle = '#C24E22';                   // body, leaning into travel
      ctx.beginPath();
      ctx.moveTo(x - d * 2, y - 6); ctx.lineTo(x + d * 5, y - 3); ctx.lineTo(x + d * 4, y + 2); ctx.lineTo(x - d * 2, y + 1); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = TEAL_TRIM; ctx.lineWidth = 1.6; ctx.lineCap = 'round';   // legs trailing
      ctx.beginPath();
      ctx.moveTo(x - d * 1, y + 1); ctx.lineTo(x - d * 9, y + 4);
      ctx.moveTo(x - d * 1, y + 1); ctx.lineTo(x - d * 9, y + 1);
      ctx.stroke(); ctx.lineCap = 'butt';
      ctx.fillStyle = SKIN;                        // head
      ctx.beginPath(); ctx.arc(x + d * 5.5, y - 5, 2.3, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = night ? GLOW_CYAN : 'rgba(63,224,216,0.7)'; ctx.lineWidth = 1.2;   // bubble helmet
      ctx.beginPath(); ctx.arc(x + d * 5.5, y - 5, 3.7, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = '#C24E22'; ctx.lineWidth = 1.6; ctx.lineCap = 'round';   // arm forward
      ctx.beginPath(); ctx.moveTo(x + d * 2, y - 4); ctx.lineTo(x + d * 7, y - 6); ctx.stroke(); ctx.lineCap = 'butt';
    }
  }

  // a glowing exhibit kiosk — a domed booth with a cyan neon sign
  function drawKiosk(litLevel) {
    if (!kiosk || !eraHas('kiosk')) return;
    var x = kiosk.x, night = litLevel > 0.55;
    var w = 34, bodyTop = GROUND_Y - 34;
    ctx.fillStyle = TEALS[1];                     // booth body
    ctx.fillRect(x - w / 2, bodyTop, w, 34);
    ctx.fillStyle = TEAL_TRIM;
    ctx.fillRect(x - w / 2 - 2, GROUND_Y - 4, w + 4, 4);
    if (night) { ctx.fillStyle = GLOW_CYAN; ctx.fillRect(x - w / 2 + 2, bodyTop + 8, w - 4, 14); }
    ctx.fillStyle = night ? '#8FF0EA' : '#2A6C68';   // lit window
    ctx.fillRect(x - w / 2 + 4, bodyTop + 10, w - 8, 10);
    ctx.fillStyle = TEAL_TRIM;
    ctx.fillRect(x - 1, bodyTop + 10, 2, 10);
    ctx.fillStyle = CREAM_HI;                     // rounded awning
    ctx.beginPath(); ctx.ellipse(x, bodyTop, w / 2 + 4, 8, 0, Math.PI, Math.PI * 2); ctx.fill();
    ctx.fillStyle = ORANGE;
    ctx.beginPath(); ctx.ellipse(x, bodyTop, w / 2 + 4, 8, 0, Math.PI * 1.5, Math.PI * 2); ctx.fill();
    ctx.fillStyle = TEAL_TRIM; ctx.fillRect(x - 1, bodyTop - 20, 2, 12);   // sign post
    ctx.fillStyle = '#0A2B29';
    ctx.fillRect(x - 22, bodyTop - 32, 44, 14);
    if (night) { ctx.shadowBlur = 7; ctx.shadowColor = NEON_CYAN; }
    ctx.strokeStyle = NEON_CYAN; ctx.lineWidth = 1.4; ctx.strokeRect(x - 21, bodyTop - 31, 42, 12);
    ctx.shadowBlur = 0;
    ctx.fillStyle = night ? '#9FF3EE' : NEON_CYAN;
    ctx.font = '700 8px Jost, Futura, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '1px';
    if (night) { ctx.shadowBlur = 6; ctx.shadowColor = NEON_CYAN; }
    ctx.fillText('EXHIBIT', x, bodyTop - 25);
    ctx.shadowBlur = 0;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.strokeStyle = BRASS; ctx.lineWidth = 1.3; ctx.lineCap = 'round';   // starburst finial
    if (night) { ctx.shadowBlur = 5; ctx.shadowColor = BRASS; }
    ctx.beginPath();
    for (var sp = 0; sp < 8; sp++) { var aa = sp * Math.PI / 4, rr = sp % 2 ? 3 : 6; ctx.moveTo(x + 18, bodyTop - 36); ctx.lineTo(x + 18 + Math.cos(aa) * rr, bodyTop - 36 + Math.sin(aa) * rr); }
    ctx.stroke(); ctx.shadowBlur = 0; ctx.lineCap = 'butt';
  }

  // the House of the Future: a Monsanto-style cluster of rounded pods
  // cantilevered off a central stalk, big ribbon windows aglow
  function drawFutureHouse(litLevel) {
    if (!futureHouse || !eraHas('futureHouse')) return;
    var x = futureHouse.x, night = litLevel > 0.55;
    var podY = GROUND_Y - 40;
    ctx.fillStyle = TEAL_TRIM;                     // stalk
    ctx.fillRect(x - 6, podY, 12, GROUND_Y - podY);
    ctx.fillStyle = '#183B37';
    ctx.fillRect(x - 13, GROUND_Y - 5, 26, 5);
    var pods = [ { dx: 0, w: 36, h: 24, up: 0 }, { dx: -27, w: 26, h: 18, up: 5 }, { dx: 27, w: 26, h: 18, up: 5 } ];
    for (var i = 0; i < pods.length; i++) {
      var p = pods[i], cx = x + p.dx, cy = podY - p.up, pw = p.w, ph = p.h;
      ctx.fillStyle = CREAM_HI;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(cx - pw / 2, cy - ph, pw, ph, ph / 2);
      else ctx.rect(cx - pw / 2, cy - ph, pw, ph);
      ctx.fill();
      if (night) { ctx.shadowBlur = 5; ctx.shadowColor = BRASS; }
      ctx.fillStyle = night ? BRASS : '#2A6C68';   // ribbon window
      ctx.fillRect(cx - pw / 2 + 4, cy - ph * 0.72, pw - 8, ph * 0.4);
      ctx.shadowBlur = 0;
      ctx.fillStyle = TEAL_TRIM;
      ctx.fillRect(cx - pw / 2, cy - ph * 0.28, pw, 2);
    }
    ctx.fillStyle = TEAL_TRIM; ctx.fillRect(x - 1, podY - 52, 2, 12);   // little sign post
    ctx.fillStyle = '#0A2B29'; ctx.fillRect(x - 24, podY - 62, 48, 11);
    if (night) { ctx.shadowBlur = 6; ctx.shadowColor = NEON_CYAN; }
    ctx.strokeStyle = NEON_CYAN; ctx.lineWidth = 1.2; ctx.strokeRect(x - 23, podY - 61, 46, 9);
    ctx.fillStyle = night ? '#9FF3EE' : NEON_CYAN;
    ctx.font = '700 6.5px Jost, Futura, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0.5px';
    ctx.fillText('HOME OF TOMORROW', x, podY - 56.5);
    ctx.shadowBlur = 0;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  }

  // a pneumatic-tube transit line: a translucent glass tube on pylons
  // with capsules whooshing through it above the street
  function drawTube(litLevel) {
    if (!tube || !eraHas('tube')) return;
    var y = RAIL_Y - 118, night = litLevel > 0.55;
    var x0 = tube.x0, x1 = tube.x1, px;
    ctx.strokeStyle = TEAL_TRIM; ctx.lineWidth = 3;   // support pylons
    ctx.beginPath();
    for (px = x0 + 50; px < x1; px += 210) { ctx.moveTo(px, y + 7); ctx.lineTo(px, RAIL_Y - 2); }
    ctx.stroke();
    ctx.fillStyle = 'rgba(63,224,216,0.13)';          // glass tube
    ctx.fillRect(x0, y - 7, x1 - x0, 14);
    ctx.strokeStyle = 'rgba(203,236,234,0.5)'; ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x0, y - 7); ctx.lineTo(x1, y - 7); ctx.moveTo(x0, y + 7); ctx.lineTo(x1, y + 7);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(203,236,234,0.25)'; ctx.lineWidth = 1;   // ring seams
    ctx.beginPath();
    for (px = x0 + 24; px < x1; px += 48) { ctx.moveTo(px, y - 7); ctx.lineTo(px, y + 7); }
    ctx.stroke();
    ctx.fillStyle = TEALS[1];                         // end stations
    ctx.fillRect(x0 - 11, y - 12, 12, 24); ctx.fillRect(x1 - 1, y - 12, 12, 24);
    if (reducedMotion.matches) return;
    var span2 = x1 - x0 - 24;
    var caps = [ { p: (effT * 0.16) % 1, dir: 1 }, { p: (effT * 0.13 + 0.5) % 1, dir: -1 } ];
    for (var ci = 0; ci < caps.length; ci++) {
      var c = caps[ci];
      var cxp = c.dir === 1 ? x0 + 12 + c.p * span2 : x1 - 12 - c.p * span2;
      ctx.fillStyle = 'rgba(255,201,74,0.22)';        // motion streak
      ctx.fillRect(cxp - c.dir * 16, y - 3.5, 16, 7);
      ctx.fillStyle = tubeCapCol();
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(cxp - 9, y - 4.5, 18, 9, 4.5); else ctx.rect(cxp - 9, y - 4.5, 18, 9);
      ctx.fill();
      ctx.fillStyle = night ? BRASS : CREAM_HI;
      ctx.fillRect(cxp - 4, y - 2.5, 8, 3);
      ctx.fillStyle = CREAM_HI;
      ctx.beginPath(); ctx.arc(cxp + c.dir * 8, y, 2.2, 0, Math.PI * 2); ctx.fill();
    }
  }

  // MECHANICAL MAN: a boxy retro robot clanking down Main Street
  function drawRobot(litLevel) {
    if (!robot.active || reducedMotion.matches || !eraHas('robot')) return;
    var d = robot.dir, x = robot.x, gy = GROUND_Y, night = litLevel > 0.55;
    var step = Math.sin(robot.ph * 6);
    ctx.fillStyle = TEAL_TRIM;                        // legs + feet
    ctx.fillRect(x - 4, gy - 9, 3.4, 9 - Math.max(0, step) * 2);
    ctx.fillRect(x + 1.6, gy - 9, 3.4, 9 - Math.max(0, -step) * 2);
    ctx.fillRect(x - 5.5, gy - 1.5, 5.5, 2); ctx.fillRect(x + 1, gy - 1.5, 5.5, 2);
    ctx.fillStyle = CREAM_HI;                         // torso
    ctx.fillRect(x - 6, gy - 24, 12, 15);
    ctx.fillStyle = TEALS[1]; ctx.fillRect(x - 6, gy - 20, 12, 3);
    ctx.fillStyle = night ? GLOW_CYAN : 'rgba(63,224,216,0.6)'; ctx.fillRect(x - 4, gy - 16, 8, 2);
    ctx.strokeStyle = BRASS; ctx.lineWidth = 2; ctx.lineCap = 'round';   // arms
    ctx.beginPath();
    ctx.moveTo(x - 6, gy - 22); ctx.lineTo(x - 8, gy - 14 + step * 1.5);
    ctx.moveTo(x + 6, gy - 22); ctx.lineTo(x + 8, gy - 14 - step * 1.5);
    ctx.stroke(); ctx.lineCap = 'butt';
    ctx.fillStyle = CREAM_HI; ctx.fillRect(x - 4.5, gy - 33, 9, 8);      // head
    ctx.fillStyle = TEAL_TRIM; ctx.fillRect(x - 4.5, gy - 30, 9, 1.5);
    if (night) { ctx.shadowBlur = 6; ctx.shadowColor = ORANGE; }
    ctx.fillStyle = ORANGE; ctx.beginPath(); ctx.arc(x + d * 1.5, gy - 29, 1.6, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = TEAL_TRIM; ctx.lineWidth = 1;   // antenna
    ctx.beginPath(); ctx.moveTo(x, gy - 33); ctx.lineTo(x, gy - 38); ctx.stroke();
    ctx.fillStyle = ORANGE; ctx.beginPath(); ctx.arc(x, gy - 39, 1.4, 0, Math.PI * 2); ctx.fill();
  }

  // a flying-saucer taxi descending to its rooftop pad
  function drawTaxi(litLevel) {
    if (taxi.phase === 0 || reducedMotion.matches || !eraHas('taxi')) return;
    var night = litLevel > 0.55, padY = GROUND_Y - 84;
    ctx.fillStyle = TEAL_TRIM; ctx.fillRect(taxi.padX - 3, padY, 6, GROUND_Y - padY);   // pad post
    ctx.fillStyle = BRASS; ctx.fillRect(taxi.padX - 18, padY - 3, 36, 4);               // deck
    var beac = Math.floor(effT * 3) % 2 === 0;
    ctx.fillStyle = beac ? ORANGE : 'rgba(255,107,61,0.4)';
    ctx.beginPath(); dotPath(taxi.padX - 16, padY - 4, 1.6); dotPath(taxi.padX + 16, padY - 4, 1.6); ctx.fill();
    var x = taxi.x, y = taxi.y;
    if (taxi.phase === 2 || taxi.phase === 3) {        // tractor/landing beam
      ctx.fillStyle = 'rgba(63,224,216,0.14)';
      ctx.beginPath();
      ctx.moveTo(x - 8, y + 4); ctx.lineTo(x + 8, y + 4);
      ctx.lineTo(taxi.padX + 14, padY - 3); ctx.lineTo(taxi.padX - 14, padY - 3);
      ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = TEALS[1]; ctx.beginPath(); ctx.ellipse(x, y + 2, 22, 6, 0, 0, Math.PI); ctx.fill();
    ctx.fillStyle = CREAM_HI; ctx.beginPath(); ctx.ellipse(x, y + 2, 22, 6, 0, Math.PI, Math.PI * 2); ctx.fill();
    ctx.fillStyle = ORANGE; ctx.fillRect(x - 22, y + 0.5, 44, 2);      // taxi band
    ctx.fillStyle = 'rgba(63,224,216,0.5)'; ctx.beginPath(); ctx.ellipse(x, y - 2, 9, 7, 0, Math.PI, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = CREAM_HI; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.ellipse(x, y - 2, 9, 7, 0, Math.PI, Math.PI * 2); ctx.stroke();
    if (night) { ctx.shadowBlur = 6; ctx.shadowColor = BRASS; }
    ctx.fillStyle = BRASS; ctx.fillRect(x - 5, y - 10, 10, 3);          // TAXI light
    ctx.shadowBlur = 0;
    ctx.fillStyle = night ? BRASS : 'rgba(255,201,74,0.6)';
    for (var k = 0; k < 5; k++) { ctx.beginPath(); dotPath(x - 16 + k * 8, y + 4, 1.3); ctx.fill(); }
  }

  // a kinetic atomic sculpture turning on the park lawn
  function drawKineticSculpture(litLevel) {
    if (!park || !eraHas('sculpture')) return;
    var x = park.x + 60, gy = GROUND_Y, night = litLevel > 0.55;
    ctx.strokeStyle = TEAL_TRIM; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(x, gy); ctx.lineTo(x, gy - 30); ctx.stroke();
    ctx.fillStyle = BRASS; ctx.beginPath(); ctx.arc(x, gy - 32, 3, 0, Math.PI * 2); ctx.fill();
    var spin = reducedMotion.matches ? 0.4 : effT * 0.5;
    var cy = gy - 40, colors = [ORANGE, NEON_CYAN, NEON_PINK];
    for (var a = 0; a < 3; a++) {
      var ang = spin + a * 2.094;
      var ax = x + Math.cos(ang) * (10 + a * 4);
      var ay = cy - a * 5 + Math.sin(ang) * (5 + a * 2);
      ctx.strokeStyle = BRASS; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(x, cy - a * 5); ctx.lineTo(ax, ay); ctx.stroke();
      if (night) { ctx.shadowBlur = 5; ctx.shadowColor = colors[a]; }
      ctx.fillStyle = colors[a];
      ctx.beginPath(); ctx.arc(ax, ay, 3, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  // an animated neon spectacular: chase-light border and a neon rocket
  // that climbs its own track and resets, over and over
  function drawSpectacular(b, top, h, litLevel) {
    var night = litLevel > 0.5;
    var pw = Math.min(b.w * 0.72, 58), ph = Math.min(60, h * 0.5 + 20);
    var cx = b.x + b.w / 2, py = top - ph - 8;
    ctx.fillStyle = 'rgba(158,168,172,0.9)';           // support legs
    ctx.fillRect(cx - pw * 0.3, top - 8, 2, 8); ctx.fillRect(cx + pw * 0.3 - 2, top - 8, 2, 8);
    ctx.fillStyle = 'rgba(9,20,22,0.94)';              // dark backing
    ctx.fillRect(cx - pw / 2, py, pw, ph);
    var per = [], step = 7, xx, yy;                    // chase-light border
    for (xx = cx - pw / 2; xx < cx + pw / 2; xx += step) per.push([xx, py]);
    for (yy = py; yy < py + ph; yy += step) per.push([cx + pw / 2, yy]);
    for (xx = cx + pw / 2; xx > cx - pw / 2; xx -= step) per.push([xx, py + ph]);
    for (yy = py + ph; yy > py; yy -= step) per.push([cx - pw / 2, yy]);
    for (var pi = 0; pi < per.length; pi++) {
      var on = ((pi + Math.floor(effT * 6)) % 3 === 0);
      if (on && night) { ctx.shadowBlur = 5; ctx.shadowColor = BRASS; }
      ctx.fillStyle = on ? BRASS : 'rgba(255,201,74,0.28)';
      ctx.beginPath(); ctx.arc(per[pi][0], per[pi][1], 1.6, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    }
    var trackTop = py + 10, trackBot = py + ph - 10;
    var prog = (effT * 0.5) % 1;
    var rY = trackBot - prog * (trackBot - trackTop);
    ctx.fillStyle = 'rgba(63,224,216,0.35)';           // the track
    for (var ty = trackTop; ty <= trackBot; ty += 6) { ctx.beginPath(); ctx.arc(cx, ty, 1, 0, Math.PI * 2); ctx.fill(); }
    if (night) { ctx.shadowBlur = 7; ctx.shadowColor = NEON_PINK; }
    ctx.fillStyle = NEON_PINK;                          // the neon rocket
    ctx.beginPath();
    ctx.moveTo(cx, rY - 6);
    ctx.quadraticCurveTo(cx + 3, rY - 1, cx + 2.4, rY + 4);
    ctx.lineTo(cx - 2.4, rY + 4);
    ctx.quadraticCurveTo(cx - 3, rY - 1, cx, rY - 6);
    ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0;
    var flame = 3 + Math.abs(Math.sin(effT * 20)) * 4;  // flame
    ctx.fillStyle = ORANGE;
    ctx.beginPath(); ctx.moveTo(cx - 2, rY + 4); ctx.lineTo(cx, rY + 4 + flame); ctx.lineTo(cx + 2, rY + 4); ctx.closePath(); ctx.fill();
    if (prog > 0.9) {                                   // launch burst at the top
      ctx.strokeStyle = BRASS; ctx.lineWidth = 1.2; ctx.lineCap = 'round';
      if (night) { ctx.shadowBlur = 6; ctx.shadowColor = BRASS; }
      ctx.beginPath();
      for (var s = 0; s < 8; s++) { var aa = s * Math.PI / 4; ctx.moveTo(cx, trackTop); ctx.lineTo(cx + Math.cos(aa) * 6, trackTop + Math.sin(aa) * 6); }
      ctx.stroke(); ctx.shadowBlur = 0; ctx.lineCap = 'butt';
    }
  }

  /* ---------------- per-era signature motifs ---------------------------- */

  var styleCache = {};
  function styleVignette(rgba1) {
    var key = 'vig' + rgba1;
    if (!styleCache[key]) {
      var g = ctx.createRadialGradient(VIEW_W / 2, VIEW_H * 0.52, VIEW_H * 0.34, VIEW_W / 2, VIEW_H * 0.52, VIEW_W * 0.62);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, rgba1);
      styleCache[key] = g;
    }
    ctx.fillStyle = styleCache[key]; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }
  function scanLines(alpha, tint) {
    var key = 'scan' + tint;
    if (!styleCache[key]) {
      var pc = document.createElement('canvas'); pc.width = 3; pc.height = 3;
      var p = pc.getContext('2d'); p.fillStyle = tint; p.fillRect(0, 2, 3, 1);
      styleCache[key] = ctx.createPattern(pc, 'repeat');
    }
    ctx.globalAlpha = alpha; ctx.fillStyle = styleCache[key]; ctx.fillRect(0, 0, VIEW_W, VIEW_H); ctx.globalAlpha = 1;
  }
  function gridPat(alpha, tint, cell) {
    var key = 'grid' + tint + cell;
    if (!styleCache[key]) {
      var pc = document.createElement('canvas'); pc.width = cell; pc.height = cell;
      var p = pc.getContext('2d'); p.strokeStyle = tint; p.lineWidth = 1;
      p.beginPath(); p.moveTo(0, 0); p.lineTo(cell, 0); p.moveTo(0, 0); p.lineTo(0, cell); p.stroke();
      styleCache[key] = ctx.createPattern(pc, 'repeat');
    }
    ctx.globalAlpha = alpha; ctx.fillStyle = styleCache[key]; ctx.fillRect(0, 0, VIEW_W, VIEW_H); ctx.globalAlpha = 1;
  }

  function drawGear(cx, cy, r, teeth, rot, color) {
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot);
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, 0, r * 0.6, 0, Math.PI * 2); ctx.stroke();
    var i;
    for (i = 0; i < teeth; i++) { ctx.save(); ctx.rotate(i / teeth * Math.PI * 2); ctx.fillRect(r * 0.6 - 1, -3, r * 0.42, 6); ctx.restore(); }
    ctx.beginPath(); ctx.arc(0, 0, r * 0.16, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 2;
    for (i = 0; i < 6; i++) { var a = i / 6 * Math.PI * 2; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55); ctx.stroke(); }
    ctx.restore();
  }

  // sky-layer motifs (behind the skyline)
  function drawStyleSky(skyLum, starLevel) {
    var s = STYLE, t = reducedMotion.matches ? 0 : effT, i, a;
    if (s === 'steampunk') {
      drawGear(150, 118 * SKY_K, 66, 12, t * 0.2, 'rgba(224,169,78,0.6)');
      drawGear(VIEW_W - 150, 150 * SKY_K, 82, 16, -t * 0.15, 'rgba(198,96,42,0.5)');
      drawGear(VIEW_W - 210, 96 * SKY_K, 40, 10, t * 0.28, 'rgba(224,169,78,0.46)');
    } else if (s === 'clockpunk') {
      a = VIEW_W * 0.5;
      drawGear(a, 150 * SKY_K, 74, 14, t * 0.12, 'rgba(216,180,92,0.58)');
      drawGear(a - 78, 110 * SKY_K, 40, 10, -t * 0.3, 'rgba(216,180,92,0.46)');
      drawGear(a + 74, 122 * SKY_K, 48, 12, t * 0.22, 'rgba(216,180,92,0.5)');
      ctx.strokeStyle = 'rgba(240,230,204,0.5)'; ctx.lineWidth = 2;   // clock hands on the big gear
      ctx.beginPath(); ctx.moveTo(a, 150 * SKY_K); ctx.lineTo(a + Math.cos(t * 0.5) * 30, 150 * SKY_K + Math.sin(t * 0.5) * 30);
      ctx.moveTo(a, 150 * SKY_K); ctx.lineTo(a + Math.cos(t * 0.1) * 44, 150 * SKY_K + Math.sin(t * 0.1) * 44); ctx.stroke();
    } else if (s === 'artdeco' || s === 'decopunk') {
      var cx = VIEW_W * 0.5, cy = GROUND_Y - 6;
      ctx.save(); ctx.globalAlpha = s === 'decopunk' ? 0.22 : 0.16;
      ctx.strokeStyle = BRASS; ctx.lineWidth = 2.4;
      ctx.beginPath();
      for (i = 0; i <= 22; i++) { a = -Math.PI + i * (Math.PI / 22); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * 950, cy + Math.sin(a) * 950); }
      ctx.stroke();
      ctx.globalAlpha = s === 'decopunk' ? 0.3 : 0.2; ctx.lineWidth = 2;   // concentric deco arcs
      for (i = 1; i <= 3; i++) { ctx.beginPath(); ctx.arc(cx, cy, 120 + i * 90, Math.PI, Math.PI * 2); ctx.stroke(); }
      ctx.restore();
    } else if (s === 'cyberpunk' || s === 'nanopunk') {
      var hy = GROUND_Y - 3, vp = VIEW_W * 0.5;
      ctx.save();
      ctx.strokeStyle = s === 'cyberpunk' ? glowRGBA(NEON_CYAN, 0.42) : glowRGBA(NEON_CYAN, 0.28);
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (i = -12; i <= 12; i++) { ctx.moveTo(vp, hy); ctx.lineTo(vp + i * 130, hy + 210); }
      for (i = 1; i <= 7; i++) { var yy = hy + Math.pow(i / 7, 2) * 210; ctx.moveTo(vp - i * 320, yy); ctx.lineTo(vp + i * 320, yy); }
      ctx.stroke(); ctx.restore();
    } else if (s === 'solarpunk') {
      ctx.save(); ctx.globalAlpha = 0.09; ctx.fillStyle = BRASS;
      var sx = VIEW_W * 0.68, sy = 120 * SKY_K;
      for (i = 0; i < 11; i++) { a = t * 0.015 + i * 0.57; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + Math.cos(a) * 820, sy + Math.sin(a) * 820); ctx.lineTo(sx + Math.cos(a + 0.09) * 820, sy + Math.sin(a + 0.09) * 820); ctx.closePath(); ctx.fill(); }
      ctx.restore();
    } else if (s === 'present') {
      // a contrail crosses the high sky, its jet a bright pinhead
      var span = VIEW_W + 500;
      var hx4 = ((t * 26) % span) - 250;
      var hy4 = 70 * SKY_K + Math.sin(hx4 * 0.002) * 10;
      var tg = ctx.createLinearGradient(hx4 - 380, hy4 + 14, hx4, hy4);
      tg.addColorStop(0, 'rgba(255,255,255,0)');
      tg.addColorStop(1, 'rgba(255,255,255,0.35)');
      ctx.strokeStyle = tg; ctx.lineWidth = 2.6;
      ctx.beginPath(); ctx.moveTo(hx4 - 380, hy4 + 14); ctx.lineTo(hx4, hy4); ctx.stroke();
      ctx.fillStyle = CREAM_HI;
      ctx.fillRect(hx4, hy4 - 1, 4, 2);
    } else if (s === 'cassette') {
      // the smog bank: a warm haze lying on the rooftops, and the
      // evening airliner blinking through it
      ctx.fillStyle = 'rgba(200, 150, 90, ' + (0.1 + skyLum * 0.1).toFixed(3) + ')';
      ctx.fillRect(0, GROUND_Y - 190, VIEW_W, 120);
      ctx.fillStyle = 'rgba(200, 150, 90, 0.08)';
      ctx.fillRect(0, GROUND_Y - 230, VIEW_W, 60);
      var ax = ((t * 34) % (VIEW_W + 400)) - 200;
      var ay = 58 * SKY_K + Math.sin(ax * 0.003) * 6;
      ctx.fillStyle = 'rgba(239, 230, 212, 0.8)';
      ctx.fillRect(ax - 5, ay - 1, 10, 2);
      ctx.fillRect(ax - 1.4, ay - 3, 2.8, 6);
      if (Math.sin(t * 5) > 0.4) {
        ctx.fillStyle = glowRGBA('#FF4A4A', 0.9);
        ctx.fillRect(ax - 6.5, ay - 1, 1.6, 1.6);
      }
    } else if (s === 'orbital') {
      // the space elevator: a hair-thin ribbon from the horizon to the
      // top of the sky, with a climber on its long patient way up
      var ex = VIEW_W * 0.84;
      ctx.strokeStyle = 'rgba(240, 242, 238, ' + (0.28 + 0.25 * (1 - skyLum)).toFixed(3) + ')';
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(ex, GROUND_Y); ctx.lineTo(ex + 14, -20); ctx.stroke();
      var cp = reducedMotion.matches ? 0.4 : (t * 0.012) % 1;
      var cy2 = GROUND_Y - cp * (GROUND_Y + 30);
      ctx.fillStyle = CREAM_HI;
      ctx.fillRect(ex + (GROUND_Y - cy2) / (GROUND_Y + 20) * 14 - 2.4, cy2 - 4, 4.8, 8);
      ctx.fillStyle = glowRGBA(ORANGE, 0.9);
      ctx.fillRect(ex + (GROUND_Y - cy2) / (GROUND_Y + 20) * 14 - 2.4, cy2 + 4, 4.8, 1.6);
      ctx.fillStyle = mixHex(TEALS[0], '#F0F2EE', 0.2);   // the anchor works
      ctx.fillRect(ex - 10, GROUND_Y - 16, 22, 16);
      ctx.fillStyle = glowRGBA(ORANGE, 0.7);
      ctx.fillRect(ex - 10, GROUND_Y - 17.6, 22, 1.8);
    }

    // night signatures: each age owns its own sky after dark
    var sl = starLevel || 0;
    if (sl > 0.25) {
      if (s === 'present' || s === 'orbital') {
        // a satellite train, evenly spaced pinpoints on one track
        var st = ((t * 18) % (VIEW_W + 700)) - 350;
        ctx.fillStyle = 'rgba(255,255,255,' + (0.75 * sl).toFixed(3) + ')';
        for (i = 0; i < (s === 'orbital' ? 9 : 6); i++) {
          var sx2 = st - i * 24;
          ctx.fillRect(sx2, (92 + sx2 * 0.012) * SKY_K, 2, 2);
        }
        if (s === 'orbital') {                     // and the station itself
          var stx = ((t * 9) % (VIEW_W + 300)) - 150;
          ctx.fillStyle = 'rgba(255,255,255,' + (0.9 * sl).toFixed(3) + ')';
          ctx.fillRect(stx - 3, 46 * SKY_K, 6, 2.4);
          ctx.fillRect(stx - 1, 44 * SKY_K, 2, 7);
        }
      } else if (s === 'clockpunk') {
        // the astronomers have drawn their figures on the night
        ctx.strokeStyle = 'rgba(240,230,204,' + (0.28 * sl).toFixed(3) + ')';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (i = 0; i + 1 < stars.length && i < 12; i++) {
          if (i % 4 === 3) continue;               // break into figures
          ctx.moveTo(stars[i].x, stars[i].y * SKY_K);
          ctx.lineTo(stars[i + 1].x, stars[i + 1].y * SKY_K);
        }
        ctx.stroke();
      } else if (s === 'solarpunk') {
        // air this clean shows the milky way
        ctx.save();
        ctx.translate(VIEW_W * 0.5, 130 * SKY_K);
        ctx.rotate(-0.32);
        var mg = ctx.createLinearGradient(0, -70, 0, 70);
        mg.addColorStop(0, 'rgba(247,243,224,0)');
        mg.addColorStop(0.5, 'rgba(247,243,224,' + (0.1 * sl).toFixed(3) + ')');
        mg.addColorStop(1, 'rgba(247,243,224,0)');
        ctx.fillStyle = mg;
        ctx.fillRect(-VIEW_W, -70, VIEW_W * 2, 140);
        ctx.fillStyle = 'rgba(247,243,224,' + (0.5 * sl).toFixed(3) + ')';
        for (i = 0; i < 40; i++) {
          ctx.fillRect(((i * 97.3) % (VIEW_W * 1.6)) - VIEW_W * 0.8, ((i * 37.7) % 90) - 45, 1.2, 1.2);
        }
        ctx.restore();
      } else if (s === 'silkpunk') {
        // paper lanterns rise from the festival quarter
        for (i = 0; i < 8; i++) {
          var lp = (t * (7 + (i % 3) * 3) + i * 143) % (GROUND_Y + 60);
          var lx = ((i * 211.7) % VIEW_W) + Math.sin(t * 0.5 + i) * 18;
          var ly2 = GROUND_Y - 40 - lp;
          if (ly2 < 20) continue;
          ctx.shadowBlur = 8; ctx.shadowColor = ORANGE;
          ctx.fillStyle = glowRGBA(ORANGE, 0.75 * sl);
          ctx.beginPath(); ctx.ellipse(lx, ly2, 2.6, 3.4, 0, 0, Math.PI * 2); ctx.fill();
          ctx.shadowBlur = 0;
        }
      }
    }
  }

  // drifting particle field used by several eras
  function drawMotes(n, spd, up, color, size, glow) {
    var t = reducedMotion.matches ? 0 : effT;
    if (glow) { ctx.shadowBlur = 6; ctx.shadowColor = color; }
    ctx.fillStyle = color;
    for (var i = 0; i < n; i++) {
      var sway = Math.sin(t * 0.6 + i * 1.3) * 30;
      var x = (((i * 137.5) % VIEW_W) + sway + VIEW_W) % VIEW_W;
      var range = GROUND_Y - 10;
      var yy = up ? range - ((i * 61 + t * spd) % range) : (i * 47 + t * spd) % range;
      var r = size * (0.6 + (i % 3) * 0.3);
      ctx.beginPath(); ctx.arc(x, yy, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.shadowBlur = 0;
  }

  function drawPetals(n, color) {
    var t = reducedMotion.matches ? 0 : effT;
    ctx.fillStyle = color;
    for (var i = 0; i < n; i++) {
      var x = (((i * 113.3) % VIEW_W) + Math.sin(t * 0.8 + i) * 46 + VIEW_W) % VIEW_W;
      var yy = (i * 53 + t * (26 + (i % 4) * 8)) % (GROUND_Y + 20);
      ctx.save(); ctx.translate(x, yy); ctx.rotate(t * 1.4 + i);
      ctx.beginPath(); ctx.ellipse(0, 0, 3.4, 1.7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  // full-frame overlays (on top of the scene)
  function drawStyleOverlay(litLevel) {
    var s = STYLE, i;
    if (s === 'atompunk') return;
    if (s === 'cyberpunk') {
      scanLines(0.5, 'rgba(8,4,20,0.55)');
      if (!reducedMotion.matches) {
        var gy = ((effT * 90) % (VIEW_H + 160)) - 80;
        ctx.fillStyle = glowRGBA(NEON_PINK, 0.05); ctx.fillRect(0, gy, VIEW_W, 28);
        ctx.fillStyle = glowRGBA(NEON_CYAN, 0.04); ctx.fillRect(0, gy - 46, VIEW_W, 12);
      }
      styleVignette('rgba(18,4,40,0.5)');
    } else if (s === 'nanopunk') {
      gridPat(0.16, glowRGBA(NEON_CYAN, 0.5), 26);
      drawMotes(18, 30, false, glowRGBA(NEON_CYAN, 0.8), 1.4, true);
      styleVignette('rgba(12,18,26,0.45)');
    } else if (s === 'biopunk') {
      drawMotes(22, 20, true, glowRGBA(NEON_CYAN, 0.8), 1.8, true);
      drawMotes(10, 12, true, glowRGBA(BRASS, 0.7), 1.4, true);
      styleVignette('rgba(8,20,12,0.5)');
    } else if (s === 'solarpunk') {
      drawPetals(16, glowRGBA(BRASS, 0.5));
      drawPetals(10, 'rgba(232,138,176,0.5)');
    } else if (s === 'silkpunk') {
      drawPetals(20, 'rgba(232,106,138,0.6)');
      styleVignette('rgba(30,24,14,0.32)');
    } else if (s === 'steampunk') {
      drawMotes(14, 9, true, 'rgba(60,44,28,0.35)', 3, false);   // soot
      styleVignette('rgba(28,16,6,0.5)');
    } else if (s === 'dieselpunk') {
      drawMotes(12, 7, true, 'rgba(40,38,30,0.4)', 3.5, false);
      styleVignette('rgba(8,8,5,0.62)');
    } else if (s === 'clockpunk') {
      styleVignette('rgba(20,20,32,0.4)');
    } else if (s === 'artdeco' || s === 'decopunk') {
      var m = 12;
      ctx.strokeStyle = glowRGBA(BRASS, s === 'decopunk' ? 0.6 : 0.45); ctx.lineWidth = 3;
      ctx.strokeRect(m, m, VIEW_W - m * 2, VIEW_H - m * 2);
      ctx.lineWidth = 1.2; ctx.strokeRect(m + 6, m + 6, VIEW_W - (m + 6) * 2, VIEH(VIEW_H, m));
      var corners = [[m, m, 1, 1], [VIEW_W - m, m, -1, 1], [m, VIEW_H - m, 1, -1], [VIEW_W - m, VIEW_H - m, -1, -1]];
      ctx.lineWidth = 2;
      for (i = 0; i < corners.length; i++) {
        var c = corners[i];
        for (var k = 1; k <= 4; k++) { ctx.beginPath(); ctx.moveTo(c[0], c[1]); ctx.lineTo(c[0] + c[2] * k * 11, c[1] + c[3] * (5 - k) * 11); ctx.stroke(); }
      }
    }
  }
  function VIEH(H, m) { return H - (m + 6) * 2; }

  /* ---------------- era-specific building architecture ------------------ */

  function hashB(b) { return Math.abs(Math.floor(b.x * 13.7 + b.w * 3.1)); }
  function mixHex(a, c, t) { return rgbStr(mixRgb(hexToRgb(a), hexToRgb(c), t == null ? 0.5 : t)); }
  function litTest(wd, litLevel) {
    if (outage.phase === 1) return false;         // the whole grid is down
    if (outage.phase === 2 && wd.x > outage.frontX) return false;
    return (wd.threshold < litLevel) !== (wd.flickUntil > effT);
  }

  // CYBERPUNK — dark megastructures, neon strips, holo billboards, antennae
  function drawBuildingCyber(b, top, h, litLevel) {
    var cx = b.x + b.w / 2, night = litLevel > 0.45, sub = hashB(b) % 4, i, wd, wy;
    ctx.fillStyle = b.color; ctx.fillRect(b.x, top, b.w, h);
    ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.fillRect(b.x + b.w - 4, top, 4, h);
    ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fillRect(b.x, top, 3, h);
    if (!b.windows.length) { if (night) { ctx.fillStyle = glowRGBA(NEON_CYAN, 0.5); ctx.fillRect(b.x, top, b.w, 2); } return; }
    var strips = Math.max(2, Math.round(b.w / 16));
    for (var s = 1; s < strips; s++) {
      var sx = b.x + b.w * s / strips;
      ctx.fillStyle = (s % 2) ? glowRGBA(NEON_CYAN, night ? 0.5 : 0.16) : glowRGBA(NEON_PINK, night ? 0.4 : 0.12);
      ctx.fillRect(sx - 0.8, top + 4, 1.6, h - 8);
    }
    for (i = 0; i < b.windows.length; i++) {
      wd = b.windows[i]; wy = GROUND_Y + wd.y; if (wy < top + 5) continue;
      if (litTest(wd, litLevel)) {
        if (night) { ctx.shadowBlur = 4; ctx.shadowColor = wd.accent ? NEON_PINK : NEON_CYAN; }
        ctx.fillStyle = wd.accent ? NEON_PINK : NEON_CYAN; ctx.fillRect(wd.x - 2, wy - 2.5, 4, 5); ctx.shadowBlur = 0;
      } else { ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(wd.x - 2, wy - 2.5, 4, 5); }
    }
    if (sub === 0) {
      var bw = Math.min(b.w * 0.72, 46), bh = Math.min(h * 0.32, 42), bx = cx - bw / 2, by = top - bh - 6;
      ctx.fillStyle = glowRGBA(NEON_CYAN, 0.12); ctx.fillRect(bx, by, bw, bh);
      if (night) { ctx.shadowBlur = 8; ctx.shadowColor = NEON_PINK; }
      ctx.strokeStyle = glowRGBA(NEON_PINK, night ? 0.85 : 0.4); ctx.lineWidth = 1.4; ctx.strokeRect(bx, by, bw, bh); ctx.shadowBlur = 0;
      if (!reducedMotion.matches) { var ly = by + ((effT * 20) % bh); ctx.fillStyle = glowRGBA(NEON_CYAN, 0.5); ctx.fillRect(bx, ly, bw, 1.5); }
      ctx.fillStyle = TEAL_TRIM; ctx.fillRect(cx - 1, top - 6, 2, 6);
    } else if (sub === 1) {
      var mtY = top - Math.min(h * 0.4, 54);
      ctx.strokeStyle = CREAM_HI; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(cx, top); ctx.lineTo(cx, mtY); ctx.stroke();
      ctx.strokeStyle = glowRGBA(NEON_CYAN, 0.7); ctx.lineWidth = 1.2;
      for (i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(cx, mtY, 6 + i * 5, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke(); }
      if (night) { ctx.shadowBlur = 6; ctx.shadowColor = ORANGE; }
      ctx.fillStyle = ORANGE; ctx.beginPath(); ctx.arc(cx, mtY, 2.4, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
    } else if (sub === 2) {
      var tw = b.w * 0.6; ctx.fillStyle = b.color; ctx.fillRect(cx - tw / 2, top - 14, tw, 14);
      ctx.fillStyle = glowRGBA(NEON_PINK, night ? 0.7 : 0.3); ctx.fillRect(cx - tw / 2, top - 14, tw, 2);
    } else {
      ctx.fillStyle = b.color; ctx.beginPath(); ctx.moveTo(b.x + 2, top); ctx.lineTo(cx, top - Math.min(h * 0.25, 30)); ctx.lineTo(b.x + b.w - 2, top); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = glowRGBA(NEON_CYAN, 0.6); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(b.x + 2, top); ctx.lineTo(cx, top - Math.min(h * 0.25, 30)); ctx.lineTo(b.x + b.w - 2, top); ctx.stroke();
    }
  }

  // STEAMPUNK — brick + brass pipes, arched windows, stacks, domes, clocks
  function drawBuildingSteam(b, top, h, litLevel) {
    var cx = b.x + b.w / 2, night = litLevel > 0.5, sub = hashB(b) % 4, i, wd, wy;
    ctx.fillStyle = b.color; ctx.fillRect(b.x, top, b.w, h);
    ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.lineWidth = 1; ctx.beginPath();
    for (var yy = top + 8; yy < GROUND_Y; yy += 8) { ctx.moveTo(b.x, yy); ctx.lineTo(b.x + b.w, yy); } ctx.stroke();
    ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.fillRect(b.x + b.w - 3, top, 3, h);
    if (!b.windows.length) { ctx.fillStyle = BRASS; ctx.fillRect(b.x, top, b.w, 2); return; }
    ctx.strokeStyle = BRASS; ctx.lineWidth = 2; ctx.globalAlpha = 0.8;
    ctx.beginPath(); ctx.moveTo(b.x + 5, GROUND_Y); ctx.lineTo(b.x + 5, top + 10); ctx.moveTo(b.x + b.w - 5, GROUND_Y); ctx.lineTo(b.x + b.w - 5, top + 14); ctx.stroke(); ctx.globalAlpha = 1;
    for (i = 0; i < b.windows.length; i++) {
      wd = b.windows[i]; wy = GROUND_Y + wd.y; if (wy < top + 8) continue;
      var lit = litTest(wd, litLevel);
      if (lit && night) { ctx.shadowBlur = 4; ctx.shadowColor = BRASS; }
      ctx.fillStyle = lit ? (night ? '#FFCF7A' : '#C98A4E') : 'rgba(0,0,0,0.3)';
      ctx.beginPath(); ctx.moveTo(wd.x - 2.4, wy + 3); ctx.lineTo(wd.x - 2.4, wy - 1); ctx.arc(wd.x, wy - 1, 2.4, Math.PI, 0); ctx.lineTo(wd.x + 2.4, wy + 3); ctx.closePath(); ctx.fill(); ctx.shadowBlur = 0;
    }
    if (sub === 0) {
      var stx = cx + b.w * 0.22; ctx.fillStyle = '#3E2817'; ctx.fillRect(stx - 4, top - 22, 8, 22); ctx.fillStyle = BRASS; ctx.fillRect(stx - 5, top - 22, 10, 3);
      if (!reducedMotion.matches) { ctx.fillStyle = 'rgba(232,222,200,0.3)'; for (var k = 0; k < 3; k++) { var sy = top - 24 - ((effT * 18 + k * 14) % 42); ctx.beginPath(); ctx.arc(stx + Math.sin(effT + k) * 3, sy, 4 + k, 0, Math.PI * 2); ctx.fill(); } }
      ctx.fillStyle = TEAL_TRIM; ctx.fillRect(b.x, top - 6, b.w, 6);
    } else if (sub === 1) {
      var dh = Math.min(h * 0.3, 26), dr = Math.min(b.w * 0.4, 22);
      ctx.fillStyle = mixHex(b.color, '#C6602A', 0.5); ctx.beginPath(); ctx.ellipse(cx, top, dr, dh, 0, Math.PI, 0); ctx.fill();
      ctx.fillStyle = BRASS; ctx.fillRect(cx - 1.5, top - dh - 8, 3, 8); ctx.beginPath(); ctx.arc(cx, top - dh - 9, 2.4, 0, Math.PI * 2); ctx.fill();
    } else if (sub === 2) {
      ctx.fillStyle = '#3E2817'; ctx.fillRect(b.x - 2, top - 16, b.w + 4, 16);
      ctx.fillStyle = CREAM_HI; ctx.beginPath(); ctx.arc(cx, top - 8, 7, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = TEAL_TRIM; ctx.lineWidth = 1.4; ctx.stroke();
      ctx.strokeStyle = TEAL_TRIM; ctx.beginPath(); ctx.moveTo(cx, top - 8); ctx.lineTo(cx + 3, top - 8); ctx.moveTo(cx, top - 8); ctx.lineTo(cx, top - 12); ctx.stroke();
    } else {
      ctx.fillStyle = mixHex(b.color, '#241408', 0.5); ctx.fillRect(cx - 9, top - 16, 18, 12); ctx.fillStyle = BRASS; ctx.fillRect(cx - 9, top - 16, 18, 2);
      ctx.fillStyle = TEAL_TRIM; ctx.fillRect(cx - 8, top - 4, 2, 4); ctx.fillRect(cx + 6, top - 4, 2, 4);
    }
    ctx.fillStyle = BRASS; ctx.globalAlpha = 0.6; for (var rx = b.x + 6; rx < b.x + b.w - 4; rx += 12) { ctx.beginPath(); ctx.arc(rx, GROUND_Y - 5, 1, 0, Math.PI * 2); ctx.fill(); } ctx.globalAlpha = 1;
  }

  // SOLARPUNK — rounded organic towers, planted terraces, turbines, domes
  function drawBuildingSolar(b, top, h, litLevel) {
    var cx = b.x + b.w / 2, night = litLevel > 0.5, hb = hashB(b), sub = hb % 4, i, wd, wy;
    var r = Math.min(b.w * 0.5, 18);
    ctx.fillStyle = b.color; ctx.beginPath();
    ctx.moveTo(b.x, GROUND_Y); ctx.lineTo(b.x, top + r);
    ctx.quadraticCurveTo(b.x, top, b.x + r, top); ctx.lineTo(b.x + b.w - r, top);
    ctx.quadraticCurveTo(b.x + b.w, top, b.x + b.w, top + r); ctx.lineTo(b.x + b.w, GROUND_Y); ctx.closePath(); ctx.fill();
    if (!b.windows.length) { ctx.fillStyle = mixHex(b.color, '#F7F3E0', 0.3); ctx.fillRect(b.x, top + r, b.w, 2); return; }
    var terraces = 2 + (hb % 3);
    for (var tI = 0; tI < terraces; tI++) {
      var ty = top + r + (h - r) * (tI + 1) / (terraces + 1);
      ctx.fillStyle = '#2E7D4F'; ctx.fillRect(b.x, ty, b.w, 3);
      ctx.fillStyle = '#3E9A63'; for (var gx = b.x + 3; gx < b.x + b.w - 2; gx += 7) { ctx.beginPath(); ctx.arc(gx, ty, 2.5, Math.PI, 0); ctx.fill(); }
    }
    for (i = 0; i < b.windows.length; i++) {
      wd = b.windows[i]; wy = GROUND_Y + wd.y; if (wy < top + r) continue;
      ctx.fillStyle = litTest(wd, litLevel) ? (night ? '#FFE196' : glowRGBA(CREAM_HI, 0.55)) : 'rgba(90,200,224,0.3)';
      ctx.fillRect(wd.x - 3, wy - 3, 6, 6);
    }
    if (sub === 0) {
      var wy2 = top - Math.min(h * 0.3, 34); ctx.strokeStyle = CREAM_HI; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx, top); ctx.lineTo(cx, wy2); ctx.stroke();
      var rot = reducedMotion.matches ? 0.5 : effT * 1.5; ctx.strokeStyle = CREAM_HI; ctx.lineWidth = 2.4;
      for (var bl = 0; bl < 3; bl++) { var a = rot + bl * 2.094; ctx.beginPath(); ctx.moveTo(cx, wy2); ctx.lineTo(cx + Math.cos(a) * 12, wy2 + Math.sin(a) * 12); ctx.stroke(); }
      ctx.fillStyle = BRASS; ctx.beginPath(); ctx.arc(cx, wy2, 2, 0, Math.PI * 2); ctx.fill();
    } else if (sub === 1) {
      ctx.fillStyle = mixHex(NEON_CYAN, '#123E28', 0.45); ctx.save(); ctx.translate(cx, top - 4); ctx.transform(1, -0.24, 0, 1, 0, 0); ctx.fillRect(-b.w * 0.3, -8, b.w * 0.6, 8); ctx.restore();
      ctx.strokeStyle = glowRGBA(NEON_CYAN, 0.5); ctx.lineWidth = 1; ctx.strokeRect(cx - b.w * 0.3, top - 13, b.w * 0.6, 8);
    } else if (sub === 2) {
      var gd = Math.min(h * 0.3, 22), gw = Math.min(b.w * 0.42, 20);
      ctx.fillStyle = glowRGBA(CREAM_HI, 0.25); ctx.beginPath(); ctx.ellipse(cx, top, gw, gd, 0, Math.PI, 0); ctx.fill();
      ctx.strokeStyle = CREAM_HI; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(cx, top, gw, gd, 0, Math.PI, 0); ctx.stroke();
      ctx.fillStyle = '#3E9A63'; ctx.beginPath(); ctx.arc(cx, top - 4, 4, Math.PI, 0); ctx.fill();
    } else {
      ctx.fillStyle = '#2E7D4F'; ctx.beginPath(); ctx.arc(cx - b.w * 0.2, top, 6, Math.PI, 0); ctx.arc(cx, top, 7, Math.PI, 0); ctx.arc(cx + b.w * 0.2, top, 6, Math.PI, 0); ctx.fill();
      ctx.strokeStyle = 'rgba(46,125,79,0.6)'; ctx.lineWidth = 1.5;
      for (var v = 0; v < 3; v++) { var vx = b.x + b.w * (0.25 + v * 0.25); ctx.beginPath(); ctx.moveTo(vx, top); ctx.quadraticCurveTo(vx + 4, top + 18, vx, top + 34); ctx.stroke(); }
    }
  }

  // SILKPUNK — stacked pagoda tiers, curved vermilion eaves, lanterns
  function drawBuildingSilk(b, top, h, litLevel) {
    var cx = b.x + b.w / 2, night = litLevel > 0.5, sub = hashB(b) % 4, i, wd, wy;
    ctx.fillStyle = b.color; ctx.fillRect(b.x, top, b.w, h);
    ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(b.x + b.w - 3, top, 3, h);
    if (!b.windows.length) { ctx.fillStyle = ORANGE; ctx.fillRect(b.x, top, b.w, 2); return; }
    var tiers = Math.max(2, Math.min(5, Math.round(h / 40)));
    for (var tI = 0; tI < tiers; tI++) {
      var ey = top + h * tI / tiers, ew = b.w * 0.6 + b.w * 0.4 * (tI / tiers);
      ctx.fillStyle = ORANGE;
      ctx.beginPath();
      ctx.moveTo(cx - ew / 2 - 6, ey + 4);
      ctx.quadraticCurveTo(cx - ew / 4, ey - 3, cx, ey - 3);
      ctx.quadraticCurveTo(cx + ew / 4, ey - 3, cx + ew / 2 + 6, ey + 4);
      ctx.quadraticCurveTo(cx + ew / 4, ey + 1, cx, ey + 1);
      ctx.quadraticCurveTo(cx - ew / 4, ey + 1, cx - ew / 2 - 6, ey + 4); ctx.closePath(); ctx.fill();
      ctx.fillStyle = BRASS; ctx.fillRect(cx - ew / 2, ey + 2, ew, 1.4);
    }
    for (i = 0; i < b.windows.length; i++) {
      wd = b.windows[i]; wy = GROUND_Y + wd.y; if (wy < top + 6) continue;
      if (litTest(wd, litLevel) && night) { ctx.shadowBlur = 5; ctx.shadowColor = BRASS; }
      ctx.fillStyle = litTest(wd, litLevel) ? (night ? glowRGBA(BRASS, 0.9) : '#F4ECD6') : 'rgba(0,0,0,0.25)';
      ctx.fillRect(wd.x - 2.5, wy - 3, 5, 6); ctx.shadowBlur = 0;
    }
    var tpk = Math.min(h * 0.2, 20);
    ctx.fillStyle = ORANGE; ctx.beginPath(); ctx.moveTo(cx - b.w * 0.4, top + 2); ctx.quadraticCurveTo(cx, top - tpk, cx + b.w * 0.4, top + 2); ctx.quadraticCurveTo(cx, top - 2, cx - b.w * 0.4, top + 2); ctx.closePath(); ctx.fill();
    ctx.fillStyle = BRASS; ctx.fillRect(cx - 1, top - tpk - 6, 2, 8);
    if (sub % 2 === 0) { if (night) { ctx.shadowBlur = 6; ctx.shadowColor = ORANGE; } ctx.fillStyle = night ? glowRGBA(ORANGE, 0.9) : ORANGE; ctx.beginPath(); ctx.ellipse(cx, top + 11, 3.5, 5, 0, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0; }
  }

  // CASSETTE 1984 — precast concrete panels, CRT-amber windows, aerials,
  // dishes and one arcade sign that refuses to be tasteful
  function drawBuildingCassette(b, top, h, litLevel) {
    var cx = b.x + b.w / 2, night = litLevel > 0.5, hb = hashB(b), sub = hb % 4, i, wd, wy;
    ctx.fillStyle = b.color;
    ctx.fillRect(b.x, top, b.w, h);
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(b.x + b.w - 3, top, 3, h);
    if (!b.windows.length) {
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      for (wy = top + 12; wy < GROUND_Y - 8; wy += 14) ctx.fillRect(b.x, wy, b.w, 1.2);
      return;
    }
    ctx.fillStyle = 'rgba(0,0,0,0.18)';            // precast panel joints
    for (wy = top + 12; wy < GROUND_Y - 8; wy += 14) ctx.fillRect(b.x + 1, wy, b.w - 2, 1.2);
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(b.x, top, 2.5, h);
    for (i = 0; i < b.windows.length; i++) {       // square panes, CRT amber
      wd = b.windows[i]; wy = GROUND_Y + wd.y; if (wy < top + 7) continue;
      var lit = litTest(wd, litLevel);
      if (lit && night) { ctx.shadowBlur = 3; ctx.shadowColor = '#FFB25E'; }
      ctx.fillStyle = lit ? (wd.accent ? '#8CF0B4' : '#FFC076') : 'rgba(10, 8, 6, 0.4)';
      ctx.fillRect(wd.x - 2.6, wy - 2.6, 5.2, 5.2);
      ctx.shadowBlur = 0;
    }
    if (h > 30) {                                  // shopfront + awning
      ctx.fillStyle = night ? 'rgba(255, 190, 110, 0.7)' : 'rgba(240, 230, 210, 0.25)';
      ctx.fillRect(b.x + 2, GROUND_Y - 11, b.w - 4, 11);
      ctx.fillStyle = mixHex(ORANGE, TEAL_TRIM, 0.15);
      ctx.fillRect(b.x + 2, GROUND_Y - 13, b.w - 4, 3);
    }
    if (sub === 0) {                               // TV aerial cluster
      ctx.strokeStyle = 'rgba(239,230,212,0.7)'; ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(cx - 4, top); ctx.lineTo(cx - 4, top - 16);
      ctx.moveTo(cx - 9, top - 13); ctx.lineTo(cx + 1, top - 13);
      ctx.moveTo(cx - 8, top - 9); ctx.lineTo(cx, top - 9);
      ctx.moveTo(cx + 6, top); ctx.lineTo(cx + 6, top - 10);
      ctx.moveTo(cx + 2, top - 8); ctx.lineTo(cx + 10, top - 8);
      ctx.stroke();
    } else if (sub === 1) {                        // rooftop satellite dish
      ctx.fillStyle = mixHex(b.color, '#FFFFFF', 0.25);
      ctx.beginPath();
      ctx.ellipse(cx, top - 6, 7, 5.4, -0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = TEAL_TRIM; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(cx, top); ctx.lineTo(cx, top - 4); ctx.stroke();
      ctx.fillStyle = TEAL_TRIM;
      ctx.beginPath(); ctx.arc(cx - 3, top - 8, 1.2, 0, Math.PI * 2); ctx.fill();
    } else if (sub === 2) {                        // the arcade sign, buzzing pink
      var buzz = !reducedMotion.matches && Math.sin(effT * 13 + hb) > -0.7;
      if (night && buzz) { ctx.shadowBlur = 8; ctx.shadowColor = NEON_PINK; }
      ctx.strokeStyle = glowRGBA(NEON_PINK, night ? (buzz ? 0.95 : 0.35) : 0.45);
      ctx.lineWidth = 2;
      ctx.strokeRect(cx - Math.min(14, b.w * 0.3), top - 12, Math.min(28, b.w * 0.6), 9);
      ctx.shadowBlur = 0;
      ctx.fillStyle = glowRGBA(NEON_CYAN, night ? 0.85 : 0.4);
      ctx.fillRect(cx - Math.min(10, b.w * 0.22), top - 9.4, Math.min(20, b.w * 0.44), 3.6);
    } else {                                       // microwave relay drum
      ctx.fillStyle = mixHex(b.color, '#FFFFFF', 0.18);
      ctx.fillRect(cx - 2, top - 12, 4, 12);
      ctx.fillStyle = CREAM_HI;
      ctx.beginPath(); ctx.arc(cx, top - 13, 3.4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath(); ctx.arc(cx + 1, top - 13, 1.6, 0, Math.PI * 2); ctx.fill();
    }
  }

  // ORBITAL 2050 — composite towers, hazard bands, pad rings, radomes
  // and gantry masts; a port city that happens to point upward
  function drawBuildingOrbital(b, top, h, litLevel) {
    var cx = b.x + b.w / 2, night = litLevel > 0.5, hb = hashB(b), sub = hb % 4, i, wd, wy;
    ctx.fillStyle = b.color;
    ctx.fillRect(b.x, top, b.w, h);
    ctx.fillStyle = 'rgba(240, 242, 238, 0.07)';   // composite sheen
    ctx.fillRect(b.x, top, b.w * 0.3, h);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(b.x + b.w - 3, top, 3, h);
    if (!b.windows.length) {
      ctx.fillStyle = glowRGBA(ORANGE, 0.5);
      ctx.fillRect(b.x, top, b.w, 1.8);
      return;
    }
    for (i = 0; i < b.windows.length; i++) {       // wide low ports, cool white
      wd = b.windows[i]; wy = GROUND_Y + wd.y; if (wy < top + 7) continue;
      var lit = litTest(wd, litLevel);
      if (lit && night) { ctx.shadowBlur = 3; ctx.shadowColor = '#BEE0FF'; }
      ctx.fillStyle = lit ? (wd.accent ? glowRGBA(ORANGE, 0.95) : '#D8ECFF') : 'rgba(6, 12, 20, 0.45)';
      ctx.fillRect(wd.x - 3.2, wy - 2, 6.4, 4);
      ctx.shadowBlur = 0;
    }
    ctx.save();                                    // hazard chevrons at the base
    ctx.beginPath(); ctx.rect(b.x + 2, GROUND_Y - 8, b.w - 4, 8); ctx.clip();
    ctx.fillStyle = 'rgba(6, 12, 20, 0.5)';
    ctx.fillRect(b.x + 2, GROUND_Y - 8, b.w - 4, 8);
    ctx.fillStyle = glowRGBA(ORANGE, 0.75);
    for (var zx2 = b.x - 6; zx2 < b.x + b.w + 6; zx2 += 12) {
      ctx.beginPath();
      ctx.moveTo(zx2, GROUND_Y); ctx.lineTo(zx2 + 5, GROUND_Y - 8);
      ctx.lineTo(zx2 + 9, GROUND_Y - 8); ctx.lineTo(zx2 + 4, GROUND_Y);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    if (sub === 0) {                               // rooftop pad ring
      ctx.strokeStyle = glowRGBA(ORANGE, night ? 0.9 : 0.55);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.ellipse(cx, top - 1, Math.min(b.w * 0.36, 15), 3.4, 0, 0, Math.PI * 2);
      ctx.stroke();
      if (night && Math.sin(effT * 3 + hb) > 0.4) {
        ctx.shadowBlur = 6; ctx.shadowColor = ORANGE;
        ctx.fillStyle = glowRGBA(ORANGE, 0.95);
        ctx.fillRect(cx - 1, top - 3, 2, 2);
        ctx.shadowBlur = 0;
      }
    } else if (sub === 1) {                        // radome
      ctx.fillStyle = mixHex(b.color, '#F0F2EE', 0.4);
      ctx.beginPath(); ctx.arc(cx, top, Math.min(b.w * 0.3, 10), Math.PI, 0); ctx.fill();
      ctx.strokeStyle = 'rgba(6, 12, 20, 0.3)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(cx, top, Math.min(b.w * 0.3, 10) * 0.6, Math.PI, 0); ctx.stroke();
    } else if (sub === 2) {                        // gantry mast, guyed
      ctx.strokeStyle = 'rgba(240, 242, 238, 0.7)'; ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(cx, top); ctx.lineTo(cx, top - 24);
      ctx.moveTo(cx, top - 22); ctx.lineTo(cx - 8, top);
      ctx.moveTo(cx, top - 22); ctx.lineTo(cx + 8, top);
      ctx.moveTo(cx, top - 16); ctx.lineTo(cx + 6, top - 16);
      ctx.stroke();
      ctx.fillStyle = glowRGBA('#FF5A5A', night ? 0.95 : 0.5);
      ctx.beginPath(); ctx.arc(cx, top - 25, 1.5, 0, Math.PI * 2); ctx.fill();
    } else {                                       // paired solar wings
      ctx.fillStyle = mixHex('#1A3A5E', NEON_CYAN, 0.25);
      ctx.fillRect(cx - b.w * 0.4, top - 7, b.w * 0.34, 6);
      ctx.fillRect(cx + b.w * 0.06, top - 7, b.w * 0.34, 6);
      ctx.strokeStyle = 'rgba(240,242,238,0.4)'; ctx.lineWidth = 1;
      ctx.strokeRect(cx - b.w * 0.4, top - 7, b.w * 0.34, 6);
      ctx.strokeRect(cx + b.w * 0.06, top - 7, b.w * 0.34, 6);
      ctx.fillStyle = CREAM_HI;
      ctx.fillRect(cx - 1, top - 5, 2, 5);
    }
  }

  // ART DECO / DECOPUNK — setback ziggurats, gilt fluting, sunburst crowns
  function drawBuildingDeco(b, top, h, litLevel) {
    var cx = b.x + b.w / 2, night = litLevel > 0.5, sub = hashB(b) % 4, i, wd, wy;
    var stepped = h > 70 && b.w > 26;
    var h3 = stepped ? Math.min(h * 0.14, 26) : 0;       // crown tier
    var h2 = stepped ? Math.min(h * 0.26, 52) : 0;       // shoulder tier
    var w2 = b.w * 0.72, w3 = b.w * 0.46;
    ctx.fillStyle = b.color;
    ctx.fillRect(b.x, top + h2 + h3, b.w, h - h2 - h3);  // base mass
    if (stepped) {
      ctx.fillRect(cx - w2 / 2, top + h3, w2, h2 + 1);
      ctx.fillRect(cx - w3 / 2, top, w3, h3 + 1);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(b.x + b.w - 3, top + h2 + h3, 3, h - h2 - h3);
    if (!b.windows.length) {                             // back row: gilt crown + faint flutes
      ctx.fillStyle = glowRGBA(BRASS, 0.55);
      ctx.fillRect(stepped ? cx - w3 / 2 : b.x, top, stepped ? w3 : b.w, 2);
      ctx.fillStyle = glowRGBA(BRASS, night ? 0.28 : 0.14);
      var bf = Math.max(2, Math.round(b.w / 18));
      for (i = 1; i < bf; i++) {
        ctx.fillRect(b.x + b.w * i / bf - 0.6, top + h2 + h3 + 2, 1.2, h - h2 - h3 - 6);
      }
      return;
    }
    ctx.fillStyle = glowRGBA(BRASS, night ? 0.5 : 0.32); // gilt fluting
    var flutes = Math.max(3, Math.round(b.w / 12));
    for (i = 1; i < flutes; i++) {
      ctx.fillRect(b.x + b.w * i / flutes - 0.7, top + h2 + h3 + 3, 1.4, h - h2 - h3 - 8);
    }
    ctx.fillStyle = BRASS;                               // bright setback shoulders
    ctx.fillRect(b.x, top + h2 + h3, b.w, 2);
    if (stepped) {
      ctx.fillRect(cx - w2 / 2, top + h3, w2, 2);
      ctx.fillRect(cx - w3 / 2, top, w3, 2);
    }
    for (i = 0; i < b.windows.length; i++) {             // tall lancet panes
      wd = b.windows[i]; wy = GROUND_Y + wd.y; if (wy < top + h2 + h3 + 6) continue;
      var lit = litTest(wd, litLevel);
      if (lit && night) { ctx.shadowBlur = 4; ctx.shadowColor = BRASS; }
      ctx.fillStyle = lit ? (night ? '#FFD98A' : '#E0BC88') : 'rgba(0,0,0,0.3)';
      ctx.fillRect(wd.x - 1.8, wy - 4, 3.6, 8);
      ctx.shadowBlur = 0;
    }
    var crownY = top, crownW = stepped ? w3 : b.w;
    if (sub === 0) {                                     // the sunburst fan
      if (night) { ctx.shadowBlur = 7; ctx.shadowColor = BRASS; }
      ctx.strokeStyle = glowRGBA(BRASS, night ? 0.9 : 0.6);
      ctx.lineWidth = 1.6; ctx.lineCap = 'round';
      ctx.beginPath();
      for (i = 0; i <= 6; i++) {
        var fa = Math.PI + i * (Math.PI / 6);
        var fr = Math.min(crownW * 0.9, 24);
        ctx.moveTo(cx, crownY);
        ctx.lineTo(cx + Math.cos(fa) * fr, crownY + Math.sin(fa) * fr);
      }
      ctx.stroke(); ctx.shadowBlur = 0; ctx.lineCap = 'butt';
    } else if (sub === 1) {                              // stepped chrome spire
      ctx.fillStyle = CREAM_HI;
      ctx.fillRect(cx - 3, crownY - 8, 6, 8);
      ctx.fillRect(cx - 1.5, crownY - 20, 3, 12);
      ctx.fillStyle = BRASS;
      ctx.beginPath(); ctx.arc(cx, crownY - 22, 2, 0, Math.PI * 2); ctx.fill();
    } else if (sub === 2) {                              // chevron parapet
      ctx.strokeStyle = BRASS; ctx.lineWidth = 1.6;
      ctx.beginPath();
      for (var zx = cx - crownW / 2 + 2; zx < cx + crownW / 2 - 2; zx += 8) {
        ctx.moveTo(zx, crownY); ctx.lineTo(zx + 4, crownY - 5); ctx.lineTo(zx + 8, crownY);
      }
      ctx.stroke();
    } else {                                             // flagpole and pennant
      ctx.strokeStyle = CREAM_HI; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(cx, crownY); ctx.lineTo(cx, crownY - 18); ctx.stroke();
      ctx.fillStyle = ORANGE;
      var fl = reducedMotion.matches ? 0 : Math.sin(effT * 3 + b.x) * 2;
      ctx.beginPath(); ctx.moveTo(cx, crownY - 18); ctx.lineTo(cx + 11, crownY - 15 + fl); ctx.lineTo(cx, crownY - 12); ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = 'rgba(6, 26, 20, 0.4)';              // shaded plinth
    ctx.fillRect(b.x, GROUND_Y - 6, b.w, 6);
  }

  // PRESENT DAY — glass curtain walls, floor ribbons, comm masts, LED crowns
  function drawBuildingPresent(b, top, h, litLevel) {
    var cx = b.x + b.w / 2, night = litLevel > 0.5, hb = hashB(b), sub = hb % 4, i, wd, wy;
    ctx.fillStyle = b.color;
    ctx.fillRect(b.x, top, b.w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';            // the sky in the glass
    ctx.beginPath();
    ctx.moveTo(b.x, top); ctx.lineTo(b.x + b.w * 0.45, top);
    ctx.lineTo(b.x + b.w * 0.2, GROUND_Y); ctx.lineTo(b.x, GROUND_Y);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(b.x + b.w - 3, top, 3, h);
    if (!b.windows.length) {
      ctx.fillStyle = 'rgba(255,255,255,0.2)'; ctx.fillRect(b.x, top, b.w, 1.6);
      return;
    }
    ctx.fillStyle = 'rgba(10, 16, 22, 0.4)';             // curtain-wall floor ribbons
    for (wy = top + 8; wy < GROUND_Y - 6; wy += 9) ctx.fillRect(b.x + 1, wy, b.w - 2, 1.1);
    for (i = 0; i < b.windows.length; i++) {             // wide office panes
      wd = b.windows[i]; wy = GROUND_Y + wd.y; if (wy < top + 7) continue;
      var lit = litTest(wd, litLevel);
      if (lit) {
        if (night) { ctx.shadowBlur = 3; ctx.shadowColor = wd.accent ? BRASS : '#CFE8FF'; }
        ctx.fillStyle = wd.accent ? '#FFD98A' : (night ? '#DDEFFF' : 'rgba(255,255,255,0.55)');
      } else {
        ctx.fillStyle = 'rgba(160, 200, 230, 0.14)';
      }
      ctx.fillRect(wd.x - 3, wy - 2.5, 6, 5);
      ctx.shadowBlur = 0;
    }
    if (h > 30) {                                        // double-height glass lobby
      ctx.fillStyle = night ? 'rgba(255, 216, 138, 0.75)' : 'rgba(255,255,255,0.25)';
      ctx.fillRect(b.x + 2, GROUND_Y - 13, b.w - 4, 13);
      ctx.fillStyle = TEAL_TRIM;
      ctx.fillRect(cx - 1.2, GROUND_Y - 13, 2.4, 13);
    }
    if (sub === 0) {                                     // comm mast + dishes
      ctx.strokeStyle = CREAM_HI; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(cx, top); ctx.lineTo(cx, top - 26); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillRect(cx - 5, top - 4, 3, 4); ctx.fillRect(cx + 2, top - 6, 3, 6);
      if (night && Math.sin(effT * 2.2 + hb) > 0) { ctx.shadowBlur = 8; ctx.shadowColor = ORANGE; }
      ctx.fillStyle = ORANGE;
      ctx.beginPath(); ctx.arc(cx, top - 28, 2, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    } else if (sub === 1) {                              // LED crown band, breathing
      var pulse = reducedMotion.matches ? 0.5 : 0.5 + 0.35 * Math.sin(effT * 1.6 + hb);
      if (night) { ctx.shadowBlur = 8; ctx.shadowColor = NEON_CYAN; }
      ctx.fillStyle = glowRGBA(NEON_CYAN, (night ? 0.55 : 0.2) + 0.25 * pulse);
      ctx.fillRect(b.x + 2, top, b.w - 4, 3);
      ctx.shadowBlur = 0;
    } else if (sub === 2) {                              // rooftop plant + screen
      ctx.fillStyle = mixHex(b.color, '#101820', 0.4);
      ctx.fillRect(cx - b.w * 0.32, top - 8, b.w * 0.3, 8);
      ctx.fillRect(cx + b.w * 0.06, top - 5, b.w * 0.2, 5);
      ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(b.x + 2, top - 10); ctx.lineTo(b.x + b.w - 2, top - 10); ctx.stroke();
    } else {                                             // angled glass crown
      var ah = Math.min(h * 0.16, 18);
      ctx.fillStyle = b.color;
      ctx.beginPath(); ctx.moveTo(b.x + 1, top); ctx.lineTo(b.x + b.w - 1, top - ah); ctx.lineTo(b.x + b.w - 1, top); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(b.x + 1, top); ctx.lineTo(b.x + b.w - 1, top - ah); ctx.stroke();
    }
  }

  // per-era road / ground-band treatment
  function drawGroundEra(litLevel) {
    var s = STYLE; if (s === 'atompunk') return;
    var by = GROUND_Y, bh = VIEW_H - GROUND_Y, i, xx, yy;
    var L = harbor && harbor.side === -1 ? harbor.shore : -80;
    var R = harbor && harbor.side === 1 ? harbor.shore : VIEW_W + 80;
    if (s === 'cyberpunk') {
      ctx.fillStyle = 'rgba(6,4,16,0.5)'; ctx.fillRect(L, by, R - L, bh);
      var vp = VIEW_W * 0.5;
      ctx.strokeStyle = glowRGBA(NEON_CYAN, 0.5); ctx.lineWidth = 1; ctx.beginPath();
      for (i = -8; i <= 8; i++) { ctx.moveTo(vp, by); ctx.lineTo(vp + i * 90, VIEW_H); } ctx.stroke();
      ctx.strokeStyle = glowRGBA(NEON_PINK, 0.5);
      for (i = 0; i < 4; i++) { var p = ((effT * 0.4 + i / 4) % 1); yy = by + p * p * bh; ctx.globalAlpha = p; ctx.beginPath(); ctx.moveTo(L, yy); ctx.lineTo(R, yy); ctx.stroke(); }
      ctx.globalAlpha = 1;
    } else if (s === 'steampunk') {
      ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 1.3;
      for (yy = by + 8; yy < VIEW_H; yy += 10) { ctx.beginPath(); for (xx = L; xx < R; xx += 16) { ctx.moveTo(xx, yy); ctx.arc(xx + 8, yy, 8, Math.PI, 0); } ctx.stroke(); }
      ctx.strokeStyle = glowRGBA(BRASS, 0.5); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(L, by + 16); ctx.lineTo(R, by + 16); ctx.moveTo(L, by + 30); ctx.lineTo(R, by + 30); ctx.stroke();
    } else if (s === 'solarpunk') {
      ctx.fillStyle = '#2E7D4F'; ctx.fillRect(L, by, R - L, bh);
      ctx.fillStyle = '#3E9A63'; for (xx = L; xx < R; xx += 6) { ctx.beginPath(); ctx.arc(xx, by + 3, 2.5, Math.PI, 0); ctx.fill(); }
      ctx.fillStyle = 'rgba(244,243,224,0.5)'; ctx.fillRect(L, by + 20, R - L, 8);
      ctx.fillStyle = BRASS; for (i = 0; i < 10; i++) { var fx = L + (i * 197) % (R - L); ctx.beginPath(); ctx.arc(fx, by + 8, 1.5, 0, Math.PI * 2); ctx.fill(); }
    } else if (s === 'artdeco' || s === 'decopunk') {
      // polished terrazzo: gilt border courses and a chevron inlay
      ctx.strokeStyle = glowRGBA(BRASS, 0.55); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(L, by + 14); ctx.lineTo(R, by + 14); ctx.stroke();
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (xx = L; xx < R; xx += 22) { ctx.moveTo(xx, by + 26); ctx.lineTo(xx + 11, by + 20); ctx.lineTo(xx + 22, by + 26); }
      ctx.stroke();
    } else if (s === 'present') {
      // fresh asphalt: crisp lane dashes and a protected cycle lane
      ctx.fillStyle = 'rgba(10,14,18,0.45)'; ctx.fillRect(L, by, R - L, bh);
      ctx.fillStyle = 'rgba(238,243,247,0.6)';
      for (xx = L; xx < R; xx += 34) ctx.fillRect(xx, by + 16, 16, 2.4);
      ctx.fillStyle = glowRGBA(NEON_CYAN, 0.16); ctx.fillRect(L, by + 30, R - L, 7);
    } else if (s === 'cassette') {
      // sun-bleached asphalt: a double yellow center line, patch seams
      ctx.fillStyle = 'rgba(20, 16, 12, 0.4)'; ctx.fillRect(L, by, R - L, bh);
      ctx.fillStyle = glowRGBA(BRASS, 0.55);
      ctx.fillRect(L, by + 15, R - L, 1.8);
      ctx.fillRect(L, by + 19, R - L, 1.8);
      ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1.2;   // tar seams
      ctx.beginPath();
      for (xx = L + 60; xx < R; xx += 170) {
        ctx.moveTo(xx, by + 2); ctx.lineTo(xx + 24, by + bh - 4);
      }
      ctx.stroke();
    } else if (s === 'orbital') {
      // the pad apron: sealed grey, orange chevrons, one landing ring
      ctx.fillStyle = 'rgba(6, 12, 20, 0.4)'; ctx.fillRect(L, by, R - L, bh);
      ctx.fillStyle = glowRGBA(ORANGE, 0.5);
      for (xx = L; xx < R; xx += 46) {
        ctx.beginPath();
        ctx.moveTo(xx, by + 24); ctx.lineTo(xx + 9, by + 14);
        ctx.lineTo(xx + 13, by + 14); ctx.lineTo(xx + 4, by + 24);
        ctx.closePath(); ctx.fill();
      }
      ctx.strokeStyle = glowRGBA(ORANGE, 0.4); ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.ellipse(L + (R - L) * 0.72, by + 30, 34, 7, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (s === 'silkpunk') {
      ctx.strokeStyle = 'rgba(0,0,0,0.16)'; ctx.lineWidth = 1;
      for (xx = L; xx < R; xx += 26) { ctx.strokeRect(xx, by + 4, 24, bh - 8); }
      ctx.fillStyle = mixHex(TEALS[1], '#101C20', 0.35); ctx.fillRect(L, by + bh - 16, R - L, 16);
      ctx.strokeStyle = 'rgba(242,236,214,0.3)'; ctx.lineWidth = 1;
      for (i = 0; i < 3; i++) { yy = by + bh - 12 + i * 4; var dr = reducedMotion.matches ? 0 : (effT * (6 + i * 3)) % 40; ctx.beginPath(); for (xx = L - 40 + dr; xx < R; xx += 40) { ctx.moveTo(xx, yy); ctx.lineTo(xx + 16, yy); } ctx.stroke(); }
    }
  }

  // per-era flying craft (replaces the Googie aircar for other eras)
  function drawAircarEra(s, x, y, d, night) {
    if (s === 'cyberpunk') {
      ctx.fillStyle = glowRGBA(NEON_CYAN, 0.4); ctx.beginPath(); ctx.moveTo(x - d * 16, y - 2); ctx.lineTo(x - d * 46, y); ctx.lineTo(x - d * 16, y + 3); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#141326'; ctx.beginPath(); ctx.moveTo(x + d * 22, y); ctx.lineTo(x - d * 16, y - 6); ctx.lineTo(x - d * 18, y + 5); ctx.closePath(); ctx.fill();
      if (night) { ctx.shadowBlur = 6; ctx.shadowColor = NEON_PINK; }
      ctx.fillStyle = glowRGBA(NEON_PINK, 0.9); ctx.fillRect(Math.min(x - d * 16, x - d * 18), y + 4, 34, 1.4); ctx.shadowBlur = 0;
      ctx.fillStyle = glowRGBA(NEON_CYAN, 0.9); ctx.beginPath(); ctx.arc(x + d * 18, y - 1, 1.6, 0, Math.PI * 2); ctx.fill();
    } else if (s === 'steampunk') {
      ctx.fillStyle = CREAM_HI; ctx.beginPath(); ctx.ellipse(x, y, 20, 7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = ORANGE; ctx.fillRect(x - 16, y - 1.5, 32, 3);
      ctx.fillStyle = TEAL_TRIM; ctx.fillRect(x - 5, y + 7, 10, 4);
      ctx.strokeStyle = TEAL_TRIM; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x - 5, y + 6); ctx.lineTo(x - 4, y + 7); ctx.moveTo(x + 5, y + 6); ctx.lineTo(x + 4, y + 7); ctx.stroke();
      ctx.strokeStyle = BRASS; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(x - d * 20, y); ctx.lineTo(x - d * 24, y - 3 + (reducedMotion.matches ? 0 : Math.sin(effT * 20) * 3)); ctx.moveTo(x - d * 20, y); ctx.lineTo(x - d * 24, y + 3 - (reducedMotion.matches ? 0 : Math.sin(effT * 20) * 3)); ctx.stroke();
    } else if (s === 'solarpunk') {
      ctx.fillStyle = '#3E9A63'; ctx.beginPath(); ctx.ellipse(x, y, 16, 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = CREAM_HI; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x - 15, y); ctx.lineTo(x + 15, y); ctx.stroke();
      ctx.fillStyle = glowRGBA(NEON_CYAN, 0.4); ctx.beginPath(); ctx.ellipse(x + d * 4, y - 3, 6, 3, 0, Math.PI, Math.PI * 2); ctx.fill();
      ctx.fillStyle = BRASS; ctx.beginPath(); ctx.arc(x + d * 14, y, 1.4, 0, Math.PI * 2); ctx.fill();
    } else if (s === 'present') {
      // a parcel drone: crossed rotors, nav lights, cargo underneath
      var spin = reducedMotion.matches ? 0 : effT * 30;
      ctx.strokeStyle = 'rgba(238,243,247,0.5)'; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x - 8 - 4 * Math.cos(spin), y - 3); ctx.lineTo(x - 8 + 4 * Math.cos(spin), y - 3);
      ctx.moveTo(x + 8 - 4 * Math.cos(spin + 2), y - 3); ctx.lineTo(x + 8 + 4 * Math.cos(spin + 2), y - 3);
      ctx.stroke();
      ctx.fillStyle = '#2A333C';
      ctx.fillRect(x - 9, y - 3, 18, 2.4);
      ctx.fillRect(x - 3, y - 1, 6, 4);
      ctx.fillStyle = BRASS; ctx.fillRect(x - 2.4, y + 3, 4.8, 3.4);          // the parcel
      ctx.fillStyle = glowRGBA('#4AE07A', 0.9); ctx.beginPath(); ctx.arc(x - 9, y - 4.5, 1, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = glowRGBA('#FF5A5A', 0.9); ctx.beginPath(); ctx.arc(x + 9, y - 4.5, 1, 0, Math.PI * 2); ctx.fill();
    } else if (s === 'artdeco' || s === 'decopunk' || s === 'dieselpunk') {
      // a prop monoplane, silver in any light
      ctx.fillStyle = CREAM_HI;
      ctx.beginPath(); ctx.ellipse(x, y, 16, 3.4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(x - 9 - d * 3, y - 0.5, 18, 2.2);                          // wing
      ctx.beginPath(); ctx.moveTo(x - d * 15, y); ctx.lineTo(x - d * 19, y - 6); ctx.lineTo(x - d * 13, y); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(238,231,206,0.5)'; ctx.lineWidth = 1;
      var pr2 = reducedMotion.matches ? 3 : 5 + Math.sin(effT * 30) * 2;
      ctx.beginPath(); ctx.moveTo(x + d * 16, y - pr2); ctx.lineTo(x + d * 16, y + pr2); ctx.stroke();
      ctx.fillStyle = ORANGE; ctx.fillRect(x - 4, y - 3.4, 8, 1.4);           // livery stripe
    } else if (s === 'cassette') {
      // the traffic helicopter, watching the smog roll in
      var rot = reducedMotion.matches ? 4 : 10 * Math.abs(Math.cos(effT * 22));
      ctx.fillStyle = mixHex(TEALS[0], '#EFE6D4', 0.2);
      ctx.beginPath(); ctx.ellipse(x, y, 8, 4.4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(10, 8, 6, 0.5)';
      ctx.beginPath(); ctx.ellipse(x + d * 4, y - 0.8, 3.2, 2.4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = TEAL_TRIM; ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.moveTo(x - d * 6, y); ctx.lineTo(x - d * 17, y - 1); ctx.stroke();   // tail boom
      ctx.fillStyle = ORANGE; ctx.fillRect(x - d * 18, y - 4, 2, 6);
      ctx.strokeStyle = 'rgba(239,230,212,0.65)';
      ctx.beginPath(); ctx.moveTo(x - rot, y - 6); ctx.lineTo(x + rot, y - 6); ctx.stroke();    // rotor
      ctx.beginPath(); ctx.moveTo(x, y - 6); ctx.lineTo(x, y - 4); ctx.stroke();
      if (night) {
        ctx.fillStyle = glowRGBA('#FF4A4A', Math.sin(effT * 6) > 0 ? 0.95 : 0.2);
        ctx.beginPath(); ctx.arc(x, y + 5, 1.2, 0, Math.PI * 2); ctx.fill();
      }
    } else if (s === 'orbital') {
      // a cargo pod on thrust, parcels for the pads
      var flick = reducedMotion.matches ? 0.7 : 0.55 + 0.45 * Math.sin(effT * 26 + x);
      ctx.fillStyle = mixHex(TEALS[1], '#F0F2EE', 0.35);
      ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x - 9, y - 6, 18, 12, 4); else ctx.rect(x - 9, y - 6, 18, 12); ctx.fill();
      ctx.fillStyle = glowRGBA(ORANGE, 0.85);
      ctx.fillRect(x - 9, y - 1.2, 18, 2.4);        // hazard belt
      ctx.fillStyle = 'rgba(6, 12, 20, 0.5)';
      ctx.fillRect(x + d * 3, y - 4.5, 4, 3);       // sensor face
      ctx.shadowBlur = 6; ctx.shadowColor = NEON_CYAN;
      ctx.fillStyle = glowRGBA(NEON_CYAN, flick);
      ctx.fillRect(x - 5, y + 6.5, 3, 2.6);
      ctx.fillRect(x + 2, y + 6.5, 3, 2.6);
      ctx.shadowBlur = 0;
    } else if (s === 'clockpunk') {
      // an ornithopter, wings beating like a heron's
      var flap = reducedMotion.matches ? 2 : Math.sin(effT * 7 + x) * 6;
      ctx.fillStyle = mixHex(TEALS[0], '#241408', 0.35);
      ctx.beginPath(); ctx.ellipse(x, y, 9, 2.6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = BRASS; ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(x - 3, y - 1); ctx.quadraticCurveTo(x - 12, y - 6 - flap, x - 20, y - 2 - flap);
      ctx.moveTo(x + 3, y - 1); ctx.quadraticCurveTo(x + 12, y - 6 - flap, x + 20, y - 2 - flap);
      ctx.stroke();
      ctx.fillStyle = TEAL_TRIM; ctx.fillRect(x - d * 10 - 1, y - 1, 2, 4);
    } else if (s === 'biopunk') {
      // a courier moth, all wing and glow
      var beat = reducedMotion.matches ? 3 : Math.sin(effT * 11 + x) * 5;
      ctx.fillStyle = 'rgba(182,232,90,0.4)';
      ctx.beginPath();
      ctx.ellipse(x - 6, y - 2 - beat * 0.4, 7, 3.4, -0.4, 0, Math.PI * 2);
      ctx.ellipse(x + 6, y - 2 + beat * 0.4, 7, 3.4, 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = mixHex(TEALS[1], '#B6E85A', 0.25);
      ctx.beginPath(); ctx.ellipse(x, y, 4.5, 2.2, 0, 0, Math.PI * 2); ctx.fill();
      if (night) { ctx.shadowBlur = 5; ctx.shadowColor = NEON_CYAN; }
      ctx.fillStyle = glowRGBA(NEON_CYAN, 0.9);
      ctx.beginPath(); ctx.arc(x + d * 4, y, 1.2, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    } else if (s === 'nanopunk') {
      // a courier swarm holding a chevron
      ctx.fillStyle = glowRGBA(NEON_CYAN, night ? 0.85 : 0.5);
      for (var sw2 = 0; sw2 < 7; sw2++) {
        var back = Math.ceil(sw2 / 2) * 7;
        var side = sw2 === 0 ? 0 : (sw2 % 2 ? -1 : 1) * Math.ceil(sw2 / 2) * 4;
        var jx = reducedMotion.matches ? 0 : Math.sin(effT * 5 + sw2 * 1.7) * 1.4;
        ctx.beginPath(); ctx.arc(x + d * 8 - d * back + jx, y + side, 1.3, 0, Math.PI * 2); ctx.fill();
      }
    } else {
      ctx.fillStyle = ORANGE; ctx.beginPath(); ctx.moveTo(x, y - 12); ctx.lineTo(x + d * 10, y - 2); ctx.lineTo(x, y); ctx.closePath(); ctx.fill();
      ctx.fillStyle = CREAM_HI; ctx.beginPath(); ctx.moveTo(x - 14, y); ctx.quadraticCurveTo(x, y + 6, x + 14, y); ctx.quadraticCurveTo(x, y + 3, x - 14, y); ctx.closePath(); ctx.fill();
      ctx.fillStyle = BRASS; ctx.fillRect(x - 14, y, 28, 1.2);
      ctx.strokeStyle = TEAL_TRIM; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 12); ctx.stroke();
    }
  }

  function tubeCapCol() {
    return STYLE === 'cyberpunk' ? '#1A1633' : STYLE === 'steampunk' ? mixHex(TEALS[0], '#3E2817', 0.4)
      : STYLE === 'solarpunk' ? '#3E9A63' : STYLE === 'silkpunk' ? ORANGE : ORANGE;
  }

  // per-era street vehicle (replaces the tail-fin car)
  function drawCarEra(s, p, night) {
    var d = p.dir, L = p.len, x0 = p.x, cx = p.x + L / 2, gy = GROUND_Y;
    if (s === 'cyberpunk') {
      var y = gy - 7;
      ctx.fillStyle = glowRGBA(NEON_PINK, 0.5); ctx.fillRect(x0, gy - 2, L, 2);
      ctx.fillStyle = '#1A1633'; ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 + L, y); ctx.lineTo(x0 + L - 4, y + 6); ctx.lineTo(x0 + 4, y + 6); ctx.closePath(); ctx.fill();
      if (night) { ctx.shadowBlur = 4; ctx.shadowColor = NEON_CYAN; }
      ctx.fillStyle = glowRGBA(NEON_CYAN, night ? 0.9 : 0.45); ctx.fillRect(x0 + 3, y + 1.5, L - 6, 1.8); ctx.shadowBlur = 0;
      ctx.fillStyle = night ? glowRGBA(NEON_CYAN, 0.9) : NEON_CYAN; ctx.beginPath(); ctx.arc(d === 1 ? x0 + L : x0, y + 3, 1.4, 0, Math.PI * 2); ctx.fill();
    } else if (s === 'steampunk') {
      ctx.strokeStyle = TEAL_TRIM; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(x0 + 4, gy - 3, 3.2, 0, Math.PI * 2); ctx.moveTo(x0 + L - 0.5, gy - 4.5); ctx.arc(x0 + L - 5, gy - 4.5, 4.5, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = mixHex(TEALS[0], '#3E2817', 0.45); ctx.fillRect(x0 + 2, gy - 13, L - 6, 10);
      ctx.fillStyle = TEAL_TRIM; ctx.fillRect(x0 + (d === 1 ? L * 0.48 : 3), gy - 18, L * 0.42, 6);
      var fnx = d === 1 ? x0 + 4 : x0 + L - 4; ctx.fillStyle = '#3E2817'; ctx.fillRect(fnx - 1.5, gy - 19, 3, 7); ctx.fillStyle = BRASS; ctx.fillRect(fnx - 2, gy - 19, 4, 1.5);
      if (!reducedMotion.matches) { ctx.fillStyle = 'rgba(230,220,200,0.3)'; var py = gy - 21 - ((effT * 14) % 16); ctx.beginPath(); ctx.arc(fnx, py, 3, 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = BRASS; ctx.fillRect(x0 + 2, gy - 4.5, L - 6, 1);
    } else if (s === 'solarpunk') {
      ctx.fillStyle = TEAL_TRIM; ctx.beginPath(); ctx.arc(x0 + 5, gy - 2, 2, 0, Math.PI * 2); ctx.arc(x0 + L - 5, gy - 2, 2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#3E9A63'; ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x0 + 2, gy - 12, L - 4, 10, 5); else ctx.rect(x0 + 2, gy - 12, L - 4, 10); ctx.fill();
      ctx.fillStyle = glowRGBA(night ? CREAM_HI : NEON_CYAN, 0.5); ctx.beginPath(); ctx.ellipse(cx, gy - 9, L * 0.32, 4, 0, Math.PI, 0); ctx.fill();
      ctx.fillStyle = BRASS; ctx.fillRect(x0 + 2, gy - 5, L - 4, 1);
    } else if (s === 'artdeco' || s === 'decopunk' || s === 'dieselpunk') {
      // streamlined thirties sedan: long hood, teardrop tail, chrome speed line
      ctx.strokeStyle = TEAL_TRIM; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(x0 + 6, gy - 3.5, 4, 0, Math.PI * 2); ctx.moveTo(x0 + L - 3, gy - 3.5); ctx.arc(x0 + L - 7, gy - 3.5, 4, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = mixHex(TEALS[0], '#161A10', 0.35);
      ctx.beginPath();
      ctx.moveTo(x0 + (d === 1 ? L : 0), gy - 4);
      ctx.quadraticCurveTo(x0 + L * 0.5, gy - 19, x0 + (d === 1 ? L * 0.2 : L * 0.8), gy - 16);
      ctx.quadraticCurveTo(x0 + (d === 1 ? 0 : L), gy - 12, x0 + (d === 1 ? 0 : L), gy - 4);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = BRASS; ctx.fillRect(x0 + 4, gy - 5.5, L - 8, 1.2);
      var hx2 = d === 1 ? x0 + L - 1 : x0 + 1;
      ctx.fillStyle = night ? glowRGBA(BRASS, 0.9) : CREAM_HI;
      ctx.beginPath(); ctx.arc(hx2, gy - 8, 1.6, 0, Math.PI * 2); ctx.fill();
    } else if (s === 'present') {
      // a quiet electric crossover: soft box, light-bar face, no exhaust
      ctx.fillStyle = TEAL_TRIM;
      ctx.beginPath(); ctx.arc(x0 + 6, gy - 2.5, 2.6, 0, Math.PI * 2); ctx.arc(x0 + L - 6, gy - 2.5, 2.6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = mixHex(TEALS[1], '#EEF3F7', 0.18);
      ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x0 + 2, gy - 14, L - 4, 11, 4); else ctx.rect(x0 + 2, gy - 14, L - 4, 11); ctx.fill();
      ctx.fillStyle = 'rgba(10,16,22,0.55)';
      ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x0 + L * 0.28, gy - 13, L * 0.5, 4.5, 2); else ctx.rect(x0 + L * 0.28, gy - 13, L * 0.5, 4.5); ctx.fill();
      if (night) { ctx.shadowBlur = 4; ctx.shadowColor = CREAM_HI; }
      ctx.fillStyle = night ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.5)';
      ctx.fillRect(d === 1 ? x0 + L - 4 : x0 + 2, gy - 9.5, 2.5, 1.6);
      ctx.shadowBlur = 0;
      ctx.fillStyle = glowRGBA(NEON_CYAN, 0.8);
      ctx.fillRect(d === 1 ? x0 : x0 + L - 2, gy - 9.5, 2, 1.4);
    } else if (s === 'cassette') {
      // a boxy hatchback, two crisp boxes and a red tail bar
      ctx.fillStyle = TEAL_TRIM;
      ctx.beginPath(); ctx.arc(x0 + 6, gy - 2.5, 2.8, 0, Math.PI * 2); ctx.arc(x0 + L - 6, gy - 2.5, 2.8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = mixHex(TEALS[1], '#EFE6D4', 0.16);
      ctx.fillRect(x0 + 2, gy - 10, L - 4, 7);      // lower box
      ctx.fillRect(x0 + (d === 1 ? 4 : L * 0.42), gy - 15, L * 0.52, 6);   // cabin box
      ctx.fillStyle = 'rgba(10, 8, 6, 0.5)';
      ctx.fillRect(x0 + (d === 1 ? 6 : L * 0.46), gy - 14, L * 0.44, 4);
      if (night) { ctx.shadowBlur = 4; ctx.shadowColor = '#FFD98A'; }
      ctx.fillStyle = night ? '#FFE9B0' : CREAM_HI;
      ctx.fillRect(d === 1 ? x0 + L - 4 : x0 + 2, gy - 9, 2.4, 2);
      ctx.shadowBlur = 0;
      ctx.fillStyle = glowRGBA('#FF4A4A', night ? 0.95 : 0.6);
      ctx.fillRect(d === 1 ? x0 + 2 : x0 + L - 4.4, gy - 9, 2.4, 2);
    } else if (s === 'orbital') {
      // a six-wheel crew rover, cab forward, hazard tail
      ctx.fillStyle = TEAL_TRIM;
      ctx.beginPath();
      ctx.arc(x0 + 5, gy - 2.5, 2.6, 0, Math.PI * 2);
      ctx.arc(x0 + L / 2, gy - 2.5, 2.6, 0, Math.PI * 2);
      ctx.arc(x0 + L - 5, gy - 2.5, 2.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = mixHex(TEALS[1], '#F0F2EE', 0.3);
      ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x0 + 1, gy - 13, L - 2, 10, 3); else ctx.rect(x0 + 1, gy - 13, L - 2, 10); ctx.fill();
      ctx.fillStyle = 'rgba(6, 12, 20, 0.55)';      // wraparound visor cab
      ctx.fillRect(d === 1 ? x0 + L * 0.55 : x0 + 3, gy - 12, L * 0.4, 4);
      ctx.fillStyle = glowRGBA(ORANGE, 0.9);
      ctx.fillRect(d === 1 ? x0 + 1 : x0 + L - 3.4, gy - 12, 2.4, 8);
    } else if (s === 'clockpunk') {
      // a horse-drawn trap on iron tyres
      var hd = d === 1 ? 1 : -1;
      var trot = reducedMotion.matches ? 0 : Math.sin(effT * 9 + x0) * 1.4;
      ctx.strokeStyle = TEAL_TRIM; ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.arc(cx - hd * 6, gy - 4, 4.4, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = mixHex(TEALS[0], '#241408', 0.4);
      ctx.fillRect(hd === 1 ? cx - 12 : cx, gy - 13, 12, 9);
      ctx.strokeStyle = BRASS; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx - hd * 1, gy - 9); ctx.lineTo(cx + hd * 8, gy - 7); ctx.stroke();
      var hx3 = cx + hd * 13;
      ctx.fillStyle = '#3E2817';
      ctx.beginPath(); ctx.ellipse(hx3, gy - 8, 6, 3.2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(hx3 + hd * 5 - 1, gy - 13, 2, 5);
      ctx.beginPath(); ctx.ellipse(hx3 + hd * 6.5, gy - 13, 2.4, 1.4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#3E2817'; ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(hx3 - 4, gy - 6); ctx.lineTo(hx3 - 4 - trot, gy);
      ctx.moveTo(hx3 + 4, gy - 6); ctx.lineTo(hx3 + 4 + trot, gy);
      ctx.stroke();
    } else if (s === 'biopunk') {
      // a grown carapace pod, padding along on soft feet
      ctx.fillStyle = mixHex(TEALS[1], '#B6E85A', 0.18);
      ctx.beginPath(); ctx.ellipse(cx, gy - 8, L * 0.4, 7, 0, Math.PI, 0); ctx.fill();
      if (night) { ctx.shadowBlur = 5; ctx.shadowColor = NEON_CYAN; }
      ctx.fillStyle = glowRGBA(NEON_CYAN, 0.85);
      ctx.beginPath(); ctx.arc(cx + d * L * 0.3, gy - 9, 1.6, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      var pad = reducedMotion.matches ? 0 : Math.sin(effT * 10 + x0) * 1.2;
      ctx.strokeStyle = TEAL_TRIM; ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(cx - 6, gy - 4); ctx.lineTo(cx - 6 - pad, gy);
      ctx.moveTo(cx + 6, gy - 4); ctx.lineTo(cx + 6 + pad, gy);
      ctx.stroke();
    } else if (s === 'nanopunk') {
      // a seamless capsule gliding a hair above the road
      var hov = reducedMotion.matches ? 0 : Math.sin(effT * 3 + x0) * 0.8;
      ctx.fillStyle = glowRGBA(NEON_CYAN, 0.25);
      ctx.fillRect(x0 + 4, gy - 1.5, L - 8, 1.5);
      ctx.fillStyle = mixHex(TEALS[1], '#EEF3F7', 0.3);
      ctx.beginPath(); ctx.ellipse(cx, gy - 9 + hov, L * 0.42, 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = glowRGBA(NEON_CYAN, night ? 0.9 : 0.5);
      ctx.fillRect(cx - L * 0.3, gy - 9.6 + hov, L * 0.6, 1.2);
    } else {
      ctx.strokeStyle = TEAL_TRIM; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(cx - 6, gy - 4, 4.5, 0, Math.PI * 2); ctx.moveTo(cx + 10.5, gy - 4); ctx.arc(cx + 6, gy - 4, 4.5, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = mixHex(TEALS[1], '#145A4E', 0.2); ctx.fillRect(cx - 8, gy - 12, 16, 8);
      ctx.fillStyle = ORANGE; ctx.beginPath(); ctx.moveTo(cx - 9, gy - 12); ctx.quadraticCurveTo(cx, gy - 20, cx + 9, gy - 12); ctx.closePath(); ctx.fill();
      ctx.fillStyle = BRASS; ctx.fillRect(cx - 9, gy - 12, 18, 1.2);
      var hx = d === 1 ? cx + 12 : cx - 12; ctx.strokeStyle = TEAL_TRIM; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(cx + (d === 1 ? 8 : -8), gy - 6); ctx.lineTo(hx, gy - 8); ctx.stroke();
      ctx.fillStyle = TEAL_TRIM; ctx.fillRect(hx - 1, gy - 11, 2, 7); ctx.beginPath(); ctx.arc(hx, gy - 12.5, 1.8, 0, Math.PI * 2); ctx.fill();
    }
  }

  // per-era monorail train
  function drawTrainEra(s, x, d, night) {
    var y = RAIL_Y - 26, wx, k;
    if (s === 'cyberpunk') {
      ctx.fillStyle = '#14122E';
      ctx.beginPath();
      ctx.moveTo(x + 8, y + 2); ctx.lineTo(x + TRAIN_LEN - 8, y + 2);
      ctx.quadraticCurveTo(x + TRAIN_LEN, y + 2, x + TRAIN_LEN, y + 12); ctx.lineTo(x + TRAIN_LEN, y + 22); ctx.lineTo(x, y + 22); ctx.lineTo(x, y + 12);
      ctx.quadraticCurveTo(x, y + 2, x + 8, y + 2); ctx.closePath(); ctx.fill();
      if (night) { ctx.shadowBlur = 6; ctx.shadowColor = NEON_CYAN; }
      ctx.fillStyle = glowRGBA(NEON_CYAN, 0.9); ctx.fillRect(x + 6, y + 8, TRAIN_LEN - 12, 2.4); ctx.shadowBlur = 0;
      ctx.fillStyle = glowRGBA(NEON_PINK, 0.7); ctx.fillRect(x + 6, y + 21, TRAIN_LEN - 12, 1.5);
    } else if (s === 'steampunk') {
      var col = mixHex(TEALS[0], '#3E2817', 0.42);
      ctx.fillStyle = col; ctx.fillRect(x + 10, y + 9, TRAIN_LEN - 20, 13);
      ctx.beginPath(); ctx.arc(d === 1 ? x + TRAIN_LEN - 10 : x + 10, y + 15, 7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = TEAL_TRIM; ctx.fillRect(x + (d === 1 ? 16 : TRAIN_LEN * 0.42), y, TRAIN_LEN * 0.42, 11);
      var fx = d === 1 ? x + TRAIN_LEN - 18 : x + 18; ctx.fillStyle = '#3E2817'; ctx.fillRect(fx - 3, y + 1, 6, 9); ctx.fillStyle = BRASS; ctx.fillRect(fx - 4, y, 8, 2);
      if (!reducedMotion.matches) { ctx.fillStyle = 'rgba(230,220,200,0.35)'; for (k = 0; k < 3; k++) { var py = y - ((effT * 20 + k * 12) % 36); ctx.beginPath(); ctx.arc(fx + Math.sin(effT + k) * 4, py, 4 + k, 0, Math.PI * 2); ctx.fill(); } }
      ctx.fillStyle = TEAL_TRIM; for (wx = x + 22; wx < x + TRAIN_LEN - 14; wx += 26) { ctx.beginPath(); ctx.arc(wx, y + 24, 4, 0, Math.PI * 2); ctx.fill(); }
      ctx.strokeStyle = BRASS; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x + 22, y + 24); ctx.lineTo(x + TRAIN_LEN - 16, y + 24); ctx.stroke();
      ctx.fillStyle = night ? BRASS : '#16332F'; for (wx = x + 16; wx < x + TRAIN_LEN - 16; wx += 16) ctx.fillRect(wx, y + 12, 7, 6);
    } else if (s === 'solarpunk') {
      ctx.fillStyle = '#3E9A63'; ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x + 4, y + 4, TRAIN_LEN - 8, 18, 9); else ctx.rect(x + 4, y + 4, TRAIN_LEN - 8, 18); ctx.fill();
      ctx.fillStyle = night ? '#FFE196' : glowRGBA(CREAM_HI, 0.6); for (wx = x + 14; wx < x + TRAIN_LEN - 10; wx += 18) ctx.fillRect(wx, y + 9, 12, 8);
      ctx.fillStyle = BRASS; ctx.fillRect(x + 4, y + 21, TRAIN_LEN - 8, 1.6);
      ctx.fillStyle = '#2E7D4F'; ctx.beginPath(); ctx.arc(x + TRAIN_LEN * 0.5, y + 4, 5, Math.PI, 0); ctx.fill();
    } else if (s === 'artdeco' || s === 'decopunk' || s === 'dieselpunk') {
      // the chrome streamliner: bullet nose, shrouded skirts, one speed line
      var nx2 = d === 1 ? x + TRAIN_LEN : x;
      ctx.fillStyle = mixHex(CREAM_HI, TEAL_TRIM, 0.32);
      ctx.beginPath();
      ctx.moveTo(d === 1 ? x : x + TRAIN_LEN, y + 3);
      ctx.lineTo(nx2 - d * 16, y + 3);
      ctx.quadraticCurveTo(nx2, y + 4, nx2, y + 14);
      ctx.quadraticCurveTo(nx2 - d * 2, y + 22, nx2 - d * 16, y + 22);
      ctx.lineTo(d === 1 ? x : x + TRAIN_LEN, y + 22);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = BRASS;
      ctx.fillRect(x + 6, y + 12, TRAIN_LEN - 12, 1.6);
      ctx.fillStyle = night ? glowRGBA(BRASS, 0.9) : TEAL_TRIM;
      for (wx = x + 14; wx < x + TRAIN_LEN - 18; wx += 15) {
        ctx.beginPath(); ctx.arc(wx, y + 8.5, 2.4, 0, Math.PI * 2); ctx.fill();
      }
      if (night) { ctx.shadowBlur = 6; ctx.shadowColor = CREAM_HI; }
      ctx.fillStyle = CREAM_HI;
      ctx.beginPath(); ctx.arc(nx2 - d * 3, y + 9, 1.8, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    } else if (s === 'present') {
      // a quiet light-metro set: big glass, door lights, no smoke at all
      ctx.fillStyle = mixHex(CREAM_HI, TEALS[0], 0.12);
      ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x + 3, y + 3, TRAIN_LEN - 6, 19, 6); else ctx.rect(x + 3, y + 3, TRAIN_LEN - 6, 19); ctx.fill();
      ctx.fillStyle = 'rgba(10,16,22,0.55)';
      ctx.fillRect(x + 8, y + 7, TRAIN_LEN - 16, 7);
      ctx.fillStyle = night ? '#FFE196' : 'rgba(255,255,255,0.6)';
      for (wx = x + 10; wx < x + TRAIN_LEN - 10; wx += 13) ctx.fillRect(wx, y + 8, 9, 5);
      ctx.fillStyle = glowRGBA(NEON_CYAN, 0.85);
      for (wx = x + 26; wx < x + TRAIN_LEN - 20; wx += 40) ctx.fillRect(wx, y + 16, 2, 5);
      ctx.fillStyle = TEAL_TRIM; ctx.fillRect(x + 3, y + 21, TRAIN_LEN - 6, 1.4);
    } else if (s === 'cassette') {
      // the commuter unit: box sections, orange stripe, honest fluorescents
      ctx.fillStyle = mixHex(TEALS[1], '#EFE6D4', 0.28);
      for (wx = x + 3; wx < x + TRAIN_LEN - 3; wx += 42) {
        ctx.fillRect(wx, y + 4, Math.min(38, x + TRAIN_LEN - 3 - wx), 18);
      }
      ctx.fillStyle = ORANGE;
      ctx.fillRect(x + 3, y + 15, TRAIN_LEN - 6, 3);
      ctx.fillStyle = night ? '#EFF6E2' : 'rgba(10, 8, 6, 0.4)';
      for (wx = x + 8; wx < x + TRAIN_LEN - 10; wx += 11) ctx.fillRect(wx, y + 7, 7, 5);
      ctx.fillStyle = 'rgba(10, 8, 6, 0.5)';
      ctx.fillRect(x + 3, y + 21, TRAIN_LEN - 6, 1.4);
    } else if (s === 'orbital') {
      // the maglev: one seamless blade riding its own glow
      var nx3 = d === 1 ? x + TRAIN_LEN : x;
      ctx.fillStyle = mixHex(CREAM_HI, TEALS[0], 0.08);
      ctx.beginPath();
      ctx.moveTo(d === 1 ? x : x + TRAIN_LEN, y + 5);
      ctx.lineTo(nx3 - d * 20, y + 5);
      ctx.quadraticCurveTo(nx3, y + 6, nx3, y + 19);
      ctx.lineTo(d === 1 ? x : x + TRAIN_LEN, y + 19);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(6, 12, 20, 0.5)';
      ctx.fillRect(x + 8, y + 8, TRAIN_LEN - 26, 4.5);
      ctx.fillStyle = glowRGBA(ORANGE, 0.85);
      ctx.fillRect(x + 6, y + 15.5, TRAIN_LEN - 12, 1.6);
      if (night) { ctx.shadowBlur = 6; ctx.shadowColor = NEON_CYAN; }
      ctx.fillStyle = glowRGBA(NEON_CYAN, night ? 0.8 : 0.45);   // the lift field
      ctx.fillRect(x + 4, y + 20.5, TRAIN_LEN - 8, 1.6);
      ctx.shadowBlur = 0;
    } else {
      ctx.fillStyle = mixHex(TEALS[1], '#145A4E', 0.2); ctx.fillRect(x + 8, y + 11, TRAIN_LEN - 16, 11);
      for (var seg = 0; seg < 3; seg++) { var sx = x + 20 + seg * (TRAIN_LEN - 40) / 2; ctx.fillStyle = ORANGE; ctx.beginPath(); ctx.moveTo(sx - 24, y + 11); ctx.quadraticCurveTo(sx, y + 1, sx + 24, y + 11); ctx.quadraticCurveTo(sx, y + 7, sx - 24, y + 11); ctx.closePath(); ctx.fill(); ctx.fillStyle = BRASS; ctx.fillRect(sx - 22, y + 10, 44, 1.2); }
      ctx.fillStyle = night ? glowRGBA(BRASS, 0.9) : '#F4ECD6'; for (wx = x + 16; wx < x + TRAIN_LEN - 12; wx += 16) ctx.fillRect(wx, y + 14, 6, 6);
      var hx = d === 1 ? x + TRAIN_LEN : x; ctx.fillStyle = ORANGE; ctx.beginPath(); ctx.arc(hx, y + 16, 5, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = BRASS; ctx.beginPath(); ctx.arc(hx + d * 2, y + 15, 1.4, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = TEAL_TRIM; ctx.fillRect(x + TRAIN_LEN * 0.18, y + 24, 16, 4); ctx.fillRect(x + TRAIN_LEN * 0.72, y + 24, 16, 4);
  }

  // per-era airship
  function drawAirshipEra(s, x, y, d, night) {
    if (s === 'cyberpunk') {
      ctx.fillStyle = '#141330'; ctx.beginPath(); ctx.ellipse(x, y, 64, 16, 0, 0, Math.PI * 2); ctx.fill();
      if (night) { ctx.shadowBlur = 8; ctx.shadowColor = NEON_CYAN; }
      ctx.strokeStyle = glowRGBA(NEON_CYAN, 0.85); ctx.lineWidth = 1.6; ctx.beginPath(); ctx.ellipse(x, y, 64, 16, 0, 0, Math.PI * 2); ctx.stroke(); ctx.shadowBlur = 0;
      ctx.fillStyle = glowRGBA(NEON_PINK, 0.7); ctx.fillRect(x - 60, y + 8, 120, 2);
      ctx.fillStyle = glowRGBA(NEON_CYAN, 0.9); for (var k = -2; k <= 2; k++) { ctx.beginPath(); ctx.arc(x + k * 24, y + 14, 1.6, 0, Math.PI * 2); ctx.fill(); }
    } else if (s === 'steampunk') {
      ctx.fillStyle = CREAM_HI; ctx.beginPath(); ctx.ellipse(x, y, 66, 18, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(6,37,35,0.25)'; ctx.lineWidth = 1.4; for (var k2 = -2; k2 <= 2; k2++) { ctx.beginPath(); ctx.moveTo(x + k2 * 22, y - 15); ctx.lineTo(x + k2 * 22, y + 15); ctx.stroke(); }
      ctx.fillStyle = ORANGE; ctx.fillRect(x - 66, y - 3, 132, 6);
      ctx.fillStyle = BRASS; ctx.beginPath(); ctx.ellipse(x + d * 66, y, 13, 18, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = mixHex(TEALS[0], '#3E2817', 0.4); ctx.beginPath(); ctx.ellipse(x, y + 26, 16, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = BRASS; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x - 10, y + 16); ctx.lineTo(x - 8, y + 22); ctx.moveTo(x + 10, y + 16); ctx.lineTo(x + 8, y + 22); ctx.stroke();
      var pr = reducedMotion.matches ? 4 : Math.sin(effT * 18) * 5; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(x - d * 66, y - 5); ctx.lineTo(x - d * 72, y - 5 + pr); ctx.moveTo(x - d * 66, y + 5); ctx.lineTo(x - d * 72, y + 5 - pr); ctx.stroke();
    } else if (s === 'solarpunk') {
      ctx.fillStyle = '#3E9A63'; ctx.beginPath(); ctx.moveTo(x - 40, y); ctx.bezierCurveTo(x - 40, y - 30, x + 40, y - 30, x + 50, y); ctx.bezierCurveTo(x + 40, y + 26, x - 40, y + 26, x - 40, y); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = CREAM_HI; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x - 38, y); ctx.lineTo(x + 48, y); ctx.stroke();
      ctx.fillStyle = BRASS; ctx.beginPath(); ctx.ellipse(x, y + 24, 14, 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(46,125,79,0.7)'; ctx.lineWidth = 1.2; for (var v = 0; v < 3; v++) { ctx.beginPath(); ctx.moveTo(x - 10 + v * 10, y + 22); ctx.quadraticCurveTo(x - 8 + v * 10, y + 34, x - 12 + v * 10, y + 40); ctx.stroke(); }
    } else if (s === 'artdeco' || s === 'decopunk' || s === 'dieselpunk') {
      // the great silver ship of state
      ctx.fillStyle = mixHex(CREAM_HI, TEAL_TRIM, 0.22);
      ctx.beginPath(); ctx.ellipse(x, y, 70, 15, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.14)'; ctx.lineWidth = 1;
      for (var k3 = -2; k3 <= 2; k3++) { ctx.beginPath(); ctx.moveTo(x + k3 * 24, y - 12); ctx.lineTo(x + k3 * 24, y + 12); ctx.stroke(); }
      ctx.fillStyle = mixHex(CREAM_HI, TEAL_TRIM, 0.4);
      ctx.beginPath(); ctx.moveTo(x - d * 62, y - 4); ctx.lineTo(x - d * 78, y - 14); ctx.lineTo(x - d * 66, y); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x - d * 62, y + 4); ctx.lineTo(x - d * 78, y + 14); ctx.lineTo(x - d * 66, y); ctx.closePath(); ctx.fill();
      ctx.fillStyle = TEAL_TRIM;
      ctx.fillRect(x - 14, y + 13, 28, 5);
      ctx.fillStyle = night ? glowRGBA(BRASS, 0.9) : BRASS;
      for (var k4 = -1; k4 <= 1; k4++) ctx.fillRect(x + k4 * 8 - 1, y + 14.5, 2, 2);
      ctx.fillStyle = ORANGE; ctx.fillRect(x - 30, y - 15.5, 60, 2.4);
    } else if (s === 'present' || s === 'cassette') {
      // the ad blimp, LED board amidships
      ctx.fillStyle = mixHex(CREAM_HI, TEALS[0], 0.1);
      ctx.beginPath(); ctx.ellipse(x, y, 58, 16, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = mixHex(CREAM_HI, TEALS[0], 0.3);
      ctx.beginPath(); ctx.moveTo(x - d * 52, y - 4); ctx.lineTo(x - d * 66, y - 12); ctx.lineTo(x - d * 56, y + 1); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#0C1218';
      ctx.fillRect(x - 30, y - 6, 60, 12);
      if (night) { ctx.shadowBlur = 6; ctx.shadowColor = NEON_CYAN; }
      ctx.fillStyle = glowRGBA(NEON_CYAN, night ? 0.95 : 0.6);
      ctx.font = '700 9px Jost, Futura, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('NAZARBAN', x, y + 0.5);
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      ctx.shadowBlur = 0;
      ctx.fillStyle = TEAL_TRIM; ctx.fillRect(x - 8, y + 14, 16, 4);
    } else if (s === 'orbital') {
      // the heavy lifter: twin hulls and a cargo frame between
      ctx.fillStyle = mixHex(CREAM_HI, TEALS[0], 0.14);
      ctx.beginPath();
      ctx.ellipse(x, y - 9, 55, 10, 0, 0, Math.PI * 2);
      ctx.ellipse(x, y + 9, 55, 10, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = glowRGBA(ORANGE, 0.8);
      ctx.fillRect(x - 40, y - 10.5, 80, 2);
      ctx.fillRect(x - 40, y + 7.5, 80, 2);
      ctx.strokeStyle = TEAL_TRIM; ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(x - 20, y - 4); ctx.lineTo(x - 20, y + 4);
      ctx.moveTo(x + 20, y - 4); ctx.lineTo(x + 20, y + 4);
      ctx.stroke();
      ctx.fillStyle = mixHex(TEALS[1], '#F0F2EE', 0.3);   // the slung container
      ctx.fillRect(x - 14, y - 4, 28, 8);
      ctx.fillStyle = glowRGBA(NEON_CYAN, night ? 0.9 : 0.5);
      ctx.fillRect(x - 14, y - 0.8, 28, 1.6);
    } else if (s === 'clockpunk') {
      // a montgolfier, drifting on whatever wind there is
      ctx.fillStyle = mixHex(ORANGE, CREAM_HI, 0.25);
      ctx.beginPath(); ctx.arc(x, y - 8, 17, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(36,20,8,0.3)'; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y - 25); ctx.quadraticCurveTo(x - 10, y - 8, x - 6, y + 8);
      ctx.moveTo(x, y - 25); ctx.quadraticCurveTo(x + 10, y - 8, x + 6, y + 8);
      ctx.moveTo(x, y - 25); ctx.lineTo(x, y + 8);
      ctx.stroke();
      ctx.strokeStyle = BRASS;
      ctx.beginPath(); ctx.moveTo(x - 6, y + 7); ctx.lineTo(x - 4, y + 15); ctx.moveTo(x + 6, y + 7); ctx.lineTo(x + 4, y + 15); ctx.stroke();
      ctx.fillStyle = '#3E2817'; ctx.fillRect(x - 5, y + 15, 10, 7);
    } else {
      ctx.fillStyle = mixHex(TEALS[1], '#145A4E', 0.2); ctx.beginPath(); ctx.moveTo(x - 40, y); ctx.quadraticCurveTo(x, y + 16, x + 44, y); ctx.quadraticCurveTo(x, y + 8, x - 40, y); ctx.closePath(); ctx.fill();
      ctx.fillStyle = ORANGE; ctx.beginPath(); ctx.moveTo(x - 6, y - 2); ctx.lineTo(x - 6, y - 34); ctx.quadraticCurveTo(x + 20, y - 24, x + 22, y - 4); ctx.lineTo(x + 18, y - 2); ctx.closePath(); ctx.fill();
      ctx.fillStyle = BRASS; ctx.fillRect(x - 40, y, 84, 1.4);
      ctx.strokeStyle = TEAL_TRIM; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x - 6, y); ctx.lineTo(x - 6, y - 34); ctx.stroke();
      if (night) { ctx.shadowBlur = 6; ctx.shadowColor = ORANGE; } ctx.fillStyle = night ? glowRGBA(ORANGE, 0.9) : ORANGE; ctx.beginPath(); ctx.ellipse(x + 30, y + 2, 3, 5, 0, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
    }
  }

  var curLit = 0;   // latest computed light level, for helpers without the param

  /* ---------------- which furniture belongs to which age -------------- */
  /* The Googie fixtures are 1958 hardware (decopunk, its 1939 cousin,
     shares the World-of-Tomorrow wardrobe); every other age keeps only
     what it would plausibly have. Anything not listed shows in all ages
     (it era-skins itself — monorail, cars, airships, citizens). */
  var ERA_FIXTURES = {
    welcome:      { atompunk: 1, decopunk: 1 },
    tower:        { atompunk: 1, artdeco: 1, dieselpunk: 1, decopunk: 1, cyberpunk: 1, present: 1, nanopunk: 1, cassette: 1, orbital: 1 },
    jetpacks:     { atompunk: 1, decopunk: 1 },
    kiosk:        { atompunk: 1, decopunk: 1 },
    futureHouse:  { atompunk: 1, decopunk: 1 },
    tube:         { atompunk: 1, steampunk: 1, decopunk: 1, nanopunk: 1 },
    robot:        { atompunk: 1, dieselpunk: 1, decopunk: 1 },
    taxi:         { atompunk: 1, decopunk: 1 },
    sculpture:    { atompunk: 1, decopunk: 1 },
    milk:         { atompunk: 1, artdeco: 1, dieselpunk: 1, decopunk: 1 },
    sputnik:      { atompunk: 1, cyberpunk: 1, present: 1, solarpunk: 1, silkpunk: 1, biopunk: 1, nanopunk: 1, cassette: 1, orbital: 1 },
    searchlights: { atompunk: 1, artdeco: 1, dieselpunk: 1, decopunk: 1, cyberpunk: 1 },
    driveIn:      { atompunk: 1, dieselpunk: 1, decopunk: 1, cassette: 1 },
    smoke:        { atompunk: 1, steampunk: 1, clockpunk: 1, artdeco: 1, dieselpunk: 1, decopunk: 1, cyberpunk: 1, biopunk: 1, silkpunk: 1, cassette: 1 }
  };
  function eraHas(f) { var m = ERA_FIXTURES[f]; return !m || m[STYLE] === 1; }

  /* ---------------- era retune + newsreel leader (full-frame) ---------- */

  // swapping ages rolls the picture: set static, one pass of the
  // vertical hold, torn scanlines and an opening flash, all fading as
  // the new age settles — a television being retuned, not a cut
  function drawEraFX() {
    if (eraFX.t <= 0 || reducedMotion.matches) return;
    var k = eraFX.t / eraFX.dur, i;                // 1 → 0
    ctx.fillStyle = 'rgba(8, 10, 10, ' + (0.28 * k).toFixed(3) + ')';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.globalAlpha = 0.5 * k;                     // set static
    ctx.fillStyle = CREAM_HI;
    for (i = 0; i < 90; i++) {
      var nx = (i * 149.7 + eraFX.t * 5231) % VIEW_W;
      var ny = (i * 83.3 + eraFX.t * 3719) % VIEW_H;
      ctx.fillRect(nx, ny, 2.2, 1.4);
    }
    ctx.globalAlpha = 1;
    var roll = (1 - k) * (VIEW_H + 240) - 120;     // the vertical hold rolls once
    ctx.fillStyle = 'rgba(6, 8, 8, ' + (0.5 * k).toFixed(3) + ')';
    ctx.fillRect(0, roll, VIEW_W, 90);
    ctx.fillStyle = glowRGBA(CREAM_HI, 0.5 * k);
    ctx.fillRect(0, roll + 90, VIEW_W, 3);
    ctx.fillStyle = 'rgba(255,255,255,' + (0.08 * k).toFixed(3) + ')';
    for (i = 0; i < 5; i++) {                      // torn scanline slivers
      var sy3 = (i * 197.7 + (1 - k) * 900) % VIEW_H;
      ctx.fillRect(0, sy3, VIEW_W, 2);
    }
    if (k > 0.82) {                                // the strike flash
      ctx.fillStyle = 'rgba(242, 233, 210, ' + (((k - 0.82) / 0.18) * 0.5).toFixed(3) + ')';
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }
  }

  // the newsreel's own title leader — recorded over the first moments
  // of every reel, era-stamped, with a film-leader sweep behind it
  function drawNewsreelCard() {
    if (newsreelCard <= 0) return;
    var fade = Math.min(1, newsreelCard / 0.3);
    var era = ERAS[STYLE];
    var pop = (window.MUNICITRON_CITY && window.MUNICITRON_CITY.population) || 0;
    ctx.globalAlpha = fade;
    ctx.fillStyle = '#0E100E';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    var cx = VIEW_W / 2, cy = VIEW_H / 2;
    var sweep = 1 - Math.max(0, Math.min(1, newsreelCard / 1.5));
    ctx.strokeStyle = 'rgba(242,233,210,0.16)';    // the leader's reticle
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, 150, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(242,233,210,0.1)';
    ctx.beginPath();
    ctx.moveTo(cx, cy - 170); ctx.lineTo(cx, cy + 170);
    ctx.moveTo(cx - 190, cy); ctx.lineTo(cx + 190, cy);
    ctx.stroke();
    ctx.fillStyle = 'rgba(242,233,210,0.06)';
    ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, 150, -Math.PI / 2, -Math.PI / 2 + sweep * Math.PI * 2);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = CREAM_HI;                    // the card itself
    ctx.lineWidth = 3;
    ctx.strokeRect(cx - 300, cy - 110, 600, 220);
    ctx.lineWidth = 1;
    ctx.strokeRect(cx - 292, cy - 102, 584, 204);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '6px';
    ctx.font = '700 40px Jost, Futura, sans-serif';
    ctx.fillStyle = CREAM_HI;
    ctx.fillText('NAZARBAN NEWSREEL', cx, cy - 44);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '3px';
    ctx.font = '600 16px Jost, Futura, sans-serif';
    ctx.fillStyle = BRASS;
    ctx.fillText(era ? era.age + ' · ' + era.year : 'MUNICIPAL PICTURES', cx, cy + 4);
    ctx.fillStyle = 'rgba(242,233,210,0.75)';
    ctx.fillText('CITY OF ' + CITY_NAME + ' — POP. ' + Math.floor(pop).toLocaleString('en-US'), cx, cy + 40);
    ctx.font = '600 12px Jost, Futura, sans-serif';
    ctx.fillStyle = 'rgba(242,233,210,0.45)';
    ctx.fillText('REEL Nº ' + seed.toString(16).toUpperCase() + ' · SHOWN IN ALL AGES', cx, cy + 78);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.globalAlpha = 1;
  }

  /* ---------------- the back row, cached ------------------------------
     The distant city doesn't need sixty paints a second. It repaints
     into an offscreen sheet a few times a second — or the instant the
     light, weather, season, era or skyline changes — and the main loop
     just blits the sheet under the live layers. */

  var bgSheet = null, bgSheetCtx = null, bgSheetKey = '';
  var BG_SS = 2;                                   // supersample for retina

  function drawBackRow(litLevel) {
    var i, sig = 0;
    for (i = 0; i < bgCity.length; i++) sig += bgCity[i].progress;
    var key = STYLE + '|' + Math.round(litLevel * 28) + '|' +
              Math.round(weatherLevel[2] * 8) + '|' + calendar.month + '|' +
              bgCity.length + '|' + Math.round(sig * 16) + '|' +
              Math.floor(effT * 8) + '|' + VIEW_H + '|' +
              (outage.phase ? outage.phase + ':' + Math.round(outage.frontX / 30) : 'n');
    if (!bgSheet || bgSheet.width !== VIEW_W * BG_SS || bgSheet.height !== VIEW_H * BG_SS) {
      bgSheet = document.createElement('canvas');
      bgSheet.width = VIEW_W * BG_SS;
      bgSheet.height = VIEW_H * BG_SS;
      bgSheetCtx = bgSheet.getContext('2d');
      bgSheetKey = '';
    }
    if (key !== bgSheetKey) {
      bgSheetKey = key;
      var main = ctx;                              // every draw helper reads the
      ctx = bgSheetCtx;                            // closure ctx — swap it in
      ctx.setTransform(BG_SS, 0, 0, BG_SS, 0, 0);
      ctx.clearRect(0, 0, VIEW_W, VIEW_H);
      for (i = 0; i < bgCity.length; i++) drawBuilding(bgCity[i], litLevel);
      ctx = main;
    }
    ctx.drawImage(bgSheet, 0, 0, VIEW_W, VIEW_H);
  }

  // per-era citizen (replaces the swing-coat figure)
  function drawPersonEra(s, x, gy, stride, d, night) {
    var y = gy - Math.abs(stride) * 0.9, hipY = y - 6, coat, accent;
    if (s === 'cyberpunk') { coat = '#1A1633'; accent = NEON_CYAN; }
    else if (s === 'steampunk') { coat = mixHex(TEALS[0], '#3E2817', 0.4); accent = BRASS; }
    else if (s === 'solarpunk') { coat = '#3E9A63'; accent = CREAM_HI; }
    else if (s === 'artdeco' || s === 'decopunk' || s === 'dieselpunk') { coat = mixHex(TEALS[0], '#241408', 0.3); accent = BRASS; }
    else if (s === 'present') { coat = '#3A4650'; accent = NEON_CYAN; }
    else if (s === 'cassette') { coat = '#6E4A5E'; accent = NEON_PINK; }
    else if (s === 'orbital') { coat = '#C8500F'; accent = CREAM_HI; }
    else if (s === 'clockpunk') { coat = mixHex(TEALS[0], '#241408', 0.45); accent = BRASS; }
    else { coat = mixHex(TEALS[1], '#145A4E', 0.2); accent = ORANGE; }
    ctx.strokeStyle = TEAL_TRIM; ctx.lineWidth = 1.8; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x, hipY); ctx.lineTo(x + stride * 2.6, y); ctx.moveTo(x, hipY); ctx.lineTo(x - stride * 2.6, y); ctx.stroke(); ctx.lineCap = 'butt';
    ctx.fillStyle = coat;                          // coat/torso
    ctx.beginPath(); ctx.moveTo(x - 2.8, hipY + 1); ctx.lineTo(x + 2.8, hipY + 1); ctx.lineTo(x + 2.2, y - 12.5); ctx.lineTo(x - 2.2, y - 12.5); ctx.closePath(); ctx.fill();
    if (s === 'silkpunk') { ctx.fillStyle = accent; ctx.fillRect(x - 2.6, y - 8, 5.2, 1.6); }
    else if (s === 'cyberpunk') { if (night) { ctx.shadowBlur = 4; ctx.shadowColor = accent; } ctx.strokeStyle = accent; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x - 1.8, y - 12); ctx.lineTo(x - 1.8, hipY); ctx.stroke(); ctx.shadowBlur = 0; }
    else if (s === 'steampunk') { ctx.strokeStyle = TEAL_TRIM; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x + 3, y - 6); ctx.lineTo(x + 3, y); ctx.stroke(); }   // cane
    else if (s === 'present' && night) { ctx.shadowBlur = 3; ctx.shadowColor = accent; ctx.fillStyle = glowRGBA(accent, 0.9); ctx.fillRect(x + 2.6, y - 7, 1.8, 2.6); ctx.shadowBlur = 0; }   // the phone
    else if (s === 'cassette') { ctx.strokeStyle = accent; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(x, headY + 0.4, 3, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke(); ctx.fillStyle = accent; ctx.fillRect(x - 3.6, headY + 0.2, 1.6, 2); ctx.fillRect(x + 2, headY + 0.2, 1.6, 2); }   // the walkman
    else if (s === 'orbital') { ctx.strokeStyle = 'rgba(240,242,238,0.8)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(x, headY, 3.2, 0, Math.PI * 2); ctx.stroke(); }   // soft helmet ring
    var headY = y - 14.6;
    ctx.fillStyle = SKIN; ctx.beginPath(); ctx.arc(x, headY, 2.1, 0, Math.PI * 2); ctx.fill();
    if (s === 'steampunk') { ctx.fillStyle = '#241408'; ctx.fillRect(x - 3.2, headY - 1.4, 6.4, 1); ctx.fillRect(x - 2.2, headY - 5.4, 4.4, 4.2); }
    else if (s === 'cyberpunk') { if (night) { ctx.shadowBlur = 5; ctx.shadowColor = accent; } ctx.fillStyle = accent; ctx.fillRect(x - 2.2, headY - 0.6, 4.4, 1.4); ctx.shadowBlur = 0; }
    else if (s === 'solarpunk') { ctx.fillStyle = CREAM_HI; ctx.fillRect(x - 3.4, headY - 1.8, 6.8, 1); ctx.beginPath(); ctx.arc(x, headY - 2, 2.4, Math.PI, 0); ctx.fill(); }
    else if (s === 'artdeco' || s === 'decopunk' || s === 'dieselpunk') { ctx.fillStyle = '#241408'; ctx.fillRect(x - 3.2, headY - 1.2, 6.4, 1); ctx.fillRect(x - 2, headY - 4, 4, 3); }   // fedora
    else if (s === 'present') { /* bare heads this age */ }
    else if (s === 'cassette') { /* the walkman is drawn with the coat */ }
    else if (s === 'orbital') { /* the helmet ring is drawn with the coat */ }
    else { ctx.fillStyle = ORANGE; ctx.beginPath(); ctx.moveTo(x - 3.4, headY - 1.4); ctx.lineTo(x, headY - 5.6); ctx.lineTo(x + 3.4, headY - 1.4); ctx.closePath(); ctx.fill(); }
    return y;
  }

  function drawBuilding(b, litLevel) {
    if (b.progress <= 0) return;
    var h = b.h * easeOutCubic(b.progress);
    var top = GROUND_Y - h;
    var i, wd;

    litLevel = Math.max(0, Math.min(1, litLevel + (b.litBias || 0)));

    if (STYLE === 'cyberpunk') { drawBuildingCyber(b, top, h, litLevel); return; }
    if (STYLE === 'steampunk') { drawBuildingSteam(b, top, h, litLevel); return; }
    if (STYLE === 'solarpunk') { drawBuildingSolar(b, top, h, litLevel); return; }
    if (STYLE === 'silkpunk')  { drawBuildingSilk(b, top, h, litLevel); return; }
    if (STYLE === 'artdeco' || STYLE === 'decopunk') { drawBuildingDeco(b, top, h, litLevel); return; }
    if (STYLE === 'present')   { drawBuildingPresent(b, top, h, litLevel); return; }
    if (STYLE === 'cassette')  { drawBuildingCassette(b, top, h, litLevel); return; }
    if (STYLE === 'orbital')   { drawBuildingOrbital(b, top, h, litLevel); return; }

    ctx.fillStyle = b.color;
    ctx.fillRect(b.x, top, b.w, h);

    if (b.windows.length && h > 8) {              // near-row towers get real detail
      ctx.fillStyle = 'rgba(251, 243, 222, 0.09)';   // lit left flank
      ctx.fillRect(b.x, top, 2.5, h);
      ctx.fillStyle = 'rgba(6, 37, 35, 0.28)';       // shaded right flank
      ctx.fillRect(b.x + b.w - 3, top, 3, h);
      ctx.fillStyle = 'rgba(6, 30, 28, 0.16)';       // vertical structural striations
      var fins = Math.max(2, Math.round(b.w / 15));
      for (var vf = 1; vf < fins; vf++) {
        ctx.fillRect(b.x + b.w * vf / fins - 0.6, top + 3, 1.2, h - 3);
      }
      ctx.fillStyle = calendar.month === 9 ? 'rgba(255,107,61,0.6)' : ACC_BAND[b.accent || 0];
      ctx.fillRect(b.x, top + 3.5, b.w, 1.6);        // bright crown band
      ctx.fillStyle = 'rgba(6, 30, 28, 0.4)';        // shaded base plinth
      ctx.fillRect(b.x, GROUND_Y - 6, b.w, 6);
    } else if (h > 20) {                          // distant back row: faint relief only
      ctx.fillStyle = 'rgba(6, 30, 28, 0.10)';
      var bf = Math.max(2, Math.round(b.w / 18));
      for (var vb = 1; vb < bf; vb++) ctx.fillRect(b.x + b.w * vb / bf - 0.5, top + 2, 1, h - 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.fillRect(b.x, top, b.w, 1.4);
      var bh2 = Math.abs(Math.floor(b.x * 7.3)) % 4;   // quiet back-row roof variety
      if (bh2 === 1) {                            // shallow peak
        ctx.fillStyle = b.color;
        ctx.beginPath();
        ctx.moveTo(b.x, top);
        ctx.lineTo(b.x + b.w / 2, top - Math.min(13, b.w * 0.2));
        ctx.lineTo(b.x + b.w, top);
        ctx.closePath(); ctx.fill();
      } else if (bh2 === 2) {                     // stepped parapet
        ctx.fillStyle = b.color;
        ctx.fillRect(b.x + b.w * 0.28, top - 6, b.w * 0.44, 6);
      } else if (bh2 === 3) {                     // slim mid fin
        ctx.fillStyle = b.color;
        ctx.fillRect(b.x + b.w / 2 - 1, top - 10, 2, 10);
      }
    }

    // a burnt-orange safety cordon crowns any works in progress, and the
    // risen portion shows its floors going in
    if (b.progress < 1 && (b.rising || b.demolishing) && h > 8) {
      ctx.fillStyle = ORANGE;
      ctx.fillRect(b.x, top, b.w, 3);
      if (b.rising) {
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = TEAL_TRIM;
        for (var fy = GROUND_Y - 26; fy > top + 8; fy -= 26) {
          ctx.fillRect(b.x + 3, fy, b.w - 6, 2);
        }
        ctx.globalAlpha = 1;
      }
    }

    if (b.progress === 1) {
      if (b.cap) {
        ctx.fillStyle = TEAL_TRIM;
        ctx.fillRect(b.x - 4, top, b.w + 8, 7);
      }
      var plainTop = b.windows.length && !b.mast && !b.sign && !b.chimney && !b.clock;
      if (b.nazarban) { /* the Nazarban crest overlay owns this rooftop */ }
      else if (b.spectacular) drawSpectacular(b, top, h, litLevel);
      else drawRoof(b, top, h, litLevel);
      if (b.chimney) {                            // rooftop stack
        ctx.fillStyle = TEAL_TRIM;
        ctx.fillRect(b.x + b.chimney * b.w - 4.5, top - 12, 9, 12);
      }
      if (b.clock) {                              // the stopped courthouse clock
        var ccx = b.x + b.w / 2, ccy = top + 24;
        ctx.fillStyle = CREAM_HI;
        ctx.beginPath(); ctx.arc(ccx, ccy, 9.5, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = TEAL_TRIM;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(ccx, ccy, 9.5, 0, Math.PI * 2); ctx.stroke();
        ctx.lineWidth = 1.6;                      // 3:47, as it has been since 1949
        ctx.beginPath();
        ctx.moveTo(ccx, ccy);
        ctx.lineTo(ccx + Math.cos(0.41) * 4.5, ccy + Math.sin(0.41) * 4.5);
        ctx.moveTo(ccx, ccy);
        ctx.lineTo(ccx + Math.cos(3.35) * 7, ccy + Math.sin(3.35) * 7);
        ctx.stroke();
        ctx.fillStyle = BRASS;
        ctx.beginPath(); ctx.arc(ccx, ccy, 1.4, 0, Math.PI * 2); ctx.fill();
      }
      if (weatherLevel[2] > 0.05) {               // settled rooftop snow
        ctx.globalAlpha = weatherLevel[2] * 0.9;
        ctx.fillStyle = CREAM_HI;
        ctx.fillRect(b.x - 1, top - 3, b.w + 2, 4);
        ctx.globalAlpha = 1;
      }
      if (b.mast) {                               // sleek chrome spire + beacon
        var mx = b.x + b.w / 2;
        ctx.fillStyle = CREAM_HI;                 // tapered spire
        ctx.beginPath();
        ctx.moveTo(mx - 4, top);
        ctx.lineTo(mx - 1, top - 48);
        ctx.lineTo(mx + 1, top - 48);
        ctx.lineTo(mx + 4, top);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = BRASS;                    // collars
        ctx.fillRect(mx - 4, top - 15, 8, 2);
        ctx.fillRect(mx - 3, top - 30, 6, 2);
        var blink = litLevel > 0.55 && Math.sin(effT * 2.6) > -0.25;
        if (blink) {
          ctx.shadowBlur = 10; ctx.shadowColor = ORANGE;
          ctx.fillStyle = GLOW_ORANGE;
          ctx.beginPath(); ctx.arc(mx, top - 52, 5.5, 0, Math.PI * 2); ctx.fill();
          ctx.shadowBlur = 0;
        }
        ctx.fillStyle = ORANGE;
        ctx.beginPath(); ctx.arc(mx, top - 52, 2.6, 0, Math.PI * 2); ctx.fill();
      }
      if (b.sign && !b.mast) {                    // clean atomic starburst
        var sx = b.x + b.w / 2;
        var sy2 = top - 34;
        var night = litLevel > 0.55;
        ctx.fillStyle = CREAM_HI;                 // chrome support pole
        ctx.fillRect(sx - 1.5, top - 18, 3, 18);
        ctx.strokeStyle = BRASS;                  // 16 rays, alternating length
        ctx.lineWidth = 2.4;
        ctx.lineCap = 'round';
        if (night) { ctx.shadowBlur = 8; ctx.shadowColor = BRASS; }
        ctx.beginPath();
        for (var sp = 0; sp < 16; sp++) {
          var sa = sp * Math.PI / 8;
          var sl = sp % 2 ? 8 : 16;
          ctx.moveTo(sx + Math.cos(sa) * 3.5, sy2 + Math.sin(sa) * 3.5);
          ctx.lineTo(sx + Math.cos(sa) * sl, sy2 + Math.sin(sa) * sl);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.lineCap = 'butt';
        ctx.fillStyle = ORANGE;                   // core
        ctx.beginPath(); ctx.arc(sx, sy2, 5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = CREAM_HI;
        ctx.beginPath(); ctx.arc(sx, sy2, 2, 0, Math.PI * 2); ctx.fill();
      }
    }

    // ---- glazed facade: ribbon windows grouped into floor bands, crisp
    // glass with ONE soft grouped glow (no more fuzzy per-dot halos) ----
    var wy;
    var wk = Math.max(0.72, CITY_K);
    var cw = 5.2 * wk, ch = 8.4 * wk;
    if (b._rowsFor !== b.windows) {               // cache floor extents per pane set
      var mm = {};
      for (i = 0; i < b.windows.length; i++) {
        wd = b.windows[i];
        var ky = Math.round(wd.y);
        if (!mm[ky]) mm[ky] = [wd.x, wd.x];
        else { if (wd.x < mm[ky][0]) mm[ky][0] = wd.x; if (wd.x > mm[ky][1]) mm[ky][1] = wd.x; }
      }
      b._rows = [];
      for (var kk in mm) b._rows.push({ y: parseInt(kk, 10), x0: mm[kk][0], x1: mm[kk][1] });
      b._rowsFor = b.windows;
    }

    ctx.fillStyle = 'rgba(5, 26, 24, 0.55)';      // recessed floor glazing bands
    for (i = 0; i < b._rows.length; i++) {
      wy = GROUND_Y + b._rows[i].y;
      if (wy < top + 6) continue;
      ctx.fillRect(b._rows[i].x0 - cw / 2 - 1.5, wy - ch / 2 - 1,
                   (b._rows[i].x1 - b._rows[i].x0) + cw + 3, ch + 2);
    }

    var litPath = new Path2D(), litAccent = new Path2D(), unlit = new Path2D();
    var anyGlow = false;
    for (i = 0; i < b.windows.length; i++) {
      wd = b.windows[i];
      wy = GROUND_Y + wd.y;
      if (wy < top + 6) continue;                 // above the built portion
      var lit = (wd.threshold < litLevel) !== (wd.flickUntil > effT);
      var rx = wd.x - cw / 2, ry = wy - ch / 2;
      if (lit) { anyGlow = true; (wd.accent ? litAccent : litPath).rect(rx, ry, cw, ch); }
      else unlit.rect(rx, ry, cw, ch);
    }
    ctx.fillStyle = 'rgba(24, 66, 60, 0.7)';      // dark unlit panes
    ctx.fill(unlit);
    var bloom = (reducedMotion.matches || !anyGlow) ? 0 : 6 * wk;
    ctx.shadowBlur = bloom;
    ctx.shadowColor = calendar.month === 9 ? ORANGE : BRASS;
    ctx.fillStyle = calendar.month === 9 ? '#FFD98A' : '#FFE196';   // warm lit glass
    ctx.fill(litPath);
    ctx.shadowColor = ORANGE;
    ctx.fillStyle = '#FFC08A';
    ctx.fill(litAccent);
    ctx.shadowBlur = 0;

    if (b.door && h > 26) {
      ctx.fillStyle = ORANGE;
      ctx.fillRect(b.x + Math.round(b.w / 2) - 7, GROUND_Y - 20, 14, 20);
    }
    if (b.canopy && b.progress === 1 && h > 40) drawCanopy(b);
  }

  /* ---------------- the Nazarban House ---------------------------------
     One building in every city is the firm's own headquarters — placed
     deterministically, standing from the first frame (Nazarban predates
     the boom), never redeveloped. It wears the same atomic-starburst mark
     in every age (the through-line of the whole toy) and a lit NAZARBAN
     nameplate, drawn as an overlay AFTER the building so it reads on top
     of whichever era skin is live. The mark and letterform take the
     current era's palette; an electron orbits the core — the thinking
     machine at work. The full pitch stays on the console (the hatch
     dossier), keeping the city itself behind glass. */

  function nazarbanPalette() {
    var s = STYLE;
    return {
      rays: s === 'cyberpunk' ? NEON_CYAN : s === 'solarpunk' ? '#3E9A63' : BRASS,
      core: s === 'cyberpunk' ? NEON_PINK : s === 'silkpunk' ? NEON_PINK : ORANGE,
      edge: s === 'cyberpunk' ? NEON_CYAN : s === 'solarpunk' ? '#3E9A63' : BRASS,
      // electric ages glow by day; brass/gaslight ages only light after dark
      alwaysGlow: (s === 'cyberpunk' || s === 'solarpunk' || s === 'silkpunk' || s === 'present' || s === 'orbital'),
      font: s === 'cyberpunk' ? '"Courier New", monospace'
        : (s === 'steampunk' || s === 'silkpunk') ? 'Georgia, serif'
        : s === 'solarpunk' ? '"Trebuchet MS", sans-serif'
        : s === 'present' ? '"Helvetica Neue", Helvetica, Arial, sans-serif'
        : s === 'cassette' ? '"Courier New", monospace'
        : 'Jost, Futura, sans-serif'
    };
  }

  function drawNazarbanSign(b, top, night, pal) {
    var word = 'NAZARBAN';
    var plateH = Math.min(15, Math.max(11, b.w * 0.15));
    var plateY = top + 9;
    var fs = plateH * 0.6;
    ctx.font = '700 ' + fs + 'px ' + pal.font;
    var hadLS = ('letterSpacing' in ctx);
    if (hadLS) ctx.letterSpacing = '1px';
    var maxw = b.w - 10;
    var tw = ctx.measureText(word).width;
    while (fs > 5 && tw > maxw) { fs -= 0.5; ctx.font = '700 ' + fs + 'px ' + pal.font; tw = ctx.measureText(word).width; }
    var plateW = Math.min(b.w - 4, tw + 12);
    var px = b.x + b.w / 2 - plateW / 2;

    ctx.fillStyle = 'rgba(6, 26, 24, 0.74)';        // dark signage plate
    ctx.fillRect(px, plateY, plateW, plateH);
    ctx.strokeStyle = pal.edge; ctx.lineWidth = 1;
    ctx.strokeRect(px + 0.5, plateY + 0.5, plateW - 1, plateH - 1);

    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (night || pal.alwaysGlow) { ctx.shadowBlur = 7; ctx.shadowColor = pal.edge; }
    ctx.fillStyle = night ? (STYLE === 'cyberpunk' ? NEON_CYAN : '#FFE196') : CREAM_HI;
    ctx.fillText(word, b.x + b.w / 2, plateY + plateH / 2 + 0.5);
    ctx.shadowBlur = 0;
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    if (hadLS) ctx.letterSpacing = '0px';
  }

  function drawNazarbanCrest(b, litLevel) {
    if (b.progress <= 0) return;
    var h = b.h * easeOutCubic(b.progress);
    var top = GROUND_Y - h;
    var lit = Math.max(0, Math.min(1, litLevel + (b.litBias || 0)));
    var night = lit > 0.5;
    var pal = nazarbanPalette();
    var cx = b.x + b.w / 2;
    var ey = top - 34;                              // emblem center, above the roof

    ctx.fillStyle = CREAM_HI;                       // chrome support mast
    ctx.fillRect(cx - 1.5, top - 16, 3, 16);

    ctx.save();                                     // the starburst — 16 alternating rays
    ctx.strokeStyle = pal.rays; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
    if (night || pal.alwaysGlow) { ctx.shadowBlur = 8; ctx.shadowColor = pal.rays; }
    ctx.beginPath();
    for (var sp = 0; sp < 16; sp++) {
      var sa = sp * Math.PI / 8;
      var sl = sp % 2 ? 7 : 14;
      ctx.moveTo(cx + Math.cos(sa) * 3.5, ey + Math.sin(sa) * 3.5);
      ctx.lineTo(cx + Math.cos(sa) * sl, ey + Math.sin(sa) * sl);
    }
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = pal.core;                       // nucleus
    ctx.beginPath(); ctx.arc(cx, ey, 4.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = CREAM_HI;
    ctx.beginPath(); ctx.arc(cx, ey, 1.8, 0, Math.PI * 2); ctx.fill();

    if (!reducedMotion.matches) {                   // one electron orbiting — the machine at work
      var ang = effT * 1.6;
      var ox = cx + Math.cos(ang) * 11, oy = ey + Math.sin(ang) * 5.5;
      ctx.save();
      if (night || pal.alwaysGlow) { ctx.shadowBlur = 6; ctx.shadowColor = pal.rays; }
      ctx.fillStyle = pal.rays;
      ctx.beginPath(); ctx.arc(ox, oy, 1.6, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    if (h > 40) drawNazarbanSign(b, top, night, pal);
  }

  /* ---------------- Googie neon signage, aircars, ringed planet ---------- */

  var SIGN_NAMES = ['COSMIC CAFE', 'STARLITE LODGE', 'ATOM CITY', 'ORBIT ROOM',
    'ROCKET DINER', 'SPUTNIK CLUB', 'GALAXY LANES', 'METEOR INN', 'THE SATELLITE',
    'LUNAR LOUNGE', 'NEON MOTOR LODGE', 'JET AGE BOWL'];
  var SIGN_COLORS = ['#3FE0D8', '#FF5A96', '#FF8A3C', '#FFC94A'];
  var SIGN_ICONS = ['atom', 'rocket', 'saucer', 'star'];
  var AIRCAR_TONES = [
    { body: '#D98A6A', accent: '#FBF3DE', glow: 'rgba(255,140,80,0.5)' },
    { body: '#7FBFC0', accent: '#FBF3DE', glow: 'rgba(63,224,216,0.5)' },
    { body: '#C29AC4', accent: '#FBF3DE', glow: 'rgba(255,90,150,0.5)' }
  ];

  function drawSignIcon(kind, x, y, r, color, lit) {
    ctx.save();
    if (lit) { ctx.shadowBlur = 6; ctx.shadowColor = color; }
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 1.3;
    if (kind === 'atom') {
      ctx.beginPath(); ctx.arc(x, y, r * 0.28, 0, Math.PI * 2); ctx.fill();
      for (var a = 0; a < 3; a++) {
        ctx.save(); ctx.translate(x, y); ctx.rotate(a * Math.PI / 3);
        ctx.beginPath(); ctx.ellipse(0, 0, r, r * 0.42, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }
    } else if (kind === 'rocket') {
      ctx.beginPath();
      ctx.moveTo(x, y - r);
      ctx.quadraticCurveTo(x + r * 0.5, y - r * 0.2, x + r * 0.4, y + r * 0.55);
      ctx.lineTo(x - r * 0.4, y + r * 0.55);
      ctx.quadraticCurveTo(x - r * 0.5, y - r * 0.2, x, y - r);
      ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x - r * 0.4, y + r * 0.25); ctx.lineTo(x - r * 0.82, y + r * 0.8); ctx.lineTo(x - r * 0.4, y + r * 0.6); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x + r * 0.4, y + r * 0.25); ctx.lineTo(x + r * 0.82, y + r * 0.8); ctx.lineTo(x + r * 0.4, y + r * 0.6); ctx.closePath(); ctx.fill();
    } else if (kind === 'saucer') {
      ctx.beginPath(); ctx.ellipse(x, y + r * 0.18, r, r * 0.34, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(x, y - r * 0.04, r * 0.44, r * 0.36, 0, Math.PI, Math.PI * 2); ctx.fill();
    } else {
      ctx.lineWidth = 1.6; ctx.lineCap = 'round';
      ctx.beginPath();
      for (var s2 = 0; s2 < 8; s2++) {
        var sa2 = s2 * Math.PI / 4, rr = s2 % 2 ? r * 0.5 : r;
        ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(sa2) * rr, y + Math.sin(sa2) * rr);
      }
      ctx.stroke(); ctx.lineCap = 'butt';
    }
    ctx.restore();
  }

  // a rooftop Googie marquee: chrome posts, dark backing, neon tube border,
  // a glowing icon and the establishment's name in neon
  function drawNeonSign(cx, roofY, bw, hash, lit) {
    var name = SIGN_NAMES[hash % SIGN_NAMES.length];
    var neon = SIGN_COLORS[(hash >> 2) % SIGN_COLORS.length];
    var icon = SIGN_ICONS[(hash >> 4) % SIGN_ICONS.length];
    var fs = Math.max(6.5, Math.min(11, (bw - 14) / (name.length * 0.6)));
    ctx.font = '700 ' + fs.toFixed(1) + 'px Jost, Futura, sans-serif';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0.4px';
    var tw = ctx.measureText(name).width;
    var ph2 = fs * 1.9, iconW = ph2 * 0.95;
    var pw2 = tw + iconW + fs * 1.3;
    var top2 = roofY - 11 - ph2;
    var lx = cx - pw2 / 2;
    ctx.fillStyle = 'rgba(158,168,172,0.9)';      // chrome support posts
    ctx.fillRect(cx - pw2 * 0.3, top2 + ph2, 2, 11);
    ctx.fillRect(cx + pw2 * 0.3 - 2, top2 + ph2, 2, 11);
    ctx.fillStyle = 'rgba(9,20,22,0.92)';         // dark backing panel
    ctx.fillRect(lx, top2, pw2, ph2);
    ctx.strokeStyle = neon; ctx.lineWidth = 1.6;  // neon tube border
    if (lit) { ctx.shadowBlur = 9; ctx.shadowColor = neon; }
    ctx.strokeRect(lx + 1.2, top2 + 1.2, pw2 - 2.4, ph2 - 2.4);
    ctx.shadowBlur = 0;
    drawSignIcon(icon, lx + iconW * 0.55 + 3, top2 + ph2 / 2, ph2 * 0.32, neon, lit);
    ctx.fillStyle = lit ? neon : 'rgba(205,214,214,0.85)';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    if (lit) { ctx.shadowBlur = 7; ctx.shadowColor = neon; }
    ctx.fillText(name, lx + iconW + 5, top2 + ph2 / 2 + 0.5);
    ctx.shadowBlur = 0;
    ctx.textBaseline = 'alphabetic';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  }

  function drawAircars(litLevel) {
    if (reducedMotion.matches) return;
    for (var i = 0; i < aircars.length; i++) {
      var ac = aircars[i];
      if (!ac.active) continue;
      var d = ac.dir;
      var x = ac.x, y = ac.y + Math.sin(effT * 1.8 + ac.lane) * 3;
      var tone = AIRCAR_TONES[ac.tone];
      if (STYLE !== 'atompunk') { drawAircarEra(STYLE, x, y, d, litLevel > 0.5); continue; }
      ctx.fillStyle = tone.glow;                  // ion trail
      ctx.globalAlpha = 0.45;
      ctx.beginPath();
      ctx.moveTo(x - d * 18, y - 2); ctx.lineTo(x - d * 52, y);
      ctx.lineTo(x - d * 18, y + 3); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = tone.body;                  // swept tail fin
      ctx.beginPath();
      ctx.moveTo(x - d * 12, y - 1); ctx.lineTo(x - d * 23, y - 12);
      ctx.lineTo(x - d * 8, y - 1); ctx.closePath(); ctx.fill();
      ctx.beginPath();                            // teardrop body
      ctx.moveTo(x + d * 25, y);
      ctx.quadraticCurveTo(x, y - 7.5, x - d * 20, y - 3);
      ctx.quadraticCurveTo(x - d * 25, y + 1, x - d * 19, y + 5.5);
      ctx.quadraticCurveTo(x, y + 7, x + d * 25, y);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = tone.accent;                // chrome belt
      ctx.fillRect(Math.min(x - d * 19, x + d * 22), y + 1.4, 41, 1.3);
      ctx.fillStyle = 'rgba(63,224,216,0.5)';     // bubble canopy
      ctx.beginPath(); ctx.ellipse(x + d * 5, y - 2.5, 8, 5, 0, Math.PI, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = CREAM_HI; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(x + d * 5, y - 2.5, 8, 5, 0, Math.PI, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = ORANGE;                     // nose light
      ctx.beginPath(); dotPath(x + d * 23, y, 1.4); ctx.fill();
      ctx.fillStyle = GLOW_CYAN;                  // underglow jets
      ctx.beginPath(); dotPath(x - d * 6, y + 5, 2); dotPath(x + d * 8, y + 5, 2); ctx.fill();
    }
  }

  // a distant ringed planet low in the night sky
  function drawPlanet(alpha) {
    if (alpha <= 0.03) return;
    var px = VIEW_W * planet.fx, py = planet.fy * SKY_K, pr = planet.r;
    ctx.globalAlpha = alpha * 0.9;
    ctx.save();
    ctx.translate(px, py); ctx.rotate(planet.tilt);
    ctx.strokeStyle = 'rgba(255,201,74,0.4)'; ctx.lineWidth = 3.2;   // ring, far half
    ctx.beginPath(); ctx.ellipse(0, 0, pr * 1.95, pr * 0.5, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    ctx.fillStyle = planet.color;                                    // body
    ctx.beginPath(); ctx.arc(px, py, pr, 0, Math.PI * 2); ctx.fill();
    ctx.save();
    ctx.beginPath(); ctx.arc(px, py, pr, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(px - pr, py - pr * 0.42, pr * 2, pr * 0.2);
    ctx.fillStyle = 'rgba(0,0,0,0.14)';
    ctx.fillRect(px - pr, py + pr * 0.12, pr * 2, pr * 0.26);
    ctx.fillStyle = 'rgba(0,0,0,0.12)';                              // soft terminator
    ctx.beginPath(); ctx.arc(px + pr * 0.55, py - pr * 0.35, pr * 0.95, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.translate(px, py); ctx.rotate(planet.tilt);
    ctx.strokeStyle = 'rgba(255,222,120,0.72)'; ctx.lineWidth = 3.2; // ring, near half over body
    ctx.beginPath(); ctx.ellipse(0, 0, pr * 1.95, pr * 0.5, 0, 0.2, Math.PI - 0.2); ctx.stroke();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function drawScene() {
    // map the logical 1600×600 space onto the backing store
    ctx.setTransform(canvas.width / VIEW_W, 0, 0, canvas.height / VIEW_H, 0, 0);

    // blend every active time-of-day by its eased weight; sun and moon
    // each render at the weighted average of their active positions
    var wSum = 0, litLevel = 0, starLevel = 0;
    var skyRgb = [0, 0, 0];
    var sunW = 0, sun = { kind: 'sun', x: 0, y: 0, r: 0, rgb: [0, 0, 0] };
    var moonW = 0, moon = { kind: 'moon', x: 0, y: 0, r: 0, rgb: [0, 0, 0] };
    var i, w, T, cel, acc;

    for (i = 0; i < 8; i++) {
      w = timeLevel[i];
      if (w <= 0.001) continue;
      T = TIMES[i];
      wSum += w;
      skyRgb[0] += T.skyRgb[0] * w;
      skyRgb[1] += T.skyRgb[1] * w;
      skyRgb[2] += T.skyRgb[2] * w;
      litLevel += T.lit * w;
      starLevel += T.star * w;
      cel = T.cel;
      acc = cel.kind === 'sun' ? sun : moon;
      if (cel.kind === 'sun') sunW += w; else moonW += w;
      acc.x += cel.x * w;
      acc.y += cel.y * w;
      acc.r += cel.r * w;
      acc.rgb[0] += cel.rgb[0] * w;
      acc.rgb[1] += cel.rgb[1] * w;
      acc.rgb[2] += cel.rgb[2] * w;
    }
    skyRgb = [skyRgb[0] / wSum, skyRgb[1] / wSum, skyRgb[2] / wSum];
    litLevel /= wSum;
    curLit = litLevel;
    starLevel /= wSum;

    // weather pulls the sky toward its tint; aurora also brings out stars
    for (var wi = 1; wi < 4; wi++) {
      if (weatherLevel[wi] > 0.001) {
        skyRgb = mixRgb(skyRgb, WEATHERS[wi].tintRgb, WEATHERS[wi].amt * weatherLevel[wi]);
      }
    }
    starLevel = Math.max(starLevel, weatherLevel[3] * 0.75);

    // totality: the eclipse pulls an uncanny dusk over the whole scene —
    // sky drops toward slate, the window lights come on, a few stars show
    var ecov = eclipseCover();
    if (ecov > 0.01) {
      skyRgb = mixRgb(skyRgb, hexToRgb('#2A3438'), ecov * 0.78);
      litLevel = Math.max(litLevel, ecov * 0.75);
      starLevel = Math.max(starLevel, (ecov - 0.6) * 1.2);
    }
    var sky = rgbStr(skyRgb);
    var skyLum = (0.299 * skyRgb[0] + 0.587 * skyRgb[1] + 0.114 * skyRgb[2]) / 255;

    // clouds sit slightly off the sky in-family: toward trim on pale
    // skies, toward cream on dark ones, and toward storm when weather
    // rolls in; smoke splits the difference
    var cloudRgb = skyLum > 0.55
      ? mixRgb(skyRgb, TRIM_RGB, 0.14)
      : mixRgb(skyRgb, CREAMHI_RGB, 0.16);
    cloudRgb = mixRgb(cloudRgb, TRIM_RGB, 0.28 * Math.max(weatherLevel[1], weatherLevel[2]));
    var cloudColor = rgbStr(cloudRgb);
    var smokeColor = rgbStr(mixRgb(skyRgb, CREAMHI_RGB, 0.5));

    ctx.fillStyle = sky;
    ctx.fillRect(-80, 0, VIEW_W + 160, VIEW_H);

    // the living camera: a slow breathing zoom anchored at the ground
    // line, plus pointer parallax — the sky drifts least, the street
    // most, so the flat poster reads as a stage with depth
    ctx.save();
    var zoom = reducedMotion.matches ? 1 : 1 + 0.02 * (0.5 + 0.5 * Math.sin(effT * 0.07)) + 0.016 * camPushSm;
    ctx.translate(VIEW_W / 2, GROUND_Y);
    ctx.scale(zoom, zoom);
    ctx.translate(-VIEW_W / 2, -GROUND_Y);

    ctx.save();                                   // ---- far sky ----
    ctx.translate(parX * 0.25, parY * 0.35);

    // dusk/dawn horizon glow — a warm low band under the cool upper sky,
    // fading orange → magenta → violet as it climbs (the Atom-City look);
    // the daytime hours keep a gentler version of the same warm horizon
    var warm = Math.min(1, timeLevel[1] + timeLevel[5] + timeLevel[6] * 0.5
                           + (timeLevel[2] + timeLevel[3] + timeLevel[4]) * 0.28);
    warm *= 1 - 0.55 * Math.max(weatherLevel[1], weatherLevel[2]);
    if (warm > 0.01) {
      var hgTop = GROUND_Y - 320 * SKY_K;
      var hg = ctx.createLinearGradient(0, GROUND_Y, 0, hgTop);
      hg.addColorStop(0, 'rgba(255, 140, 66, ' + (0.5 * warm).toFixed(3) + ')');
      hg.addColorStop(0.45, 'rgba(255, 96, 120, ' + (0.24 * warm).toFixed(3) + ')');
      hg.addColorStop(1, 'rgba(120, 80, 150, 0)');
      ctx.fillStyle = hg;
      ctx.fillRect(-80, hgTop, VIEW_W + 160, GROUND_Y - hgTop);
    }

    if (starLevel > 0.01) {
      ctx.fillStyle = CREAM_HI;
      ctx.beginPath();
      for (var s = 0; s < stars.length; s++) dotPath(stars[s].x, stars[s].y * SKY_K, stars[s].r);
      ctx.globalAlpha = 0.6 * starLevel;
      ctx.fill();
      ctx.beginPath();                              // twinkle: a shifting subset flares
      for (s = 0; s < stars.length; s++) {
        var tk = Math.sin(effT * stars[s].ts + stars[s].tw);
        if (tk > 0.62) dotPath(stars[s].x, stars[s].y * SKY_K, stars[s].r * (1.15 + tk * 0.55));
      }
      ctx.globalAlpha = 0.95 * starLevel;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    drawPlanet(starLevel);
    drawAurora(weatherLevel[3]);

    // overcast weather veils the sun/moon
    var celDim = 1 - 0.65 * Math.max(weatherLevel[1], weatherLevel[2]);

    if (sunW > 0.01) {
      drawCelestial({
        kind: 'sun',
        x: sun.x / sunW, y: sun.y / sunW, r: sun.r / sunW,
        color: rgbStr([sun.rgb[0] / sunW, sun.rgb[1] / sunW, sun.rgb[2] / sunW])
      }, (sunW / wSum) * celDim, sky);
    }
    if (moonW > 0.01) {
      drawCelestial({
        kind: 'moon',
        x: moon.x / moonW, y: moon.y / moonW, r: moon.r / moonW,
        color: rgbStr([moon.rgb[0] / moonW, moon.rgb[1] / moonW, moon.rgb[2] / moonW])
      }, (moonW / wSum) * celDim, sky);
    }

    drawRainbow();
    drawSputnik(starLevel);
    drawShootingStar(starLevel);
    drawComet(starLevel);
    drawClouds(cloudColor);
    drawStyleSky(skyLum, starLevel);
    ctx.restore();

    ctx.save();                                   // ---- high traffic ----
    ctx.translate(parX * 0.4, parY);
    drawHill(litLevel);
    drawAirship(litLevel);
    drawAircars(litLevel);
    drawJetpacks(litLevel);
    drawRegatta(litLevel);
    drawUfo();
    drawBirds(skyLum);
    ctx.restore();

    ctx.save();                                   // ---- back row ----
    ctx.translate(parX * 0.55, parY);
    drawBackRow(litLevel);
    drawTower(litLevel);
    ctx.restore();

    ctx.save();                                   // ---- the street ----
    ctx.translate(parX, parY);
    drawSearchlights(starLevel);
    for (i = 0; i < landmarks.length; i++) drawLandmark(landmarks[i], litLevel);
    drawPark(litLevel);
    drawKineticSculpture(litLevel);
    drawNotes();
    drawKite();
    drawDriveIn(litLevel);
    for (i = 0; i < city.length; i++) drawBuilding(city[i], litLevel);
    for (i = 0; i < city.length; i++) if (city[i].nazarban) drawNazarbanCrest(city[i], litLevel);
    drawFutureHouse(litLevel);
    drawTube(litLevel);
    drawLeaves();
    drawSmoke(smokeColor);
    drawStreetlamps(litLevel);
    drawFolks();
    drawRobot(litLevel);
    drawFire(litLevel);
    for (i = 0; i < city.length; i++) drawCrane(city[i]);
    drawStringLights(litLevel);
    drawDust();

    drawCars(litLevel);
    drawMilk(litLevel);
    drawParade();
    drawMonorail(litLevel);
    drawWelcome(litLevel);                        // roadside signs ride in front of the beam
    drawKiosk(litLevel);
    drawTaxi(litLevel);
    drawFireworks();

    drawRain(weatherLevel[1], skyLum);
    drawSnow(weatherLevel[2]);
    drawBolt();

    // brass horizon line over a dark ground band, echoing the console
    // trim; settled snow pales the band, rain slicks it darker
    var bandRgb = mixRgb(TRIM_RGB, CREAM_RGB, weatherLevel[2] * 0.55);
    bandRgb = mixRgb(bandRgb, DEEP_RGB, weatherLevel[1] * 0.4);
    ctx.fillStyle = rgbStr(bandRgb);
    ctx.fillRect(-80, GROUND_Y, VIEW_W + 160, VIEW_H - GROUND_Y + 26);

    drawHarbor(skyRgb, starLevel);                // the bay claims its side

    ctx.fillStyle = BRASS;                        // brass trim on land only
    var brassL = harbor && harbor.side === -1 ? harbor.shore : -80;
    var brassR = harbor && harbor.side === 1 ? harbor.shore : VIEW_W + 80;
    ctx.fillRect(brassL, GROUND_Y, brassR - brassL, 3);
    drawGroundEra(litLevel);
    drawRiver(skyRgb, starLevel);                 // the canal claims its crossing

    // wet-street reflections: lamps and doorways smear into the asphalt
    var wet = weatherLevel[1];
    if (wet > 0.02) {
      ctx.globalAlpha = wet * 0.3;
      if (streetlamps) {
        ctx.fillStyle = BRASS;
        for (var lx = 85; lx < VIEW_W; lx += 170) {
          if (lx < LAND_L + 12 || lx > LAND_R - 20) continue;
          ctx.fillRect(lx + 6, GROUND_Y + 5, 2, 24);
        }
      }
      ctx.fillStyle = ORANGE;
      for (i = 0; i < city.length; i++) {
        if (city[i].door && city[i].progress === 1) {
          ctx.fillRect(city[i].x + city[i].w / 2 - 1.5, GROUND_Y + 5, 3, 16);
        }
      }
      // raindrop rings widen and fade on the wet asphalt
      if (!reducedMotion.matches) {
        ctx.strokeStyle = CREAM_HI;
        ctx.lineWidth = 1;
        for (i = 0; i < 7; i++) {
          var rp = (effT * (0.5 + (i % 3) * 0.13) + i * 0.371) % 1;
          var rx2 = ((i * 227.3) % (VIEW_W - 80)) + 40;
          if (rx2 < LAND_L + 14 || rx2 > LAND_R - 14) continue;
          ctx.globalAlpha = wet * 0.4 * (1 - rp);
          ctx.beginPath();
          ctx.ellipse(rx2, GROUND_Y + 8 + (i % 4) * 5, 3 + rp * 13, (3 + rp * 13) * 0.32, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    }

    // engraved city-name plate on the ground band (darkens when snow
    // pales the band so it always reads)
    var plateColor = rgbStr(mixRgb(hexToRgb(BRASS), TRIM_RGB, weatherLevel[2] * 0.7));
    var bandMid = GROUND_Y + (VIEW_H - GROUND_Y) / 2 + 2;
    var plateX = LAND_L > 0 ? LAND_L + 22 : 22;
    var eF = '600 15px Jost, Futura, sans-serif', eBF = '600 13px Jost, Futura, sans-serif', eP = 'CITY OF ', eS = '☆ ', eLS = '3px', eGlow = null;
    if (STYLE === 'cyberpunk') { eF = '700 13px "Courier New", monospace'; eBF = '700 12px "Courier New", monospace'; eP = '// '; eS = '> '; eLS = '2px'; eGlow = NEON_CYAN; plateColor = NEON_CYAN; }
    else if (STYLE === 'steampunk') { eF = '600 17px Georgia, serif'; eBF = '600 14px Georgia, serif'; eP = 'Ye Towne of '; eS = '✦ '; eLS = '1px'; }
    else if (STYLE === 'solarpunk') { eF = '600 15px "Trebuchet MS", sans-serif'; eBF = '600 13px "Trebuchet MS", sans-serif'; eP = 'Commons of '; eS = '❀ '; eLS = '2px'; }
    else if (STYLE === 'silkpunk') { eF = '600 17px Georgia, serif'; eBF = '600 14px Georgia, serif'; eP = 'Port of '; eS = '✿ '; eLS = '1px'; }
    else if (STYLE === 'artdeco' || STYLE === 'decopunk') { eF = '700 15px Jost, Futura, sans-serif'; eBF = '600 13px Jost, Futura, sans-serif'; eP = 'THE CITY OF '; eS = '◆ '; eLS = '4px'; }
    else if (STYLE === 'present') { eF = '600 14px "Helvetica Neue", Helvetica, Arial, sans-serif'; eBF = '600 12px "Helvetica Neue", Helvetica, Arial, sans-serif'; eP = 'City of '; eS = '● '; eLS = '1.5px'; }
    else if (STYLE === 'cassette') { eF = '700 14px "Courier New", monospace'; eBF = '600 12px "Courier New", monospace'; eP = 'CITY OF '; eS = '■ '; eLS = '1px'; }
    else if (STYLE === 'orbital') { eF = '600 14px "Helvetica Neue", Helvetica, Arial, sans-serif'; eBF = '600 12px "Helvetica Neue", Helvetica, Arial, sans-serif'; eP = 'PORT '; eS = '▲ '; eLS = '3px'; }
    if (eGlow) { ctx.shadowBlur = 6; ctx.shadowColor = eGlow; }
    ctx.font = eF;
    if ('letterSpacing' in ctx) ctx.letterSpacing = eLS;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = plateColor;
    ctx.fillText(eP + CITY_NAME, plateX, bandMid);
    ctx.shadowBlur = 0;

    // the municipal bulletin wire, right-aligned, fading in and out
    if (bulletin.current) {
      var age = bulletin.clock - bulletin.started;
      var left = bulletin.until - bulletin.clock;
      var fade = Math.min(1, age / 0.4, left / 0.4);
      ctx.globalAlpha = Math.max(0, fade) * 0.9;
      if (eGlow) { ctx.shadowBlur = 5; ctx.shadowColor = eGlow; }
      ctx.font = eBF;
      ctx.textAlign = 'right';
      ctx.fillStyle = plateColor;
      ctx.fillText(eS + bulletin.current, LAND_R < VIEW_W ? LAND_R - 22 : VIEW_W - 22, bandMid);
      ctx.shadowBlur = 0;
      ctx.textAlign = 'left';
      ctx.globalAlpha = 1;
    }
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';

    ctx.restore();                                // street layer
    ctx.restore();                                // camera

    // the bolt's sky-wide flash is a screen effect, outside the camera
    if (lightning.t > 0 && !reducedMotion.matches) {
      ctx.fillStyle = 'rgba(242, 233, 210, ' +
        (0.14 * (lightning.t / 0.32)).toFixed(3) + ')';
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }

    drawStyleOverlay(litLevel);
    drawMail();                                   // the sister city's postcard
    drawTelecast();                               // the tube, if we're on the air
    drawTestPattern();                            // calibration card covers all
    drawEraFX();                                  // the retune rides over everything
    drawNewsreelCard();                           // the reel opens on its title
  }

  /* ---------------- loop ---------------- */

  var lastTime = 0;

  function frame(now) {
    var dt = lastTime ? Math.min(0.1, (now - lastTime) / 1000) : 0;
    lastTime = now;
    update(dt);
    if (measureFrames > 0 && fitBackingStore()) measureFrames--;
    drawScene();
    window.requestAnimationFrame(frame);
  }
  window.requestAnimationFrame(frame);

  /* ---------------- art direction: swap the whole palette ------------- */
  /* Each theme re-skins the dominant colors — buildings, windows, neon,
     accents and the eight sky palettes — and remaps every generated
     building through its palette slot so the city changes era live. */

  var THEMES = {
    atompunk:   { label: 'ATOMPUNK',   teals: ['#0F4F4B','#166A61','#0A3C39'], trim: '#082B29', brass: '#FFC94A', orange: '#FF6B3D', cream: '#FBF3DE', cyan: '#3FE0D8', pink: '#FF5A96', ground: '#E8DCC0', skies: ['#0F1230','#F4995F','#F0CBA0','#F6DEC0','#F2C592','#6E3F66','#3A2E6E','#141636'] },
    cyberpunk:  { label: 'CYBERPUNK',  teals: ['#241A3A','#38265C','#1A1230'], trim: '#0E0820', brass: '#F5E663', orange: '#FF4D6D', cream: '#E9E6FF', cyan: '#28E7F0', pink: '#FF2E88', ground: '#141026', skies: ['#080510','#2A1240','#3B1D57','#4A2A6B','#341E52','#5A1E5A','#1B1030','#0A0618'] },
    present:    { label: 'PRESENT DAY', teals: ['#26313B','#33424F','#1B2530'], trim: '#0E141A', brass: '#E8B44C', orange: '#FF7A45', cream: '#F2F0E9', cyan: '#4FD8FF', pink: '#9A8CFF', ground: '#262E36', skies: ['#0A0E16','#F0A05E','#DCE4EA','#EBF1F5','#D8E2EA','#7A5A78','#2E3A5E','#101624'] },
    cassette:   { label: 'CASSETTE',    teals: ['#4A4440','#5C554E','#37322D'], trim: '#191512', brass: '#E8B84B', orange: '#E85D2C', cream: '#EFE6D4', cyan: '#42E896', pink: '#FF4FA0', ground: '#2E2A26', skies: ['#151021','#D98A4E','#C9B896','#D8CBAA','#C2AE8C','#8A5A5E','#3A3450','#181322'] },
    orbital:    { label: 'ORBITAL',     teals: ['#1E3A54','#2A4C6E','#152A40'], trim: '#0A1624', brass: '#FFB05A', orange: '#FF6A2A', cream: '#F0F2EE', cyan: '#5AC8FF', pink: '#FF7A5A', ground: '#122032', skies: ['#060A14','#F08A4E','#A8CBE4','#C2DCEE','#96BEDC','#6A4A72','#1E2A54','#0A0E1C'] },
    steampunk:  { label: 'STEAMPUNK',  teals: ['#5A3A24','#6E4A2E','#3E2817'], trim: '#241408', brass: '#E0A94E', orange: '#C6602A', cream: '#EFE2C4', cyan: '#4FA38C', pink: '#B5713C', ground: '#8A6A44', skies: ['#1E160E','#C98A4E','#D8B27E','#E4CFA6','#D2A96E','#8A5A3C','#4A3524','#160E08'] },
    artdeco:    { label: 'ART DECO',   teals: ['#252A32','#31383F','#191D24'], trim: '#0D1015', brass: '#EFC75E', orange: '#C8553D', cream: '#F3E9CE', cyan: '#5FBFAE', pink: '#C46A86', ground: '#15181E', skies: ['#0B0F16','#E5A45C','#EED2A0','#F6E5C2','#E6C084','#6E4258','#242A44','#0E1219'] },
    dieselpunk: { label: 'DIESELPUNK', teals: ['#3E4632','#4E5A3E','#2A3022'], trim: '#161A10', brass: '#C9A24B', orange: '#D2601F', cream: '#DAD4BE', cyan: '#5E8A76', pink: '#A85E3C', ground: '#5E5A44', skies: ['#161812','#9A7A54','#B4A588','#C4BCA0','#A89878','#5E4E3E','#33362E','#101208'] },
    clockpunk:  { label: 'CLOCKPUNK',  teals: ['#333A5E','#414A7A','#242A45'], trim: '#12162B', brass: '#D8B45C', orange: '#B5763C', cream: '#F0E6CC', cyan: '#7A9AD0', pink: '#B58AA0', ground: '#2A3050', skies: ['#0F1322','#C79A6E','#D8C29A','#EADDBE','#CBB088','#6E5A80','#2E3560','#0D1120'] },
    decopunk:   { label: 'DECOPUNK',   teals: ['#2E6E8E','#3A85A8','#1F4C63'], trim: '#0F2836', brass: '#F2CE5E', orange: '#F07A3C', cream: '#F6ECD2', cyan: '#6FE0E8', pink: '#F06A9A', ground: '#173845', skies: ['#0D1826','#F0A25E','#DCE8EE','#EAF2F6','#D8E4EC','#7A5070','#2C3A66','#101A2C'] },
    solarpunk:  { label: 'SOLARPUNK',  teals: ['#2E7D4F','#3E9A63','#206A3E'], trim: '#123E28', brass: '#F2C94C', orange: '#F09A3C', cream: '#F7F3E0', cyan: '#5AC8E0', pink: '#E88AB0', ground: '#3E7A52', skies: ['#16323E','#F5B36A','#CDE8E0','#DFF2E8','#BFE0D6','#E8946A','#3A6A7A','#12303A'] },
    biopunk:    { label: 'BIOPUNK',    teals: ['#2A4A38','#38614A','#1E3428'], trim: '#0E2018', brass: '#B6E85A', orange: '#E06A4A', cream: '#E6EAD2', cyan: '#4FE0B0', pink: '#C86ACA', ground: '#243A2A', skies: ['#0E1812','#7A8A4E','#9EAE6E','#B0BE86','#8A9E5E','#4A3A5A','#22322A','#0C160F'] },
    nanopunk:   { label: 'NANOPUNK',   teals: ['#9AA4B2','#B2BCC8','#7E8896'], trim: '#3E4652', brass: '#C8D2DC', orange: '#8A7AFF', cream: '#FBFCFE', cyan: '#66E6FF', pink: '#B49AFF', ground: '#AEB6C2', skies: ['#1A2030','#C4B2D4','#E6ECF4','#F2F6FA','#DEE6F0','#8A82B4','#3E4670','#161C2E'] },
    silkpunk:   { label: 'SILKPUNK',   teals: ['#1E7A6A','#2A9684','#145A4E'], trim: '#0A342C', brass: '#E8C25A', orange: '#E24A32', cream: '#F4ECD6', cyan: '#4FD0C0', pink: '#E86A8A', ground: '#166054', skies: ['#101C20','#E0A46A','#EAD2A2','#F2E4C6','#DDBE8E','#9A4A4A','#2E4A4A','#0E181C'] }
  };

  /* ---------------- Nazarban through the ages --------------------------
     The console is the constant: a 1958 simulation unit that can render
     any age. This ERA metadata carries the museum story behind each skin
     — who Nazarban was in that age, and how it helped the city — and
     every era resolves to the same live wire: Nazarban AI, today. Read by
     the maintenance-hatch dossier (js/municitron.js), the era bulletin,
     and the postcard fine print (js/postcard.js). Keyed to THEMES ids. */

  var NAZARBAN_TODAY = {
    name: 'NAZARBAN AI',
    what: 'AI CONSULTATION & IMPLEMENTATION',
    line: 'Every age needs a thinking machine. Today the machine is AI — and it is real. Nazarban builds yours.',
    url: 'https://nazarbanai.com'
  };

  var ERAS = {
    steampunk: {
      year: '1858', age: 'THE AGE OF STEAM', tag: 'AGE OF STEAM',
      company: 'NAZARBAN ANALYTICAL WORKS',
      machine: 'THE NAZARBAN DIFFERENCE ENGINE',
      brief: 'The city drowned in ledgers no hall of clerks could keep.',
      install: 'A steam-driven analytical engine, geared straight to the census.',
      result: 'The books balanced by lamplight — and the city could plan at last.'
    },
    atompunk: {
      year: '1958', age: 'THE ATOMIC AGE', tag: 'ATOMIC AGE',
      company: 'NAZARBAN INSTRUMENT WORKS',
      machine: 'MUNICITRON M-58 — MUNICIPAL SIMULATION UNIT',
      brief: 'The city grew faster than any council could foresee.',
      install: 'The M-58 — a console that ran tomorrow before it arrived.',
      result: 'Growth planned, not guessed. The atomic city kept its nerve.'
    },
    cyberpunk: {
      year: '1999', age: 'THE WIRED AGE', tag: 'WIRED AGE',
      company: 'NAZARBAN SYSTEMS',
      machine: 'THE NAZARBAN NEURODECK',
      brief: 'The city sprawled into a network no one could see whole.',
      install: 'A neural deck wired to every sensor, ledger and light.',
      result: 'The grid answered in real time. Nothing moved unseen.'
    },
    cassette: {
      year: '1984', age: 'THE CASSETTE AGE', tag: 'CASSETTE AGE',
      company: 'NAZARBAN MICROSYSTEMS',
      machine: 'THE NAZARBAN HOME TERMINAL',
      brief: 'City hall ran on carbon paper while the arcades ran on light.',
      install: 'A beige terminal on every desk, singing to the exchange at dusk.',
      result: 'The ledgers balanced overnight. The operators kept the high score.'
    },
    present: {
      year: '2026', age: 'THE THINKING AGE', tag: 'THINKING AGE',
      company: 'NAZARBAN AI',
      machine: 'APPLIED AI — CONSULTATION & IMPLEMENTATION',
      brief: 'Every desk drowned in data; every decision waited on it.',
      install: 'A thinking machine, built to the city’s own work, beside its people.',
      result: 'The city answers before it is asked. This age is real — and open for business.'
    },
    orbital: {
      year: '2050', age: 'THE ORBITAL AGE', tag: 'ORBITAL AGE',
      company: 'NAZARBAN ORBITAL',
      machine: 'THE NAZARBAN UPLINK',
      brief: 'Half the city’s business was suddenly overhead.',
      install: 'An uplink braided into the elevator ribbon, minding both ends.',
      result: 'Ground and orbit kept one ledger. Nothing was lost between floors.'
    },
    solarpunk: {
      year: '2077', age: 'THE GREEN AGE', tag: 'GREEN AGE',
      company: 'NAZARBAN COLLECTIVE',
      machine: 'THE NAZARBAN GROVE',
      brief: 'The city had to give back more than it took.',
      install: 'A living console that balanced sun, water and green.',
      result: 'The city breathed — it powered itself and grew gardens.'
    },
    silkpunk: {
      year: '2140', age: 'THE WOVEN AGE', tag: 'WOVEN AGE',
      company: 'NAZARBAN LOOM',
      machine: 'THE NAZARBAN LOOM',
      brief: 'A city of a thousand trades, none speaking to the others.',
      install: 'A loom of silk circuitry that wove every trade to one thread.',
      result: 'The city moved as one cloth. Fortune followed the weave.'
    },

    // further ages, reachable by ?style= — same museum voice
    clockpunk: {
      year: '1580', age: 'THE AGE OF CLOCKWORK', tag: 'CLOCKWORK AGE',
      company: 'NAZARBAN HOROLOGICAL WORKS',
      machine: 'THE NAZARBAN ORRERY',
      brief: 'The city kept a hundred calendars and trusted none.',
      install: 'A clockwork orrery that reckoned every hour and tide.',
      result: 'The town ran on one true time — and the markets with it.'
    },
    artdeco: {
      year: '1928', age: 'THE GILDED AGE', tag: 'GILDED AGE',
      company: 'NAZARBAN ELECTRIC WORKS',
      machine: 'THE NAZARBAN TABULATOR',
      brief: 'A boom town outran its own paperwork.',
      install: 'A gilt electric tabulator on every clerk’s desk.',
      result: 'The ledgers closed each night. The boom kept its books.'
    },
    dieselpunk: {
      year: '1938', age: 'THE DIESEL AGE', tag: 'DIESEL AGE',
      company: 'NAZARBAN MOTOR WORKS',
      machine: 'THE NAZARBAN CALCULATOR-ENGINE',
      brief: 'Rail, freight and factory each ran on a separate clock.',
      install: 'A diesel calculator-engine timing the whole works.',
      result: 'The city moved as one shift. Nothing waited on the dock.'
    },
    decopunk: {
      year: '1939', age: 'THE STREAMLINE AGE', tag: 'STREAMLINE AGE',
      company: 'NAZARBAN STREAMLINE WORKS',
      machine: 'THE NAZARBAN WORLD-ENGINE',
      brief: 'The fair promised a future the city could not schedule.',
      install: 'A streamlined world-engine to model the years ahead.',
      result: 'Tomorrow arrived on time, for once, and to plan.'
    },
    biopunk: {
      year: '2090', age: 'THE LIVING AGE', tag: 'LIVING AGE',
      company: 'NAZARBAN BIOWORKS',
      machine: 'THE NAZARBAN CULTURED MIND',
      brief: 'The city had to heal as fast as it was built.',
      install: 'A cultured mind grown to read the city like a body.',
      result: 'The streets mended themselves. The city stayed well.'
    },
    nanopunk: {
      year: '2110', age: 'THE FINE AGE', tag: 'FINE AGE',
      company: 'NAZARBAN MOLECULAR WORKS',
      machine: 'THE NAZARBAN LATTICE',
      brief: 'The city’s work had shrunk below what any eye could watch.',
      install: 'A molecular lattice that minded the smallest machines.',
      result: 'The invisible city ran clean — and answered to a dial.'
    }
  };

  var STYLE = 'atompunk';

  /* the wire speaks the age: a small pool of era-voiced lines mixed in
     with the perennials (Wembly campaigns in every century) */
  var ERA_WIRE = {
    steampunk: [
      'BOILER INSPECTION PASSED — PRESSURE DECLARED HANDSOME',
      'GAS LAMPS TRIMMED — LAMPLIGHTER COMMENDED',
      'DIFFERENCE ENGINE CASTS THE CENSUS — CLERKS TAKE THE AIR',
      'AIRSHIP MOORING FEES UNCHANGED SINCE TUESDAY'
    ],
    clockpunk: [
      'TOWN ORRERY WOUND — ALL SPHERES ACCOUNTED FOR',
      'MARKET BELL RECAST — NOON NOW OCCURS AT NOON'
    ],
    artdeco: [
      'NEW SPIRE TOPS OUT — GILDING COMMENCES AT DAWN',
      'TABULATOR CLOSES THE LEDGERS BY TEN — CLERKS AT THE PICTURES',
      'CHROME POLISH SHORTAGE DECLARED OVER',
      'ELEVATOR RACE TO THE 40TH — HOUSE RULES APPLY'
    ],
    dieselpunk: [
      'FREIGHT YARD ON ONE CLOCK AT LAST — NOTHING WAITS ON THE DOCK',
      'CALCULATOR-ENGINE RUNS THE NIGHT SHIFT — QUIETLY'
    ],
    decopunk: [
      'THE FAIR OPENS SUNDAY — TOMORROW ON SCHEDULE',
      'WORLD-ENGINE FORECASTS: MORE OF EVERYTHING'
    ],
    cyberpunk: [
      'GRID LOAD NOMINAL — NEURODECK DREAMING IN FORTY CHANNELS',
      'RAIN FORECAST: CONTINUOUS — UMBRELLA FUTURES UP',
      'BILLBOARD PERMIT DENIED: INSUFFICIENTLY BRIGHT',
      'DIAL-UP EXCHANGE AT CAPACITY — TRY AFTER MIDNIGHT'
    ],
    present: [
      'NAZARBAN MODEL DEPLOYED AT THE PERMIT OFFICE — QUEUE CLEARED BY NOON',
      'THE THINKING MACHINE FLAGS A WATER LEAK BEFORE IT LEAKS',
      'BIKE-LANE COUNTER PASSES ONE MILLION — CAKE AT THE DEPOT',
      'CITY COUNCIL STREAMS AT SEVEN — AGENDA: EVERYTHING',
      'PARCEL DRONE RETURNS A LOST HAT — OWNER DELIGHTED'
    ],
    cassette: [
      'ARCADE HIGH SCORE STANDS — INITIALS A.O.K.',
      'HOME TERMINALS IN ONE HOUSE IN FIVE — MODEMS SING AT DUSK',
      'CASSETTE RETURNED UNREWOUND — FINE ASSESSED, LESSON TAKEN',
      'SMOG ADVISORY LIFTED BY THE EVENING BREEZE',
      'CABLE CHANNEL 34 SIGNS ON — MOSTLY WEATHER'
    ],
    orbital: [
      'CARGO POD CLEARED FOR PAD THREE — WIND WITHIN LIMITS',
      'ELEVATOR CLIMBER PASSES THE KÁRMÁN LINE — WAVE',
      'UPLINK NOMINAL — THE CITY SPEAKS TO ORBIT',
      'STATION OVERHEAD AT 21:04 — PORCH LIGHTS OFF, PLEASE',
      'RE-ENTRY SCHEDULED — EXPECT ONE POLITE BOOM'
    ],
    solarpunk: [
      'ROOFTOP HARVEST WEIGHED — SURPLUS TO THE COMMONS',
      'THE GROVE REPORTS: CITY GAVE BACK MORE THAN IT TOOK',
      'QUIET HOURS EXTENDED — THE BEES ASKED NICELY'
    ],
    biopunk: [
      'MAIN STREET RESEEDED ITSELF OVERNIGHT — CREWS STOOD DOWN',
      'CULTURED MIND REPORTS THE CITY IN GOOD HEALTH'
    ],
    nanopunk: [
      'INVISIBLE WORKS INSPECTED — NOTHING TO SEE, ALL WELL',
      'LATTICE RECOUNTS THE CENSUS TO THE LAST SOUL'
    ],
    silkpunk: [
      'THE LOOM WEAVES THE MORNING MARKETS — FORTUNE FOLLOWS',
      'LANTERN FESTIVAL MOVED UP — THE THREAD SAYS RAIN'
    ]
  };

  function glowRGBA(hex, a) { var c = hexToRgb(hex); return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }

  function applyTheme(id) {
    var th = THEMES[id]; if (!th) return;
    STYLE = id;
    if (window.MUNICITRON_CITY) window.MUNICITRON_CITY.style = id;
    var oldTeals = TEALS.slice(), oldBg = BG_TEALS.slice(), i, k, b;
    TEALS = th.teals.slice();
    TEAL_TRIM = th.trim; BRASS = th.brass; ORANGE = th.orange;
    CREAM_HI = th.cream; NEON_CYAN = th.cyan; NEON_PINK = th.pink;
    GLOW_BRASS = glowRGBA(BRASS, 0.55); GLOW_ORANGE = glowRGBA(ORANGE, 0.55);
    GLOW_CYAN = glowRGBA(NEON_CYAN, 0.5); GLOW_PINK = glowRGBA(NEON_PINK, 0.5);
    CREAM_RGB = hexToRgb(th.ground);
    TRIM_RGB = hexToRgb(TEAL_TRIM);
    CREAMHI_RGB = hexToRgb(CREAM_HI);
    BG_TEALS = [];
    for (i = 0; i < TEALS.length; i++) BG_TEALS.push(rgbStr(mixRgb(hexToRgb(TEALS[i]), CREAM_RGB, 0.32)));
    ACCENTS = [NEON_CYAN, NEON_PINK, ORANGE];
    ACC_GLOW = [GLOW_CYAN, GLOW_PINK, GLOW_ORANGE];
    ACC_BAND = [glowRGBA(NEON_CYAN, 0.55), glowRGBA(NEON_PINK, 0.55), glowRGBA(ORANGE, 0.55)];
    SIGN_COLORS = [NEON_CYAN, NEON_PINK, ORANGE, BRASS];
    FW_COLORS = id === 'present' ? [NEON_CYAN, BRASS, CREAM_HI] : id === 'cyberpunk' ? [NEON_CYAN, NEON_PINK, CREAM_HI] : id === 'solarpunk' ? [BRASS, '#3E9A63', CREAM_HI] : id === 'silkpunk' ? [ORANGE, BRASS, NEON_PINK] : [BRASS, ORANGE, CREAM_HI];
    HILL_FILL = hill ? rgbStr(mixRgb(hexToRgb(TEALS[1]), CREAM_RGB, 0.42)) : null;
    HILL_TRACK = hill ? rgbStr(mixRgb(TRIM_RGB, CREAM_RGB, 0.3)) : null;
    for (i = 0; i < TIMES.length; i++) {
      TIMES[i].sky = th.skies[i];
      TIMES[i].skyRgb = hexToRgb(th.skies[i]);
      var cel = TIMES[i].cel;
      cel.color = cel.kind === 'sun' ? (i === 1 ? ORANGE : BRASS) : CREAM_HI;
      cel.rgb = hexToRgb(cel.color);
    }
    for (i = 0; i < allBuildings.length; i++) {
      b = allBuildings[i];
      if ((k = oldTeals.indexOf(b.color)) >= 0) b.color = TEALS[k];
      else if ((k = oldBg.indexOf(b.color)) >= 0) b.color = BG_TEALS[k];
      if (b.next && (k = oldTeals.indexOf(b.next.color)) >= 0) b.next.color = TEALS[k];
    }
    if (themeBooted) eraFX.t = eraFX.dur;         // roll the retune over the swap
  }

  var STYLE_KEY = 'municitron-style';
  var _styleParams = new URLSearchParams(window.location.search);
  var styleId = _styleParams.get('style');
  if (!styleId) { try { styleId = localStorage.getItem(STYLE_KEY); } catch (e) {} }
  if (!styleId || !THEMES[styleId]) styleId = 'atompunk';
  applyTheme(styleId);
  themeBooted = true;
  (function () {
    var sel = document.getElementById('style-select');
    if (!sel) return;
    sel.value = styleId;
    sel.addEventListener('change', function () {
      var v = sel.value;
      if (!THEMES[v]) return;
      applyTheme(v);
      try { localStorage.setItem(STYLE_KEY, v); } catch (e) {}
      var era = ERAS[v];
      postBulletin(era
        ? 'NOW SIMULATING ' + era.age + ' — NAZARBAN, ' + era.year
        : 'ART DIRECTION — ' + THEMES[v].label + ' ENGAGED');
      document.dispatchEvent(new CustomEvent('municitron:era',
        { detail: { style: v, era: era || null } }));
    });
  })();

  /* ---------------- debug surface ---------------- */

  window.MUNICITRON_CITY = {
    seed: seed,
    name: CITY_NAME,
    motto: CITY_MOTTO,
    almanac: ALMANAC,
    harbor: harbor,
    hill: hill,
    river: river,
    ledger: memory,
    population: 0,
    city: city,
    bg: bgCity,
    landmarks: landmarks,
    calendar: calendar,
    months: MONTHS,
    log: dayLog,
    park: park,
    driveIn: driveIn,
    ambient: {
      monorail: monorail, sputnik: sputnik, airship: airship, cars: cars,
      birds: birds, regatta: regatta, ufo: ufo, ferry: ferry, parade: parade,
      funicular: funi, kite: kite, folks: folks, milk: milk, mail: mail
    },
    request: request,
    fx: fw,
    reducedMotion: reducedMotion,
    style: STYLE,
    eras: ERAS,
    today: NAZARBAN_TODAY
  };
  postBulletin('MUNICIPAL SIMULATION IN PROGRESS — MODEL M-58');
  if (memory && memory.prevVisit) {
    var away = Math.floor((memory.lastVisit - memory.prevVisit) / 86400000);
    if (away >= 1) {
      postBulletin('WELCOME BACK, COMMISSIONER — ' + away +
                   (away === 1 ? ' DAY' : ' DAYS') + ' SINCE LAST INSPECTION');
    }
  }
  console.info('MUNICITRON M-58 · ' + CITY_NAME + ' · seed ' + seed + ' — reproduce with ?seed=' + seed);

  // paint the very first frame synchronously so the city exists before
  // the first rAF tick — no blank canvas on a throttled or background
  // load (embeds, previews, print captures)
  fitBackingStore();
  update(1 / 60);
  drawScene();

  // service hook: step the simulation by hand (dt seconds × n frames).
  // Used by the factory for calibration captures; harmless in the field.
  window.MUNICITRON_STEP = function (dt, n) {
    for (var i = 0; i < (n || 1); i++) { update(dt || 1 / 60); }
    drawScene();
  };

  // service hook: the civil-defense drill. Rushes a rare event to the
  // front of its queue (the event still honors its own conditions —
  // eclipses need a clear noon). For technicians and the curious.
  window.MUNICITRON_DRILL = function (what) {
    if (what === 'fire') fire.timer = 0;
    else if (what === 'outage') outage.timer = 0;
    else if (what === 'eclipse') eclipse.timer = 0;
    else if (what === 'comet') comet.timer = 0;
    else return 'DRILLS: fire · outage · eclipse · comet';
  };
})();
