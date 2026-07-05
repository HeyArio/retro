/* ==========================================================================
   MUNICITRON M-58 — city renderer
   Nazarban Instrument Works · Est. 1958

   Phase 1: canvas foundation — DPR-aware backing store, mulberry32 seeded
   RNG (?seed=N reproduces a city), rAF loop, flat poster-style skyline.

   Phase 2: growth simulation — the console's GROWTH lever sets the build
   rate; buildings rise from the ground line; population derives from the
   built city and is broadcast for the census register.

   Phase 3: time of day — the TIME dial shifts the sky palette, moves a
   sun/moon disc, fades stars in, and switches window lights on and off
   per a baked per-window schedule; changes crossfade over ~1.6s.

   Console ↔ city contract (DOM CustomEvents on document):
   - listens  'municitron:growth'     detail {index, name}  0=DORMANT 1=STEADY 2=BOOM
   - listens  'municitron:time'       detail {index, name}  0=MIDNIGHT … 7=NIGHT
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
  var UNLIT      = 'rgba(13, 28, 26, 0.35)';

  /* logical drawing space — everything renders in these coordinates and
     is mapped to the real backing store with a single setTransform */
  var VIEW_W = 1600;
  var VIEW_H = 600;
  var GROUND_Y = 552;

  /* ---------------- simulation tuning ---------------- */

  var INITIAL_BUILT   = 3;                  // buildings standing at power-on
  var SPAWN_INTERVAL  = [Infinity, 5.0, 1.3]; // s between new builds, per lever
  var RISE_DURATION   = 2.6;                // s for a building to top out
  var DENSITY         = 0.4;                // people per logical px² of built mass
  var AMBIENT_RATE    = [0, 8, 60];         // people/s once lots are occupied
  var POP_MAX         = 999999;             // census register is 6 drums
  var TIME_FADE       = 1.6;                // s to crossfade a time-of-day change

  /* ---------------- time-of-day palettes ------------------------------- */
  /* Indices follow the console dial: MIDNIGHT, DAWN, MORNING, NOON,
     AFTERNOON, DUSK, EVENING, NIGHT. Skies are flat in-family tints:
     cream through burnt-orange cream into deep teal. `lit` is the
     fraction of window schedules that are on; `cel` follows the dial's
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

  /* ---------------- seeded rng ---------------- */

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  var params = new URLSearchParams(window.location.search);
  var seedParam = parseInt(params.get('seed'), 10);
  var seed = isNaN(seedParam) ? (Math.random() * 0x100000000) >>> 0 : seedParam >>> 0;
  var rng = mulberry32(seed);

  /* ---------------- color helpers ---------------- */

  function hexToRgb(hex) {
    var n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function mixColor(hexA, hexB, t) {
    var a = hexToRgb(hexA), b = hexToRgb(hexB);
    return 'rgb(' +
      Math.round(a[0] + (b[0] - a[0]) * t) + ',' +
      Math.round(a[1] + (b[1] - a[1]) * t) + ',' +
      Math.round(a[2] + (b[2] - a[2]) * t) + ')';
  }

  function easeOutCubic(p) {
    var q = 1 - p;
    return 1 - q * q * q;
  }

  function easeInOut(p) {
    return p < 0.5 ? 2 * p * p : 1 - 2 * (1 - p) * (1 - p);
  }

  /* ---------------- city plan (pure, from rng only) -------------------- */
  /* The full build-out is planned up front; the lever only controls how
     fast the plan is realized, so one seed always yields one city. The
     rng is never consumed at runtime. */

  function generatePlan() {
    var lots = [];
    var x = 0;
    var b, i;

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
        windows: []
      };
      lots.push(b);
      x += w + 14 + Math.floor(rng() * 24);
    }

    // center the row on the 1600 stage
    var shift = Math.round((VIEW_W - x + 14) / 2) + 40;
    var tallest = lots[0];
    for (i = 0; i < lots.length; i++) {
      lots[i].x += shift;
      if (lots[i].h > tallest.h) tallest = lots[i];
    }
    tallest.mast = true;                          // brass mast on the tallest

    // window dots: fixed grid per building; each window gets a baked
    // schedule threshold (lit when the time's `lit` level exceeds it)
    // and a rare warm-orange accent, so lighting is deterministic
    for (i = 0; i < lots.length; i++) {
      b = lots[i];
      var colSpace = 20, rowSpace = 24, inset = 15;
      var cols = Math.max(2, Math.floor((b.w - inset * 2) / colSpace));
      var rows = Math.max(2, Math.floor((b.h - inset * 2 - 8) / rowSpace));
      var gridW = (cols - 1) * colSpace;
      var gridH = (rows - 1) * rowSpace;
      var x0 = b.x + Math.round((b.w - gridW) / 2);
      var y0 = GROUND_Y - b.h + inset + Math.round((b.h - inset * 2 - gridH) / 2);
      for (var r = 0; r < rows; r++) {
        for (var c = 0; c < cols; c++) {
          b.windows.push({
            x: x0 + c * colSpace,
            y: y0 + r * rowSpace,
            threshold: rng(),
            accent: rng() < 0.05
          });
        }
      }
    }

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

    // deterministic build order (Fisher–Yates on lot indices)
    var order = [];
    for (i = 0; i < lots.length; i++) order.push(i);
    for (i = order.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = order[i]; order[i] = order[j]; order[j] = t;
    }

    return { lots: lots, order: order, stars: stars };
  }

  var plan = generatePlan();
  var city = plan.lots;
  var stars = plan.stars;
  var buildQueue = plan.order.slice();

  for (var k = 0; k < INITIAL_BUILT && buildQueue.length; k++) {
    city[buildQueue.shift()].progress = 1;
  }

  // the low dawn/dusk discs sit near the horizon, but the skyline is
  // seed-dependent — lift them just clear of the planned roofline under
  // them so they always peek out (still deterministic, still low)
  function settleLowCelestial(cel) {
    var roofY = GROUND_Y;
    for (var i = 0; i < city.length; i++) {
      var b = city[i];
      if (b.x < cel.x + cel.r && b.x + b.w > cel.x - cel.r) {
        roofY = Math.min(roofY, GROUND_Y - b.h);
      }
    }
    cel.y = Math.min(cel.y, roofY - cel.r * 0.35);
  }
  settleLowCelestial(TIMES[1].cel);
  settleLowCelestial(TIMES[5].cel);

  /* ---------------- simulation state ---------------- */

  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  var growthIndex = 1;                            // STEADY until console says otherwise
  var spawnTimer = 2.0;
  var ambientPop = 0;
  var displayedPop = -1;                          // forces first census broadcast
  var lastEmitted = -1;

  var timeFrom = 2;                               // MORNING, matching the console
  var timeTo = 2;
  var timeT = 1;                                  // crossfade progress 0→1

  document.addEventListener('municitron:growth', function (e) {
    growthIndex = e.detail.index;
  });

  document.addEventListener('municitron:time', function (e) {
    if (e.detail.index === timeTo) return;
    timeFrom = timeTo;
    timeTo = e.detail.index;
    timeT = reducedMotion.matches ? 1 : 0;
  });

  function builtMass() {
    var area = 0;
    for (var i = 0; i < city.length; i++) {
      area += city[i].w * city[i].h * easeOutCubic(city[i].progress);
    }
    return area;
  }

  function update(dt) {
    if (growthIndex > 0) {                        // DORMANT freezes construction
      spawnTimer -= dt;
      if (spawnTimer <= 0 && buildQueue.length) {
        var next = city[buildQueue.shift()];
        next.rising = true;
        if (reducedMotion.matches) { next.progress = 1; next.rising = false; }
        spawnTimer = SPAWN_INTERVAL[growthIndex] * next.jitter;
      }
      for (var i = 0; i < city.length; i++) {
        var b = city[i];
        if (b.rising) {
          b.progress = Math.min(1, b.progress + dt / RISE_DURATION);
          if (b.progress === 1) b.rising = false;
        }
      }
      ambientPop += AMBIENT_RATE[growthIndex] * dt;
    }

    timeT = Math.min(1, timeT + dt / TIME_FADE);

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

  function fitBackingStore() {
    var rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    var dpr = window.devicePixelRatio || 1;
    var w = Math.round(rect.width * dpr);
    var h = Math.round(rect.height * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  /* ---------------- drawing ---------------- */

  function dotPath(x, y, r) {
    ctx.moveTo(x + r, y);
    ctx.arc(x, y, r, 0, Math.PI * 2);
  }

  function drawCelestial(cel, alpha, sky) {
    if (alpha <= 0) return;
    ctx.globalAlpha = alpha;
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

    // three batched passes so hundreds of dots stay cheap: brass, accent, unlit
    ctx.fillStyle = BRASS;
    ctx.beginPath();
    for (i = 0; i < b.windows.length; i++) {
      wd = b.windows[i];
      if (wd.y < top + 6) continue;               // above the built portion
      if (wd.threshold < litLevel && !wd.accent) dotPath(wd.x, wd.y, 3);
    }
    ctx.fill();

    ctx.fillStyle = ORANGE;
    ctx.beginPath();
    for (i = 0; i < b.windows.length; i++) {
      wd = b.windows[i];
      if (wd.y < top + 6) continue;
      if (wd.threshold < litLevel && wd.accent) dotPath(wd.x, wd.y, 3);
    }
    ctx.fill();

    ctx.fillStyle = UNLIT;
    ctx.beginPath();
    for (i = 0; i < b.windows.length; i++) {
      wd = b.windows[i];
      if (wd.y < top + 6) continue;
      if (wd.threshold >= litLevel) dotPath(wd.x, wd.y, 3);
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

    var from = TIMES[timeFrom];
    var to = TIMES[timeTo];
    var t = easeInOut(timeT);

    var sky = mixColor(from.sky, to.sky, t);
    var litLevel = from.lit + (to.lit - from.lit) * t;
    var starLevel = from.star + (to.star - from.star) * t;

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

    // sun/moon: glide when the kind matches, crossfade when it changes
    if (timeFrom !== timeTo && timeT < 1 && from.cel.kind === to.cel.kind) {
      drawCelestial({
        kind: to.cel.kind,
        x: from.cel.x + (to.cel.x - from.cel.x) * t,
        y: from.cel.y + (to.cel.y - from.cel.y) * t,
        r: from.cel.r + (to.cel.r - from.cel.r) * t,
        color: mixColor(from.cel.color, to.cel.color, t)
      }, 1, sky);
    } else {
      if (timeT < 1) drawCelestial(from.cel, 1 - t, sky);
      drawCelestial(to.cel, timeT < 1 ? t : 1, sky);
    }

    for (var i = 0; i < city.length; i++) drawBuilding(city[i], litLevel);

    // brass horizon line over a dark ground band, echoing the console trim
    ctx.fillStyle = TEAL_TRIM;
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
    fitBackingStore();   // also tracks machine rescale + dpr changes
    drawScene();
    window.requestAnimationFrame(frame);
  }
  window.requestAnimationFrame(frame);

  /* ---------------- debug surface ---------------- */

  window.MUNICITRON_CITY = { seed: seed, city: city, reducedMotion: reducedMotion };
  console.info('MUNICITRON M-58 · city seed ' + seed + ' — reproduce with ?seed=' + seed);
})();
