#!/usr/bin/env python3
"""Draw the Opal Assist desktop-app icons (installable web app / Add to Dock).

Same mark as scripts/build-office-icons.py — the Opal cell — but at app sizes,
on the page's cream tile so it reads as an app in the Dock, Start menu and
taskbar. A scanline fill keeps 512 px quick without third-party libraries.

  icons/assist-192.png, icons/assist-512.png   tile, rounded corners
  icons/assist-maskable-512.png                full-bleed tile, mark in the safe zone
  icons/assist-apple-touch.png                 180 px, full-bleed (iOS/macOS round it)

Usage:  python3 scripts/build-assist-app-icons.py
"""
import importlib.util, os

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location('office_icons', os.path.join(HERE, 'build-office-icons.py'))
oi = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(oi)

TILE = (0xfa, 0xf6, 0xf0)


def crossings(poly, y):
    xs = []
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]; xj, yj = poly[j]
        if (yi > y) != (yj > y):
            xs.append((xj - xi) * (y - yi) / (yj - yi) + xi)
        j = i
    xs.sort()
    return xs


def inside_sorted(xs, x):
    n = 0
    for c in xs:
        if c > x:
            break
        n += 1
    return n % 2 == 1


def render(size, mark_frac, corner_frac, ss=4):
    pebble, nucleus = oi.flatten(oi.PEBBLE), oi.flatten(oi.NUCLEUS)
    mark = size * mark_frac
    off = (size - mark) / 2
    scale = mark / 57.0
    radius = size * corner_frac
    rows = []
    for py in range(size):
        acc = [[0.0, 0.0, 0.0, 0.0] for _ in range(size)]
        for sy in range(ss):
            gy = py + (sy + 0.5) / ss
            my = (gy - off) / scale + 3.5
            pc, nc = crossings(pebble, my), crossings(nucleus, my)
            for px in range(size):
                for sx in range(ss):
                    gx = px + (sx + 0.5) / ss
                    # rounded-rect tile
                    if radius:
                        cx = min(max(gx, radius), size - radius); cy = min(max(gy, radius), size - radius)
                        if (gx - cx) ** 2 + (gy - cy) ** 2 > radius ** 2:
                            continue
                    mx = (gx - off) / scale + 3.5
                    col = TILE
                    if inside_sorted(pc, mx):
                        col = oi.gradient(mx, my)
                        if inside_sorted(nc, mx):
                            col = tuple(c + (255 - c) * 0.55 for c in col)
                    a = acc[px]
                    a[0] += col[0]; a[1] += col[1]; a[2] += col[2]; a[3] += 1
        row = bytearray([0])
        n = ss * ss
        for r, g, b, a in acc:
            row += bytes((round(r / a), round(g / a), round(b / a), round(255 * a / n))) if a else b'\x00\x00\x00\x00'
        rows.append(bytes(row))
    return b''.join(rows)


if __name__ == '__main__':
    out = os.path.join(HERE, '..', 'frontend', 'current', 'icons')
    jobs = [
        ('assist-192.png', 192, 0.66, 0.22),
        ('assist-512.png', 512, 0.66, 0.22),
        ('assist-maskable-512.png', 512, 0.56, 0),
        ('assist-apple-touch.png', 180, 0.66, 0),
    ]
    for name, size, mark, corner in jobs:
        path = os.path.join(out, name)
        with open(path, 'wb') as f:
            f.write(oi.png(size, render(size, mark, corner)))
        print('wrote', os.path.relpath(path))
