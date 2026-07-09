/* ==========================================================================
   MUNICITRON M-58 — postcard album
   Nazarban Instrument Works · Est. 1958

   The commissioner's collection: every transmitted postcard is pasted
   into an album (localStorage, newest first, a dozen kept — see
   js/postcard.js for the pasting). The FORMS dial's ALBUM detent opens
   the book; clicking a card revisits the city that mailed it.

   Listens: 'municitron:album'
   ========================================================================== */

(function () {
  'use strict';

  var KEY = 'municitron-album';
  var overlay = document.getElementById('album-overlay');
  var grid = document.getElementById('album-grid');
  var close = document.getElementById('album-close');
  if (!overlay || !grid || !close) return;

  function readAlbum() {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]'); }
    catch (err) { return []; }
  }

  function fill() {
    var cards = readAlbum();
    grid.innerHTML = '';
    if (!cards.length) {
      var empty = document.createElement('div');
      empty.className = 'album-empty';
      empty.textContent = 'NO CARDS ON FILE — TRANSMIT ONE AND RETURN';
      grid.appendChild(empty);
      return;
    }
    cards.forEach(function (card) {
      var fig = document.createElement('figure');
      fig.className = 'album-card';
      var img = document.createElement('img');
      img.src = card.img;
      img.alt = 'Postcard from ' + (card.name || 'a city');
      img.loading = 'lazy';
      var cap = document.createElement('figcaption');
      var when = '';
      try {
        when = new Date(card.when).toLocaleDateString('en-US',
          { month: 'short', day: 'numeric' }).toUpperCase();
      } catch (err) {}
      cap.textContent = (card.name || 'CITY') +
        (card.era ? ' · ' + card.era : '') +
        (card.edition ? ' · ' + card.edition : '') +
        (when ? ' · ' + when : '');
      fig.appendChild(img);
      fig.appendChild(cap);
      if (typeof card.seed === 'number') {
        fig.setAttribute('data-seed', String(card.seed));
        fig.title = 'REVISIT THIS CITY — ?seed=' + card.seed;
        fig.addEventListener('click', function () {
          window.location.href = '?seed=' + card.seed;
        });
      }
      grid.appendChild(fig);
    });
  }

  document.addEventListener('municitron:album', function () {
    fill();
    overlay.hidden = false;
  });
  close.addEventListener('click', function () { overlay.hidden = true; });
  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) overlay.hidden = true;
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') overlay.hidden = true;
  });
})();
