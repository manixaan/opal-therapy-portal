#!/usr/bin/env python3
"""Draw the Opal AI mark — Opal Assist and the Opa AI button — at every size.

The cell (the pebble) is the PORTAL's mark only. The AI has its own: a
golden-angle seed spiral. Thirty-four seeds (a Fibonacci number) are placed
at successive turns of the golden angle, 137.5 degrees, at radius
proportional to sqrt(i), the way a sunflower packs its seeds (Vogel's model).
Seeds grow from the centre out and carry the brand gradient, green
#2aa792 -> teal #0f7c6c -> terracotta #cf7b57, along the diagonal.

Writes, from one geometry:
  frontend/current/icons/opal-assist.svg                    the mark (page, header button, Opa button)
  frontend/current/icons/office/opal-assist-{16..128}.png   Office ribbon, transparent
  frontend/current/icons/assist-{192,512}.png               desktop app, cream rounded tile
  frontend/current/icons/assist-maskable-512.png            desktop app, full-bleed tile
  frontend/current/icons/assist-apple-touch.png             180 px, full-bleed tile

No third-party libraries: a scanline fill and a hand-written PNG, so the
output is byte-stable across rebuilds.

Usage:  python3 scripts/build-ai-icons.py
"""
import math, os, struct, zlib

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'frontend', 'current', 'icons')

SEEDS = 34
GOLDEN = math.pi * (3 - math.sqrt(5))       # 137.507...degrees
SPREAD = 0.86                                # outermost seed centre, in a -1..1 box
R_INNER, R_OUTER = 0.05, 0.13                # seed radius at the centre and at the rim
STOPS = [(0.0, (0x2a, 0xa7, 0x92)), (0.54, (0x0f, 0x7c, 0x6c)), (1.0, (0xcf, 0x7b, 0x57))]
TILE = (0xfa, 0xf6, 0xf0)


def seeds():
    """[(cx, cy, r)] in a -1..1 box, centre first."""
    out = []
    for i in range(1, SEEDS + 1):
        d = SPREAD * math.sqrt((i - 0.5) / SEEDS)
        a = i * GOLDEN
        out.append((d * math.cos(a), d * math.sin(a), R_INNER + (R_OUTER - R_INNER) * i / SEEDS))
    return out


def colour(x, y):
    """Brand gradient along the top-left -> bottom-right diagonal of the -1..1 box."""
    t = max(0.0, min(1.0, ((x + 1) / 2 + (y + 1) / 2) / 2))
    for (a, ca), (b, cb) in zip(STOPS, STOPS[1:]):
        if t <= b:
            k = (t - a) / (b - a)
            return tuple(ca[i] + (cb[i] - ca[i]) * k for i in range(3))
    return STOPS[-1][1]


def render(size, mark=0.92, tile=False, corner=0.0, ss=None):
    """RGBA scanlines (with PNG filter bytes). `mark` = share of the canvas the mark spans."""
    ss = ss or (8 if size <= 64 else 4)
    dots = seeds()
    half = size / 2
    sc = half * mark
    radius = size * corner
    rows = []
    for py in range(size):
        acc = [[0.0, 0.0, 0.0, 0] for _ in range(size)]
        for sy in range(ss):
            gy = py + (sy + 0.5) / ss
            y = (gy - half) / sc
            spans = []  # the seeds this scanline crosses: (x0, x1)
            for cx, cy, r in dots:
                dy = y - cy
                if abs(dy) < r:
                    w = math.sqrt(r * r - dy * dy)
                    spans.append((cx - w, cx + w))
            for px in range(size):
                for sx in range(ss):
                    gx = px + (sx + 0.5) / ss
                    if radius:
                        qx = min(max(gx, radius), size - radius); qy = min(max(gy, radius), size - radius)
                        if (gx - qx) ** 2 + (gy - qy) ** 2 > radius ** 2:
                            continue
                    x = (gx - half) / sc
                    hit = any(x0 <= x <= x1 for x0, x1 in spans)
                    if hit:
                        col = colour(x, y)
                    elif tile:
                        col = TILE
                    else:
                        continue
                    a = acc[px]
                    a[0] += col[0]; a[1] += col[1]; a[2] += col[2]; a[3] += 1
        row = bytearray([0])
        n = ss * ss
        for r, g, b, a in acc:
            row += bytes((round(r / a), round(g / a), round(b / a), round(255 * a / n))) if a else b'\x00\x00\x00\x00'
        rows.append(bytes(row))
    return b''.join(rows)


def png(size, raw):
    def chunk(kind, data):
        c = kind + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))


def svg():
    """64x64 SVG, same geometry; the gradient spans the mark's box like the PNGs."""
    c, s = 32.0, 32.0 * 0.92
    lo, hi = c - s, c + s
    stops = ''.join('<stop offset="%g" stop-color="#%02x%02x%02x"/>' % (o, *rgb) for o, rgb in STOPS)
    circles = ''.join('<circle cx="%.2f" cy="%.2f" r="%.2f"/>' % (c + x * s, c + y * s, r * s) for x, y, r in seeds())
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" role="img" aria-label="Opal Assist">\n'
            '  <!-- The Opal AI mark: 34 seeds on the golden angle (scripts/build-ai-icons.py). The cell is the portal\'s mark, not the AI\'s. -->\n'
            '  <defs><linearGradient id="oa-g" gradientUnits="userSpaceOnUse" x1="%.2f" y1="%.2f" x2="%.2f" y2="%.2f">%s</linearGradient></defs>\n'
            '  <g fill="url(#oa-g)">%s</g>\n'
            '</svg>\n') % (lo, lo, hi, hi, stops, circles)


def write(rel, data):
    path = os.path.join(ROOT, rel)
    with open(path, 'wb') as f:
        f.write(data)
    print('wrote', os.path.relpath(path))


if __name__ == '__main__':
    # Seeds must not touch, or the mark reads as a blob at small sizes.
    d = seeds()
    gap = min(math.hypot(a[0] - b[0], a[1] - b[1]) - a[2] - b[2] for i, a in enumerate(d) for b in d[i + 1:])
    assert gap > 0.01, 'seeds overlap'
    write('opal-assist.svg', svg().encode())
    for size in (16, 32, 64, 80, 128):
        write('office/opal-assist-%d.png' % size, png(size, render(size, mark=0.96)))
    write('assist-192.png', png(192, render(192, mark=0.62, tile=True, corner=0.22)))
    write('assist-512.png', png(512, render(512, mark=0.62, tile=True, corner=0.22)))
    write('assist-maskable-512.png', png(512, render(512, mark=0.52, tile=True)))
    write('assist-apple-touch.png', png(180, render(180, mark=0.62, tile=True)))
