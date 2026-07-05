/* ==========================================================================
   MUNICITRON M-58 — commissioner's record
   Nazarban Instrument Works · Est. 1958

   Form CR-5: a record about the operator, not the city. Reads the
   municipal ledger (localStorage) — commission date, visits, cities
   governed, requests honored, keys to the city, and the civic firsts
   with their dates — and downloads it as a PNG.

   Listens: 'municitron:record'  (typed code LEDGER, or the odometer)
   ========================================================================== */

(function () {
  'use strict';

  var S = 2;
  var W = 620, H = 860;

  var TEAL    = '#1E4744';
  var BRASS   = '#C9A227';
  var ORANGE  = '#D96F32';
  var CREAM   = '#F2E9D2';
  var ENGRAVE = '#4A3510';

  var FIRSTS = {
    snow:          'FIRST SNOWFALL WITNESSED',
    aurora:        'FIRST AURORA WITNESSED',
    landmark:      'FIRST LANDMARK COMMISSIONED',
    benefaction:   'FIRST BENEFACTION ENTERED',
    incorporation: 'FIRST INCORPORATION FILED',
    object:        'FIRST UNEXPLAINED OBJECT LOGGED',
    almanac:       'FIRST ALMANAC CONSULTED',
    newsreel:      'FIRST NEWSREEL FILMED',
    telecast:      'FIRST TELECAST TUNED',
    request:       'FIRST CIVIC REQUEST HONORED',
    record:        'FIRST SELF-AUDIT REQUESTED'
  };

  function setFont(c, weight, sizeCss, family, spacingCss) {
    c.font = weight + ' ' + (sizeCss * S) + 'px ' + family;
    if ('letterSpacing' in c) c.letterSpacing = (spacingCss * S) + 'px';
  }

  function fmtDate(ms) {
    try {
      var d = new Date(ms);
      return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }).toUpperCase();
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

  function compose(M) {
    var L = M.ledger || { records: {}, visits: 1, firstVisit: Date.now() };
    var pc = document.createElement('canvas');
    pc.width = W * S;
    pc.height = H * S;
    var c = pc.getContext('2d');
    var cx = (W / 2) * S;

    c.fillStyle = CREAM;
    c.fillRect(0, 0, W * S, H * S);
    c.strokeStyle = TEAL;
    c.lineWidth = 3 * S;
    c.strokeRect(20 * S, 20 * S, (W - 40) * S, (H - 40) * S);

    c.textAlign = 'center';
    c.textBaseline = 'alphabetic';

    function fitLine(text, weight, size, spacing, maxW) {
      setFont(c, weight, size, 'Jost, Futura, sans-serif', spacing);
      while (size > 7 && c.measureText(text).width > maxW * S) {
        size -= 0.5;
        spacing = Math.max(1, spacing - 0.25);
        setFont(c, weight, size, 'Jost, Futura, sans-serif', spacing);
      }
    }

    fitLine('NAZARBAN INSTRUMENT WORKS · OFFICE OF PERSONNEL', '600', 11, 4, W - 90);
    c.fillStyle = ENGRAVE;
    c.fillText('NAZARBAN INSTRUMENT WORKS · OFFICE OF PERSONNEL', cx, 58 * S);

    fitLine('COMMISSIONER’S RECORD', '700', 30, 5, W - 90);
    c.fillStyle = TEAL;
    c.fillText('COMMISSIONER’S RECORD', cx, 100 * S);
    setFont(c, '600', 13, 'Jost, Futura, sans-serif', 4);
    c.fillStyle = ORANGE;
    c.fillText('FORM CR-5 · SERVICE TO DATE', cx, 126 * S);

    var days = Math.max(1, Math.ceil((Date.now() - (L.firstVisit || Date.now())) / 86400000));
    var gratitude = L.gratitude || 0;
    var rows = [
      ['COMMISSIONED', fmtDate(L.firstVisit || Date.now())],
      ['DAYS OF SERVICE', String(days)],
      ['INSPECTIONS LOGGED', String(L.visits || 1)],
      ['CITIES GOVERNED', String(citiesGoverned())],
      ['CURRENT POST', 'CITY OF ' + (M.name || 'UNKNOWN')],
      ['REQUESTS HONORED', String(gratitude)],
      ['KEYS TO THE CITY', String(Math.floor(gratitude / 3))]
    ];
    var y = 176;
    c.textAlign = 'left';
    for (var i = 0; i < rows.length; i++) {
      setFont(c, '600', 11, 'Jost, Futura, sans-serif', 3);
      c.fillStyle = ORANGE;
      c.fillText(rows[i][0], 60 * S, y * S);
      setFont(c, '500', 15, 'Cabin, Gill Sans, sans-serif', 1.5);
      c.fillStyle = TEAL;
      c.fillText(rows[i][1], 60 * S, (y + 22) * S);
      c.fillStyle = 'rgba(74, 53, 16, 0.25)';
      c.fillRect(60 * S, (y + 32) * S, (W - 120) * S, 1 * S);
      y += 48;
    }

    // the civic firsts, in the order they were earned
    y += 14;
    setFont(c, '600', 12, 'Jost, Futura, sans-serif', 3);
    c.fillStyle = ORANGE;
    c.fillText('CIVIC FIRSTS ON RECORD', 60 * S, y * S);
    y += 24;
    var entries = [];
    var recs = L.records || {};
    for (var key in recs) {
      if (FIRSTS[key]) entries.push([Date.parse(recs[key]) || 0, FIRSTS[key], recs[key]]);
    }
    entries.sort(function (a, b) { return a[0] - b[0]; });
    if (!entries.length) {
      setFont(c, '500', 13, 'Cabin, Gill Sans, sans-serif', 1.5);
      c.fillStyle = 'rgba(30, 71, 68, 0.6)';
      c.fillText('NONE YET — THE LEDGER AWAITS', 60 * S, y * S);
      y += 24;
    }
    for (i = 0; i < entries.length && i < 9; i++) {
      setFont(c, '500', 12.5, 'Cabin, Gill Sans, sans-serif', 1);
      c.fillStyle = TEAL;
      c.fillText('✶ ' + entries[i][1], 60 * S, y * S);
      setFont(c, '600', 9.5, 'Jost, Futura, sans-serif', 2);
      c.fillStyle = 'rgba(74, 53, 16, 0.55)';
      c.textAlign = 'right';
      c.fillText(fmtDate(entries[i][0]), (W - 60) * S, y * S);
      c.textAlign = 'left';
      y += 24;
    }

    // personnel stamp
    c.save();
    c.translate((W - 92) * S, (H - 150) * S);
    c.rotate(0.08);
    c.strokeStyle = BRASS;
    c.lineWidth = 3 * S;
    c.beginPath(); c.arc(0, 0, 42 * S, 0, Math.PI * 2); c.stroke();
    c.lineWidth = 1.5 * S;
    c.beginPath(); c.arc(0, 0, 35 * S, 0, Math.PI * 2); c.stroke();
    c.textAlign = 'center';
    setFont(c, '700', 10.5, 'Jost, Futura, sans-serif', 2);
    c.fillStyle = BRASS;
    c.fillText('FIT FOR', 0, -3 * S);
    c.fillText('SERVICE', 0, 10 * S);
    c.restore();

    c.textAlign = 'center';
    var footer = 'MODEL M-58 OUTPUT · THE MACHINE THANKS YOU FOR YOUR GOVERNANCE';
    fitLine(footer, '600', 9.5, 2.5, W - 90);
    c.fillStyle = 'rgba(74, 53, 16, 0.55)';
    c.fillText(footer, cx, (H - 40) * S);
    c.textAlign = 'left';
    if ('letterSpacing' in c) c.letterSpacing = '0px';

    pc.toBlob(function (blob) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'MUNICITRON-COMMISSIONERS-RECORD.png';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
    }, 'image/png');
  }

  document.addEventListener('municitron:record', function () {
    var M = window.MUNICITRON_CITY;
    if (!M) return;
    var fontsReady = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
    fontsReady.then(function () { compose(M); });
  });
})();
