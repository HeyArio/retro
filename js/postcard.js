/* ==========================================================================
   MUNICITRON M-58 — postcard transmitter
   Nazarban Instrument Works · Est. 1958

   Composes the live city canvas into the postcard frame (offscreen
   canvas) and downloads a PNG. The frame, stamp, postmark and airmail
   border come from assets/postcard-frame.png — a capture of the real
   console CSS design, not a redraw — with the photo and dynamic text
   composited on top. Layout constants mirror css/styles.css.

   Listens: 'municitron:transmit'  detail {name}  (name may be user-edited)
   ========================================================================== */

(function () {
  'use strict';

  var S = 2;                        // CSS px → asset px (frame captured at 2x)
  var CARD_W = 860, CARD_H = 570;   // .postcard-frame CSS size
  var FACE_L = 54, FACE_T = 48;     // frame padding 12 + face padding 42/36
  var FACE_R = CARD_W - 54;

  var TEAL   = '#1E4744';
  var ORANGE = '#D96F32';
  var ENGRAVE = '#4A3510';

  // the design asset ships as a data URI (js/postcard-frame-data.js) so
  // the composite canvas is never tainted — even over file:// — with the
  // on-disk PNG as a fallback for any context where the module is absent
  var frameImg = new Image();
  frameImg.src = window.MUNICITRON_FRAME_SRC || 'assets/postcard-frame.png';

  function setFont(c, weight, sizeCss, family, spacingCss) {
    c.font = weight + ' ' + (sizeCss * S) + 'px ' + family;
    if ('letterSpacing' in c) c.letterSpacing = (spacingCss * S) + 'px';
  }

  function compose(name, pop, seed, conditions) {
    var pc = document.createElement('canvas');
    pc.width = CARD_W * S;
    pc.height = CARD_H * S;
    var c = pc.getContext('2d');

    c.drawImage(frameImg, 0, 0, CARD_W * S, CARD_H * S);

    // the city photo: pasted print in the clear zone left of the stamp
    // (430×161 keeps the sim canvas's 8:3 aspect)
    var px = FACE_L * S, py = FACE_T * S, pw = 430 * S, ph = 161 * S;
    var sim = document.getElementById('sim-canvas');
    c.drawImage(sim, 0, 0, sim.width, sim.height, px, py, pw, ph);
    c.strokeStyle = '#16332F';
    c.lineWidth = 2 * S;
    c.strokeRect(px - S, py - S, pw + 2 * S, ph + 2 * S);

    c.textBaseline = 'alphabetic';

    // greeting — Jost 700 50px, spacing 8, teal with flat orange offset,
    // shrunk as a whole line if the city drew a long name
    var line2 = 'FROM ' + name;
    var size = 50;
    setFont(c, '700', size, 'Jost, Futura, sans-serif', 8);
    while (size > 26 && c.measureText(line2).width > (FACE_R - FACE_L - 8) * S) {
      size -= 2;
      setFont(c, '700', size, 'Jost, Futura, sans-serif', 8);
    }
    var y1 = 262 * S;
    var y2 = y1 + size * 1.15 * S;
    var shadow = 'rgba(217, 111, 50, 0.35)';
    var off = 2 * S;

    c.fillStyle = shadow;
    c.fillText('GREETINGS', FACE_L * S + off, y1 + off);
    c.fillText(line2, FACE_L * S + off, y2 + off);
    c.fillStyle = TEAL;
    c.fillText('GREETINGS', FACE_L * S, y1);
    var fromW = c.measureText('FROM ').width;
    c.fillText('FROM ', FACE_L * S, y2);
    c.fillStyle = ORANGE;
    c.fillText(name, FACE_L * S + fromW, y2);

    // the blank's engraved underline, as in the overlay design
    var nameW = Math.max(c.measureText(name).width, 300 * S);
    c.fillStyle = ENGRAVE;
    c.fillRect(FACE_L * S + fromW, y2 + 10 * S, nameW, 4 * S);

    // population line — owner-specified wording
    var y3 = y2 + 46 * S;
    setFont(c, '500', 18, 'Cabin, Gill Sans, sans-serif', 3);
    c.fillStyle = ENGRAVE;
    c.fillText('POP. ' + pop.toLocaleString('en-US') + '  —  TRANSMITTED VIA MUNICITRON', FACE_L * S, y3);

    // conditions at the moment of transmission
    if (conditions) {
      setFont(c, '600', 11, 'Jost, Futura, sans-serif', 2.5);
      c.fillStyle = 'rgba(74, 53, 16, 0.6)';
      c.fillText('CONDITIONS AT TRANSMISSION: ' + conditions, FACE_L * S, y3 + 26 * S);
    }

    // collectible editions: cards mailed under special skies carry a
    // rubber-stamp overprint across the photo corner
    var edition = null;
    if (conditions) {
      if (conditions.indexOf('AURORA') !== -1) edition = 'AURORA SPECIAL';
      else if (conditions.indexOf('SNOW') !== -1) edition = 'WINTER CARNIVAL EDITION';
      else if (/MIDNIGHT|EVENING|NIGHT/.test(conditions)) edition = 'NIGHT AIRMAIL';
    }
    if (edition) {
      c.save();
      c.translate((FACE_L + 330) * S, (FACE_T + 148) * S);
      c.rotate(-0.14);
      setFont(c, '700', 15, 'Jost, Futura, sans-serif', 3);
      var ew = c.measureText(edition).width;
      c.strokeStyle = 'rgba(217, 111, 50, 0.75)';
      c.lineWidth = 2 * S;
      c.strokeRect(-ew / 2 - 10 * S, -14 * S, ew + 20 * S, 24 * S);
      c.fillStyle = 'rgba(217, 111, 50, 0.8)';
      c.textAlign = 'center';
      c.fillText(edition, 0, 3 * S);
      c.textAlign = 'left';
      c.restore();
    }

    // fine print, with the seed as the transmission number
    setFont(c, '600', 9.5, 'Jost, Futura, sans-serif', 2.5);
    c.fillStyle = 'rgba(74, 53, 16, 0.55)';
    c.fillText(
      'NAZARBAN INSTRUMENT WORKS · MODEL M-58 OUTPUT · FORM PC-1 · TRANSMISSION Nº ' +
      seed.toString(16).toUpperCase(),
      FACE_L * S, (CARD_H - 51) * S
    );
    if ('letterSpacing' in c) c.letterSpacing = '0px';

    pc.toBlob(function (blob) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'MUNICITRON-' + name.replace(/[^A-Za-z0-9]+/g, '-') +
                   '-No' + seed.toString(16).toUpperCase() + '.png';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
    }, 'image/png');
  }

  document.addEventListener('municitron:transmit', function (e) {
    var M = window.MUNICITRON_CITY || {};
    var name = (e.detail && e.detail.name) || M.name || 'YOUR CITY';
    var conditions = (e.detail && e.detail.conditions) || null;
    var pop = M.population || 0;
    var seed = M.seed || 0;
    var fontsReady = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
    fontsReady.then(function () {
      if (frameImg.complete && frameImg.naturalWidth) compose(name, pop, seed, conditions);
      else frameImg.onload = function () { compose(name, pop, seed, conditions); };
    });
  });
})();
