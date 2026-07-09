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

  var booting = false;                    // the power-on self test owns the dials
  var needleBase = -78;
  var needleQuiver = 0;

  function setNeedle() {
    gaugeNeedle.style.transform = 'rotate(' + (needleBase + needleQuiver) + 'deg)';
  }

  function renderPopulation() {
    if (booting) return;
    var padded = String(Math.floor(state.population)).padStart(6, '0');
    for (var i = 0; i < 6; i++) {
      strips[i].style.transform = 'translateY(' + (-Number(padded[i]) * DIGIT_H) + 'px)';
    }
    // town-scale sweep: one full needle revolution per 10,000 citizens
    needleBase = -78 + ((state.population % 10000) / 10000) * 156;
    setNeedle();
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

  var draggingLever = false;

  function renderGrowth() {
    if (!draggingLever) leverHandle.style.top = LEVER_TOPS[state.growth] + 'px';
    growthReadout.textContent = GROWTH_NAMES[state.growth];
  }

  function setWeather(i) {
    state.weather = ((i % 4) + 4) % 4;
    renderWeather();
    announce('weather', state.weather, WEATHER[state.weather]);
  }

  function setTime(i) {
    state.time = ((i % 8) + 8) % 8;
    renderTime();
    announce('time', state.time, TIME_NAMES[state.time]);
  }

  function setGrowth(i) {
    state.growth = Math.max(0, Math.min(2, i));
    renderGrowth();
    announce('growth', state.growth, GROWTH_NAMES[state.growth]);
  }

  weatherKnob.addEventListener('click', function () { setWeather(state.weather + 1); });
  timeDial.addEventListener('click', function () { setTime(state.time + 1); });
  document.querySelectorAll('.lever-label').forEach(function (label) {
    label.addEventListener('click', function () { setGrowth(Number(label.dataset.growth)); });
  });

  // the GROWTH lever really slides: grab the handle, drag it along the
  // track, and it snaps to the nearest detent on release — the readout
  // (and the city) follow live as you cross each notch
  var leverArea = leverHandle.closest('.lever-area');

  function leverSlotAt(top) {
    var best = 0;
    for (var i = 1; i < LEVER_TOPS.length; i++) {
      if (Math.abs(top - LEVER_TOPS[i]) < Math.abs(top - LEVER_TOPS[best])) best = i;
    }
    return best;
  }

  leverHandle.addEventListener('pointerdown', function (e) {
    draggingLever = true;
    leverHandle.setPointerCapture(e.pointerId);
    leverHandle.style.transition = 'none';
    leverHandle.style.cursor = 'grabbing';
    e.preventDefault();
  });

  leverHandle.addEventListener('pointermove', function (e) {
    if (!draggingLever) return;
    var rect = leverArea.getBoundingClientRect();
    var scale = rect.height / 148;               // machine transform scale
    var top = (e.clientY - rect.top) / scale - 13;   // half the handle height
    top = Math.max(LEVER_TOPS[2], Math.min(LEVER_TOPS[0], top));
    leverHandle.style.top = top + 'px';
    var slot = leverSlotAt(top);
    if (slot !== state.growth) setGrowth(slot);  // notch by notch, live
  });

  function leverRelease() {
    if (!draggingLever) return;
    draggingLever = false;
    leverHandle.style.transition = '';
    leverHandle.style.cursor = '';
    renderGrowth();                              // snap to the detent
  }
  leverHandle.addEventListener('pointerup', leverRelease);
  leverHandle.addEventListener('pointercancel', leverRelease);

  // modern convenience: the whole console from the keyboard.
  // arrows drive TIME and GROWTH, 1-4 dial the WEATHER, P transmits a
  // postcard, M works the speaker switch — none of which collide with
  // the typed maintenance codes.
  document.addEventListener('keydown', function (e) {
    if (e.target && e.target.isContentEditable) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    switch (e.key) {
      case 'ArrowRight': setTime(state.time + 1); e.preventDefault(); break;
      case 'ArrowLeft':  setTime(state.time - 1); e.preventDefault(); break;
      case 'ArrowUp':    setGrowth(state.growth + 1); e.preventDefault(); break;
      case 'ArrowDown':  setGrowth(state.growth - 1); e.preventDefault(); break;
      case '1': case '2': case '3': case '4':
        setWeather(Number(e.key) - 1);
        break;
      case 'p': case 'P':
        if (overlay.hidden) transmit.click();
        break;
      case 'm': case 'M':
        var powerUnit = document.getElementById('power-lamp');
        if (powerUnit && powerUnit.closest) {
          var unit = powerUnit.closest('.lamp-unit');
          if (unit) unit.click();
        }
        break;
    }
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

  // the census gauge doubles as the registrar's window: once the count
  // clears 10,000 a click issues the certificate of incorporation
  gaugeFace.title = 'ISSUE CERTIFICATE OF INCORPORATION (POP. 10,000 REQUIRED)';
  gaugeFace.style.cursor = 'pointer';
  gaugeFace.addEventListener('click', function () {
    if (state.population >= 10000) {
      flashLamp(xmitLamp, 'xmit', 1400);
      var custom = postcardCity.textContent.replace(/\s+/g, ' ').trim();
      document.dispatchEvent(new CustomEvent('municitron:certificate', {
        detail: { name: custom || null, population: state.population }
      }));
    } else {
      document.dispatchEvent(new CustomEvent('municitron:certificate-denied'));
    }
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
    // the machine says thank you in its own fiction (streetlamps, a
    // small salute in the sky) — see js/city.js
    document.dispatchEvent(new CustomEvent('municitron:coin'));
    window.open(KOFI_URL, '_blank', 'noopener');
  });

  /* ---------------- newsreel camera ---------------- */
  /* The XMIT lamp doubles as the camera trigger: click it to record a
     six-second newsreel of the living city (js/newsreel.js). */

  var xmitUnit = xmitLamp && xmitLamp.closest ? xmitLamp.closest('.lamp-unit') : null;
  if (xmitUnit) {
    xmitUnit.title = 'RECORD A 6-SECOND NEWSREEL';
    xmitUnit.style.cursor = 'pointer';
    xmitUnit.addEventListener('click', function () {
      flashLamp(xmitLamp, 'xmit', 6200);
      document.dispatchEvent(new CustomEvent('municitron:newsreel'));
    });
  }

  /* ---------------- machine personality ---------------- */
  /* The M-58 is a 1958 unit and acts like one: a power-on self test
     sweeps the dials, the census needle quivers in a storm, and once
     in a while a lamp flickers — routine maintenance is scheduled. */

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  var powerLamp = $('power-lamp');

  // power-on self test: drums roll to 9s, needle sweeps, lamps settle
  if (!reduced.matches) {
    booting = true;
    setTimeout(function () {
      for (var i = 0; i < 6; i++) {
        strips[i].style.transform = 'translateY(' + (-9 * DIGIT_H) + 'px)';
      }
      needleBase = 78;
      setNeedle();
      powerLamp.classList.remove('on');
    }, 150);
    setTimeout(function () { powerLamp.classList.add('on'); }, 450);
    setTimeout(function () { powerLamp.classList.remove('on'); }, 650);
    setTimeout(function () {
      powerLamp.classList.add('on');
      booting = false;
      renderPopulation();
    }, 900);
  }

  // the needle can't quite hold steady under rain on the cabinet roof
  setInterval(function () {
    var want = (!reduced.matches && !booting && state.weather === 1)
      ? (Math.random() * 2 - 1) * 2.5 : 0;
    if (want !== needleQuiver) {
      needleQuiver = want;
      setNeedle();
    }
  }, 130);

  // valve wear: a rare, brief flicker of the POWER lamp
  setInterval(function () {
    if (reduced.matches || booting || Math.random() > 0.07) return;
    if (!powerLamp.classList.contains('on')) return;
    powerLamp.classList.remove('on');
    setTimeout(function () { powerLamp.classList.add('on'); }, 90 + Math.random() * 140);
  }, 8000);

  // typed maintenance codes: NAZARBAN summons the factory test pattern,
  // TELECAST switches KNAZ-TV on and off
  var codeBuffer = '';
  document.addEventListener('keydown', function (e) {
    if (e.target && e.target.isContentEditable) return;
    if (!e.key || e.key.length !== 1) return;
    codeBuffer = (codeBuffer + e.key.toUpperCase()).slice(-12);
    if (codeBuffer.slice(-8) === 'NAZARBAN') {
      codeBuffer = '';
      flashLamp(xmitLamp, 'xmit', 1800);
      document.dispatchEvent(new CustomEvent('municitron:testpattern'));
    } else if (codeBuffer.slice(-8) === 'TELECAST') {
      codeBuffer = '';
      flashLamp(coinLamp, 'coin', 1200);
      document.dispatchEvent(new CustomEvent('municitron:telecast'));
    } else if (codeBuffer.slice(-6) === 'LEDGER') {
      codeBuffer = '';
      flashLamp(xmitLamp, 'xmit', 1400);
      document.dispatchEvent(new CustomEvent('municitron:record'));
    }
  });

  // the odometer window is the records desk: click for Form CR-5
  odometer.title = 'ISSUE COMMISSIONER’S RECORD (FORM CR-5)';
  odometer.style.cursor = 'pointer';
  odometer.addEventListener('click', function (e) {
    e.stopPropagation();                  // the gauge behind issues certificates
    flashLamp(xmitLamp, 'xmit', 1400);
    document.dispatchEvent(new CustomEvent('municitron:record'));
  });

  /* ---------------- attract mode ---------------- */
  /* After 90 idle seconds the machine strolls through the day on its
     own — a living desk toy in a background tab. Any touch of the
     console hands the wheel back. Disabled under reduced motion. */

  var lastInteraction = Date.now();
  var lastAttractStep = 0;
  var attractOn = false;                 // the ATTRACT key skips the idle wait

  function wake() { lastInteraction = Date.now(); }
  machine.addEventListener('pointerdown', wake);
  document.addEventListener('keydown', wake);

  setInterval(function () {
    if (reduced.matches || !overlay.hidden || document.visibilityState !== 'visible') return;
    var now = Date.now();
    if (!attractOn && now - lastInteraction < 90000) return;
    if (now - lastAttractStep < 12000) return;
    lastAttractStep = now;
    setTime(state.time + 1);
    // idle skies wander too, once in a while
    if (Math.random() < 0.25) setWeather(state.weather + 1);
  }, 1000);

  /* ---------------- first-visit demonstration ---------------- */
  /* A brand-new commissioner gets a short show: the machine works its
     own dials with captions on the wire, then hands the city over.
     Any touch of the console or keyboard cancels it immediately. */

  (function () {
    var M = window.MUNICITRON_CITY;
    if (!M || !M.ledger || M.ledger.visits !== 1) return;
    if (reduced.matches) return;
    var canceled = false;
    function cancel() { canceled = true; }
    machine.addEventListener('pointerdown', cancel, { once: true });
    document.addEventListener('keydown', cancel, { once: true });
    function cap(text) {
      document.dispatchEvent(new CustomEvent('municitron:caption', { detail: text }));
    }
    [
      [5000,  function () { cap('A DEMONSTRATION, COMMISSIONER — ONE MOMENT'); }],
      [7500,  function () { cap('THE KNOB COMMANDS THE SKY'); setWeather(1); }],
      [10000, function () { setWeather(2); }],
      [12500, function () { setWeather(0); }],
      [14000, function () { cap('THE DIAL COMMANDS THE SUN'); setTime(5); }],
      [16500, function () { setTime(7); }],
      [19000, function () { setTime(2); }],
      [20500, function () { cap('THE LEVER COMMANDS PROGRESS'); setGrowth(2); }],
      [25000, function () { setGrowth(1); cap('THE REGISTER COUNTS EVERY SOUL'); }],
      [28500, function () { cap('DIAL THE ERA — NAZARBAN THROUGH THE AGES'); }],
      [31500, function () { cap('THE CITY IS YOURS — CARRY ON'); }]
    ].forEach(function (step) {
      setTimeout(function () { if (!canceled) step[1](); }, step[0]);
    });
  })();

  /* ---------------- auxiliary services rail ---------------- */
  /* Real hardware, not labelled keys: a forms dial feeding a PRINT
     button, a bank of momentary pushbuttons for the ceremonies,
     bat-handle switches, and a guarded travel desk — all driving the
     same 'municitron:*' events the city listens for. */

  function fire(channel, lamp, ms) {
    if (lamp) flashLamp(lamp, 'aux-' + channel, ms || 1400);
    document.dispatchEvent(new CustomEvent('municitron:' + channel));
  }

  // click everywhere, keyboard too on the non-button dials
  function press(id, fn) {
    var el = $(id);
    if (!el) return null;
    el.addEventListener('click', fn);
    if (el.tagName !== 'BUTTON') {
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { fn(); e.preventDefault(); }
      });
    }
    return el;
  }

  // FORMS desk: dial a document, press PRINT, the machine issues it
  var FORMS = [
    { name: 'ALMANAC', channel: 'almanac' },
    { name: 'DAY LOG', channel: 'daylog' },
    { name: 'WIRE PHOTO', channel: 'wirephoto' },
    { name: 'RECORD', channel: 'record' },
    { name: 'ALBUM', channel: 'album' }
  ];
  var FORM_ANGLES = [-58, -29, 0, 29, 58];
  var formSel = 0;
  var formsRotor = $('forms-rotor');
  var formsReadout = $('forms-readout');

  function renderForms() {
    if (formsRotor) formsRotor.style.transform = 'rotate(' + FORM_ANGLES[formSel] + 'deg)';
    if (formsReadout) formsReadout.textContent = FORMS[formSel].name;
  }
  press('forms-dial', function () { formSel = (formSel + 1) % FORMS.length; renderForms(); });
  press('forms-print', function () { fire(FORMS[formSel].channel, xmitLamp, 1800); });
  renderForms();

  // ceremonies: momentary pushbuttons. Every one blinks the XMIT lamp
  // the instant it's pressed — the machine acknowledges at once, even
  // before the effect reaches the glass
  press('push-concert', function () { fire('concert', xmitLamp, 1400); });
  press('push-parade', function () { fire('parade', xmitLamp, 1600); });
  press('push-salute', function () { fire('salute', xmitLamp, 1800); });
  press('push-whistle', function () { fire('whistle', xmitLamp, 1400); });
  press('push-newsreel', function () { fire('newsreel', xmitLamp, 6200); });

  // bat-handle switches: the handle remembers, the machine obeys
  function flip(el) {
    var on = el.getAttribute('aria-pressed') === 'true';
    el.setAttribute('aria-pressed', on ? 'false' : 'true');
    return !on;
  }

  // SPEAKER throws the same switch as the POWER lamp (js/sound.js
  // listens there); the handle follows every route to that switch,
  // including the M key and direct lamp clicks
  (function () {
    var sw = $('sw-speaker');
    var unit = powerLamp && powerLamp.closest ? powerLamp.closest('.lamp-unit') : null;
    if (!sw || !unit) return;
    unit.addEventListener('click', function () { flip(sw); });
    sw.addEventListener('click', function () { unit.click(); });
  })();

  press('sw-telecast', function () {
    flip($('sw-telecast'));
    fire('telecast', coinLamp, 1200);
  });

  press('sw-attract', function () {
    attractOn = flip($('sw-attract'));
    if (attractOn) lastAttractStep = 0;          // first stroll within a second
  });

  // TRAVEL desk: point the selector at a destination, then DEPART —
  // leaving town is a two-press affair (armed in orange, asks SURE?)
  var travelSel = 0;                              // 0 NEW TOWN · 1 SISTER CITY
  var travelReadout = $('travel-readout');
  press('travel-sel', function () {
    travelSel = flip($('travel-sel')) ? 1 : 0;
    if (travelReadout) travelReadout.textContent = travelSel ? 'SISTER CITY' : 'NEW TOWN';
  });

  (function () {
    var btn = $('travel-depart');
    var label = $('depart-label');
    if (!btn || !label) return;
    var armed = false;
    var timer = null;
    btn.addEventListener('click', function () {
      if (!armed) {
        armed = true;
        btn.classList.add('armed');
        label.textContent = 'SURE?';
        timer = setTimeout(function () {
          armed = false;
          btn.classList.remove('armed');
          label.textContent = 'DEPART';
        }, 3000);
        return;
      }
      clearTimeout(timer);
      var seed;
      if (travelSel === 1) {
        var M = window.MUNICITRON_CITY;
        if (!M || !M.almanac || typeof M.almanac.sisterSeed !== 'number') return;
        seed = M.almanac.sisterSeed;
        label.textContent = 'TUNING…';
      } else {
        seed = (Math.random() * 0x100000000) >>> 0;
        label.textContent = 'SURVEYING…';
      }
      window.location.href = '?seed=' + seed +
        '&t=' + state.time + '&w=' + state.weather + '&g=' + state.growth;
    });
  })();

  // the VOLUME knob steps LOW / STANDARD / FULL (js/sound.js listens);
  // the pointer swings between three detents like the console knobs
  (function () {
    var area = $('aux-volume');
    var rotor = $('aux-volume-rotor');
    if (!area || !rotor) return;
    var VOL_NAMES = ['LOW', 'STANDARD', 'FULL'];
    var VOL_ANGLES = [-55, 0, 55];
    var vol = 1;
    function render() {
      rotor.style.transform = 'rotate(' + VOL_ANGLES[vol] + 'deg)';
      area.title = 'SPEAKER VOLUME: ' + VOL_NAMES[vol];
    }
    function bump() {
      vol = (vol + 1) % 3;
      render();
      document.dispatchEvent(new CustomEvent('municitron:volume', { detail: vol }));
    }
    area.addEventListener('click', bump);
    area.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { bump(); e.preventDefault(); }
    });
    render();
  })();

  // the civic-calendar window reads the city's own months (16 real
  // seconds each; a light poll is plenty) — and it's a dial too:
  // clicking it turns the month early, customs and all
  (function () {
    var win = $('aux-season');
    if (!win) return;
    function refresh() {
      var M = window.MUNICITRON_CITY;
      if (!M || !M.calendar || !M.months) return;
      var text = M.months[M.calendar.month] + ' ' + M.calendar.year;
      if (win.textContent !== text) win.textContent = text;
    }
    win.addEventListener('click', function () {
      document.dispatchEvent(new CustomEvent('municitron:season'));
      refresh();
    });
    refresh();
    setInterval(refresh, 1000);
  })();

  // the maintenance hatch: the machine's own diagnostics, read straight
  // off the municipal ledger — a plate you unscrew, not a menu
  (function () {
    var hatch = $('hatch-overlay');
    var rows = $('hatch-rows');
    var key = $('aux-hatch');
    var close = $('hatch-close');
    if (!hatch || !rows || !key || !close) return;
    var shiftStart = Date.now();

    function fmtDate(ms) {
      try {
        return new Date(ms).toLocaleDateString('en-US',
          { year: 'numeric', month: 'short', day: 'numeric' }).toUpperCase();
      } catch (err) { return '—'; }
    }

    function citiesGoverned() {
      var n = 0;
      try {
        for (var i = 0; i < localStorage.length; i++) {
          if (localStorage.key(i).indexOf('municitron-m58-city-') === 0) n++;
        }
      } catch (err) {}
      return Math.max(1, n);
    }

    function fill() {
      var M = window.MUNICITRON_CITY || {};
      var L = M.ledger || {};
      var t = L.tally || {};
      var up = Math.floor((Date.now() - shiftStart) / 1000);
      var pairs = [
        ['SERIAL Nº', typeof M.seed === 'number' ? String(M.seed) : '—'],
        ['CURRENT POST', 'CITY OF ' + (M.name || 'UNKNOWN')],
        ['COMMISSIONED', L.firstVisit ? fmtDate(L.firstVisit) : '—'],
        ['INSPECTIONS LOGGED', String(L.visits || 1)],
        ['CITIES GOVERNED', String(citiesGoverned())],
        ['POSTCARDS TRANSMITTED', String(t.postcards || 0)],
        ['COINS RECEIVED', String(t.coins || 0)],
        ['NEWSREELS FILMED', String(t.newsreels || 0)],
        ['PARADES ORDERED', String(t.parades || 0)],
        ['REQUESTS HONORED', String(L.gratitude || 0)],
        ['UPTIME THIS SHIFT', Math.floor(up / 60) + 'M ' + (up % 60) + 'S']
      ];
      rows.innerHTML = '';
      for (var i = 0; i < pairs.length; i++) {
        var row = document.createElement('dl');
        row.className = 'hatch-row';
        var dt = document.createElement('dt');
        dt.textContent = pairs[i][0];
        var dd = document.createElement('dd');
        dd.textContent = pairs[i][1];
        row.appendChild(dt);
        row.appendChild(dd);
        rows.appendChild(row);
      }
      // the dossier behind the current skin: who Nazarban was in this age
      // and how it helped the city — the museum story, read live off the
      // era metadata (js/city.js), ending on the one live wire in the hatch
      var era = (M.eras && M.style) ? M.eras[M.style] : null;
      var today = M.today || { name: 'NAZARBAN AI',
        what: 'AI CONSULTATION & IMPLEMENTATION',
        line: 'Every age needs a thinking machine. Today the machine is AI — and it is real. Nazarban builds yours.',
        url: 'https://nazarbanai.com' };

      function hatchRow(label, value) {
        var dl = document.createElement('dl');
        dl.className = 'hatch-row';
        var dt = document.createElement('dt');
        dt.textContent = label;
        var dd = document.createElement('dd');
        dd.textContent = value;
        dl.appendChild(dt); dl.appendChild(dd);
        rows.appendChild(dl);
      }

      function hatchBand(text, color, heading) {
        var p = document.createElement('div');
        p.className = 'hatch-row';
        p.style.display = 'block';
        p.style.textAlign = heading ? 'center' : 'left';
        p.style.fontFamily = 'Jost, Futura, sans-serif';
        p.style.fontWeight = '600';
        p.style.fontSize = heading ? '9px' : '10px';
        p.style.letterSpacing = heading ? '2.5px' : '0.4px';
        p.style.lineHeight = '1.55';
        p.style.color = color;
        p.textContent = text;
        rows.appendChild(p);
      }

      if (era) {
        hatchBand('· NAZARBAN THROUGH THE AGES ·', 'var(--brass-light)', true);
        hatchRow('NOW SIMULATING', era.age + ' · ' + era.year);
        hatchRow('THE FIRM THEN', era.company);
        hatchRow('THE MACHINE', era.machine);
        hatchBand(era.brief + ' ' + era.install + ' ' + era.result,
          'rgba(242, 233, 210, 0.72)', false);
      }

      // the works today — the real company, the real pitch, the real link
      hatchBand(today.line, 'rgba(242, 233, 210, 0.82)', false);
      var reg = document.createElement('dl');
      reg.className = 'hatch-row';
      var regT = document.createElement('dt');
      regT.textContent = 'THE WORKS TODAY';
      var regD = document.createElement('dd');
      var regA = document.createElement('a');
      regA.href = today.url || 'https://nazarbanai.com';
      regA.target = '_blank';
      regA.rel = 'noopener';
      regA.textContent = today.name + ' ↗';
      regA.title = today.what + ' — Nazarban AI (nazarbanai.com)';
      regA.style.color = 'var(--brass-light)';
      regA.style.textDecoration = 'underline dotted';
      regA.style.textUnderlineOffset = '3px';
      regD.appendChild(regA);
      reg.appendChild(regT);
      reg.appendChild(regD);
      rows.appendChild(reg);
      hatchBand(today.what, 'rgba(242, 233, 210, 0.5)', true);
    }

    key.addEventListener('click', function () {
      fill();
      hatch.hidden = false;
    });
    close.addEventListener('click', function () { hatch.hidden = true; });
    hatch.addEventListener('click', function (e) {
      if (e.target === hatch) hatch.hidden = true;
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') hatch.hidden = true;
    });
  })();

  // the SPEAKER key works the same switch as the POWER lamp (js/sound.js
  // listens there); its jewel follows every route to that switch,
  // including the M key and direct lamp clicks
  (function () {
    var speakerKey = $('aux-speaker');
    var speakerUnit = powerLamp && powerLamp.closest ? powerLamp.closest('.lamp-unit') : null;
    if (!speakerKey || !speakerUnit) return;
    speakerUnit.addEventListener('click', function () {
      var on = speakerKey.getAttribute('aria-pressed') === 'true';
      speakerKey.setAttribute('aria-pressed', on ? 'false' : 'true');
    });
    speakerKey.addEventListener('click', function () { speakerUnit.click(); });
  })();

  // the manufacturer's nameplate on the console footer links to the
  // works' present-day address — same face, same type, just live wire
  (function () {
    var foot = document.querySelector('.console-footer');
    if (!foot) return;
    var a = document.createElement('a');
    a.href = 'https://nazarbanai.com';
    a.target = '_blank';
    a.rel = 'noopener';
    a.title = 'Nazarban Instrument Works, est. 1958 — today Nazarban AI (nazarbanai.com)';
    a.textContent = foot.textContent;
    a.style.color = 'inherit';
    a.style.textDecoration = 'none';
    foot.textContent = '';
    foot.appendChild(a);
  })();

  /* ---------------- scale machine to viewport ---------------- */
  /* The machine fills the screen: width is matched exactly, and the sim
     viewport absorbs the leftover height — tall screens get more sky,
     short screens scale the skyline down to fit (js/city.js). The
     console block itself never changes shape. The city renderer is told
     the new logical sim height via 'municitron:viewport'. */

  var PANEL_H = 374;                             // console 300 + auxiliary rail 74
  var simEl = document.querySelector('.sim');
  var lastSimH = 600;

  function fit() {
    var w = window.innerWidth || document.documentElement.clientWidth;
    var h = window.innerHeight || document.documentElement.clientHeight;
    if (!w || !h) { requestAnimationFrame(fit); return; }
    var scale = w / 1600;
    var simH = h / scale - PANEL_H;              // logical px left for the city
    if (simH < 320) {                            // ultra-wide: fall back to height fit
      scale = h / (320 + PANEL_H);
      simH = 320;
    }
    simH = Math.round(Math.min(simH, 1000));     // very tall: cap the sky, center
    machine.style.height = (simH + PANEL_H) + 'px';
    if (simEl) simEl.style.height = simH + 'px';
    machine.style.transform = 'scale(' + scale + ')';
    overlay.style.transform = 'scale(' + scale + ')';
    if (simH !== lastSimH) {
      lastSimH = simH;
      document.dispatchEvent(new CustomEvent('municitron:viewport', { detail: { h: simH } }));
    }
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
