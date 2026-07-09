/* ==========================================================================
   MUNICITRON M-58 — wire photo service
   Nazarban Instrument Works · Est. 1958

   The photo desk: the living canvas is re-shot as a duotone press
   photograph — deep teal shadows into cream highlights, faint
   transmission scanlines, crop marks, and a typeset caption strip —
   and downloaded as a PNG, distinct from the postcard.

   Listens: 'municitron:wirephoto'  (the WIRE PHOTO key on the rail)
   ========================================================================== */

(function () {
  'use strict';

  var TEAL_D  = [22, 51, 47];         // shadow ink
  var CREAM_L = [242, 233, 210];      // paper highlight

  function setFont(c, weight, size, spacing) {
    c.font = weight + ' ' + size + 'px Jost, Futura, sans-serif';
    if ('letterSpacing' in c) c.letterSpacing = spacing + 'px';
  }

  function compose(M) {
    var src = document.getElementById('sim-canvas');
    if (!src || !src.width || !src.height) return;

    var W = 1100;
    var PAD = 30;
    var CAP = 58;
    var imgW = W - PAD * 2;
    var imgH = Math.round(imgW * src.height / src.width);
    imgH = Math.max(200, Math.min(imgH, 640));
    var H = imgH + PAD * 2 + CAP;

    var pc = document.createElement('canvas');
    pc.width = W;
    pc.height = H;
    var c = pc.getContext('2d');

    c.fillStyle = '#F2E9D2';                      // the print stock
    c.fillRect(0, 0, W, H);

    // the exposure: city → duotone with a touch of contrast, plus
    // faint transmission scanlines baked into the emulsion
    c.drawImage(src, PAD, PAD, imgW, imgH);
    var img = c.getImageData(PAD, PAD, imgW, imgH);
    var d = img.data;
    var row;
    for (var i = 0; i < d.length; i += 4) {
      var lum = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
      lum = Math.pow(lum, 1.18);
      row = ((i / 4) / imgW) | 0;
      if (row % 3 === 0) lum *= 0.93;
      d[i]     = TEAL_D[0] + (CREAM_L[0] - TEAL_D[0]) * lum;
      d[i + 1] = TEAL_D[1] + (CREAM_L[1] - TEAL_D[1]) * lum;
      d[i + 2] = TEAL_D[2] + (CREAM_L[2] - TEAL_D[2]) * lum;
    }
    c.putImageData(img, PAD, PAD);

    c.strokeStyle = '#16332F';                    // plate edge
    c.lineWidth = 2;
    c.strokeRect(PAD + 1, PAD + 1, imgW - 2, imgH - 2);

    // press-room crop marks at the corners
    c.strokeStyle = '#D96F32';
    c.lineWidth = 2;
    c.beginPath();
    [[PAD, PAD, 1, 1], [W - PAD, PAD, -1, 1],
     [PAD, PAD + imgH, 1, -1], [W - PAD, PAD + imgH, -1, -1]].forEach(function (m) {
      c.moveTo(m[0] - m[2] * 6, m[1] + m[3] * 14);
      c.lineTo(m[0] - m[2] * 6, m[1] - m[3] * 6);
      c.lineTo(m[0] + m[2] * 14, m[1] - m[3] * 6);
    });
    c.stroke();

    // the caption strip
    var months = M.months || [];
    var when = (M.calendar ? (months[M.calendar.month] || '') + ' ' + M.calendar.year : '');
    var by = PAD + imgH + 36;
    c.textBaseline = 'alphabetic';
    c.fillStyle = '#1E4744';
    setFont(c, '700', 15, 3);
    var caption = 'WIRE PHOTO — CITY OF ' + (M.name || 'UNKNOWN') + ' — ' + when;
    while (caption.length > 8 && c.measureText(caption).width > W * 0.62) {
      caption = caption.slice(0, -2);
    }
    c.fillText(caption, PAD, by);
    c.textAlign = 'right';
    setFont(c, '600', 10, 2.5);
    c.fillStyle = 'rgba(74, 53, 16, 0.6)';
    var era = (M.eras && M.style) ? M.eras[M.style] : null;
    c.fillText('NAZARBAN PHOTO SERVICE' + (era ? ' · ' + era.tag : '') + ' · POP. ' +
               Math.floor(M.population || 0).toLocaleString('en-US'), W - PAD, by);
    c.textAlign = 'left';
    if ('letterSpacing' in c) c.letterSpacing = '0px';

    pc.toBlob(function (blob) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'MUNICITRON-WIRE-PHOTO.png';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
    }, 'image/png');
  }

  document.addEventListener('municitron:wirephoto', function () {
    var M = window.MUNICITRON_CITY;
    if (!M) return;
    var fontsReady = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
    fontsReady.then(function () { compose(M); });
  });
})();
