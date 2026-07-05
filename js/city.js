/* ==========================================================================
   MUNICITRON M-58 — city renderer
   Nazarban Instrument Works · Est. 1958

   Phase 1: canvas foundation — DPR-aware backing store, mulberry32 seeded
   RNG (?seed=N reproduces a city), rAF loop, flat poster-style skyline.

   Phase 2: growth simulation — the console's GROWTH lever sets the build
   rate; buildings rise from the ground line; population derives from the
   built city and is broadcast for the census register.

   Console ↔ city contract (DOM CustomEvents on document):
   - listens  'municitron:growth'     detail {index, name}  0=DORMANT 1=STEADY 2=BOOM
   - emits    'municitron:population' detail <int>
   ========================================================================== */

(function () {
  'use strict';

  /* ---------------- palette — must stay in step with css/styles.css ---- */

  var SKY        = '#E8DCC0';
  var TEALS      = ['#1E4744', '#235450', '#183B37'];
  var TEAL_TRIM  = '#16332F';
  var BRASS      = '#C9A227';
  var ORANGE     = '#D96F32';

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

    // window dots: fixed grid per building, lit state baked in so the
    // scene is fully deterministic and cheap to redraw
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
          var roll = rng();
          if (roll < 0.42) continue;              // dark window — building shows through
          b.windows.push({
            x: x0 + c * colSpace,
            y: y0 + r * rowSpace,
            color: roll > 0.96 ? ORANGE : BRASS   // rare warm accent
          });
        }
      }
    }

    // deterministic build order (Fisher–Yates on lot indices)
    var order = [];
    for (i = 0; i < lots.length; i++) order.push(i);
    for (i = order.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = order[i]; order[i] = order[j]; order[j] = t;
    }

    return { lots: lots, order: order };
  }

  var plan = generatePlan();
  var city = plan.lots;
  var buildQueue = plan.order.slice();

  for (var k = 0; k < INITIAL_BUILT && buildQueue.length; k++) {
    city[buildQueue.shift()].progress = 1;
  }

  /* ---------------- simulation state ---------------- */

  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  var growthIndex = 1;                            // STEADY until console says otherwise
  var spawnTimer = 2.0;
  var ambientPop = 0;
  var displayedPop = -1;                          // forces first census broadcast
  var lastEmitted = -1;

  document.addEventListener('municitron:growth', function (e) {
    growthIndex = e.detail.index;
  });

  function easeOutCubic(p) {
    var q = 1 - p;
    return 1 - q * q * q;
  }

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

  function drawBuilding(b) {
    if (b.progress <= 0) return;
    var h = b.h * easeOutCubic(b.progress);
    var top = GROUND_Y - h;

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

    for (var i = 0; i < b.windows.length; i++) {
      var wd = b.windows[i];
      if (wd.y < top + 6) continue;               // above the built portion
      ctx.fillStyle = wd.color;
      ctx.beginPath();
      ctx.arc(wd.x, wd.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    if (b.door && h > 26) {
      ctx.fillStyle = ORANGE;
      ctx.fillRect(b.x + Math.round(b.w / 2) - 7, GROUND_Y - 20, 14, 20);
    }
  }

  function drawScene() {
    // map the logical 1600×600 space onto the backing store
    ctx.setTransform(canvas.width / VIEW_W, 0, 0, canvas.height / VIEW_H, 0, 0);

    ctx.fillStyle = SKY;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    for (var i = 0; i < city.length; i++) drawBuilding(city[i]);

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
