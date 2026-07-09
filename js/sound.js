/* ==========================================================================
   MUNICITRON M-58 — valve audio unit
   Nazarban Instrument Works · Est. 1958

   Entirely optional and MUTED BY DEFAULT. Clicking the POWER lamp
   toggles the speaker (the click is also the user gesture Web Audio
   requires). No autoplay, no persistence, no tracking.

   Voices: the machine at work — a transformer hum, a motor whir and a
   tabulator's steady relay clatter, the M-58 computing its city · knob
   clunks on control changes · geiger-style census ticks · a two-tone
   chime when a landmark is commissioned · Sputnik's beep-beep while it
   crosses · and, faint under the clatter, the MUNICITRON BROADCAST
   SERVICE: occasional celesta phrases in a seasonal pentatonic mode.
   ========================================================================== */

(function () {
  'use strict';

  var enabled = false;
  var ac = null;
  var master = null;
  var bed = null;          // ambient bus (hum + motor + clatter); duckable
  var lastTick = 0;
  var noiseBuf = null;
  var humO1 = null, humO2 = null, humG = null, motorO = null;

  /* the machine's voice changes with the age being simulated: piston
     thud and low steam for the brass ages, a dynamo and typebars for
     the chrome ones, data chatter for the wired age, near-silence and
     key taps for the present, soft work for the green ages */
  var PROFILES = {
    atom:    { hum1: 50,  hum2: 100.4, humG: 0.04,  motor: 82,  clackF: 1500, clackJ: 700, wave: 'sine',     oct: 1, bedG: 1 },
    steam:   { hum1: 34,  hum2: 68.3,  humG: 0.05,  motor: 46,  clackF: 750,  clackJ: 350, wave: 'sine',     oct: 2, bedG: 1.1 },
    diesel:  { hum1: 60,  hum2: 120.5, humG: 0.045, motor: 110, clackF: 1150, clackJ: 500, wave: 'triangle', oct: 1, bedG: 1 },
    cyber:   { hum1: 58,  hum2: 116.7, humG: 0.05,  motor: 164, clackF: 2500, clackJ: 900, wave: 'square',   oct: 1, bedG: 0.9 },
    cassette:{ hum1: 60,  hum2: 119.7, humG: 0.045, motor: 124, clackF: 2100, clackJ: 700, wave: 'square',   oct: 2, bedG: 0.85 },
    orbital: { hum1: 40,  hum2: 80.4,  humG: 0.035, motor: 74,  clackF: 2800, clackJ: 600, wave: 'sine',     oct: 2, bedG: 0.65 },
    present: { hum1: 118, hum2: 236.6, humG: 0.02,  motor: 90,  clackF: 3300, clackJ: 800, wave: 'triangle', oct: 2, bedG: 0.5 },
    green:   { hum1: 44,  hum2: 88.6,  humG: 0.03,  motor: 62,  clackF: 1900, clackJ: 600, wave: 'sine',     oct: 2, bedG: 0.7 }
  };

  function profFor(style) {
    if (style === 'steampunk' || style === 'clockpunk') return PROFILES.steam;
    if (style === 'cyberpunk' || style === 'nanopunk') return PROFILES.cyber;
    if (style === 'cassette') return PROFILES.cassette;
    if (style === 'orbital') return PROFILES.orbital;
    if (style === 'present') return PROFILES.present;
    if (style === 'solarpunk' || style === 'biopunk' || style === 'silkpunk') return PROFILES.green;
    if (style === 'artdeco' || style === 'decopunk' || style === 'dieselpunk') return PROFILES.diesel;
    return PROFILES.atom;
  }

  var prof = PROFILES.atom;

  function applyEraProfile(style) {
    prof = profFor(style);
    if (!ac) return;
    humO1.frequency.value = prof.hum1;
    humO2.frequency.value = prof.hum2;
    humG.gain.value = prof.humG;
    motorO.frequency.value = prof.motor;
    bed.gain.value = prof.bedG;
  }

  // the VOLUME knob's three detents: LOW / STANDARD / FULL
  var LEVELS = [0.05, 0.12, 0.24];
  var level = 1;

  function boot() {
    if (ac) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    var M0 = window.MUNICITRON_CITY;
    prof = profFor(M0 && M0.style);
    ac = new AC();
    master = ac.createGain();
    master.gain.value = LEVELS[level];
    master.connect(ac.destination);

    // the ambient bed rides its own bus so a whistle or chime can duck
    // the machine's clatter and sing out clearly over it
    bed = ac.createGain();
    bed.gain.value = prof.bedG;
    bed.connect(master);

    // transformer hum: two detuned low oscillators through a gentle lowpass
    var hum = ac.createGain();
    hum.gain.value = prof.humG;
    var lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 200;
    var o1 = ac.createOscillator();
    o1.type = 'triangle';
    o1.frequency.value = prof.hum1;
    var o2 = ac.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = prof.hum2;
    o1.connect(hum); o2.connect(hum);
    hum.connect(lp); lp.connect(bed);
    o1.start(); o2.start();
    humO1 = o1; humO2 = o2; humG = hum;

    // motor whir: a filtered sawtooth under a slow tremolo — a cooling
    // fan or a tape reel turning somewhere inside the cabinet
    var motor = ac.createOscillator();
    motor.type = 'sawtooth';
    motor.frequency.value = prof.motor;
    motorO = motor;
    var mlp = ac.createBiquadFilter();
    mlp.type = 'lowpass';
    mlp.frequency.value = 300;
    var mg = ac.createGain();
    mg.gain.value = 0.02;
    var lfo = ac.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.6;
    var lfoG = ac.createGain();
    lfoG.gain.value = 0.009;
    lfo.connect(lfoG); lfoG.connect(mg.gain);
    motor.connect(mlp); mlp.connect(mg); mg.connect(bed);
    motor.start(); lfo.start();

    startClatter();
  }

  // a half-second of white noise, built once, for the mechanical clacks
  function noise() {
    if (noiseBuf) return noiseBuf;
    var n = Math.floor(ac.sampleRate * 0.4);
    noiseBuf = ac.createBuffer(1, n, ac.sampleRate);
    var d = noiseBuf.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return noiseBuf;
  }

  // one relay/key clack: a band-passed noise tick over a wooden thock,
  // routed through the bed so it ducks with the rest of the machine
  function clack(when, gain, freq) {
    if (!ac) return;
    var t = ac.currentTime + (when || 0);
    var src = ac.createBufferSource();
    src.buffer = noise();
    var bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq || (prof.clackF + Math.random() * prof.clackJ);
    bp.Q.value = 1.1;
    var g = ac.createGain();
    g.gain.setValueAtTime(gain || 0.1, t);
    g.gain.exponentialRampToValueAtTime(0.0004, t + 0.045);
    src.connect(bp); bp.connect(g); g.connect(bed);
    src.start(t); src.stop(t + 0.05);
    var o = ac.createOscillator();
    o.type = 'triangle';
    o.frequency.value = 108;
    var og = ac.createGain();
    og.gain.setValueAtTime((gain || 0.1) * 0.5, t);
    og.gain.exponentialRampToValueAtTime(0.0004, t + 0.05);
    o.connect(og); og.connect(bed);
    o.start(t); o.stop(t + 0.06);
  }

  // the tabulator clatter: a steady, humanized pulse with a heavier
  // relay ka-chunk every eighth beat, like a card machine at work
  var clatterTimer = null, step = 0;
  var CLK = 0.42;                                  // seconds per beat
  function startClatter() {
    if (clatterTimer) return;
    clatterTimer = setInterval(function () {
      if (!enabled || !ac) return;
      for (var k = 0; k < 2; k++) {               // two beats per tick
        var at = k * CLK + (Math.random() - 0.5) * 0.04;
        step++;
        if (step % 8 === 0) {                      // relay bank throws over
          clack(at, 0.16, prof.clackF * 0.6); clack(at + 0.07, 0.09, prof.clackF * 0.87);
        } else if (step % 4 === 2) {               // an offbeat flutter
          clack(at, 0.11);
          if (Math.random() < 0.5) clack(at + 0.21, 0.05);
        } else {
          clack(at, 0.08 + Math.random() * 0.03);
        }
      }
    }, CLK * 2 * 1000);
  }

  function blip(freq, dur, gain, type, when) {
    if (!enabled || !ac) return;
    var t = ac.currentTime + (when || 0);
    var o = ac.createOscillator();
    var g = ac.createGain();
    o.type = type || 'square';
    o.frequency.value = freq;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    o.connect(g); g.connect(master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  function clunk()  { blip(140, 0.06, 0.5, 'square'); blip(90, 0.09, 0.35, 'triangle'); }
  function bell()   { blip(1320, 0.5, 0.3, 'sine'); blip(1980, 0.35, 0.15, 'sine', 0.02); }
  function thump()  { blip(70, 0.3, 0.6, 'triangle'); blip(55, 0.4, 0.4, 'triangle', 0.12); }
  function wobble() { blip(980, 0.18, 0.2, 'sine'); blip(760, 0.18, 0.2, 'sine', 0.14); blip(540, 0.26, 0.2, 'sine', 0.28); }
  function tone()   { blip(1000, 0.6, 0.18, 'sine'); }
  function rumble() { blip(46, 0.9, 0.5, 'triangle'); blip(38, 1.3, 0.35, 'triangle', 0.18); }
  function horn()   { blip(164, 0.7, 0.35, 'triangle'); blip(123, 0.9, 0.3, 'triangle', 0.1); }
  function clink()  { blip(1800, 0.05, 0.14, 'sine'); blip(2400, 0.06, 0.1, 'sine', 0.08); }
  function tick()   {
    var now = Date.now();
    if (now - lastTick < 70) return;
    lastTick = now;
    blip(1900, 0.015, 0.12, 'square');
  }
  function chime()  { blip(660, 0.22, 0.4, 'sine'); blip(880, 0.34, 0.35, 'sine', 0.16); }
  function beep()   { blip(800, 0.09, 0.3, 'sine'); blip(800, 0.09, 0.3, 'sine', 0.35); }

  // the fire station's steam whistle: two reeds a third apart, a hard
  // rise, a long held cry, and a sag as the steam runs out
  function steamWhistle() {
    if (!enabled || !ac) return;
    var t = ac.currentTime;
    // duck the machine bed so the whistle rings out over the clatter
    if (bed) {
      bed.gain.cancelScheduledValues(t);
      bed.gain.setValueAtTime(bed.gain.value, t);
      bed.gain.linearRampToValueAtTime(0.28, t + 0.06);
      bed.gain.setValueAtTime(0.28, t + 1.15);
      bed.gain.linearRampToValueAtTime(1, t + 1.7);
    }
    [523, 659].forEach(function (f, i) {
      var o = ac.createOscillator();
      var g = ac.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(f * 0.9, t);
      o.frequency.exponentialRampToValueAtTime(f, t + 0.12);
      o.frequency.setValueAtTime(f, t + 0.9);
      o.frequency.exponentialRampToValueAtTime(f * 0.94, t + 1.35);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.32 - i * 0.11, t + 0.08);
      g.gain.setValueAtTime(0.32 - i * 0.11, t + 0.95);
      g.gain.exponentialRampToValueAtTime(0.0005, t + 1.4);
      o.connect(g);
      g.connect(master);                            // over the ducked bed
      o.start(t);
      o.stop(t + 1.5);
    });
  }

  /* ---------------- the broadcast service ---------------- */
  /* A short pentatonic phrase now and then, quiet enough to live under
     the mains hum. Runs only while the speaker is on — and it reads
     the civic calendar: major in the bright months, minor for winter,
     a lower autumn mode when the leaves come down. */

  var SCALES = {
    bright: [220, 246.9, 277.2, 329.6, 370],      // A-major pentatonic
    winter: [220, 261.6, 293.7, 329.6, 392],      // A-minor pentatonic
    autumn: [174.6, 196, 220, 261.6, 293.7]       // the same, settled lower
  };

  function seasonScale() {
    var M = window.MUNICITRON_CITY;
    var mo = M && M.calendar ? M.calendar.month : 4;
    if (mo === 11 || mo <= 1) return SCALES.winter;
    if (mo >= 8 && mo <= 10) return SCALES.autumn;
    return SCALES.bright;
  }

  function phrase() {
    if (!enabled || !ac) return;
    var NOTES = seasonScale();
    var t = 0;
    var len = 3 + Math.floor(Math.random() * 4);
    for (var i = 0; i < len; i++) {
      var note = NOTES[Math.floor(Math.random() * NOTES.length)] * prof.oct;
      if (Math.random() < 0.3) note *= 2;         // an octave lift
      blip(note, 0.55, 0.05, prof.wave, t);
      if (i === len - 1 && Math.random() < 0.6) { // close on a fifth
        blip(note * 1.5, 0.7, 0.035, prof.wave, t + 0.05);
      }
      t += 0.3 + Math.random() * 0.32;
    }
  }

  // the broadcast is now faint and infrequent — a radio somewhere under
  // the machine's clatter, not the main event
  setInterval(function () {
    if (enabled && Math.random() < 0.3) phrase();
  }, 42000);

  /* ---------------- console events → voices ---------------- */

  ['municitron:weather', 'municitron:time', 'municitron:growth'].forEach(function (ev) {
    document.addEventListener(ev, function () { clunk(); });
  });
  document.addEventListener('municitron:population', function () { tick(); });
  document.addEventListener('municitron:landmark', function () { chime(); });
  document.addEventListener('municitron:transmit', function () { chime(); });
  document.addEventListener('municitron:certificate', function () { chime(); });
  document.addEventListener('municitron:coin', function () { bell(); });
  document.addEventListener('municitron:fireworks', function () { thump(); });
  document.addEventListener('municitron:ufo', function () { wobble(); });
  document.addEventListener('municitron:testpattern', function () { tone(); });
  document.addEventListener('municitron:lightning', function () { rumble(); });
  document.addEventListener('municitron:ferry', function () { horn(); });
  document.addEventListener('municitron:almanac', function () { chime(); });
  document.addEventListener('municitron:milk', function () { clink(); });
  document.addEventListener('municitron:mail', function () { blip(1046, 0.12, 0.15, 'sine'); blip(1318, 0.2, 0.12, 'sine', 0.1); });
  document.addEventListener('municitron:record', function () { chime(); });
  document.addEventListener('municitron:concert', function () { phrase(); });
  document.addEventListener('municitron:daylog', function () { chime(); });
  document.addEventListener('municitron:wirephoto', function () { chime(); });
  document.addEventListener('municitron:whistle', function () { steamWhistle(); });
  document.addEventListener('municitron:season', function () { clunk(); });

  // the brigade bell: three quick brass strikes
  document.addEventListener('municitron:fire', function () {
    if (!enabled || !ac) return;
    for (var i = 0; i < 3; i++) {
      blip(1180, 0.22, 0.08, 'square', i * 0.28);
      blip(1770, 0.14, 0.05, 'sine', i * 0.28 + 0.02);
    }
  });

  // the grid drops: the hum sags, a breaker clunk, then silence-ish
  document.addEventListener('municitron:outage', function () {
    if (!enabled || !ac) return;
    clunk();
    var t = ac.currentTime;
    bed.gain.setValueAtTime(bed.gain.value, t);
    bed.gain.exponentialRampToValueAtTime(0.05, t + 0.5);
    bed.gain.setValueAtTime(0.05, t + 4.5);
    bed.gain.exponentialRampToValueAtTime(Math.max(0.1, prof.bedG), t + 7);
    blip(72, 1.2, 0.07, 'sine', 0.1);
  });

  // totality: the world holds its breath — the bed ducks under a low tone
  document.addEventListener('municitron:eclipse', function () {
    if (!enabled || !ac) return;
    var t = ac.currentTime;
    bed.gain.setValueAtTime(bed.gain.value, t);
    bed.gain.exponentialRampToValueAtTime(0.18, t + 3);
    bed.gain.setValueAtTime(0.18, t + 10);
    bed.gain.exponentialRampToValueAtTime(Math.max(0.1, prof.bedG), t + 15);
    blip(98, 5, 0.05, 'sine', 1);
    blip(147, 5, 0.03, 'sine', 1.5);
  });

  // dialing a new age retunes the set: a band-swept burst of static,
  // then two settling tones — and the machine speaks that age from
  // then on (hum, motor, clatter and broadcast all take the profile)
  function retune() {
    if (!enabled || !ac) return;
    var t = ac.currentTime;
    var src = ac.createBufferSource();
    src.buffer = noise();
    src.loop = true;
    var bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 0.7;
    bp.frequency.setValueAtTime(400, t);
    bp.frequency.exponentialRampToValueAtTime(3200, t + 0.5);
    var g = ac.createGain();
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.7);
    src.connect(bp); bp.connect(g); g.connect(master);
    src.start(t); src.stop(t + 0.75);
    blip(520, 0.2, 0.1, 'sine', 0.5);
    blip(780, 0.3, 0.08, 'sine', 0.62);
  }
  document.addEventListener('municitron:era', function (e) {
    applyEraProfile(e.detail && e.detail.style);
    retune();
  });

  // the VOLUME knob on the auxiliary rail (detail: 0 / 1 / 2); the
  // clunk confirms the change at the new level
  document.addEventListener('municitron:volume', function (e) {
    var idx = Number(e.detail);
    if (idx >= 0 && idx <= 2) level = idx;
    if (master && enabled) master.gain.value = LEVELS[level];
    if (enabled) clunk();
  });

  // Sputnik telemetry: watch the ambient state for a pass starting
  var wasUp = false;
  setInterval(function () {
    var M = window.MUNICITRON_CITY;
    if (!M || !M.ambient) return;
    var up = M.ambient.sputnik.active;
    if (up && !wasUp) { beep(); setTimeout(beep, 1400); setTimeout(beep, 2800); }
    wasUp = up;
  }, 400);

  // the parade brings its own drum line while it marches
  setInterval(function () {
    var M = window.MUNICITRON_CITY;
    if (!enabled || !M || !M.ambient || !M.ambient.parade || !M.ambient.parade.active) return;
    blip(78, 0.1, 0.4, 'triangle', 0);            // boom
    blip(78, 0.1, 0.4, 'triangle', 0.42);         // boom
    blip(196, 0.05, 0.12, 'square', 0.63);        // rim
    blip(78, 0.1, 0.45, 'triangle', 0.84);        // boom
    if (Math.random() < 0.35) {                   // piccolo aside
      blip(1046, 0.09, 0.08, 'sine', 1.05);
      blip(1174, 0.09, 0.08, 'sine', 1.18);
    }
  }, 1260);

  /* ---------------- the POWER lamp is the speaker switch -------------- */

  var lamp = document.getElementById('power-lamp');
  var unit = lamp && lamp.closest ? lamp.closest('.lamp-unit') : null;
  if (unit) {
    unit.title = 'TOGGLE SPEAKER';
    unit.style.cursor = 'pointer';
    unit.addEventListener('click', function () {
      enabled = !enabled;
      if (enabled) {
        boot();
        if (ac && ac.state === 'suspended') ac.resume();
        if (master) master.gain.value = LEVELS[level];
        clunk();                                    // the machine spins up:
                                                    // hum, motor and clatter
                                                    // are the sign-on now
      } else if (master) {
        master.gain.value = 0;
      }
      // acknowledge on the lamp itself: a quick double blink
      lamp.classList.remove('on');
      setTimeout(function () { lamp.classList.add('on'); }, 140);
      console.info('MUNICITRON speaker ' + (enabled ? 'ON' : 'OFF'));
    });
  }
})();
