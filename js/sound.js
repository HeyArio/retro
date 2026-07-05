/* ==========================================================================
   MUNICITRON M-58 — valve audio unit
   Nazarban Instrument Works · Est. 1958

   Entirely optional and MUTED BY DEFAULT. Clicking the POWER lamp
   toggles the speaker (the click is also the user gesture Web Audio
   requires). No autoplay, no persistence, no tracking.

   Voices: mains hum bed · knob clunks on control changes · geiger-style
   census ticks · a two-tone chime when a landmark is commissioned ·
   Sputnik's beep-beep while it crosses.
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
  function tick()   {
    var now = Date.now();
    if (now - lastTick < 70) return;
    lastTick = now;
    blip(1900, 0.015, 0.12, 'square');
  }
  function chime()  { blip(660, 0.22, 0.4, 'sine'); blip(880, 0.34, 0.35, 'sine', 0.16); }
  function beep()   { blip(800, 0.09, 0.3, 'sine'); blip(800, 0.09, 0.3, 'sine', 0.35); }

  /* ---------------- console events → voices ---------------- */

  ['municitron:weather', 'municitron:time', 'municitron:growth'].forEach(function (ev) {
    document.addEventListener(ev, function () { clunk(); });
  });
  document.addEventListener('municitron:population', function () { tick(); });
  document.addEventListener('municitron:landmark', function () { chime(); });
  document.addEventListener('municitron:transmit', function () { chime(); });

  // Sputnik telemetry: watch the ambient state for a pass starting
  var wasUp = false;
  setInterval(function () {
    var M = window.MUNICITRON_CITY;
    if (!M || !M.ambient) return;
    var up = M.ambient.sputnik.active;
    if (up && !wasUp) { beep(); setTimeout(beep, 1400); setTimeout(beep, 2800); }
    wasUp = up;
  }, 400);

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
