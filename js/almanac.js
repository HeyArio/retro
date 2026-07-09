/* ==========================================================================
   MUNICITRON M-58 — municipal almanac
   Nazarban Instrument Works · Est. 1958

   Clicking the engraved city plate on the canvas issues Form CA-2: a
   typewritten civic profile (offscreen canvas → PNG) — founding year,
   chief exports, local bird and dish, disputed rainfall, the motto,
   and the sister city with the transmission number to actually visit
   it (?seed=N is a real, working address).

   Listens: 'municitron:almanac'
   ========================================================================== */

(function () {
  'use strict';

  var S = 2;                          // CSS px → output px
  var W = 620, H = 860;

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
    var A = M.almanac;
    var pc = document.createElement('canvas');
    pc.width = W * S;
    pc.height = H * S;
    var c = pc.getContext('2d');
    var cx = (W / 2) * S;

    c.fillStyle = CREAM;                              // the form stock
    c.fillRect(0, 0, W * S, H * S);
    c.strokeStyle = TEAL;                             // single office rule
    c.lineWidth = 3 * S;
    c.strokeRect(20 * S, 20 * S, (W - 40) * S, (H - 40) * S);

    c.textAlign = 'center';
    c.textBaseline = 'alphabetic';

    // shrink a letterspaced line until it clears the office rule
    function fitLine(text, weight, size, spacing, maxW) {
      setFont(c, weight, size, 'Jost, Futura, sans-serif', spacing);
      while (size > 7 && c.measureText(text).width > maxW * S) {
        size -= 0.5;
        spacing = Math.max(1, spacing - 0.25);
        setFont(c, weight, size, 'Jost, Futura, sans-serif', spacing);
      }
    }

    // the letterhead speaks the age being simulated (js/city.js ERAS)
    var era = (M.eras && M.style) ? M.eras[M.style] : null;
    var letterhead = (era ? era.company : 'NAZARBAN INSTRUMENT WORKS') + ' · MUNICIPAL RECORDS DIVISION';
    fitLine(letterhead, '600', 11, 4, W - 90);
    c.fillStyle = ENGRAVE;
    c.fillText(letterhead, cx, 58 * S);

    setFont(c, '700', 30, 'Jost, Futura, sans-serif', 5);
    c.fillStyle = TEAL;
    c.fillText('MUNICIPAL ALMANAC', cx, 100 * S);
    var subline = 'FORM CA-2 · ' + (era ? era.tag + ' EDITION · ' : '') + 'ISSUED ANNUALLY OR ON DEMAND';
    fitLine(subline, '600', 13, 4, W - 90);
    c.fillStyle = ORANGE;
    c.fillText(subline, cx, 126 * S);

    // the subject municipality
    var size = 34;
    setFont(c, '700', size, 'Jost, Futura, sans-serif', 6);
    while (size > 20 && c.measureText(M.name).width > (W - 120) * S) {
      size -= 2;
      setFont(c, '700', size, 'Jost, Futura, sans-serif', 6);
    }
    c.fillStyle = TEAL;
    c.fillText(M.name, cx, 176 * S);
    c.fillStyle = ENGRAVE;
    c.fillRect(cx - 140 * S, 188 * S, 280 * S, 2 * S);

    // the ledger rows
    var rows = [
      ['SETTLED', 'A.D. ' + A.founded],
      ['INCORPORATED', M.population >= 10000 ? 'YES — SEE FORM CI-9' : 'PENDING (POP. 10,000)'],
      ['POPULATION AT PRESS', Math.floor(M.population).toLocaleString('en-US')],
      ['SITUATION', A.situation || (M.harbor ? 'HARBOR TOWN — MIND THE FERRY' : 'INLAND — STOUT PRAIRIE STOCK')],
      ['CHIEF EXPORTS', A.exports],
      ['MUNICIPAL BIRD', A.bird],
      ['DISH OF RECORD', A.dish],
      ['ANNUAL RAINFALL', A.rainfall],
      ['MOTTO', '“' + M.motto + '”'],
      ['SISTER CITY', A.sister],
      ['REACHABLE VIA', 'TRANSMISSION Nº ' + A.sisterSeed.toString(16).toUpperCase()]
    ];
    var y = 240;
    c.textAlign = 'left';
    for (var i = 0; i < rows.length; i++) {
      setFont(c, '600', 11, 'Jost, Futura, sans-serif', 3);
      c.fillStyle = ORANGE;
      c.fillText(rows[i][0], 60 * S, y * S);
      setFont(c, '500', 15, 'Cabin, Gill Sans, sans-serif', 1.5);
      c.fillStyle = TEAL;
      c.fillText(rows[i][1], 60 * S, (y + 22) * S);
      c.fillStyle = 'rgba(74, 53, 16, 0.25)';         // ledger rule
      c.fillRect(60 * S, (y + 32) * S, (W - 120) * S, 1 * S);
      y += 48;
    }

    // travel advisory: the sister city is a real address
    c.textAlign = 'center';
    setFont(c, '600', 11, 'Jost, Futura, sans-serif', 2.5);
    c.fillStyle = ENGRAVE;
    c.fillText('TO VISIT THE SISTER CITY, TUNE YOUR MUNICITRON TO', cx, (y + 14) * S);
    setFont(c, '700', 14, 'Jost, Futura, sans-serif', 3);
    c.fillStyle = ORANGE;
    c.fillText('?seed=' + A.sisterSeed, cx, (y + 36) * S);

    // the records stamp, slightly crooked as stamps are
    c.save();
    c.translate((W - 90) * S, (H - 160) * S);
    c.rotate(-0.1);
    c.strokeStyle = BRASS;
    c.lineWidth = 3 * S;
    c.beginPath(); c.arc(0, 0, 44 * S, 0, Math.PI * 2); c.stroke();
    c.lineWidth = 1.5 * S;
    c.beginPath(); c.arc(0, 0, 37 * S, 0, Math.PI * 2); c.stroke();
    setFont(c, '700', 11, 'Jost, Futura, sans-serif', 2);
    c.fillStyle = BRASS;
    c.fillText('RECORDS', 0, -4 * S);
    c.fillText('DIVISION', 0, 10 * S);
    c.restore();

    var footer = 'MODEL M-58 OUTPUT · TRANSMISSION Nº ' + (M.seed || 0).toString(16).toUpperCase() +
                 ' · DISPUTES BY MAIL';
    fitLine(footer, '600', 9.5, 2.5, W - 90);
    c.fillStyle = 'rgba(74, 53, 16, 0.55)';
    c.fillText(footer, cx, (H - 40) * S);
    c.textAlign = 'left';
    if ('letterSpacing' in c) c.letterSpacing = '0px';

    pc.toBlob(function (blob) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'MUNICITRON-ALMANAC-' + M.name.replace(/[^A-Za-z0-9]+/g, '-') + '.png';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
    }, 'image/png');
  }

  document.addEventListener('municitron:almanac', function () {
    var M = window.MUNICITRON_CITY;
    if (!M || !M.almanac) return;
    var fontsReady = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
    fontsReady.then(function () { compose(M); });
  });
})();
