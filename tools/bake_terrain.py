#!/usr/bin/env python3
"""Bake real-world elevation and land colour for Takeoff - Flight Simulator.

Outputs (in public/data):
  terrain.png    2048x1760 RGB. R,G = big-endian uint16 of (elevation_m + 500) * 4.
                 B = 0 land, 128 lake, 255 ocean.
  landcover.jpg  1024x880 RGB land colour.

Sources:
  Elevation  - Mapzen / AWS Terrain Tiles (Terrarium encoding), zoom 8.
  Land cover - Natural Earth II 10m "NE2_HR_LC" (public domain). Pass the path of
               NE2_HR_LC.tif as the first argument or in NE2_TIF; skipped if absent.
"""
import math
import os
import sys
import urllib.request
from collections import deque
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None

LAT0, LON0 = 36.1, -117.2
R_EARTH = 6371008.8
W, H, CELL = 2048, 1760, 600.0
LC_W, LC_H, LC_CELL = 1024, 880, 1200.0
ZOOM = 8
HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.environ.get('TERRAIN_CACHE', os.path.join(HERE, '.cache', 'terrarium'))
OUT = os.path.join(HERE, '..', 'public', 'data')
URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'


def world_to_ll(x, z):
    """Inverse spherical stereographic projection. x east, z south (metres)."""
    y = -z
    phi0 = math.radians(LAT0)
    rho = np.sqrt(x * x + y * y)
    rho = np.where(rho < 1e-9, 1e-9, rho)
    c = 2.0 * np.arctan(rho / (2.0 * R_EARTH))
    sinc, cosc = np.sin(c), np.cos(c)
    lat = np.arcsin(cosc * math.sin(phi0) + y * sinc * math.cos(phi0) / rho)
    lon = math.radians(LON0) + np.arctan2(x * sinc, rho * math.cos(phi0) * cosc - y * math.sin(phi0) * sinc)
    return np.degrees(lat), np.degrees(lon)


def grid_ll(w, h, cell):
    xs = (np.arange(w) - w / 2 + 0.5) * cell
    zs = (np.arange(h) - h / 2 + 0.5) * cell
    X, Z = np.meshgrid(xs, zs)
    return world_to_ll(X, Z)


def fetch_tile(args):
    x, y = args
    path = os.path.join(CACHE, f'{ZOOM}_{x}_{y}.png')
    if not os.path.exists(path):
        for attempt in range(4):
            try:
                with urllib.request.urlopen(URL.format(z=ZOOM, x=x, y=y), timeout=60) as r:
                    data = r.read()
                with open(path, 'wb') as f:
                    f.write(data)
                break
            except Exception as e:  # noqa: BLE001
                if attempt == 3:
                    raise
    img = np.asarray(Image.open(path).convert('RGB'), dtype=np.float32)
    return x, y, img[..., 0] * 256.0 + img[..., 1] + img[..., 2] / 256.0 - 32768.0


def bilinear(src, px, py):
    h, w = src.shape[:2]
    px = np.clip(px, 0, w - 1.001)
    py = np.clip(py, 0, h - 1.001)
    x0 = np.floor(px).astype(np.int64)
    y0 = np.floor(py).astype(np.int64)
    fx = (px - x0)
    fy = (py - y0)
    if src.ndim == 3:
        fx = fx[..., None]
        fy = fy[..., None]
    a = src[y0, x0]
    b = src[y0, x0 + 1]
    c = src[y0 + 1, x0]
    d = src[y0 + 1, x0 + 1]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def bake_elevation():
    os.makedirs(CACHE, exist_ok=True)
    lat, lon = grid_ll(W, H, CELL)
    n = 2 ** ZOOM
    tx = (lon + 180.0) / 360.0 * n
    latr = np.radians(lat)
    ty = (1.0 - np.log(np.tan(latr) + 1.0 / np.cos(latr)) / math.pi) / 2.0 * n
    x0, x1 = int(math.floor(tx.min())), int(math.floor(tx.max()))
    y0, y1 = int(math.floor(ty.min())), int(math.floor(ty.max()))
    jobs = [(x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)]
    print(f'fetching {len(jobs)} terrain tiles (x {x0}-{x1}, y {y0}-{y1})')
    mosaic = np.zeros(((y1 - y0 + 1) * 256, (x1 - x0 + 1) * 256), dtype=np.float32)
    with ThreadPoolExecutor(8) as ex:
        for x, y, tile in ex.map(fetch_tile, jobs):
            mosaic[(y - y0) * 256:(y - y0 + 1) * 256, (x - x0) * 256:(x - x0 + 1) * 256] = tile
    # Pixel centres sit at +0.5.
    elev = bilinear(mosaic, (tx - x0) * 256.0 - 0.5, (ty - y0) * 256.0 - 0.5).astype(np.float32)
    print('elevation range', float(elev.min()), float(elev.max()))

    # --- ocean: flood fill from the borders over cells at or below sea level
    cand = elev <= 0.5
    ocean = np.zeros_like(cand)
    dq = deque()
    for i in range(W):
        for j in (0, H - 1):
            if cand[j, i] and not ocean[j, i]:
                ocean[j, i] = True
                dq.append((j, i))
    for j in range(H):
        for i in (0, W - 1):
            if cand[j, i] and not ocean[j, i]:
                ocean[j, i] = True
                dq.append((j, i))
    while dq:
        j, i = dq.popleft()
        for dj, di in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            a, b = j + dj, i + di
            if 0 <= a < H and 0 <= b < W and cand[a, b] and not ocean[a, b]:
                ocean[a, b] = True
                dq.append((a, b))
    print('ocean cells', int(ocean.sum()))

    # --- lakes: connected exactly-flat regions on land
    flat = np.zeros_like(cand)
    e = elev
    same_r = np.abs(e[:, 1:] - e[:, :-1]) < 0.02
    same_d = np.abs(e[1:, :] - e[:-1, :]) < 0.02
    cnt = np.zeros(e.shape, dtype=np.int8)
    cnt[:, 1:] += same_r
    cnt[:, :-1] += same_r
    cnt[1:, :] += same_d
    cnt[:-1, :] += same_d
    flat = (cnt >= 3) & ~ocean
    lake = np.zeros_like(cand)
    seen = np.zeros_like(cand)
    for j0, i0 in zip(*np.nonzero(flat)):
        if seen[j0, i0]:
            continue
        comp = [(j0, i0)]
        seen[j0, i0] = True
        dq = deque(comp)
        h0 = e[j0, i0]
        while dq:
            j, i = dq.popleft()
            for dj, di in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                a, b = j + dj, i + di
                if 0 <= a < H and 0 <= b < W and not seen[a, b] and not ocean[a, b] and abs(e[a, b] - h0) < 0.05:
                    seen[a, b] = True
                    comp.append((a, b))
                    dq.append((a, b))
        if len(comp) >= 14:
            for j, i in comp:
                lake[j, i] = True
    print('lake cells', int(lake.sum()))

    # --- synthetic sea bed deepening away from the coast
    dist = np.where(ocean, 9999, 0).astype(np.int32)
    for step in range(1, 24):
        nb = np.full_like(dist, 9999)
        nb[1:, :] = np.minimum(nb[1:, :], dist[:-1, :])
        nb[:-1, :] = np.minimum(nb[:-1, :], dist[1:, :])
        nb[:, 1:] = np.minimum(nb[:, 1:], dist[:, :-1])
        nb[:, :-1] = np.minimum(nb[:, :-1], dist[:, 1:])
        upd = ocean & (dist > nb + 1)
        if not upd.any():
            break
        dist = np.where(upd, nb + 1, dist)
    seabed = -np.minimum(90.0, 2.0 + 4.0 * dist.astype(np.float32))
    elev = np.where(ocean, seabed, np.maximum(elev, -450.0))
    # Land touching the ocean must stay above the waterline.
    elev = np.where(~ocean & (elev < 0.6) & (elev > -1.0), 0.8, elev)

    enc = np.clip(np.round((elev + 500.0) * 4.0), 0, 65535).astype(np.uint16)
    rgb = np.zeros((H, W, 3), dtype=np.uint8)
    rgb[..., 0] = enc >> 8
    rgb[..., 1] = enc & 255
    rgb[..., 2] = np.where(ocean, 255, np.where(lake, 128, 0))
    path = os.path.join(OUT, 'terrain.png')
    Image.fromarray(rgb, 'RGB').save(path, optimize=True)
    print('wrote', path, os.path.getsize(path) // 1024, 'kB')
    return elev, ocean, lake


def bake_landcover(tif):
    lat, lon = grid_ll(LC_W, LC_H, LC_CELL)
    im = Image.open(tif)
    sw, sh = im.size
    ppd = sw / 360.0
    px = (lon + 180.0) * ppd - 0.5
    py = (90.0 - lat) * ppd - 0.5
    x0, x1 = int(px.min()) - 2, int(px.max()) + 3
    y0, y1 = int(py.min()) - 2, int(py.max()) + 3
    crop = np.asarray(im.crop((x0, y0, x1, y1)).convert('RGB'), dtype=np.float32)
    out = bilinear(crop, px - x0, py - y0)
    path = os.path.join(OUT, 'landcover.jpg')
    Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), 'RGB').save(path, quality=90)
    print('wrote', path, os.path.getsize(path) // 1024, 'kB')


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    bake_elevation()
    tif = sys.argv[1] if len(sys.argv) > 1 else os.environ.get('NE2_TIF')
    if tif and os.path.exists(tif):
        bake_landcover(tif)
    else:
        print('NE2_HR_LC.tif not given - keeping existing landcover.jpg')
