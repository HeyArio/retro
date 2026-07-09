/* ==========================================================================
   MUNICITRON M-58 — day log printer
   Nazarban Instrument Works · Est. 1958

   Form DL-7: a strip of ticker tape carrying the municipal wire's
   recent traffic — every bulletin the city posted, stamped with the
   civic month and year — composed on an offscreen canvas and
   downloaded as a PNG.

   Listens: 'municitron:daylog'  (the DAY LOG key on the auxiliary rail)
   ========================================================================== */

(function () {
  'use strict';

  var S = 2;                          // CSS px → output px
  var W = 400;                        // tape width; height fits the entries

  var TEAL    = '#1E4744';
  var BRASS   = '#C9A227';
  var ORANGE  = '#D96F32';
  var CREAM   = '#F2E9D2';
  var ENGRAVE = '#4A3510';

  function setFont(c, weight, sizeCss, family, spacingCss) {
    c.font = weight + ' ' + (sizeCss * S) + 'px ' + family;
    if ('letterSpacing' in c) c.letterSpacing = (spacingCss * S) + 'px';
  }

  function compose(M) {
    var log = (M.log || []).slice(-14);
    var months = M.months || [];
    var lineH = 40;
    var top = 148;
    var H = top + Math.max(1, log.length) * lineH + 96;

    var pc = document.createElement('canvas');
    pc.width = W * S;
    pc.height = H * S;
    var c = pc.getContext('2d');
    var cx = (W / 2) * S;

    c.fillStyle = CREAM;                              // the tape stock
    c.fillRect(0, 0, W * S, H * S);

    // sprocket holes down both margins, punched clean through
    c.strokeStyle = 'rgba(74, 53, 16, 0.35)';
    c.lineWidth = 1 * S;
    for (var hy = 22; hy < H - 12; hy += 26) {
      c.beginPath(); c.arc(13 * S, hy * S, 3.5 * S, 0, Math.PI * 2); c.stroke();
      c.beginPath(); c.arc((W - 13) * S, hy * S, 3.5 * S, 0, Math.PI * 2); c.stroke();
    }

    // torn ends: a light zig across top and bottom
    c.strokeStyle = 'rgba(74, 53, 16, 0.25)';
    c.beginPath();
    for (var tx = 0; tx <= W; tx += 16) {
      var ty = (tx / 16) % 2 ? 3 : 7;
      if (tx === 0) c.moveTo(tx * S, ty * S); else c.lineTo(tx * S, ty * S);
    }
    c.stroke();
    c.beginPath();
    for (tx = 0; tx <= W; tx += 16) {
      var by = (tx / 16) % 2 ? H - 3 : H - 7;
      if (tx === 0) c.moveTo(tx * S, by * S); else c.lineTo(tx * S, by * S);
    }
    c.stroke();

    c.textAlign = 'center';
    c.textBaseline = 'alphabetic';

    setFont(c, '600', 9, 'Jost, Futura, sans-serif', 3);
    c.fillStyle = ENGRAVE;
    var era = (M.eras && M.style) ? M.eras[M.style] : null;
    c.fillText((era ? era.company : 'NAZARBAN INSTRUMENT WORKS') + ' · WIRE DESK', cx, 34 * S);

    setFont(c, '700', 21, 'Jost, Futura, sans-serif', 4);
    c.fillStyle = TEAL;
    c.fillText('MUNICIPAL DAY LOG', cx, 62 * S);

    setFont(c, '600', 10, 'Jost, Futura, sans-serif', 3);
    c.fillStyle = ORANGE;
    c.fillText('FORM DL-7 · AS CARRIED ON THE WIRE', cx, 82 * S);

    setFont(c, '600', 11, 'Jost, Futura, sans-serif', 2.5);
    c.fillStyle = TEAL;
    var head = 'CITY OF ' + (M.name || 'UNKNOWN') + ' · POP. ' +
               Math.floor(M.population || 0).toLocaleString('en-US');
    while (c.measureText(head).width > (W - 70) * S) head = head.slice(0, -2);
    c.fillText(head, cx, 106 * S);

    c.fillStyle = 'rgba(74, 53, 16, 0.3)';
    c.fillRect(34 * S, 122 * S, (W - 68) * S, 1 * S);

    var y = top;
    c.textAlign = 'left';
    if (!log.length) {
      setFont(c, '500', 12, 'Cabin, Gill Sans, sans-serif', 1);
      c.fillStyle = 'rgba(30, 71, 68, 0.6)';
      c.fillText('THE WIRE IS QUIET — NOTHING TO REPORT', 34 * S, y * S);
      y += lineH;
    }
    for (var i = 0; i < log.length; i++) {
      var e = log[i];
      var stamp = (months[e.month] || '').slice(0, 3) + ' ' + e.year;
      setFont(c, '600', 8.5, 'Jost, Futura, sans-serif', 2);
      c.fillStyle = ORANGE;
      c.fillText(stamp, 34 * S, y * S);
      setFont(c, '500', 11, 'Cabin, Gill Sans, sans-serif', 0.5);
      c.fillStyle = TEAL;
      var msg = e.msg;
      while (msg.length > 6 && c.measureText(msg).width > (W - 68) * S) {
        msg = msg.slice(0, -2);
      }
      if (msg !== e.msg) msg += '…';
      c.fillText(msg, 34 * S, (y + 15) * S);
      c.fillStyle = 'rgba(74, 53, 16, 0.15)';
      c.fillRect(34 * S, (y + 24) * S, (W - 68) * S, 1 * S);
      y += lineH;
    }

    c.textAlign = 'center';
    setFont(c, '600', 8.5, 'Jost, Futura, sans-serif', 2.5);
    c.fillStyle = 'rgba(74, 53, 16, 0.55)';
    c.fillText('MODEL M-58 OUTPUT · READ AND FILE', cx, (H - 44) * S);
    setFont(c, '600', 8, 'Jost, Futura, sans-serif', 2);
    c.fillText('· END OF TAPE ·', cx, (H - 26) * S);
    c.textAlign = 'left';
    if ('letterSpacing' in c) c.letterSpacing = '0px';

    pc.toBlob(function (blob) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'MUNICITRON-DAY-LOG.png';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
    }, 'image/png');
  }

  document.addEventListener('municitron:daylog', function () {
    var M = window.MUNICITRON_CITY;
    if (!M) return;
    var fontsReady = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
    fontsReady.then(function () { compose(M); });
  });
})();
