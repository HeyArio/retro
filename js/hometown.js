/* ==========================================================================
   MUNICITRON M-58 — the FOREIGN SERVICE (js/hometown.js)
   Nazarban Instrument Works · Est. 1958

   ?town=NAME commissions a REAL town. The international survey wire —
   Open-Meteo's free geocoding + forecast services, no key, no backend,
   still a static deploy — resolves the name to coordinates, elevation,
   timezone and the latest census figure. From that:

   - the town's NAME is its seed (FNV-1a hash), so every visitor to
     ?town=marrakesh stands in the same city
   - elevation places it: shoreline towns get the harbor, mountain
     towns get the hillside, the rest keep the honest prairie
   - the real census figure calibrates the population register — the
     odometer climbs toward the town's actual population and settles
   - the town's LOCAL sky drives the console: time of day on arrival,
     live weather on the survey cadence (refreshed every 15 minutes);
     an aurora-latitude town on a clear night gets the aurora
   - touching a dial yourself takes the wire off that circuit — the
     commissioner outranks the survey bureau, always

   Typing V-I-S-I-T on the console opens the service: the wire asks for
   a town's name, the keys print it on the glass, ENTER departs.
   "springfield, illinois" disambiguates with a comma.

   Everything degrades: no network, no data, no such town — the M-58
   simulates locally as it always has. This file loads FIRST so that
   js/city.js can read window.MUNICITRON_HOMETOWN at parse time, and
   so its keyboard listener outranks the console's while typing.
   ========================================================================== */

(function () {
  'use strict';

  var GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search';
  var WX_URL = 'https://api.open-meteo.com/v1/forecast';
  var CACHE_PREFIX = 'municitron-m58-town-';
  var CACHE_MS = 7 * 86400000;              // re-survey weekly (census drift)
  var WX_POLL_MS = 15 * 60 * 1000;          // forecast cadence
  var WEATHER_NAMES = ['CLEAR SKIES', 'RAIN', 'SNOW', 'THE AURORA'];
  var TIME_NAMES = ['MIDNIGHT', 'DAWN', 'MORNING', 'NOON',
                    'AFTERNOON', 'DUSK', 'EVENING', 'NIGHT'];

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* ---------------- the wire, spoken through existing channels --------- */

  function caption(text) {                  // preempts the glass at once
    document.dispatchEvent(new CustomEvent('municitron:caption', { detail: text }));
  }
  function bulletin(text) {                 // queues like any other story
    document.dispatchEvent(new CustomEvent('municitron:bulletin', { detail: text }));
  }

  /* ---------------- town key, seed, cache ------------------------------ */

  function normKey(s) {
    return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 60);
  }

  // FNV-1a over the normalized name: the town IS the seed, for everyone
  function hash32(s) {
    var h = 0x811C9DC5;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  function loadCache(key) {
    try {
      var d = JSON.parse(localStorage.getItem(CACHE_PREFIX + key) || 'null');
      return d && typeof d.lat === 'number' && d.tz ? d : null;
    } catch (err) { return null; }
  }
  function saveCache(key, data) {
    try { localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(data)); }
    catch (err) { /* storage may be unavailable; the toy shrugs */ }
  }

  /* ---------------- survey judgements ---------------------------------- */

  // the survey wire judges terrain by elevation — sea-level towns face
  // the water, mountain towns climb the hill, the rest keep the prairie
  function terrainOf(elev) {
    if (typeof elev !== 'number' || !isFinite(elev)) return 'flat';
    if (elev <= 16) return 'harbor';
    if (elev >= 350) return 'hill';
    return 'flat';
  }

  function localHour(tz) {
    try {
      return parseInt(new Intl.DateTimeFormat('en-US',
        { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(new Date()), 10);
    } catch (err) { return null; }
  }

  // 24 hours onto the 8 detents of the TIME dial
  function slotOf(h) {
    if (h === null || isNaN(h)) return null;
    if (h < 5) return 0;                    // MIDNIGHT
    if (h < 8) return 1;                    // DAWN
    if (h < 11) return 2;                   // MORNING
    if (h < 14) return 3;                   // NOON
    if (h < 17) return 4;                   // AFTERNOON
    if (h < 19) return 5;                   // DUSK
    if (h < 22) return 6;                   // EVENING
    return 7;                               // NIGHT
  }

  // WMO weather code onto the 4 detents of the WEATHER knob; a clear
  // dark sky at aurora latitudes earns the fourth detent
  function weatherOf(code, dark, lat) {
    if (typeof code === 'number') {
      if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 2;
      if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95) return 1;
    }
    if (dark && Math.abs(lat) >= 60) return 3;
    return 0;
  }

  function isDark(h) { return h === null || h < 6 || h >= 19; }

  /* ---------------- the geocoding desk --------------------------------- */
  /* "springfield, illinois" — the comma narrows the search to whichever
     candidate's region or country carries the second part. */

  function geocode(q, ok, fail) {
    var parts = q.split(',');
    var name = parts[0].trim();
    var region = parts.slice(1).join(',').trim().toLowerCase();
    var url = GEO_URL + '?name=' + encodeURIComponent(name) +
              '&count=' + (region ? 10 : 1) + '&language=en&format=json';
    fetch(url).then(function (r) { return r.json(); }).then(function (j) {
      var rs = (j && j.results) || [];
      var hit = null;
      if (region) {
        for (var i = 0; i < rs.length && !hit; i++) {
          var fields = [rs[i].admin1, rs[i].admin2, rs[i].country, rs[i].country_code];
          for (var f = 0; f < fields.length; f++) {
            if (fields[f] && String(fields[f]).toLowerCase().indexOf(region) !== -1) {
              hit = rs[i];
              break;
            }
          }
        }
      }
      hit = hit || rs[0] || null;
      ok(hit ? {
        name: hit.name || name,
        country: hit.country || '',
        cc: hit.country_code || '',
        lat: hit.latitude,
        lon: hit.longitude,
        elev: hit.elevation,
        tz: hit.timezone || 'UTC',
        pop: hit.population || 0,
        at: Date.now()
      } : null);
    }).catch(fail || function () {});
  }

  /* ---------------- boot: is a real town on the wire? ------------------ */

  var params = new URLSearchParams(window.location.search);
  var TOWN_Q = normKey(params.get('town'));
  var cached = TOWN_Q ? loadCache(TOWN_Q) : null;

  if (TOWN_Q && cached) {
    window.MUNICITRON_HOMETOWN = {
      key: TOWN_Q,
      seed: hash32(TOWN_Q),
      name: cached.name,
      country: cached.country,
      terrain: terrainOf(cached.elev),
      population: cached.pop || 0,
      lat: cached.lat,
      lon: cached.lon,
      tz: cached.tz
    };
  } else if (TOWN_Q) {
    // a shared link's first landing: the seed is already the town's —
    // the skyline plan holds; name, terrain and census follow the survey
    window.MUNICITRON_HOMETOWN = { key: TOWN_Q, seed: hash32(TOWN_Q) };
  }

  var HT = window.MUNICITRON_HOMETOWN || null;

  // pre-existing ?t / ?w on a town link are somebody's deliberate scene —
  // that circuit starts overridden; otherwise the town's LOCAL sky is
  // written into the URL before the console (municitron.js) reads it
  var userT = params.get('t') !== null;
  var userW = params.get('w') !== null;
  var wireT = -1, wireW = -1;

  if (HT && HT.tz) {
    var bootHour = localHour(HT.tz);
    var bootSlot = slotOf(bootHour);
    try {
      var inject = false;
      if (!userT && bootSlot !== null) {
        params.set('t', String(bootSlot));
        wireT = bootSlot;
        inject = true;
      }
      if (!userW) {
        wireW = weatherOf(cached && cached.wmo, isDark(bootHour), HT.lat);
        params.set('w', String(wireW));
        inject = true;
      }
      if (inject && window.history && window.history.replaceState) {
        window.history.replaceState(null, '', '?' + params.toString());
      }
    } catch (err) { /* file:// may refuse; the dials keep their defaults */ }
  }

  /* ---------------- the live circuits ---------------------------------- */
  /* The wire works the console through its own hooks (municitron.js
     listens for municitron:set-weather / set-time). Any dial change the
     wire didn't order is the commissioner's — that circuit goes manual. */

  var expectW = -1, expectT = -1;
  var firstW = true, firstT = true;

  document.addEventListener('municitron:weather', function (e) {
    if (!HT) return;
    var i = e.detail && e.detail.index;
    if (firstW) {
      // the console's power-on announce: adopt whatever the dials say
      // (URL injection can't take on file://) — the first poll corrects it
      firstW = false;
      if (typeof i === 'number' && i !== wireW && !userW) wireW = i;
      return;
    }
    if (i === wireW || i === expectW) { expectW = -1; return; }
    if (!userW) {
      userW = true;
      bulletin('MANUAL OVERRIDE NOTED — THE SURVEY WIRE DEFERS ON WEATHER');
    }
  });
  document.addEventListener('municitron:time', function (e) {
    if (!HT) return;
    var i = e.detail && e.detail.index;
    if (firstT) {
      firstT = false;
      if (typeof i === 'number' && i !== wireT && !userT) wireT = i;
      return;
    }
    if (i === wireT || i === expectT) { expectT = -1; return; }
    if (!userT) {
      userT = true;
      bulletin('MANUAL OVERRIDE NOTED — THE SURVEY WIRE DEFERS ON THE CLOCK');
    }
  });

  function wireSetWeather(w, announce) {
    if (userW || w === wireW) return;
    wireW = w;
    expectW = w;
    document.dispatchEvent(new CustomEvent('municitron:set-weather', { detail: w }));
    if (announce) {
      bulletin('SURVEY WIRE, ' + String(HT.name || TOWN_Q).toUpperCase() + ': ' +
               WEATHER_NAMES[w] + ' REPORTED — KNOB SET ACCORDINGLY');
    }
  }

  function wireSetTime(t) {
    if (userT || t === wireT) return;
    wireT = t;
    expectT = t;
    document.dispatchEvent(new CustomEvent('municitron:set-time', { detail: t }));
    bulletin('SURVEY WIRE MARKS ' + TIME_NAMES[t] + ', ' +
             String(HT.name || TOWN_Q).toUpperCase() + ' LOCAL TIME');
  }

  function pollWeather(announce) {
    if (!HT || !HT.tz || userW || typeof HT.lat !== 'number') return;
    var url = WX_URL + '?latitude=' + HT.lat + '&longitude=' + HT.lon +
              '&current=weather_code,is_day&timezone=auto';
    fetch(url).then(function (r) { return r.json(); }).then(function (j) {
      var cur = j && j.current;
      if (!cur || typeof cur.weather_code !== 'number') return;
      var h = localHour(HT.tz);
      var dark = typeof cur.is_day === 'number' ? !cur.is_day : isDark(h);
      // remember the reading so the NEXT arrival's first frame is close
      var c = loadCache(TOWN_Q);
      if (c) { c.wmo = cur.weather_code; saveCache(TOWN_Q, c); }
      wireSetWeather(weatherOf(cur.weather_code, dark, HT.lat), announce);
    }).catch(function () { /* the survey wire drops; the sky stands */ });
  }

  if (HT && HT.tz) {
    // the survey stays on duty: weather every 15 minutes, clock every one.
    // The first poll waits for the console (municitron.js parses last) —
    // its dial hooks must be listening before the wire can turn a knob
    var polled = false;
    var bootPoll = function () {
      if (polled) return;
      polled = true;
      pollWeather(false);                   // confirm the cached first frame
    };
    if (document.readyState === 'complete') bootPoll();
    else window.addEventListener('load', bootPoll, { once: true });
    setTimeout(bootPoll, 4000);             // belt and braces: a hung asset
    setInterval(function () { pollWeather(true); }, WX_POLL_MS);
    setInterval(function () {
      var s = slotOf(localHour(HT.tz));
      if (s !== null && s !== wireT) wireSetTime(s);
    }, 60000);

    // the census drifts; re-survey a stale record quietly for next visit
    if (cached && Date.now() - (cached.at || 0) > CACHE_MS) {
      geocode(TOWN_Q, function (data) { if (data) saveCache(TOWN_Q, data); });
    }
  } else if (HT) {
    // no survey data on file yet: fetch it, file it, and retune — the
    // same theatre as the travel desk, one reload behind the static
    geocode(TOWN_Q, function (data) {
      if (!data) {
        bulletin('THE SURVEY WIRE FINDS NO TOWN NAMED ' + TOWN_Q.toUpperCase() +
                 ' — SIMULATING LOCALLY');
        return;
      }
      saveCache(TOWN_Q, data);
      document.dispatchEvent(new CustomEvent('municitron:depart', {
        detail: { destination: String(data.name).toUpperCase() + ' — BY THE SURVEY WIRE' }
      }));
      setTimeout(function () { window.location.reload(); }, reduced.matches ? 0 : 900);
    }, function () {
      bulletin('THE SURVEY WIRE IS DOWN — SIMULATING ' + TOWN_Q.toUpperCase() +
               ' FROM MEMORY');
    });
  }

  /* ---------------- the VISIT desk (typed, like all maintenance codes) - */
  /* Type VISIT anywhere: the wire asks for a town, every keystroke
     prints on the glass, ENTER consults the survey and departs. This
     listener registered first, so while the desk is open it consumes
     keys before the console's own shortcuts (1-4, P, M) can fire. */

  var typedBuf = '';
  var capturing = false;
  var townBuf = '';

  function showTownBuf() {
    caption('DESTINATION: ' + (townBuf ? townBuf.toUpperCase() : '') + '▂' +
            '  (ENTER DEPARTS · ESC CANCELS)');
  }

  function submitTown(q) {
    q = normKey(q);
    if (q.length < 2) {
      caption('THE SURVEY WIRE NEEDS A TOWN’S NAME, COMMISSIONER');
      return;
    }
    caption('CONSULTING THE INTERNATIONAL SURVEY WIRE — ' + q.toUpperCase() + ' …');
    geocode(q, function (data) {
      if (!data) {
        caption('NO SUCH TOWN ON THE SURVEY WIRE — CHECK THE SPELLING');
        return;
      }
      saveCache(q, data);
      document.dispatchEvent(new CustomEvent('municitron:depart', {
        detail: { destination: String(data.name).toUpperCase() + ' — FOREIGN SERVICE' }
      }));
      setTimeout(function () {
        window.location.href = '?town=' + encodeURIComponent(q);
      }, reduced.matches ? 0 : 750);
    }, function () {
      caption('THE SURVEY WIRE IS DOWN — TRY AGAIN SHORTLY');
    });
  }

  document.addEventListener('keydown', function (e) {
    if (e.target && e.target.isContentEditable) return;
    if (capturing) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Escape') {
        capturing = false;
        caption('FOREIGN SERVICE DESK CLOSED — CARRY ON');
      } else if (e.key === 'Enter') {
        capturing = false;
        submitTown(townBuf);
      } else if (e.key === 'Backspace') {
        townBuf = townBuf.slice(0, -1);
        showTownBuf();
      } else if (e.key && e.key.length === 1 &&
                 /[a-zA-Z0-9 .,'’-]/.test(e.key) && townBuf.length < 48) {
        townBuf += e.key;
        showTownBuf();
      } else {
        return;                             // F-keys and the like pass through
      }
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    if (!e.key || e.key.length !== 1 || e.metaKey || e.ctrlKey || e.altKey) return;
    typedBuf = (typedBuf + e.key.toUpperCase()).slice(-8);
    if (typedBuf.slice(-5) === 'VISIT') {
      typedBuf = '';
      capturing = true;
      townBuf = '';
      caption('FOREIGN SERVICE — TYPE A REAL TOWN’S NAME, THEN PRESS ENTER');
    }
  });
})();
