/* ==========================================================================
   MUNICITRON M-58 — newsreel camera
   Nazarban Instrument Works · Est. 1958

   Records six seconds of the living canvas to a WebM file via
   MediaRecorder. Fails silently where the API is unavailable — the
   toy never depends on it.

   Listens: 'municitron:newsreel'
   Emits:   'municitron:newsreel-done'  (the file is on its way down)
   ========================================================================== */

(function () {
  'use strict';

  var DURATION_MS = 6000;
  var recording = false;

  document.addEventListener('municitron:newsreel', function () {
    if (recording) return;
    var canvas = document.getElementById('sim-canvas');
    if (!canvas || !canvas.captureStream || typeof MediaRecorder === 'undefined') {
      console.info('MUNICITRON newsreel: MediaRecorder unavailable in this browser');
      return;
    }
    try {
      var stream = canvas.captureStream(30);
      var options = MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? { mimeType: 'video/webm;codecs=vp9' } : undefined;
      var recorder = new MediaRecorder(stream, options);
      var chunks = [];
      recording = true;
      recorder.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      recorder.onstop = function () {
        recording = false;
        stream.getTracks().forEach(function (t) { t.stop(); });
        if (!chunks.length) return;
        var M = window.MUNICITRON_CITY || {};
        var name = (M.name || 'YOUR-CITY').replace(/[^A-Za-z0-9]+/g, '-');
        var blob = new Blob(chunks, { type: recorder.mimeType || 'video/webm' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'MUNICITRON-NEWSREEL-' + name + '.webm';
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
        document.dispatchEvent(new CustomEvent('municitron:newsreel-done'));
      };
      recorder.start();
      setTimeout(function () {
        if (recorder.state !== 'inactive') recorder.stop();
      }, DURATION_MS);
    } catch (err) {
      recording = false;
      console.info('MUNICITRON newsreel: recording failed —', err && err.message);
    }
  });
})();
