#!/usr/bin/env python3
"""Draw the Opal Assist ribbon icons (16/32/64/80/128 px PNG, transparent ground).

The Office ribbon needs PNGs; the brand mark lives as an SVG
(frontend/current/icons/opal-assist.svg). This draws the same two shapes — the
pebble with its green-to-terracotta gradient and the pale nucleus — filling the
whole canvas, with 8x8 supersampling so the 16 px icon stays crisp. No
third-party libraries: the PNG is written by hand.

Usage:  python3 scripts/build-office-icons.py
"""
import os, struct, zlib

# The SVG's paths, in its 64x64 space. Relative cubic segments: (dx1,dy1, dx2,dy2, dx,dy).
PEBBLE = ((33, 4), [(12, 0, 26, 9, 27, 24), (1, 14, -9, 31, -26, 32), (-17, 1, -31, -10, -30, -26), (1, -17, 17, -30, 29, -30)])
NUCLEUS = ((24, 19), [(7, -2, 14, 2, 15, 9), (1, 6, -5, 11, -12, 11), (-7, 0, -12, -3, -12, -9), (0, -6, 4, -10, 9, -11)])
STOPS = [(0.0, (0x2a, 0xa7, 0x92)), (0.58 / 1.08, (0x0f, 0x7c, 0x6c)), (1.0, (0xcf, 0x7b, 0x57))]


def flatten(path, steps=48):
    (x, y), segs = path
    pts = [(x, y)]
    for dx1, dy1, dx2, dy2, dx, dy in segs:
        p0, p1, p2, p3 = (x, y), (x + dx1, y + dy1), (x + dx2, y + dy2), (x + dx, y + dy)
        for i in range(1, steps + 1):
            t = i / steps; u = 1 - t
            pts.append((u**3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t**3 * p3[0],
                        u**3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t**3 * p3[1]))
        x, y = p3
    return pts


def inside(poly, px, py):
    hit = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]; xj, yj = poly[j]
        if (yi > py) != (yj > py) and px < (xj - xi) * (py - yi) / (yj - yi) + xi:
            hit = not hit
        j = i
    return hit


def gradient(x, y):
    # objectBoundingBox gradient from the pebble's top-left to bottom-right; the last stop sits past the end (1.08).
    t = max(0.0, min(1.0, (((x - 3.9) / 56.2) + ((y - 4) / 56.1)) / 2 / 1.08))
    for (a, ca), (b, cb) in zip(STOPS, STOPS[1:]):
        if t <= b:
            k = (t - a) / (b - a) if b > a else 0
            return tuple(ca[i] + (cb[i] - ca[i]) * k for i in range(3))
    return STOPS[-1][1]


def render(size, ss=8):
    pebble, nucleus = flatten(PEBBLE), flatten(NUCLEUS)
    # The mark fills the canvas: its bounding box (about 4..60) is scaled to the icon with a hair of breathing room.
    pad = max(0.5, size * 0.03)
    scale = (size - 2 * pad) / 57.0
    rows = []
    for py in range(size):
        row = bytearray([0])
        for px in range(size):
            r = g = b = a = 0.0
            for sy in range(ss):
                for sx in range(ss):
                    x = ((px + (sx + 0.5) / ss) - pad) / scale + 3.5
                    y = ((py + (sy + 0.5) / ss) - pad) / scale + 3.5
                    if not inside(pebble, x, y):
                        continue
                    cr, cg, cb = gradient(x, y)
                    if inside(nucleus, x, y):  # white at 55 % over the gradient
                        cr, cg, cb = cr + (255 - cr) * 0.55, cg + (255 - cg) * 0.55, cb + (255 - cb) * 0.55
                    r += cr; g += cg; b += cb; a += 1
            n = ss * ss
            if a:
                row += bytes((round(r / a), round(g / a), round(b / a), round(255 * a / n)))
            else:
                row += b'\x00\x00\x00\x00'
        rows.append(bytes(row))
    return b''.join(rows)


def png(size, raw):
    def chunk(kind, data):
        c = kind + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')


if __name__ == '__main__':
    out = os.path.join(os.path.dirname(__file__), '..', 'frontend', 'current', 'icons', 'office')
    for size in (16, 32, 64, 80, 128):
        path = os.path.join(out, 'opal-assist-%d.png' % size)
        with open(path, 'wb') as f:
            f.write(png(size, render(size)))
        print('wrote', os.path.relpath(path))
