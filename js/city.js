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

  var TEALS      = ['#1E4744', '#235450', '#183B37'];
  var TEAL_TRIM  = '#16332F';
  var BRASS      = '#C9A227';
  var ORANGE     = '#D96F32';
  var CREAM_HI   = '#F2E9D2';
  var GLOW_BRASS = 'rgba(201, 162, 39, 0.30)';
  var GLOW_ORANGE = 'rgba(217, 111, 50, 0.32)';

  /* logical drawing space — everything renders in these coordinates and
     is mapped to the real backing store with a single setTransform */
  var VIEW_W = 1600;
  var VIEW_H = 600;
  var GROUND_Y = 552;

  /* ---------------- simulation tuning ---------------- */

  var INITIAL_BUILT   = 5;                  // buildings standing at power-on (front + back row)
  var BG_WEIGHT       = 0.3;                // back-row contribution to population
  var DENSIFY_PACE    = 1.6;                // spawn-interval multiplier for replacements
  var RAIL_Y          = 448;                // monorail beam height
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
    { sky: '#0D211E', lit: 0.55, star: 1.0,  cel: { kind: 'moon', x: 430,  y: 170, r: 38, color: CREAM_HI } },
    { sky: '#E3C9A4', lit: 0.30, star: 0.0,  cel: { kind: 'sun',  x: 300,  y: 400, r: 54, color: ORANGE   } },
    { sky: '#E8DCC0', lit: 0.50, star: 0.0,  cel: { kind: 'sun',  x: 460,  y: 210, r: 44, color: BRASS    } },
    { sky: '#F2E9D2', lit: 0.30, star: 0.0,  cel: { kind: 'sun',  x: 800,  y: 120, r: 44, color: BRASS    } },
    { sky: '#EBDDBB', lit: 0.40, star: 0.0,  cel: { kind: 'sun',  x: 1150, y: 210, r: 44, color: BRASS    } },
    { sky: '#DFB68C', lit: 0.70, star: 0.15, cel: { kind: 'moon', x: 1300, y: 400, r: 34, color: CREAM_HI } },
    { sky: '#2C4A44', lit: 0.95, star: 0.5,  cel: { kind: 'moon', x: 1240, y: 210, r: 38, color: CREAM_HI } },
    { sky: '#122B27', lit: 0.85, star: 0.9,  cel: { kind: 'moon', x: 800,  y: 140, r: 38, color: CREAM_HI } }
  ];

  /* ---------------- weather ------------------------------------------- */
  /* Indices follow the console knob: CLEAR, RAIN, SNOW, AURORA.
     `tint`/`amt` pull the current sky toward an in-family overcast,
     pale-snow, or deep-night color by that fraction at full intensity. */

  var WEATHERS = [
    { tint: null },
    { tint: '#31504A', amt: 0.35 },
    { tint: '#D5C6A2', amt: 0.45 },
    { tint: '#0D211E', amt: 0.60 }
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
    // it, a flat halo glow switches on behind the dot
    function makeWindows(bx, bw, bh) {
      var panes = [];
      var colSpace = 20, rowSpace = 24, inset = 15;
      var cols = Math.max(2, Math.floor((bw - inset * 2) / colSpace));
      var rows = Math.max(2, Math.floor((bh - inset * 2 - 8) / rowSpace));
      var gridW = (cols - 1) * colSpace;
      var gridH = (rows - 1) * rowSpace;
      var x0 = bx + Math.round((bw - gridW) / 2);
      var y0 = GROUND_Y - bh + inset + Math.round((bh - inset * 2 - gridH) / 2);
      for (var r = 0; r < rows; r++) {
        for (var c = 0; c < cols; c++) {
          if (rng() < 0.40) continue;             // no pane on this grid cell
          panes.push({
            x: x0 + c * colSpace,
            y: y0 + r * rowSpace,
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

    for (i = 0; i < lots.length; i++) lots[i].windows = makeWindows(lots[i].x, lots[i].w, lots[i].h);

    // ---- back row: shorter, narrower, lifted-teal silhouettes ----
    x = landL;
    while (true) {
      var w2 = 55 + Math.floor(rng() * 60);       // 55–114
      if (x + w2 > landR - 20) break;
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
    if (tallest.next) tallest.next.mast = true; else tallest.mast = true;

    // star field for the dark palettes
    var stars = [];
    for (i = 0; i < 46; i++) {
      stars.push({
        x: Math.floor(rng() * VIEW_W),
        y: Math.floor(rng() * (GROUND_Y - 180)),
        r: 1 + rng() * 1.2,
        a: 0.5 + rng() * 0.5
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
    var frontOrder = shuffled(lots);
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
      if (!sl.sign && (sl.next ? sl.next.h : sl.h) >= 200) {
        sl.sign = true;
        if (sl.next) sl.next.sign = true;
        signed++;
      }
    }

    return { lots: lots, bg: bg, queue: queue, densify: densify, stars: stars, landmarks: landmarks, park: park, driveIn: driveIn, harbor: harbor, hill: hill, landL: landL, landR: landR };
  }

  var plan = generatePlan();
  var city = plan.lots;
  var bgCity = plan.bg;
  var park = plan.park;
  var driveIn = plan.driveIn;
  var harbor = plan.harbor;
  var hill = plan.hill;
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
  settleLowCelestial(TIMES[1].cel);
  settleLowCelestial(TIMES[5].cel);

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

  // poster clouds: flat blob clusters that drift across every sky and
  // darken toward the console trim when weather rolls in
  var clouds = [];
  for (i = 0; i < 6; i++) {
    var puffs = [];
    var puffN = 3 + Math.floor(rng2() * 3);
    for (var pj = 0; pj < puffN; pj++) {
      puffs.push({
        dx: (pj - (puffN - 1) / 2) * 20 + (rng2() * 10 - 5),
        dy: -(rng2() * 9),
        r: 13 + rng2() * 12
      });
    }
    clouds.push({
      x: rng2() * VIEW_W,
      y: 55 + rng2() * 165,
      v: 6 + rng2() * 10,
      s: 0.8 + rng2() * 0.8,
      puffs: puffs
    });
  }

  var AURORA_RIBBONS = [
    { base: 128, amp: 30, th: 46, f: 0.0052, sp: 1.0,  color: '47,97,87',    a: 0.55 },
    { base: 178, amp: 36, th: 40, f: 0.0043, sp: 0.7,  color: '201,162,39',  a: 0.30 },
    { base: 100, amp: 24, th: 30, f: 0.0065, sp: 1.4,  color: '232,220,192', a: 0.22 }
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
  var icedLevel = 0;                              // eased harbor-freeze blend

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
  var parade = { active: false, x: 0, dir: 1 };   // Founders' Day procession
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
        y: 90 + rng6() * 160,
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
    ufo.y = 80 + rng6() * 60;
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
  var lastPointer = -100;
  window.addEventListener('pointermove', function (e) {
    var w = window.innerWidth || 1;
    parTarget = ((e.clientX / w) - 0.5) * 24;
    lastPointer = effT;
  });

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
          burstY: 100 + rng6() * 180,
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

  function postBulletin(msg) {
    if (bulletin.queue.length < 4 && bulletin.queue.indexOf(msg) === -1) {
      bulletin.queue.push(msg);
    }
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
    'MILK ROUND EXPANDS TO THE NEW DISTRICT — HORSE CONSULTED'
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
      ok: function () { return growthIndex === 0; } }
  ];

  var request = { def: null, until: 0, timer: 70 + rng5() * 60 };

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

  document.addEventListener('municitron:transmit', function () {
    postBulletin('POSTCARD TRANSMITTED — FORM PC-1 FILED');
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
    startShow(3);
  });

  // the almanac desk and the newsreel camera acknowledge their orders
  document.addEventListener('municitron:almanac', function () {
    postBulletin('MUNICIPAL ALMANAC ISSUED — FORM CA-2');
    recordFirst('almanac', 'FIRST ALMANAC CONSULTED');
  });
  document.addEventListener('municitron:newsreel', function () {
    postBulletin('NEWSREEL CAMERA ROLLING — LOOK CIVIC');
  });
  document.addEventListener('municitron:newsreel-done', function () {
    postBulletin('NEWSREEL DEVELOPED — SCREENING IN THE LOBBY');
    recordFirst('newsreel', 'FIRST NEWSREEL FILMED');
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
    for (i = 0; i < city.length; i++) {
      area += city[i].w * city[i].h * easeOutCubic(city[i].progress);
    }
    for (i = 0; i < bgCity.length; i++) {
      area += bgCity[i].w * bgCity[i].h * easeOutCubic(bgCity[i].progress) * BG_WEIGHT;
    }
    return area;
  }

  // demolition finished — the lot becomes its planned taller self
  function applyNext(b) {
    var n = b.next;
    b.h = n.h;
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
          airship.y = 130 + rng4() * 70;
          airship.x = airship.dir === 1 ? -110 : VIEW_W + 110;
        }
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

      // the harbor ferry crosses the bay on its own schedule — except in
      // the iced months, when it stays tied up until the thaw
      if (harbor) {
        var iced = calendar.month === 11 || calendar.month <= 1;
        icedLevel += ((iced ? 1 : 0) - icedLevel) * Math.min(1, dt / 2);
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
        if (sb.chimney && sb.progress === 1 && smoke.length < SMOKE_MAX) {
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
      if (effT - lastPointer > 6) parTarget = Math.sin(effT * 0.06) * 7;
      parX += (parTarget - parX) * Math.min(1, dt * 2.5);

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
          spawnFlock(bdir === 1 ? -60 : VIEW_W + 60, 140 + rng6() * 120, bdir);
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
      var gawking = fw.show > 0 || fw.sparks.length > 0;
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

      // once in a while, a falling star
      if (shoot.t > 0) shoot.t -= dt;
      else {
        shoot.timer -= dt;
        if (shoot.timer <= 0) {
          shoot.timer = 60 + rng6() * 120;
          shoot.t = 0.5;
          shoot.x = 150 + rng6() * 1150;
          shoot.y = 40 + rng6() * 120;
          shoot.dx = (rng6() < 0.5 ? -1 : 1) * (200 + rng6() * 90);
          shoot.dy = 70 + rng6() * 50;
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
      calendar.month = (calendar.month + 1) % 12;
      if (calendar.month === 0) {
        calendar.year++;
        postBulletin('A HAPPY NEW YEAR — A.D. ' + calendar.year);
        startShow(6);
      } else if (calendar.month === 6) {
        postBulletin('FOUNDERS’ DAY JULY 4 — FIREWORKS ORDERED');
        foundersTimer = MONTH_LEN * 0.2;
        if (!reducedMotion.matches && !parade.active) {
          parade.active = true;
          parade.dir = harbor ? (harbor.side === 1 ? -1 : 1) : 1;
          // harbor parades form at the quay; inland ones enter off-screen
          parade.x = parade.dir === 1
            ? (LAND_L > 0 ? LAND_L + 20 : -170)
            : (LAND_R < VIEW_W ? LAND_R - 20 : VIEW_W + 170);
          postBulletin('FOUNDERS’ DAY PARADE ON MAIN STREET — WAVE');
        }
      } else if (calendar.month === 11) {
        postBulletin('MUNICIPAL LIGHT-UP — CREWS STRINGING THE STREET');
        if (harbor) postBulletin('HARBOR ICED — FERRY SUSPENDED UNTIL THAW');
      } else if (calendar.month === 2) {
        postBulletin('PARK BLOSSOMS REPORTED — BRING A CAMERA');
        if (harbor) postBulletin('THAW REPORTED — FERRY SERVICE RESUMES');
      } else if (calendar.month === 8) {
        postBulletin('SCHOOL RESUMES — STREETS QUIET UNTIL THREE O’CLOCK');
      } else if (calendar.month === 10) {
        postBulletin('ELECTION DAY — WEMBLY vs. WEMBLY (UNOPPOSED)');
        postBulletin('WEMBLY RE-ELECTED — MANDATE: “CONTINUE”');
      }
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
      if (!bulletin.queue.length) postBulletin(nextWireLine());
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
  var ctx = canvas.getContext('2d');

  // the engraved city plate is the almanac desk: click it for Form CA-2
  function plateHit(e) {
    var rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    var lx = (e.clientX - rect.left) / rect.width * VIEW_W;
    var ly = (e.clientY - rect.top) / rect.height * VIEW_H;
    var px = LAND_L > 0 ? LAND_L + 22 : 22;
    return ly > GROUND_Y - 8 && lx > px - 12 && lx < px + 330;
  }
  canvas.addEventListener('click', function (e) {
    if (plateHit(e)) document.dispatchEvent(new CustomEvent('municitron:almanac'));
  });
  canvas.addEventListener('mousemove', function (e) {
    canvas.style.cursor = plateHit(e) ? 'pointer' : '';
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
    var dpr = window.devicePixelRatio || 1;
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

  function drawCelestial(cel, alpha, sky) {
    if (alpha <= 0.01) return;
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.fillStyle = cel.color;
    ctx.beginPath();
    ctx.arc(cel.x, cel.y, cel.r, 0, Math.PI * 2);
    ctx.fill();
    if (cel.kind === 'moon') {                    // crescent: punch with sky color
      ctx.fillStyle = sky;
      ctx.beginPath();
      ctx.arc(cel.x + cel.r * 0.38, cel.y - cel.r * 0.22, cel.r * 0.86, 0, Math.PI * 2);
      ctx.fill();
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
        var y = rb.base + Math.sin(x * rb.f + effT * rb.sp) * rb.amp
                        + Math.sin(x * rb.f * 2.3 + effT * rb.sp * 1.6) * rb.amp * 0.35;
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      for (x = VIEW_W; x >= 0; x -= 50) {
        var y2 = rb.base + rb.th
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
      ctx.lineTo(p.x - 0.22 * p.l, p.y + p.l);
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
      var sway = Math.sin(effT * p.f + p.ph) * p.amp;
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
    ctx.fillStyle = TEAL_TRIM;                    // launch platform
    ctx.fillRect(cx - 70, GROUND_Y - 10, 140, 10);
    ctx.fillStyle = '#183B37';                    // gantry mast
    ctx.fillRect(cx - 52, top + 30, 14, GROUND_Y - top - 40);
    ctx.fillStyle = BRASS;                        // gantry rungs to the ship
    for (var yy = top + 44; yy < GROUND_Y - 20; yy += 22) {
      ctx.fillRect(cx - 56, yy, 30, 2);
    }
    ctx.fillStyle = ORANGE;                       // fins
    ctx.beginPath();
    ctx.moveTo(bx - 16, GROUND_Y - 64); ctx.lineTo(bx - 34, GROUND_Y - 10); ctx.lineTo(bx - 16, GROUND_Y - 10);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(bx + 16, GROUND_Y - 64); ctx.lineTo(bx + 34, GROUND_Y - 10); ctx.lineTo(bx + 16, GROUND_Y - 10);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = CREAM_HI;                     // hull
    ctx.fillRect(bx - 16, top + 62, 32, GROUND_Y - top - 72);
    ctx.fillStyle = ORANGE;                       // nose cone
    ctx.beginPath();
    ctx.moveTo(bx - 16, top + 64);
    ctx.quadraticCurveTo(bx, top + 4, bx + 16, top + 64);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#1E4744';                    // hull band
    ctx.fillRect(bx - 16, top + 92, 32, 8);
    var dots = [];
    for (var d = 0; d < 3; d++) dots.push([bx, top + 132 + d * 36]);
    brassDots(dots, 3.5, lit);
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
      ctx.beginPath();
      ctx.moveTo(gx - 7, gy + 5);
      ctx.lineTo(gx + 7, gy + 5);
      ctx.lineTo(gx + 5, gy + 12);
      ctx.lineTo(gx - 5, gy + 12);
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
    if (!driveIn) return;
    var x = driveIn.x;
    var showing = litLevel > 0.6;
    var wheelUp = landmarks[3].progress > 0;      // the fairground took the lot

    if (!wheelUp) {
      ctx.fillStyle = TEAL_TRIM;                  // screen legs
      ctx.fillRect(x - 46, GROUND_Y - 28, 6, 28);
      ctx.fillRect(x + 40, GROUND_Y - 28, 6, 28);
      ctx.fillStyle = '#183B37';                  // screen frame
      ctx.fillRect(x - 55, GROUND_Y - 94, 110, 68);
      if (showing && !reducedMotion.matches) {    // tonight's picture
        var reel = Math.floor(effT / 2.8);
        var fields = ['#235450', ORANGE, '#1E4744', BRASS];
        ctx.globalAlpha = 0.92 + 0.08 * Math.sin(effT * 30); // projector flutter
        ctx.fillStyle = fields[((reel % 4) + 4) % 4];
        ctx.fillRect(x - 51, GROUND_Y - 90, 102, 60);
        ctx.fillStyle = fields[(((reel + 2) % 4) + 4) % 4];  // the abstract lead
        ctx.beginPath();
        ctx.arc(x - 41 + ((effT * 9) % 82), GROUND_Y - 60, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      } else {                                    // matinée-blank cream
        ctx.fillStyle = showing ? CREAM_HI : '#E8DCC0';
        ctx.fillRect(x - 51, GROUND_Y - 90, 102, 60);
      }
    }

    ctx.fillStyle = TEAL_TRIM;                    // the audience, parked
    var lot = [-38, -8, 22];
    for (var ci = 0; ci < lot.length; ci++) {
      var px = x + lot[ci];
      ctx.fillRect(px, GROUND_Y - 5, 20, 4);
      ctx.fillRect(px + 5, GROUND_Y - 8, 10, 3);
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

  // an uncommissioned plaza holds a survey billboard — the city has plans
  function drawVacantSign(x) {
    ctx.fillStyle = TEAL_TRIM;                    // posts
    ctx.fillRect(x - 20, GROUND_Y - 24, 3, 24);
    ctx.fillRect(x + 17, GROUND_Y - 24, 3, 24);
    ctx.fillStyle = CREAM_HI;                     // panel
    ctx.fillRect(x - 27, GROUND_Y - 42, 54, 20);
    ctx.save();                                   // civic caution stripes
    ctx.beginPath();
    ctx.rect(x - 27, GROUND_Y - 42, 54, 20);
    ctx.clip();
    ctx.fillStyle = ORANGE;
    for (var sx = x - 34; sx < x + 30; sx += 16) {
      ctx.beginPath();
      ctx.moveTo(sx, GROUND_Y - 22);
      ctx.lineTo(sx + 12, GROUND_Y - 42);
      ctx.lineTo(sx + 17, GROUND_Y - 42);
      ctx.lineTo(sx + 5, GROUND_Y - 22);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    ctx.strokeStyle = TEAL_TRIM;
    ctx.lineWidth = 2;
    ctx.strokeRect(x - 27, GROUND_Y - 42, 54, 20);
  }

  // commissioned landmarks reveal bottom-up behind a construction curtain
  function drawLandmark(L, litLevel) {
    // the wheel's lot is the drive-in until the day it isn't
    if (L.progress <= 0) { if (L.kind !== 'wheel') drawVacantSign(L.x); return; }
    var revealH = L.h * easeOutCubic(L.progress) + 44;   // headroom for spires
    ctx.save();
    ctx.beginPath();
    ctx.rect(L.x - 115, GROUND_Y - revealH, 230, revealH);
    ctx.clip();
    if (L.kind === 'saucer') drawSaucer(L.x, L.h, litLevel);
    else if (L.kind === 'rocket') drawRocket(L.x, L.h, litLevel);
    else if (L.kind === 'wheel') drawWheel(L.x, L.h, litLevel);
    else drawAtom(L.x, L.h, litLevel);
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
    var y = RAIL_Y - 26;
    var noseX = monorail.dir === 1 ? x + TRAIN_LEN - 12 : x + 12;
    ctx.beginPath();                              // streamlined cream body
    ctx.moveTo(x + 12, y);
    ctx.lineTo(x + TRAIN_LEN - 12, y);
    ctx.arc(x + TRAIN_LEN - 12, y + 12, 12, -Math.PI / 2, Math.PI / 2);
    ctx.lineTo(x + 12, y + 24);
    ctx.arc(x + 12, y + 12, 12, Math.PI / 2, -Math.PI / 2);
    ctx.closePath();
    ctx.fillStyle = CREAM_HI;
    ctx.fill();
    ctx.strokeStyle = TEAL_TRIM;                  // keeps it crisp on any sky
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.save();                                   // orange nose cap, clipped to the hull
    ctx.clip();
    ctx.fillStyle = ORANGE;
    ctx.beginPath(); ctx.arc(noseX, y + 12, 14, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1E4744';                    // teal beltline
    ctx.fillRect(x + 6, y + 17, TRAIN_LEN - 12, 4);
    ctx.restore();
    var dots = [];
    var wStart = monorail.dir === 1 ? x + 22 : x + 46;
    for (var w = 0; w < 5; w++) dots.push([wStart + w * 26, y + 10]);
    ctx.fillStyle = '#1E4744';                    // teal portholes by day…
    ctx.beginPath();
    for (w = 0; w < dots.length; w++) dotPath(dots[w][0], dots[w][1], 3.5);
    ctx.fill();
    if (litLevel > 0.55) brassDots(dots, 3.5, litLevel);   // …brass-lit at night
  }

  function drawCars(litLevel) {
    if (reducedMotion.matches) return;
    var parade = calendar.month === 6;            // Founders' Day pennants
    for (var i = 0; i < cars.length; i++) {
      var p = cars[i];
      if (!p.active) continue;
      var y = GROUND_Y - 7;
      var nose = p.dir === 1 ? p.x + p.len : p.x;
      var tail = p.dir === 1 ? p.x : p.x + p.len;
      var cabX = p.x + p.len * (p.dir === 1 ? 0.22 : 0.33);

      ctx.fillStyle = TEAL_TRIM;                  // body with a swept tail fin
      ctx.beginPath();
      ctx.moveTo(tail, y + 5);
      ctx.lineTo(tail, y - 3.5);                  // the fin's leading edge
      ctx.lineTo(tail + p.dir * 4, y);
      ctx.lineTo(nose - p.dir * 2, y);
      ctx.quadraticCurveTo(nose, y, nose, y + 2.5);
      ctx.lineTo(nose, y + 5);
      ctx.closePath(); ctx.fill();
      ctx.beginPath();                            // rounded cabin
      ctx.moveTo(cabX, y);
      ctx.quadraticCurveTo(cabX + p.dir * p.len * 0.1, y - 4.5, cabX + p.dir * p.len * 0.24, y - 4.5);
      ctx.quadraticCurveTo(cabX + p.dir * p.len * 0.42, y - 4.5, cabX + p.dir * p.len * 0.45, y);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = BRASS;                      // chrome rocker line
      ctx.fillRect(p.x + 2, y + 3.2, p.len - 4, 1);
      ctx.fillStyle = ORANGE;                     // tail light on the fin
      ctx.beginPath(); ctx.arc(tail, y - 2.5, 1.6, 0, Math.PI * 2); ctx.fill();
      if (litLevel > 0.55) {                      // headlight after dark
        ctx.fillStyle = CREAM_HI;
        ctx.beginPath(); ctx.arc(nose, y + 2, 1.8, 0, Math.PI * 2); ctx.fill();
      }
      if (parade) {                               // a pennant whips from the cabin
        ctx.strokeStyle = TEAL_TRIM;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cabX + p.dir * p.len * 0.2, y - 4.5);
        ctx.lineTo(cabX + p.dir * p.len * 0.2, y - 12);
        ctx.stroke();
        ctx.fillStyle = ORANGE;
        ctx.beginPath();
        ctx.moveTo(cabX + p.dir * p.len * 0.2, y - 12);
        ctx.lineTo(cabX + p.dir * p.len * 0.2 - p.dir * 6, y - 10.5);
        ctx.lineTo(cabX + p.dir * p.len * 0.2, y - 9);
        ctx.closePath(); ctx.fill();
      }
    }
  }

  // the Founders' Day procession: flag bearer, marching band, a float
  function drawParade() {
    if (!parade.active || reducedMotion.matches) return;
    var d = parade.dir;
    var hx = parade.x;
    var i, mx, bob;

    // flag bearer leads
    bob = Math.abs(Math.sin(effT * 9)) * 1.2;
    ctx.fillStyle = TEAL_TRIM;
    ctx.fillRect(hx - 2, GROUND_Y - 13 - bob, 4, 13);
    ctx.beginPath(); ctx.arc(hx, GROUND_Y - 16 - bob, 2.4, 0, Math.PI * 2); ctx.fill();
    ctx.fillRect(hx + d * 3 - 0.75, GROUND_Y - 30 - bob, 1.5, 18);
    ctx.fillStyle = ORANGE;                       // swallow-tail banner
    ctx.beginPath();
    ctx.moveTo(hx + d * 3, GROUND_Y - 30 - bob);
    ctx.lineTo(hx + d * 3 + d * 13, GROUND_Y - 27.5 - bob);
    ctx.lineTo(hx + d * 3 + d * 8, GROUND_Y - 25 - bob);
    ctx.lineTo(hx + d * 3 + d * 13, GROUND_Y - 22.5 - bob);
    ctx.lineTo(hx + d * 3, GROUND_Y - 22 - bob);
    ctx.closePath(); ctx.fill();

    // eight bandsmen in two ranks, brass in hand
    for (i = 0; i < 8; i++) {
      mx = hx - d * (20 + i * 11);
      bob = Math.abs(Math.sin(effT * 9 + i * 1.1)) * 1.2;
      ctx.fillStyle = TEAL_TRIM;
      ctx.fillRect(mx - 1.75, GROUND_Y - 11 - bob, 3.5, 11);
      ctx.beginPath(); ctx.arc(mx, GROUND_Y - 13.5 - bob, 2.2, 0, Math.PI * 2); ctx.fill();
      if (i % 2) {                                // every other man plays
        ctx.fillStyle = BRASS;
        ctx.beginPath(); ctx.arc(mx + d * 3, GROUND_Y - 9 - bob, 1.7, 0, Math.PI * 2); ctx.fill();
      }
    }

    // the float brings up the rear: orange platform, starburst standard
    var fx2 = hx - d * 130;
    ctx.fillStyle = TEAL_TRIM;                    // wheels
    ctx.beginPath();
    dotPath(fx2 - 10, GROUND_Y - 3, 3); dotPath(fx2 + 10, GROUND_Y - 3, 3);
    ctx.fill();
    ctx.fillStyle = ORANGE;                       // platform
    ctx.fillRect(fx2 - 17, GROUND_Y - 10, 34, 6);
    ctx.fillStyle = CREAM_HI;                     // bunting scallops
    ctx.beginPath();
    dotPath(fx2 - 10, GROUND_Y - 4, 3); dotPath(fx2, GROUND_Y - 4, 3); dotPath(fx2 + 10, GROUND_Y - 4, 3);
    ctx.fill();
    ctx.fillStyle = BRASS;                        // starburst standard
    ctx.fillRect(fx2 - 1, GROUND_Y - 26, 2, 16);
    ctx.strokeStyle = BRASS;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (i = 0; i < 8; i++) {
      var pa = i * Math.PI / 4;
      ctx.moveTo(fx2 + Math.cos(pa) * 2.5, GROUND_Y - 28 + Math.sin(pa) * 2.5);
      ctx.lineTo(fx2 + Math.cos(pa) * 7, GROUND_Y - 28 + Math.sin(pa) * 7);
    }
    ctx.stroke();
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
    var gawk = fw.show > 0 || fw.sparks.length > 0;   // stopped for the show
    for (var i = 0; i < folks.length; i++) {
      var p = folks[i];
      if (!p.active) continue;
      var stride = gawk ? 0 : Math.sin(effT * 9 + p.ph);
      var bob = Math.abs(stride) * 0.8;
      var y = GROUND_Y - bob;

      ctx.strokeStyle = TEAL_TRIM;                // legs mid-stride
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(p.x, y - 4);
      ctx.lineTo(p.x + stride * 2.2, y);
      ctx.moveTo(p.x, y - 4);
      ctx.lineTo(p.x - stride * 2.2, y);
      ctx.stroke();
      ctx.fillStyle = TEAL_TRIM;                  // torso + head
      ctx.fillRect(p.x - 1.6, y - 10, 3.2, 6.5);
      ctx.beginPath(); ctx.arc(p.x, y - 12, 1.9, 0, Math.PI * 2); ctx.fill();
      if (p.hat) {                                // a respectable brim
        ctx.fillRect(p.x - 3, y - 13.6, 6, 1);
        ctx.fillRect(p.x - 1.8, y - 16, 3.6, 2.6);
      }
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

    ctx.save();                                   // the diamond
    ctx.translate(kx, ky);
    ctx.rotate(Math.sin(effT * 0.9 + kite.ph) * 0.2);
    ctx.fillStyle = ORANGE;
    ctx.beginPath();
    ctx.moveTo(0, -9); ctx.lineTo(6.5, 0); ctx.lineTo(0, 11); ctx.lineTo(-6.5, 0);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = TEAL_TRIM;                  // spars
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, -9); ctx.lineTo(0, 11);
    ctx.moveTo(-6.5, 0); ctx.lineTo(6.5, 0);
    ctx.stroke();
    ctx.fillStyle = CREAM_HI;                     // tail bows
    ctx.beginPath();
    for (var tb = 1; tb <= 3; tb++) {
      dotPath(Math.sin(effT * 2.4 + tb) * 3.5, 11 + tb * 7, 1.8);
    }
    ctx.fill();
    ctx.restore();
  }

  // the bay: water in the ground band, a pier, a moored sloop, the
  // lighthouse on its rock, and the ferry when it runs
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
      ctx.fillStyle = TEAL_TRIM;                  // portholes
      ctx.beginPath();
      dotPath(ferry.x - 6, fy - 2, 1.3); dotPath(ferry.x, fy - 2, 1.3); dotPath(ferry.x + 6, fy - 2, 1.3);
      ctx.fill();
    }
  }

  // the milk truck: a cream panel van on the dawn round
  function drawMilk(litLevel) {
    if (!milk.active || reducedMotion.matches) return;
    var y = GROUND_Y - 12;
    var nose = milk.dir === 1 ? milk.x + 26 : milk.x;
    ctx.fillStyle = CREAM_HI;                     // box body
    ctx.fillRect(milk.x, y, 26, 9);
    ctx.fillStyle = '#235450';                    // roof band + windshield
    ctx.fillRect(milk.x, y - 1.5, 26, 2);
    ctx.fillRect(milk.dir === 1 ? milk.x + 20 : milk.x + 2, y + 1.5, 4, 3.5);
    ctx.fillStyle = ORANGE;                       // dairy livery stripe
    ctx.fillRect(milk.x + 2, y + 5.5, 22, 1.5);
    ctx.fillStyle = TEAL_TRIM;                    // wheels
    ctx.beginPath();
    dotPath(milk.x + 5, GROUND_Y - 2, 2.2); dotPath(milk.x + 21, GROUND_Y - 2, 2.2);
    ctx.fill();
    if (litLevel > 0.55) {                        // headlight in the half-dark
      ctx.fillStyle = CREAM_HI;
      ctx.beginPath(); ctx.arc(nose, y + 6, 1.6, 0, Math.PI * 2); ctx.fill();
    }
  }

  function drawAirship(litLevel) {
    if (!airship.active || reducedMotion.matches) return;
    var x = airship.x, y = airship.y;
    var rear = airship.dir === 1 ? x - 58 : x + 58;
    ctx.fillStyle = '#235450';                    // envelope
    ctx.beginPath(); ctx.ellipse(x, y, 64, 19, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = CREAM_HI;                     // tail fins
    ctx.fillRect(rear - 6, y - 16, 12, 12);
    ctx.fillRect(rear - 6, y + 4, 12, 12);
    ctx.fillStyle = BRASS;                        // gondola
    ctx.fillRect(x - 14, y + 17, 28, 8);
    ctx.fillStyle = TEAL_TRIM;
    ctx.beginPath();
    dotPath(x - 7, y + 21, 1.8); dotPath(x, y + 21, 1.8); dotPath(x + 7, y + 21, 1.8);
    ctx.fill();
    ctx.font = '600 10px Jost, Futura, sans-serif';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '3px';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(242, 233, 210, 0.85)';
    ctx.fillText('NAZARBAN', x, y + 1);
    ctx.textAlign = 'left';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  }

  function drawSearchlights(starLevel) {
    if (starLevel <= 0.35) return;
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
    if (!sputnik.active || reducedMotion.matches || starLevel <= 0.05) return;
    var x = -40 + sputnik.p * (VIEW_W + 80);
    var y = 84 + sputnik.p * 52;
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
      for (var j = 0; j < cl.puffs.length; j++) {
        var pf = cl.puffs[j];
        dotPath(cl.x + pf.dx * cl.s, cl.y + pf.dy * cl.s, pf.r * cl.s);
      }
      var ext = (cl.puffs.length * 11 + 14) * cl.s;
      ctx.rect(cl.x - ext, cl.y, ext * 2, 6 * cl.s);   // the flat poster base
    }
    ctx.fill();
  }

  function drawSmoke(color) {
    if (reducedMotion.matches || !smoke.length) return;
    ctx.fillStyle = color;
    for (var i = 0; i < smoke.length; i++) {
      var p = smoke[i];
      ctx.globalAlpha = Math.max(0, 0.42 * (1 - p.life / p.max));
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
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
    var y = ufo.y + Math.sin(effT * 6) * 12;
    ctx.fillStyle = GLOW_BRASS;                   // under-glow
    ctx.beginPath(); ctx.ellipse(x, y + 8, 30, 8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = CREAM_HI;                     // hull
    ctx.beginPath(); ctx.ellipse(x, y, 26, 8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#235450';                    // dome
    ctx.beginPath(); ctx.ellipse(x, y - 5, 11, 7, 0, Math.PI, 0); ctx.fill();
    ctx.fillStyle = BRASS;                        // running lights
    ctx.beginPath();
    dotPath(x - 12, y + 3, 2); dotPath(x, y + 4, 2); dotPath(x + 12, y + 3, 2);
    ctx.fill();
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

    // the fountain: teal basin, brass rim, cream water riding an arc
    var fx = park.fountain;
    ctx.fillStyle = TEAL_TRIM;
    ctx.fillRect(fx - 20, GROUND_Y - 8, 40, 8);
    ctx.fillStyle = BRASS;
    ctx.fillRect(fx - 20, GROUND_Y - 9, 40, 2);
    ctx.fillStyle = TEAL_TRIM;                    // pedestal + bowl
    ctx.fillRect(fx - 2.5, GROUND_Y - 21, 5, 13);
    ctx.beginPath(); ctx.ellipse(fx, GROUND_Y - 21, 9, 2.8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = CREAM_HI;                     // droplets on two arcs + a jet
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    for (i = 0; i < 3; i++) {
      var wt = reducedMotion.matches ? (i + 1) / 4 : ((effT * 0.55 + i / 3) % 1);
      var span = (wt * 2 - 1);                    // -1 … 1 across the arc
      var wy = GROUND_Y - 20 + wt * 11 - (1 - span * span) * 10;
      dotPath(fx - wt * 15, wy, 1.6);
      dotPath(fx + wt * 15, wy, 1.6);
      dotPath(fx, GROUND_Y - 24 - i * 6 -
        (reducedMotion.matches ? 0 : Math.sin(effT * 3 + i) * 2), 1.4);
    }
    ctx.fill();
    ctx.globalAlpha = 1;

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
    var glowing = litLevel > 0.55;
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
      ctx.fillStyle = BRASS;                      // teardrop shade
      ctx.beginPath();
      ctx.moveTo(x + 2.5, GROUND_Y - 29);
      ctx.lineTo(x + 11.5, GROUND_Y - 29);
      ctx.lineTo(x + 9.5, GROUND_Y - 24.5);
      ctx.lineTo(x + 4.5, GROUND_Y - 24.5);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = glowing ? CREAM_HI : '#235450';   // the bulb itself
      ctx.beginPath(); ctx.arc(x + 7, GROUND_Y - 24, 2, 0, Math.PI * 2); ctx.fill();
    }
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

  function drawBuilding(b, litLevel) {
    if (b.progress <= 0) return;
    var h = b.h * easeOutCubic(b.progress);
    var top = GROUND_Y - h;
    var i, wd;

    litLevel = Math.max(0, Math.min(1, litLevel + (b.litBias || 0)));

    ctx.fillStyle = b.color;
    ctx.fillRect(b.x, top, b.w, h);

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
      if (b.mast) {
        var mx = b.x + b.w / 2;
        ctx.fillStyle = BRASS;
        ctx.fillRect(mx - 1.5, top - 36, 3, 36);
        ctx.beginPath();
        ctx.arc(mx, top - 40, 4.5, 0, Math.PI * 2);
        ctx.fill();
      }
      if (b.sign && !b.mast) {                    // rooftop Googie starburst
        var sx = b.x + b.w / 2;
        var sy2 = top - 36;
        var night = litLevel > 0.55;
        ctx.fillStyle = BRASS;
        ctx.fillRect(sx - 1.5, top - 22, 3, 22);
        ctx.strokeStyle = BRASS;                  // twelve spokes, long and short
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (var sp = 0; sp < 12; sp++) {
          var sa = sp * Math.PI / 6 + Math.PI / 12;
          var sl = sp % 2 ? 9 : 16;
          ctx.moveTo(sx + Math.cos(sa) * 4, sy2 + Math.sin(sa) * 4);
          ctx.lineTo(sx + Math.cos(sa) * sl, sy2 + Math.sin(sa) * sl);
        }
        ctx.stroke();
        for (var tp = 0; tp < 12; tp += 2) {      // tip balls twinkle after dark
          var ta = tp * Math.PI / 6 + Math.PI / 12;
          var tx = sx + Math.cos(ta) * 16;
          var ty = sy2 + Math.sin(ta) * 16;
          if (night && (tp / 2 + Math.floor(effT * 2.5)) % 3 !== 0) {
            ctx.fillStyle = GLOW_BRASS;
            ctx.beginPath(); ctx.arc(tx, ty, 4.5, 0, Math.PI * 2); ctx.fill();
          }
          ctx.fillStyle = BRASS;
          ctx.beginPath(); ctx.arc(tx, ty, 2.2, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = ORANGE;                   // orange heart, cream pin
        ctx.beginPath(); ctx.arc(sx, sy2, 4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = CREAM_HI;
        ctx.beginPath(); ctx.arc(sx, sy2, 1.5, 0, Math.PI * 2); ctx.fill();
      }
    }

    // four batched passes: flat halo glows for scheduled-lit panes first,
    // then every pane's dot on top (brass, plus rare orange accents).
    // A pane whose flicker override is running shows the opposite of its
    // schedule — someone in there just hit the switch. October swaps the
    // whole city's halos to burnt orange (harvest festival custom).
    ctx.fillStyle = calendar.month === 9 ? GLOW_ORANGE : GLOW_BRASS;
    ctx.beginPath();
    for (i = 0; i < b.windows.length; i++) {
      wd = b.windows[i];
      if (wd.y < top + 6) continue;               // above the built portion
      var lit = (wd.threshold < litLevel) !== (wd.flickUntil > effT);
      if (lit && !wd.accent) dotPath(wd.x, wd.y, 7);
    }
    ctx.fill();

    ctx.fillStyle = GLOW_ORANGE;
    ctx.beginPath();
    for (i = 0; i < b.windows.length; i++) {
      wd = b.windows[i];
      if (wd.y < top + 6) continue;
      var lit2 = (wd.threshold < litLevel) !== (wd.flickUntil > effT);
      if (lit2 && wd.accent) dotPath(wd.x, wd.y, 7);
    }
    ctx.fill();

    ctx.fillStyle = BRASS;
    ctx.beginPath();
    for (i = 0; i < b.windows.length; i++) {
      wd = b.windows[i];
      if (wd.y < top + 6) continue;
      if (!wd.accent) dotPath(wd.x, wd.y, 3);
    }
    ctx.fill();

    ctx.fillStyle = ORANGE;
    ctx.beginPath();
    for (i = 0; i < b.windows.length; i++) {
      wd = b.windows[i];
      if (wd.y < top + 6) continue;
      if (wd.accent) dotPath(wd.x, wd.y, 3);
    }
    ctx.fill();

    if (b.door && h > 26) {
      ctx.fillStyle = ORANGE;
      ctx.fillRect(b.x + Math.round(b.w / 2) - 7, GROUND_Y - 20, 14, 20);
    }
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
    starLevel /= wSum;

    // weather pulls the sky toward its tint; aurora also brings out stars
    for (var wi = 1; wi < 4; wi++) {
      if (weatherLevel[wi] > 0.001) {
        skyRgb = mixRgb(skyRgb, WEATHERS[wi].tintRgb, WEATHERS[wi].amt * weatherLevel[wi]);
      }
    }
    starLevel = Math.max(starLevel, weatherLevel[3] * 0.75);
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
    var zoom = reducedMotion.matches ? 1 : 1 + 0.02 * (0.5 + 0.5 * Math.sin(effT * 0.07));
    ctx.translate(VIEW_W / 2, GROUND_Y);
    ctx.scale(zoom, zoom);
    ctx.translate(-VIEW_W / 2, -GROUND_Y);

    ctx.save();                                   // ---- far sky ----
    ctx.translate(parX * 0.25, 0);

    if (starLevel > 0.01) {
      ctx.fillStyle = CREAM_HI;
      ctx.beginPath();
      for (var s = 0; s < stars.length; s++) dotPath(stars[s].x, stars[s].y, stars[s].r);
      ctx.globalAlpha = 0.75 * starLevel;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

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
    drawClouds(cloudColor);
    ctx.restore();

    ctx.save();                                   // ---- high traffic ----
    ctx.translate(parX * 0.4, 0);
    drawHill(litLevel);
    drawAirship(litLevel);
    drawRegatta(litLevel);
    drawUfo();
    drawBirds(skyLum);
    ctx.restore();

    ctx.save();                                   // ---- back row ----
    ctx.translate(parX * 0.55, 0);
    for (i = 0; i < bgCity.length; i++) drawBuilding(bgCity[i], litLevel);
    ctx.restore();

    ctx.save();                                   // ---- the street ----
    ctx.translate(parX, 0);
    drawSearchlights(starLevel);
    for (i = 0; i < landmarks.length; i++) drawLandmark(landmarks[i], litLevel);
    drawPark(litLevel);
    drawKite();
    drawDriveIn(litLevel);
    for (i = 0; i < city.length; i++) drawBuilding(city[i], litLevel);
    drawLeaves();
    drawSmoke(smokeColor);
    drawStreetlamps(litLevel);
    drawFolks();
    for (i = 0; i < city.length; i++) drawCrane(city[i]);
    drawStringLights(litLevel);
    drawDust();

    drawCars(litLevel);
    drawMilk(litLevel);
    drawParade();
    drawMonorail(litLevel);
    drawFireworks();

    drawRain(weatherLevel[1], skyLum);
    drawSnow(weatherLevel[2]);
    drawBolt();

    // brass horizon line over a dark ground band, echoing the console
    // trim; settled snow pales the band, rain slicks it darker
    var bandRgb = mixRgb(TRIM_RGB, CREAM_RGB, weatherLevel[2] * 0.55);
    bandRgb = mixRgb(bandRgb, DEEP_RGB, weatherLevel[1] * 0.4);
    ctx.fillStyle = rgbStr(bandRgb);
    ctx.fillRect(-80, GROUND_Y, VIEW_W + 160, VIEW_H - GROUND_Y);

    drawHarbor(skyRgb, starLevel);                // the bay claims its side

    ctx.fillStyle = BRASS;                        // brass trim on land only
    var brassL = harbor && harbor.side === -1 ? harbor.shore : -80;
    var brassR = harbor && harbor.side === 1 ? harbor.shore : VIEW_W + 80;
    ctx.fillRect(brassL, GROUND_Y, brassR - brassL, 3);

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
      ctx.globalAlpha = 1;
    }

    // engraved city-name plate on the ground band (darkens when snow
    // pales the band so it always reads)
    var plateColor = rgbStr(mixRgb(hexToRgb(BRASS), TRIM_RGB, weatherLevel[2] * 0.7));
    var bandMid = GROUND_Y + (VIEW_H - GROUND_Y) / 2 + 2;
    var plateX = LAND_L > 0 ? LAND_L + 22 : 22;
    ctx.font = '600 15px Jost, Futura, sans-serif';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '3px';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = plateColor;
    ctx.fillText('CITY OF ' + CITY_NAME, plateX, bandMid);

    // the municipal bulletin wire, right-aligned, fading in and out
    if (bulletin.current) {
      var age = bulletin.clock - bulletin.started;
      var left = bulletin.until - bulletin.clock;
      var fade = Math.min(1, age / 0.4, left / 0.4);
      ctx.globalAlpha = Math.max(0, fade) * 0.9;
      ctx.font = '600 13px Jost, Futura, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillStyle = plateColor;
      ctx.fillText('☆ ' + bulletin.current, LAND_R < VIEW_W ? LAND_R - 22 : VIEW_W - 22, bandMid);
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

    drawTelecast();                               // the tube, if we're on the air
    drawTestPattern();                            // calibration card covers all
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

  /* ---------------- debug surface ---------------- */

  window.MUNICITRON_CITY = {
    seed: seed,
    name: CITY_NAME,
    motto: CITY_MOTTO,
    almanac: ALMANAC,
    harbor: harbor,
    hill: hill,
    ledger: memory,
    population: 0,
    city: city,
    bg: bgCity,
    landmarks: landmarks,
    calendar: calendar,
    park: park,
    driveIn: driveIn,
    ambient: {
      monorail: monorail, sputnik: sputnik, airship: airship, cars: cars,
      birds: birds, regatta: regatta, ufo: ufo, ferry: ferry, parade: parade,
      funicular: funi, kite: kite, folks: folks, milk: milk
    },
    request: request,
    reducedMotion: reducedMotion
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
})();
