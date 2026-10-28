/* ─────────────────────────────────────────────────────────────────────────────
   Address suggestions for standalone pages (19 Oct 2026).

   The portal shell (mockup_v3.html) has its own attachPlacesAutocomplete; the
   first-login profile wizard (onboarding.html) is a separate page and had no
   suggestions at all. This is the same behaviour for pages outside the shell:
   our native input + our own suggestion panel over the server-side Google
   proxy (POST /api/maps/autocomplete, then GET /api/maps/place/:id for the
   coordinates). The API key never reaches the browser.

   Usage:  OpalPlaces.attach(inputEl, function (addr, lat, lng, placeId) { … });
   The picked place's lat / lng / placeId are also left on inputEl.dataset.
   ──────────────────────────────────────────────────────────────────────────── */
(function (global) {
  'use strict';

  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function newToken() {
    return (global.crypto && global.crypto.randomUUID) ? global.crypto.randomUUID()
      : 'tok-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  function attach(inputEl, onSelect) {
    if (!inputEl || inputEl._placesInit) return;
    inputEl._placesInit = true;

    var wrap = inputEl.parentElement;
    if (wrap && getComputedStyle(wrap).position === 'static') wrap.style.position = 'relative';
    var list = document.createElement('div');
    list.className = 'pac-panel';
    list.setAttribute('role', 'listbox');
    list.style.display = 'none';
    wrap.appendChild(list);

    var items = [], hi = -1, seq = 0, timer = null, token = null;

    function close() { list.style.display = 'none'; list.innerHTML = ''; items = []; hi = -1; }
    function choose(i) {
      var it = items[i]; if (!it) return;
      var tok = token; token = null;
      inputEl.value = it.addr;
      close();
      fetch('/api/maps/place/' + encodeURIComponent(it.placeId) + (tok ? '?sessionToken=' + encodeURIComponent(tok) : ''),
        { credentials: 'include' })
        .then(function (r) { return r.ok ? r.json() : {}; })
        .catch(function () { return {}; })
        .then(function (d) {
          var addr = d.addr || it.addr;
          // A named place keeps its name: Place Details returns the street
          // address only, so "Xavier Catholic College" would become
          // "271 Forrest Rd, Hilbert WA 6112". Street addresses are unchanged.
          if (it.isPlace && it.name && addr.toLowerCase().indexOf(it.name.toLowerCase()) === -1) addr = it.name + ', ' + addr;
          var lat = d.lat != null ? String(d.lat) : '', lng = d.lng != null ? String(d.lng) : '';
          inputEl.value = addr;
          if (lat && lng) { inputEl.dataset.lat = lat; inputEl.dataset.lng = lng; }
          inputEl.dataset.placeId = it.placeId;
          if (onSelect) onSelect(addr, lat, lng, it.placeId);
          inputEl.dispatchEvent(new Event('change', { bubbles: true }));
        });
    }
    function render() {
      if (!items.length) { close(); return; }
      list.innerHTML = items.map(function (it, i) {
        return '<button type="button" role="option" class="pac-item' + (i === hi ? ' hi' : '') + '" data-i="' + i + '">' +
          '<span class="pac-name">' + esc(it.name) + '</span>' +
          '<span class="pac-sub">' + esc(it.addr) + '</span></button>';
      }).join('');
      list.style.display = 'block';
    }
    list.addEventListener('mousedown', function (e) { // mousedown wins over input blur
      var b = e.target.closest('.pac-item'); if (!b) return;
      e.preventDefault(); choose(Number(b.dataset.i));
    });
    inputEl.addEventListener('keydown', function (e) {
      if (list.style.display === 'none') return;
      if (e.key === 'ArrowDown') { e.preventDefault(); hi = Math.min(hi + 1, items.length - 1); render(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); hi = Math.max(hi - 1, 0); render(); }
      else if (e.key === 'Enter' && hi >= 0) { e.preventDefault(); choose(hi); }
      else if (e.key === 'Escape') { close(); }
    });
    inputEl.addEventListener('blur', function () { setTimeout(close, 150); });
    inputEl.addEventListener('input', function () {
      var q = inputEl.value.trim();
      delete inputEl.dataset.lat; delete inputEl.dataset.lng; delete inputEl.dataset.placeId;
      if (timer) clearTimeout(timer);
      if (q.length < 2) { close(); return; }
      if (!token) token = newToken();
      timer = setTimeout(function () {
        var mySeq = ++seq;
        fetch('/api/maps/autocomplete', { method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ input: q, sessionToken: token }) })
          .then(function (r) { return r.ok ? r.json() : { suggestions: [] }; })
          .then(function (j) {
            if (mySeq !== seq) return; // a newer query superseded this response
            items = (j.suggestions || []).filter(function (it) { return it.addr && it.placeId; });
            hi = items.length ? 0 : -1;
            render();
          }).catch(function () {});
      }, 150);
    });
  }

  global.OpalPlaces = { attach: attach };
})(window);
