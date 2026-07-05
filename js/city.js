/* ==========================================================================
   MUNICITRON M-58 — city renderer
   Nazarban Instrument Works · Est. 1958

   Phase 1: canvas foundation.
   - devicePixelRatio-aware backing store (canvas sits inside a CSS
     transform-scaled 1600×900 machine, so the on-screen size is
     rect × dpr, not the attribute size)
   - seeded RNG (mulberry32); ?seed=N in the URL reproduces a city
   - requestAnimationFrame loop drawing a static skyline test
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

  /* ---------------- city generation (pure, from rng only) ------------- */

  function generateCity() {
    var count = 8 + Math.floor(rng() * 3);      // 8–10 buildings
    var buildings = [];
    var totalW = 0;
    var i, b;

    for (i = 0; i < count; i++) {
      b = {
        w: 90 + Math.floor(rng() * 90),         // 90–179
        h: 150 + Math.floor(rng() * 250),       // 150–399
        gap: 20 + Math.floor(rng() * 30),       // 20–49 after this building
        color: TEALS[Math.floor(rng() * TEALS.length)],
        cap: rng() < 0.5,                       // darker parapet slab
        door: rng() < 0.3,                      // burnt-orange door accent
        windows: []
      };
      buildings.push(b);
      totalW += b.w + (i < count - 1 ? b.gap : 0);
    }

    // center the row on the 1600 stage
    var x = Math.round((VIEW_W - totalW) / 2);
    var tallest = buildings[0];
    for (i = 0; i < count; i++) {
      b = buildings[i];
      b.x = x;
      x += b.w + b.gap;
      if (b.h > tallest.h) tallest = b;
    }
    tallest.mast = true;                        // brass mast on the tallest

    // window dots: fixed grid per building, lit state baked in so the
    // scene is fully deterministic and cheap to redraw
    for (i = 0; i < count; i++) {
      b = buildings[i];
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
          if (roll < 0.42) continue;            // dark window — building shows through
          b.windows.push({
            x: x0 + c * colSpace,
            y: y0 + r * rowSpace,
            color: roll > 0.96 ? ORANGE : BRASS // rare warm accent
          });
        }
      }
    }

    return buildings;
  }

  var city = generateCity();

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
    var top = GROUND_Y - b.h;

    ctx.fillStyle = b.color;
    ctx.fillRect(b.x, top, b.w, b.h);

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

    for (var i = 0; i < b.windows.length; i++) {
      var wd = b.windows[i];
      ctx.fillStyle = wd.color;
      ctx.beginPath();
      ctx.arc(wd.x, wd.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    if (b.door) {
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

  // Static in Phase 1, but the loop is wired now so later phases only add
  // to the draw. Reduced-motion is read here for those phases; the city
  // itself always renders.
  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  function frame() {
    fitBackingStore();   // also tracks machine rescale + dpr changes
    drawScene();
    window.requestAnimationFrame(frame);
  }
  window.requestAnimationFrame(frame);

  /* ---------------- debug surface ---------------- */

  window.MUNICITRON_CITY = { seed: seed, reducedMotion: reducedMotion };
  console.info('MUNICITRON M-58 · city seed ' + seed + ' — reproduce with ?seed=' + seed);
})();
