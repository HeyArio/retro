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

   Console ↔ city contract (DOM CustomEvents on document):
   - listens  'municitron:growth'     detail {index, name}  0=DORMANT 1=STEADY 2=BOOM
   - listens  'municitron:time'       detail {index, name}  0=MIDNIGHT … 7=NIGHT
   - listens  'municitron:weather'    detail {index, name}  0=CLEAR 1=RAIN 2=SNOW 3=AURORA
   - emits    'municitron:population' detail <int>
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

    // ---- front row ----
    while (true) {
      var w = 70 + Math.floor(rng() * 65);        // 70–134
      if (x + w > VIEW_W - 80) break;
      b = {
        x: x,
        w: w,
        h: 150 + Math.floor(rng() * 250),         // 150–399
        color: TEALS[Math.floor(rng() * TEALS.length)],
        cap: rng() < 0.5,                         // darker parapet slab
        door: rng() < 0.3,                        // burnt-orange door accent
        jitter: 0.6 + rng() * 0.8,                // spawn-interval variation
        progress: 0,                              // 0 pending → 1 topped out
        rising: false,
        demolishing: false,
        windows: []
      };
      lots.push(b);
      x += w + 14 + Math.floor(rng() * 24);
    }

    var shift = Math.round((VIEW_W - x + 14) / 2) + 40;
    for (i = 0; i < lots.length; i++) lots[i].x += shift;
    for (i = 0; i < lots.length; i++) lots[i].windows = makeWindows(lots[i].x, lots[i].w, lots[i].h);

    // ---- back row: shorter, narrower, lifted-teal silhouettes ----
    x = 0;
    while (true) {
      var w2 = 55 + Math.floor(rng() * 60);       // 55–114
      if (x + w2 > VIEW_W - 40) break;
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
    shift = Math.round((VIEW_W - x + 8) / 2) + 20;
    for (i = 0; i < bg.length; i++) bg[i].x += shift;

    // ---- densification: the city's second act ----
    // every short front-row lot gets a planned taller replacement; once
    // construction exhausts, replacements demolish-and-rise in order
    for (i = 0; i < lots.length; i++) {
      b = lots[i];
      if (b.h >= 300) continue;
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

    return { lots: lots, bg: bg, queue: queue, densify: densify, stars: stars };
  }

  var plan = generatePlan();
  var city = plan.lots;
  var bgCity = plan.bg;
  var allBuildings = city.concat(bgCity);
  var stars = plan.stars;
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

  var AURORA_RIBBONS = [
    { base: 128, amp: 30, th: 46, f: 0.0052, sp: 1.0,  color: '47,97,87',    a: 0.55 },
    { base: 178, amp: 36, th: 40, f: 0.0043, sp: 0.7,  color: '201,162,39',  a: 0.30 },
    { base: 100, amp: 24, th: 30, f: 0.0065, sp: 1.4,  color: '232,220,192', a: 0.22 }
  ];

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

  document.addEventListener('municitron:time', function (e) {
    timeTo = e.detail.index;
  });

  document.addEventListener('municitron:weather', function (e) {
    weatherTo = e.detail.index;
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
          next.rising = true;
          if (reducedMotion.matches) { next.progress = 1; next.rising = false; }
          spawnTimer = SPAWN_INTERVAL[growthIndex] * next.jitter;
        } else if (denseQueue.length) {           // second act: densification
          var lot = denseQueue.shift();
          if (reducedMotion.matches) { applyNext(lot); lot.progress = 1; }
          else { lot.demolishing = true; lot.rising = false; }
          spawnTimer = SPAWN_INTERVAL[growthIndex] * DENSIFY_PACE * lot.jitter;
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
    if (displayedPop < 0 || reducedMotion.matches) displayedPop = target;
    else displayedPop += (target - displayedPop) * Math.min(1, dt * 2);

    var whole = Math.floor(displayedPop);
    if (whole !== lastEmitted) {
      lastEmitted = whole;
      document.dispatchEvent(new CustomEvent('municitron:population', { detail: whole }));
    }
  }

  /* ---------------- canvas / dpr ---------------- */

  var canvas = document.getElementById('sim-canvas');
  var ctx = canvas.getContext('2d');

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

  function drawBuilding(b, litLevel) {
    if (b.progress <= 0) return;
    var h = b.h * easeOutCubic(b.progress);
    var top = GROUND_Y - h;
    var i, wd;

    ctx.fillStyle = b.color;
    ctx.fillRect(b.x, top, b.w, h);

    if (b.progress === 1) {
      if (b.cap) {
        ctx.fillStyle = TEAL_TRIM;
        ctx.fillRect(b.x - 4, top, b.w + 8, 7);
      }
      if (b.mast) {
        var mx = b.x + b.w / 2;
        ctx.fillStyle = BRASS;
        ctx.fillRect(mx - 1.5, top - 36, 3, 36);
        ctx.beginPath();
        ctx.arc(mx, top - 40, 4.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // four batched passes: flat halo glows for scheduled-lit panes first,
    // then every pane's dot on top (brass, plus rare orange accents)
    ctx.fillStyle = GLOW_BRASS;
    ctx.beginPath();
    for (i = 0; i < b.windows.length; i++) {
      wd = b.windows[i];
      if (wd.y < top + 6) continue;               // above the built portion
      if (wd.threshold < litLevel && !wd.accent) dotPath(wd.x, wd.y, 7);
    }
    ctx.fill();

    ctx.fillStyle = GLOW_ORANGE;
    ctx.beginPath();
    for (i = 0; i < b.windows.length; i++) {
      wd = b.windows[i];
      if (wd.y < top + 6) continue;
      if (wd.threshold < litLevel && wd.accent) dotPath(wd.x, wd.y, 7);
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

    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

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

    for (i = 0; i < bgCity.length; i++) drawBuilding(bgCity[i], litLevel);
    for (i = 0; i < city.length; i++) drawBuilding(city[i], litLevel);

    drawRain(weatherLevel[1], skyLum);
    drawSnow(weatherLevel[2]);

    // brass horizon line over a dark ground band, echoing the console
    // trim; settled snow pales the band while SNOW is dialed in
    ctx.fillStyle = rgbStr(mixRgb(TRIM_RGB, CREAM_RGB, weatherLevel[2] * 0.55));
    ctx.fillRect(0, GROUND_Y, VIEW_W, VIEW_H - GROUND_Y);
    ctx.fillStyle = BRASS;
    ctx.fillRect(0, GROUND_Y, VIEW_W, 3);
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

  window.MUNICITRON_CITY = { seed: seed, city: city, bg: bgCity, reducedMotion: reducedMotion };
  console.info('MUNICITRON M-58 · city seed ' + seed + ' — reproduce with ?seed=' + seed);
})();
