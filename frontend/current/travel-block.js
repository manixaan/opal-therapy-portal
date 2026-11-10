/* ═══════════════════════════════════════════════════════════════════════════
   TRAVEL BLOCK (10 Nov 2026)

   A billable, non-face-to-face booking type in Smart Booking: a start and an
   end location, nothing else. Google Maps (fetchRoute, through /api/maps)
   prices the drive at the booking's start time and that becomes the block's
   length. A client is optional; the block sits on the calendar it is booked
   on (yours, or the therapist the Scheduling Assistant handed over).

   The block is saved with category "Travel", so the server classifies it
   event_type 'travel' (billable, travel rate) and travel.js treats it as a
   travel block: it adds no drive of its own around it. The route rides in
   the booking metadata (booking-rules.js cleanTravelRoute).

   Globals reached at call time: fetchRoute, attachPlacesAutocomplete,
   whereAtMin, _getBspTiming, bspSetDur, currentBookingLeaf, showToast.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  var TB = global.TravelBlock = global.TravelBlock || {};
  var ST = { from: '', to: '', route: null, seq: 0 };
  var MAX_MIN = 240; // the booking panel's duration slider tops out at 4 h

  function $(id) { return document.getElementById(id); }
  function fn(name) { return typeof global[name] === 'function'; }
  function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function isTravelLeaf() { var l = fn('currentBookingLeaf') ? global.currentBookingLeaf() : null; return !!(l && l.group === 'travel'); }

  /* PURE — the short name of an address: its first part ("12 Smith St"), or
     the place name Google gave ("Willetton Library"). */
  function shortPlace(addr) {
    var s = String(addr || '').trim();
    var first = s.split(',')[0].trim();
    return first || s;
  }
  TB.shortPlace = shortPlace;

  /* PURE — the event title for a route. */
  TB.titleFor = function (from, to) { return 'Travel: ' + shortPlace(from) + ' → ' + shortPlace(to); };

  function status(kind, html) {
    var el = $('travel-route-status'); if (!el) return;
    el.hidden = !html;
    el.className = 'bsp-route-status' + (kind ? ' ' + kind : '');
    el.innerHTML = html || '';
  }

  function readInputs() {
    ST.from = ($('travel-from') && $('travel-from').value || '').trim();
    ST.to = ($('travel-to') && $('travel-to').value || '').trim();
  }

  /* Price the drive and set the block's length from it. */
  TB.recalc = async function () {
    readInputs();
    ST.route = null;
    if (!ST.from || !ST.to) { status('', ''); return; }
    if (ST.from.toLowerCase() === ST.to.toLowerCase()) { status('warn', 'The start and end are the same place.'); return; }
    if (!fn('fetchRoute')) { status('warn', 'Routing is not available right now — set the length yourself.'); return; }
    var seq = ++ST.seq;
    status('', 'Working out the drive…');
    var t = fn('_getBspTiming') ? global._getBspTiming() : null;
    var r = null;
    try {
      r = await global.fetchRoute(ST.from, ST.to, 'driving', t && t.startISO ? { departureTime: t.startISO } : undefined);
    } catch (e) { r = null; }
    if (seq !== ST.seq) return; // a newer edit is already being priced
    if (!r || !(r.durationMin > 0)) { status('warn', 'Could not work out this drive — check both addresses, or set the length yourself.'); return; }
    var km = r.distanceMeters ? Math.round(r.distanceMeters / 100) / 10 : null;
    ST.route = { from: ST.from, to: ST.to, minutes: r.durationMin, distanceKm: km };
    // Round up to the next 5 minutes: the block covers the whole drive.
    var len = Math.min(MAX_MIN, Math.max(5, Math.ceil(r.durationMin / 5) * 5));
    if (fn('bspSetDur')) global.bspSetDur(len);
    var est = r.source !== 'routes-api';
    status(est ? 'warn' : 'ok',
      '<strong>' + r.durationMin + ' min</strong>' + (km != null ? ' · ' + km + ' km' : '') +
      (est ? ' · estimate (Google Maps unavailable)' : ' · Google Maps, at the start time') +
      (r.durationMin > MAX_MIN ? ' · block capped at 4 h' : '') +
      ' — block set to ' + len + ' min');
  };

  /* Chosen in the picker: fill the start with where you are at that time. */
  TB.onSelect = function () {
    var loc = document.querySelector('.bsp-loc-field');
    if (loc) loc.hidden = true; // the route replaces the single Location field
    var from = $('travel-from'), to = $('travel-to');
    if (fn('attachPlacesAutocomplete')) {
      if (from) global.attachPlacesAutocomplete(from, function () { TB.recalc(); });
      if (to) global.attachPlacesAutocomplete(to, function () { TB.recalc(); });
    }
    if (from && !from.value.trim() && fn('whereAtMin') && fn('_getBspTiming')) {
      var t = global._getBspTiming();
      var here = t && t.day ? global.whereAtMin(t.day, t.startH * 60 + (t.startM || 0)) : null;
      if (here && here.address) from.value = here.address;
    }
    if (from && to && from.value.trim() && to.value.trim()) TB.recalc();
  };

  /* Another booking type chosen: the Location field comes back. */
  TB.onLeave = function () {
    var loc = document.querySelector('.bsp-loc-field');
    if (loc) loc.hidden = false;
  };

  TB.reset = function () {
    ['travel-from', 'travel-to'].forEach(function (id) { var el = $(id); if (el) el.value = ''; });
    ST.from = ''; ST.to = ''; ST.route = null; ST.seq++;
    status('', '');
    TB.onLeave();
  };

  /* For Create appointment: { from, to, minutes?, distanceKm? } or null. */
  TB.route = function () {
    readInputs();
    if (!ST.from || !ST.to) return null;
    if (ST.route && ST.route.from === ST.from && ST.route.to === ST.to) return Object.assign({}, ST.route);
    return { from: ST.from, to: ST.to }; // typed without a fresh lookup — kept as given
  };

  /* Detail panel rows for a saved travel block. */
  TB.detailRows = function (s, row) {
    var b = s && s.booking;
    var r = b && b.group === 'travel' && b.route;
    if (!r || typeof row !== 'function') return [];
    var out = [row('<span class="section-head" style="margin:0;">Travel</span>', '', true)];
    out.push(row('From', esc(r.from)));
    out.push(row('To', esc(r.to)));
    if (r.minutes) out.push(row('Drive', r.minutes + ' min' + (r.distanceKm != null ? ' · ' + r.distanceKm + ' km' : '')));
    return out;
  };

  document.addEventListener('DOMContentLoaded', function () {
    ['travel-from', 'travel-to'].forEach(function (id) {
      var el = $(id); if (!el) return;
      el.addEventListener('change', function () { if (isTravelLeaf()) TB.recalc(); });
    });
  });
})(window);
