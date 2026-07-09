/* ==========================================================================
   MUNICITRON M-58 — certificate of incorporation
   Nazarban Instrument Works · Est. 1958

   When the census clears 10,000 the machine can issue incorporation
   papers: an ornate landscape certificate (offscreen canvas → PNG)
   bearing the city name, population at time of issue, the municipal
   motto, the corporate seal and Mayor Wembly's confident signature.

   Listens: 'municitron:certificate'  detail {name, population}
   ========================================================================== */

(function () {
  'use strict';

  var S = 2;                          // CSS px → output px
  var W = 900, H = 640;

  var TEAL    = '#1E4744';
  var TRIM    = '#16332F';
  var BRASS   = '#C9A227';
  var ORANGE  = '#D96F32';
  var CREAM   = '#F2E9D2';
  var ENGRAVE = '#4A3510';

  function setFont(c, weight, sizeCss, family, spacingCss) {
    c.font = weight + ' ' + (sizeCss * S) + 'px ' + family;
    if ('letterSpacing' in c) c.letterSpacing = (spacingCss * S) + 'px';
  }

  function starburst(c, x, y, r) {
    c.strokeStyle = BRASS;
    c.lineWidth = 2 * S;
    c.beginPath();
    for (var i = 0; i < 8; i++) {
      var a = i * Math.PI / 4 + Math.PI / 8;
      c.moveTo(x + Math.cos(a) * r * 0.35, y + Math.sin(a) * r * 0.35);
      c.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    c.stroke();
    c.fillStyle = ORANGE;
    c.beginPath(); c.arc(x, y, 3 * S, 0, Math.PI * 2); c.fill();
  }

  function compose(name, pop, seed, motto) {
    var pc = document.createElement('canvas');
    pc.width = W * S;
    pc.height = H * S;
    var c = pc.getContext('2d');
    var cx = (W / 2) * S;

    c.fillStyle = CREAM;                              // the parchment field
    c.fillRect(0, 0, W * S, H * S);
    c.strokeStyle = TEAL;                             // outer rule
    c.lineWidth = 8 * S;
    c.strokeRect(16 * S, 16 * S, (W - 32) * S, (H - 32) * S);
    c.strokeStyle = BRASS;                            // inner brass rule
    c.lineWidth = 2 * S;
    c.strokeRect(30 * S, 30 * S, (W - 60) * S, (H - 60) * S);

    starburst(c, 56 * S, 56 * S, 16 * S);             // corner devices
    starburst(c, (W - 56) * S, 56 * S, 16 * S);
    starburst(c, 56 * S, (H - 56) * S, 16 * S);
    starburst(c, (W - 56) * S, (H - 56) * S, 16 * S);

    c.textAlign = 'center';
    c.textBaseline = 'alphabetic';

    // the letterhead speaks the age being simulated (js/city.js ERAS)
    var Mc2 = window.MUNICITRON_CITY || {};
    var eraC2 = (Mc2.eras && Mc2.style) ? Mc2.eras[Mc2.style] : null;
    setFont(c, '600', 12, 'Jost, Futura, sans-serif', 5);
    c.fillStyle = ENGRAVE;
    c.fillText((eraC2 ? eraC2.company : 'NAZARBAN INSTRUMENT WORKS') + ' · MUNICIPAL SIMULATION UNIT', cx, 78 * S);

    // the headline, teal over a flat orange offset (house style),
    // shrunk as a whole line until it clears the rules
    var headline = 'CERTIFICATE OF INCORPORATION';
    var hSize = 42;
    setFont(c, '700', hSize, 'Jost, Futura, sans-serif', 6);
    while (hSize > 22 && c.measureText(headline).width > (W - 140) * S) {
      hSize -= 2;
      setFont(c, '700', hSize, 'Jost, Futura, sans-serif', 6);
    }
    c.fillStyle = 'rgba(217, 111, 50, 0.35)';
    c.fillText(headline, cx + 2 * S, 142 * S + 2 * S);
    c.fillStyle = TEAL;
    c.fillText(headline, cx, 142 * S);

    setFont(c, '500', 15, 'Cabin, Gill Sans, sans-serif', 3);
    c.fillStyle = ENGRAVE;
    c.fillText('KNOW ALL CITIZENS BY THESE PRESENTS THAT THE SETTLEMENT OF', cx, 196 * S);

    // the city name, shrunk as a whole line if it runs long
    var size = 56;
    setFont(c, '700', size, 'Jost, Futura, sans-serif', 8);
    while (size > 28 && c.measureText(name).width > (W - 160) * S) {
      size -= 2;
      setFont(c, '700', size, 'Jost, Futura, sans-serif', 8);
    }
    c.fillStyle = ORANGE;
    c.fillText(name, cx, 268 * S);
    var nameW = Math.max(c.measureText(name).width, 300 * S);
    c.fillStyle = ENGRAVE;
    c.fillRect(cx - nameW / 2, 282 * S, nameW, 3 * S);

    setFont(c, '500', 15, 'Cabin, Gill Sans, sans-serif', 3);
    c.fillText('IS HEREBY INCORPORATED AS A MUNICIPALITY OF THE FIRST CLASS', cx, 330 * S);
    c.fillText('POP. ' + pop.toLocaleString('en-US') + ' AT TIME OF ISSUE', cx, 362 * S);

    setFont(c, '600', 17, 'Jost, Futura, sans-serif', 4);
    c.fillStyle = TEAL;
    c.fillText('MOTTO: “' + motto + '”', cx, 408 * S);

    // the corporate seal, bottom left
    var sx = 190 * S, sy = 498 * S;
    c.strokeStyle = BRASS;
    c.lineWidth = 4 * S;
    c.beginPath(); c.arc(sx, sy, 50 * S, 0, Math.PI * 2); c.stroke();
    c.lineWidth = 1.5 * S;
    c.beginPath(); c.arc(sx, sy, 42 * S, 0, Math.PI * 2); c.stroke();
    starburst(c, sx, sy, 28 * S);
    setFont(c, '700', 11, 'Jost, Futura, sans-serif', 3);
    c.fillStyle = ENGRAVE;
    c.fillText('CORPORATE SEAL', sx, 570 * S);

    // Mayor Wembly signs anything, bottom right
    var gx = (W - 250) * S;
    c.font = 'italic 700 ' + (30 * S) + 'px Cabin, Georgia, serif';
    if ('letterSpacing' in c) c.letterSpacing = '0px';
    c.fillStyle = TEAL;
    c.fillText('H. Wembly', gx, 528 * S);
    c.fillStyle = ENGRAVE;
    c.fillRect(gx - 110 * S, 540 * S, 220 * S, 2 * S);
    setFont(c, '600', 11, 'Jost, Futura, sans-serif', 3);
    c.fillText('MAYOR — OFFICE OF THE MAYOR', gx, 562 * S);

    setFont(c, '600', 9.5, 'Jost, Futura, sans-serif', 2.5);
    c.fillStyle = 'rgba(74, 53, 16, 0.55)';
    c.fillText('FORM CI-9 · ISSUED BY MODEL M-58 · TRANSMISSION Nº ' +
               seed.toString(16).toUpperCase(), cx, (H - 44) * S);
    c.textAlign = 'left';
    if ('letterSpacing' in c) c.letterSpacing = '0px';

    pc.toBlob(function (blob) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'MUNICITRON-CERTIFICATE-' + name.replace(/[^A-Za-z0-9]+/g, '-') + '.png';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
    }, 'image/png');
  }

  document.addEventListener('municitron:certificate', function (e) {
    var M = window.MUNICITRON_CITY || {};
    var name = (e.detail && e.detail.name) || M.name || 'YOUR CITY';
    var pop = (e.detail && e.detail.population) || M.population || 0;
    var fontsReady = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
    fontsReady.then(function () {
      compose(name, Math.floor(pop), M.seed || 0, M.motto || 'INDUSTRIA ET CIVITAS');
    });
  });
})();
