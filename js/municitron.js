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

  var state = {
    weather: 0,
    time: 2,
    growth: 1,
    population: 0            // the city simulation broadcasts the real figure
  };

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
  });

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
})();
