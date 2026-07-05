/* ==========================================================================
   MUNICITRON M-58 — valve audio unit
   Nazarban Instrument Works · Est. 1958

   Entirely optional and MUTED BY DEFAULT. Clicking the POWER lamp
   toggles the speaker (the click is also the user gesture Web Audio
   requires). No autoplay, no persistence, no tracking.

   Voices: mains hum bed · knob clunks on control changes · geiger-style
   census ticks · a two-tone chime when a landmark is commissioned ·
   Sputnik's beep-beep while it crosses · and the MUNICITRON BROADCAST
   SERVICE: sparse generative celesta phrases, every half minute or so,
   in A-major pentatonic — the sound of a municipal evening.
   ========================================================================== */

(function () {
  'use strict';

  var enabled = false;
  var ac = null;
  var master = null;
  var lastTick = 0;

  function boot() {
    if (ac) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ac = new AC();
    master = ac.createGain();
    master.gain.value = 0.12;
    master.connect(ac.destination);

    // mains hum: two detuned low oscillators through a gentle lowpass
    var hum = ac.createGain();
    hum.gain.value = 0.05;
    var lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 220;
    var o1 = ac.createOscillator();
    o1.type = 'triangle';
    o1.frequency.value = 50;
    var o2 = ac.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = 100.4;
    o1.connect(hum); o2.connect(hum);
    hum.connect(lp); lp.connect(master);
    o1.start(); o2.start();
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
      var note = NOTES[Math.floor(Math.random() * NOTES.length)];
      if (Math.random() < 0.3) note *= 2;         // an octave lift
      blip(note, 0.55, 0.07, 'sine', t);
      if (i === len - 1 && Math.random() < 0.6) { // close on a fifth
        blip(note * 1.5, 0.7, 0.045, 'sine', t + 0.05);
      }
      t += 0.3 + Math.random() * 0.32;
    }
  }

  setInterval(function () {
    if (enabled && Math.random() < 0.55) phrase();
  }, 26000);

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
        if (master) master.gain.value = 0.12;
        clunk();
        setTimeout(function () { if (enabled) phrase(); }, 2500);   // sign-on
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
