'use strict';

/**
 * MMM GEOMETRY — pure point-in-polygon over the official Modified Monash Model
 * boundaries. No DB, no network.
 *
 * The Department of Health publishes MMM 2023 as a shapefile of seven dissolved
 * multipolygons (one per MM category, built from ABS SA1 2021, GDA94 lon/lat).
 * `parseShapefile` turns that .shp + .dbf into rings; `classifyPoint` decides
 * which category a point falls in. Holes are handled by even-odd parity across
 * all rings of a record: a point is inside a record when it is inside an odd
 * number of that record's rings.
 *
 * GDA94 vs WGS84 (Google geocodes) differ by ~1–2 m in Australia — far below
 * the boundary-proximity margin `classifyWithConfidence` uses to flag a point
 * for review, so no datum shift is applied.
 */

// ── Shapefile parsing (Polygon, shape type 5) ─────────────────────────────

function parseDbf(buf) {
  const count = buf.readUInt32LE(4);
  const headerLen = buf.readUInt16LE(8);
  const recordLen = buf.readUInt16LE(10);
  const fields = [];
  for (let i = 32; buf[i] !== 0x0d; i += 32) {
    fields.push({
      name: buf.slice(i, i + 11).toString('latin1').replace(/\0.*$/, ''),
      type: String.fromCharCode(buf[i + 11]),
      length: buf[i + 16],
    });
  }
  const rows = [];
  for (let r = 0; r < count; r++) {
    const base = headerLen + r * recordLen + 1; // skip deletion flag
    let p = base;
    const row = {};
    for (const f of fields) {
      row[f.name] = buf.slice(p, p + f.length).toString('latin1').trim();
      p += f.length;
    }
    rows.push(row);
  }
  return rows;
}

/**
 * @param {Buffer} shp   the .shp bytes
 * @param {Buffer} dbf   the .dbf bytes
 * @param {object} [opts]
 * @param {string} [opts.codeField='MMM_CODE23']
 * @returns {Array<{mmm:number, rings:Array<{bbox:number[], coords:Float64Array}>}>}
 */
function parseShapefile(shp, dbf, opts = {}) {
  const codeField = opts.codeField || 'MMM_CODE23';
  const attrs = parseDbf(dbf);
  const shapeType = shp.readInt32LE(32);
  if (shapeType !== 5) throw new Error(`Expected Polygon shapefile (type 5), got ${shapeType}`);
  const records = [];
  let pos = 100;
  let idx = 0;
  while (pos + 8 <= shp.length) {
    const contentLen = shp.readInt32BE(pos + 4) * 2;
    const rec = pos + 8;
    const type = shp.readInt32LE(rec);
    if (type === 5) {
      const numParts = shp.readInt32LE(rec + 36);
      const numPoints = shp.readInt32LE(rec + 40);
      const partsAt = rec + 44;
      const pointsAt = partsAt + numParts * 4;
      const starts = [];
      for (let i = 0; i < numParts; i++) starts.push(shp.readInt32LE(partsAt + i * 4));
      const rings = [];
      for (let i = 0; i < numParts; i++) {
        const from = starts[i];
        const to = i + 1 < numParts ? starts[i + 1] : numPoints;
        const coords = new Float64Array((to - from) * 2);
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (let k = from, j = 0; k < to; k++, j += 2) {
          const x = shp.readDoubleLE(pointsAt + k * 16);
          const y = shp.readDoubleLE(pointsAt + k * 16 + 8);
          coords[j] = x; coords[j + 1] = y;
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
        rings.push({ bbox: [minX, minY, maxX, maxY], coords });
      }
      const mmm = Number(attrs[idx] && attrs[idx][codeField]);
      if (!(mmm >= 1 && mmm <= 7)) throw new Error(`Record ${idx} has no valid ${codeField}`);
      records.push({ mmm, rings });
    }
    idx++;
    pos = rec + contentLen;
  }
  return records;
}

// ── Point in polygon ──────────────────────────────────────────────────────

function bboxContains(b, x, y) {
  return x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];
}

/** Ray casting on one closed ring (flat [x0,y0,x1,y1,…]). */
function pointInRing(coords, x, y) {
  let inside = false;
  const n = coords.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const xi = coords[i], yi = coords[i + 1], xj = coords[j], yj = coords[j + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * @param {Array<{mmm:number, bbox:number[], coords:ArrayLike<number>}>} rings
 *        flat list of rings, each tagged with its MM category
 * @returns {number|null} MM category, or null when the point lies in none
 */
function classifyPoint(rings, lng, lat) {
  const parity = new Map();
  for (const r of rings) {
    if (!bboxContains(r.bbox, lng, lat)) continue;
    if (pointInRing(r.coords, lng, lat)) parity.set(r.mmm, !parity.get(r.mmm));
  }
  const hits = [...parity.entries()].filter(([, v]) => v).map(([k]) => k);
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) return Math.min(...hits); // overlapping slivers — caller flags review
  return null;
}

// ~250 m in degrees of latitude; longitude scaled by cos(lat).
const PROBE_METRES = 250;

/**
 * Classify a point and probe four neighbours ~250 m away. When the neighbours
 * disagree the address sits on a boundary and the result is marked
 * low-confidence so the owner confirms it — never guessed silently.
 */
function classifyWithConfidence(rings, lng, lat, probeMetres = PROBE_METRES) {
  const mmm = classifyPoint(rings, lng, lat);
  if (mmm == null) return { mmm: null, confident: false, reason: 'outside_dataset' };
  const dLat = probeMetres / 111320;
  const dLng = probeMetres / (111320 * Math.cos((lat * Math.PI) / 180));
  const around = [
    classifyPoint(rings, lng, lat + dLat),
    classifyPoint(rings, lng, lat - dLat),
    classifyPoint(rings, lng + dLng, lat),
    classifyPoint(rings, lng - dLng, lat),
  ];
  const disagree = around.filter(m => m != null && m !== mmm);
  if (disagree.length) {
    return { mmm, confident: false, reason: 'near_boundary', neighbours: [...new Set(disagree)] };
  }
  return { mmm, confident: true, reason: null };
}

module.exports = { parseShapefile, parseDbf, pointInRing, classifyPoint, classifyWithConfidence };
