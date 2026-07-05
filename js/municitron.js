/* ==========================================================================
   MUNICITRON M-58 — console logic
   Nazarban Instrument Works · Est. 1958
   ========================================================================== */

(function () {
  'use strict';

  /* ---------------- state ---------------- */

  var WEATHER = ['CLEAR', 'RAIN', 'SNOW', 'AURORA'];
  var WEATHER_ANGLES = [-56, -19, 19, 56];
  var TIME_NAMES = ['MIDNIGHT', 'DAWN', 'MORNING', 'NOON', 'AFTERNOON', 'DUSK', 'EVENING', 'NIGHT'];
  var TIME_GLYPHS = ['☾', '✶', '✶', '✶', '✶', '☾', '☾', '☾'];
  var GROWTH_NAMES = ['DORMANT', 'STEADY', 'BOOM'];
  var LEVER_TOPS = [117, 63, 9];          // px, DORMANT → BOOM
  var POP_MAX = 999999;
  var KOFI_URL = 'https://ko-fi.com/municitron';   // placeholder until the owner supplies the real page

  // shareable URLs are first-class: ?seed=N&t=&w=&g= restores the scene
  var query = new URLSearchParams(window.location.search);
  function idxParam(key, count, fallback) {
    var v = parseInt(query.get(key), 10);
    return (v >= 0 && v < count) ? v : fallback;
  }

  var state = {
    weather: idxParam('w', 4, 0),
    time: idxParam('t', 8, 2),
    growth: idxParam('g', 3, 1),
    population: 0            // the city simulation broadcasts the real figure
  };

  function updateShareUrl() {
    if (!window.history || !window.history.replaceState) return;
    var seed = window.MUNICITRON_CITY && window.MUNICITRON_CITY.seed;
    if (typeof seed !== 'number') return;
    try {
      window.history.replaceState(null, '',
        '?seed=' + seed + '&t=' + state.time + '&w=' + state.weather + '&g=' + state.growth);
    } catch (err) { /* file:// and sandboxed contexts may refuse; harmless */ }
  }

  /* ---------------- dom ---------------- */

  var $ = function (id) { return document.getElementById(id); };

  var machine = $('machine');
  var weatherKnob = $('weather-knob');
  var weatherRotor = $('weather-rotor');
  var weatherReadout = $('weather-readout');
  var timeDial = $('time-dial');
  var timeGlyph = $('time-glyph');
  var timeReadout = $('time-readout');
  var leverHandle = $('lever-handle');
  var growthReadout = $('growth-readout');
  var gaugeFace = $('gauge-face');
  var gaugeNeedle = $('gauge-needle');
  var odometer = $('odometer');
  var transmit = $('transmit');
  var xmitLamp = $('xmit-lamp');
  var coinMech = $('coin-mech');
  var coinLamp = $('coin-lamp');
  var overlay = $('postcard-overlay');
  var postcardPop = $('postcard-pop');
  var postcardCity = $('postcard-city');
  var dismiss = $('postcard-dismiss');

  /* ---------------- gauge: ticks + odometer ---------------- */

  // 9 engraved tick marks, -78° … +78°
  for (var i = 0; i < 9; i++) {
    var tick = document.createElement('div');
    tick.className = 'gauge-tick';
    tick.style.transform = 'rotate(' + (-78 + i * 19.5) + 'deg) translateY(-51px)';
    gaugeFace.insertBefore(tick, gaugeFace.firstChild);
  }

  // 6 rolling digit drums, each a 0-9 strip translated vertically
  var DIGIT_H = 17;
  var strips = [];
  for (var d = 0; d < 6; d++) {
    var digit = document.createElement('div');
    digit.className = 'digit';
    var strip = document.createElement('div');
    strip.className = 'digit-strip';
    for (var n = 0; n <= 9; n++) {
      var cell = document.createElement('span');
      cell.textContent = String(n);
      strip.appendChild(cell);
    }
    digit.appendChild(strip);
    odometer.appendChild(digit);
    strips.push(strip);
  }

  function renderPopulation() {
    var padded = String(Math.floor(state.population)).padStart(6, '0');
    for (var i = 0; i < 6; i++) {
      strips[i].style.transform = 'translateY(' + (-Number(padded[i]) * DIGIT_H) + 'px)';
    }
    // town-scale sweep: one full needle revolution per 10,000 citizens
    var angle = -78 + ((state.population % 10000) / 10000) * 156;
    gaugeNeedle.style.transform = 'rotate(' + angle + 'deg)';
  }

  /* ---------------- console → city event bridge ---------------- */

  // The city simulation (js/city.js) listens for these; keep console and
  // canvas decoupled so neither reaches into the other's internals.
  function announce(channel, index, name) {
    document.dispatchEvent(new CustomEvent('municitron:' + channel, {
      detail: { index: index, name: name }
    }));
    updateShareUrl();
  }

  /* ---------------- controls ---------------- */

  function renderWeather() {
    weatherRotor.style.transform = 'rotate(' + WEATHER_ANGLES[state.weather] + 'deg)';
    weatherReadout.textContent = WEATHER[state.weather];
  }

  function renderTime() {
    timeGlyph.textContent = TIME_GLYPHS[state.time];
    timeReadout.textContent = TIME_NAMES[state.time];
  }

  function renderGrowth() {
    leverHandle.style.top = LEVER_TOPS[state.growth] + 'px';
    growthReadout.textContent = GROWTH_NAMES[state.growth];
  }

  weatherKnob.addEventListener('click', function () {
    state.weather = (state.weather + 1) % 4;
    renderWeather();
    announce('weather', state.weather, WEATHER[state.weather]);
  });

  timeDial.addEventListener('click', function () {
    state.time = (state.time + 1) % 8;
    renderTime();
    announce('time', state.time, TIME_NAMES[state.time]);
  });

  document.querySelectorAll('.lever-label').forEach(function (label) {
    label.addEventListener('click', function () {
      state.growth = Number(label.dataset.growth);
      renderGrowth();
      announce('growth', state.growth, GROWTH_NAMES[state.growth]);
    });
  });

  /* ---------------- census register (population from the city) --------- */

  document.addEventListener('municitron:population', function (e) {
    state.population = Math.min(POP_MAX, e.detail);
    renderPopulation();
  });

  // the machine salutes a commissioned landmark
  document.addEventListener('municitron:landmark', function () {
    flashLamp(xmitLamp, 'xmit', 2200);
  });

  /* ---------------- lamps ---------------- */

  var lampTimers = {};

  function flashLamp(el, key, ms) {
    el.classList.add('on', 'blink');
    clearTimeout(lampTimers[key]);
    lampTimers[key] = setTimeout(function () {
      el.classList.remove('on', 'blink');
    }, ms);
  }

  /* ---------------- transmit postcard ---------------- */

  transmit.addEventListener('click', function () {
    flashLamp(xmitLamp, 'xmit', 1400);
    postcardPop.textContent = Math.floor(state.population).toLocaleString('en-US');
    overlay.hidden = false;
    // compose + download the PNG (js/postcard.js); an edited blank wins
    var custom = postcardCity.textContent.replace(/\s+/g, ' ').trim();
    document.dispatchEvent(new CustomEvent('municitron:transmit', {
      detail: {
        name: custom || null,
        conditions: WEATHER[state.weather] + ' — ' + TIME_NAMES[state.time]
      }
    }));
  });

  dismiss.addEventListener('click', function () {
    overlay.hidden = true;
  });

  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) overlay.hidden = true;
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') overlay.hidden = true;
  });

  // keep city name only — strip pasted formatting / newlines
  postcardCity.addEventListener('input', function () {
    var text = postcardCity.textContent.replace(/\n/g, ' ');
    if (text !== postcardCity.textContent) postcardCity.textContent = text;
  });

  /* ---------------- coin slot ---------------- */

  coinMech.addEventListener('click', function () {
    flashLamp(coinLamp, 'coin', 1200);
    window.open(KOFI_URL, '_blank', 'noopener');
  });

  /* ---------------- attract mode ---------------- */
  /* After 90 idle seconds the machine strolls through the day on its
     own — a living desk toy in a background tab. Any touch of the
     console hands the wheel back. Disabled under reduced motion. */

  var lastInteraction = Date.now();
  var lastAttractStep = 0;

  function wake() { lastInteraction = Date.now(); }
  machine.addEventListener('pointerdown', wake);
  document.addEventListener('keydown', wake);

  setInterval(function () {
    var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || !overlay.hidden || document.visibilityState !== 'visible') return;
    var now = Date.now();
    if (now - lastInteraction < 90000 || now - lastAttractStep < 12000) return;
    lastAttractStep = now;
    state.time = (state.time + 1) % 8;
    renderTime();
    announce('time', state.time, TIME_NAMES[state.time]);
  }, 1000);

  /* ---------------- scale machine to viewport ---------------- */

  function fit() {
    var w = window.innerWidth || document.documentElement.clientWidth;
    var h = window.innerHeight || document.documentElement.clientHeight;
    if (!w || !h) { requestAnimationFrame(fit); return; }
    var scale = Math.min(w / 1600, h / 900);
    machine.style.transform = 'scale(' + scale + ')';
    overlay.style.transform = 'scale(' + scale + ')';
  }

  window.addEventListener('resize', fit);
  window.addEventListener('load', fit);
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(fit).observe(document.documentElement);
  }
  fit();

  /* ---------------- initial paint ---------------- */

  renderWeather();
  renderTime();
  renderGrowth();
  renderPopulation();
  announce('weather', state.weather, WEATHER[state.weather]);
  announce('time', state.time, TIME_NAMES[state.time]);
  announce('growth', state.growth, GROWTH_NAMES[state.growth]);

  // the seeded city name prefills the postcard blank; typing over it wins
  if (window.MUNICITRON_CITY && window.MUNICITRON_CITY.name && !postcardCity.textContent.trim()) {
    postcardCity.textContent = window.MUNICITRON_CITY.name;
  }
})();
