#!/usr/bin/env python3
"""Bake real airports, runways, frequencies and navaids into public/data/airports.json.

Source: OurAirports (public domain) - https://ourairports.com/data/
Pass the directory holding airports.csv, runways.csv, airport-frequencies.csv and navaids.csv
as the first argument (or OURAIRPORTS_DIR); they are downloaded into tools/.cache otherwise.
"""
import csv
import json
import math
import os
import sys
import urllib.request

import numpy as np

LAT0, LON0 = 36.1, -117.2
R_EARTH = 6371008.8
HALF_W, HALF_H = 614400.0, 528000.0
FT = 0.3048
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'public', 'data', 'airports.json')
BASE = 'https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/'

CIVIL = ['KSFO', 'KOAK', 'KSJC', 'KSMF', 'KRNO', 'KFAT', 'KMRY', 'KSBA', 'KBUR', 'KLAX', 'KLGB',
         'KSNA', 'KONT', 'KPSP', 'KSAN', 'KLAS', 'KPHX']
MILITARY = ['KEDW', 'KLSV', 'KNKX', 'KNLC', 'KNFL', 'KSUU', 'KLUF', 'KNID', 'KNTD']

# Radio telephony names used by ATC.
SPOKEN = {
    'KSFO': 'San Francisco', 'KOAK': 'Oakland', 'KSJC': 'San Jose', 'KSMF': 'Sacramento',
    'KRNO': 'Reno', 'KFAT': 'Fresno', 'KMRY': 'Monterey', 'KSBA': 'Santa Barbara',
    'KBUR': 'Burbank', 'KLAX': 'Los Angeles', 'KLGB': 'Long Beach', 'KSNA': 'John Wayne',
    'KONT': 'Ontario', 'KPSP': 'Palm Springs', 'KSAN': 'San Diego', 'KLAS': 'Las Vegas',
    'KPHX': 'Phoenix', 'KEDW': 'Edwards', 'KLSV': 'Nellis', 'KNKX': 'Miramar',
    'KNLC': 'Lemoore', 'KNFL': 'Fallon', 'KSUU': 'Travis', 'KLUF': 'Luke',
    'KNID': 'China Lake', 'KNTD': 'Point Mugu',
}
# TRACON serving each field (approach / departure call sign).
TRACON = {
    'KSFO': 'NorCal', 'KOAK': 'NorCal', 'KSJC': 'NorCal', 'KSMF': 'NorCal', 'KRNO': 'NorCal',
    'KMRY': 'NorCal', 'KSUU': 'Travis', 'KFAT': 'Fresno', 'KNLC': 'Lemoore', 'KSBA': 'Santa Barbara',
    'KBUR': 'SoCal', 'KLAX': 'SoCal', 'KLGB': 'SoCal', 'KSNA': 'SoCal', 'KONT': 'SoCal',
    'KPSP': 'SoCal', 'KSAN': 'SoCal', 'KNKX': 'SoCal', 'KNTD': 'Mugu', 'KLAS': 'Las Vegas',
    'KLSV': 'Nellis', 'KPHX': 'Phoenix', 'KLUF': 'Luke', 'KEDW': 'Joshua', 'KNID': 'Joshua',
    'KNFL': 'Fallon',
}
# Published localizer frequencies where known; all others are synthesised.
REAL_ILS = {
    ('KSFO', '28L'): 109.55, ('KSFO', '28R'): 111.7, ('KSFO', '19L'): 108.9,
    ('KLAX', '24R'): 108.5, ('KLAX', '24L'): 111.7, ('KLAX', '25L'): 109.9, ('KLAX', '25R'): 111.1,
    ('KLAX', '06L'): 108.5, ('KLAX', '06R'): 111.7, ('KLAX', '07L'): 111.1, ('KLAX', '07R'): 109.9,
}


# Corrections where the first OurAirports entry is not the primary published frequency.
FREQ_OVERRIDE = {
    'KSFO': {'atis': 118.85, 'departure': 135.1, 'approach': 135.65},
    'KLAX': {'tower': 133.9, 'approach': 124.5},
    'KLAS': {'departure': 125.9},
}


def ll_to_world(lat, lon):
    p, l = math.radians(lat), math.radians(lon)
    p0, l0 = math.radians(LAT0), math.radians(LON0)
    k = 2 * R_EARTH / (1 + math.sin(p0) * math.sin(p) + math.cos(p0) * math.cos(p) * math.cos(l - l0))
    x = k * math.cos(p) * math.sin(l - l0)
    y = k * (math.cos(p0) * math.sin(p) - math.sin(p0) * math.cos(p) * math.cos(l - l0))
    return x, -y


def real_variation(lat, lon):
    """East magnetic variation in degrees, linear fit to the 2025 field over the region."""
    return 11.62 - 0.2525 * (lon - LON0) + 0.113 * (lat - LAT0)


def load(dirname, name):
    path = os.path.join(dirname, name)
    if not os.path.exists(path):
        os.makedirs(dirname, exist_ok=True)
        print('downloading', name)
        urllib.request.urlretrieve(BASE + name, path)
    with open(path, encoding='utf-8') as f:
        return list(csv.DictReader(f))


def fnum(v, default=None):
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def norm_ident(s):
    s = s.strip().upper()
    digits = ''.join(c for c in s if c.isdigit())
    suffix = ''.join(c for c in s if c.isalpha())
    return digits.zfill(2) + suffix


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else os.environ.get(
        'OURAIRPORTS_DIR', os.path.join(HERE, '.cache', 'ourairports'))
    airports = {r['ident']: r for r in load(src, 'airports.csv')}
    runways = load(src, 'runways.csv')
    freqs = load(src, 'airport-frequencies.csv')
    navaids = load(src, 'navaids.csv')

    out = []
    decl_samples = []
    for icao in CIVIL + MILITARY:
        a = airports[icao]
        lat, lon = float(a['latitude_deg']), float(a['longitude_deg'])
        x, z = ll_to_world(lat, lon)
        elev = fnum(a['elevation_ft'], 0.0) * FT
        var = real_variation(lat, lon)
        rws = []
        for r in runways:
            if r['airport_ident'] != icao or r['closed'] == '1':
                continue
            length = fnum(r['length_ft'], 0) * FT
            width = fnum(r['width_ft'], 0) * FT
            if length < 1500 or width < 25:
                continue
            if None in (fnum(r['le_latitude_deg']), fnum(r['he_latitude_deg'])):
                continue
            surf = r['surface'].upper()
            hard = any(k in surf for k in ('ASP', 'CON', 'PEM', 'BIT'))
            if not hard:
                continue
            lx, lz = ll_to_world(float(r['le_latitude_deg']), float(r['le_longitude_deg']))
            hx, hz = ll_to_world(float(r['he_latitude_deg']), float(r['he_longitude_deg']))
            # Grid heading from the low-numbered end toward the high-numbered end.
            grid = math.degrees(math.atan2(hx - lx, -(hz - lz))) % 360
            true_le = fnum(r['le_heading_degT'])
            if true_le is not None:
                # declination that makes grid headings read as the real magnetic headings
                d = (grid - (true_le - var) + 540) % 360 - 180
                decl_samples.append((x, z, d))
            # The CSV positions are pavement ends; use the measured pavement length.
            plen = math.hypot(hx - lx, hz - lz)
            le_elev = fnum(r['le_elevation_ft'])
            he_elev = fnum(r['he_elevation_ft'])
            ends = []
            for ident, ex, ez, hdg, disp, el in (
                (r['le_ident'], lx, lz, grid, r['le_displaced_threshold_ft'], le_elev),
                (r['he_ident'], hx, hz, (grid + 180) % 360, r['he_displaced_threshold_ft'], he_elev),
            ):
                ident = norm_ident(ident)
                end = {
                    'id': ident,
                    'x': round(ex, 1), 'z': round(ez, 1),
                    'hdg': round(hdg, 3),
                    'displaced': round(fnum(disp, 0.0) * FT, 1),
                    'elev': round((el if el is not None else fnum(a['elevation_ft'], 0)) * FT, 2),
                }
                if plen >= 2000:
                    key = (icao, ident)
                    if key in REAL_ILS:
                        end['ils'] = {'freq': REAL_ILS[key], 'synthetic': False}
                    else:
                        seed = sum(ord(c) * (i + 3) for i, c in enumerate(icao + ident))
                        chan = 108.10 + (seed % 20) * 0.20 + (0.05 if (seed // 20) % 2 else 0.0)
                        end['ils'] = {'freq': round(chan, 2), 'synthetic': True}
                ends.append(end)
            rws.append({
                'id': ends[0]['id'] + '/' + ends[1]['id'],
                'length': round(plen, 1),
                'width': round(width, 1),
                'surface': 'concrete' if ('CON' in surf or 'PEM' in surf) else 'asphalt',
                'ends': ends,
            })
        rws.sort(key=lambda r: -r['length'])

        f = {}
        for r in freqs:
            if r['airport_ident'] != icao:
                continue
            mhz = fnum(r['frequency_mhz'])
            if mhz is None:
                continue
            if mhz < 100:  # UHF entries stored as tens of MHz
                mhz *= 10
            t = r['type'].upper()
            desc = r['description'].upper()
            role = None
            if t == 'ATIS' or 'ATIS' in desc:
                role = 'atis'
            elif t in ('CLD', 'CLNC', 'DEL') or 'CLNC' in desc:
                role = 'clearance'
            elif t == 'GND':
                role = 'ground'
            elif t == 'TWR':
                role = 'tower'
            elif t == 'DEP':
                role = 'departure'
            elif t == 'APP':
                role = 'approach'
            elif t == 'A/D':
                f.setdefault('approach', []).append(mhz)
                role = 'departure'
            if role:
                f.setdefault(role, []).append(mhz)
        fr = {}
        for role, vals in f.items():
            vhf = [v for v in vals if 118.0 <= v <= 137.0]
            fr[role] = round((vhf or vals)[0], 3)
        fr.update(FREQ_OVERRIDE.get(icao, {}))
        fr.setdefault('tower', 118.7)
        fr.setdefault('ground', 121.9)
        fr.setdefault('approach', fr.get('departure', 124.0))
        fr.setdefault('departure', fr['approach'])
        fr.setdefault('clearance', fr['ground'])
        fr.setdefault('atis', 127.25)

        out.append({
            'icao': icao,
            'name': a['name'],
            'spoken': SPOKEN[icao],
            'tracon': TRACON[icao],
            'city': a['municipality'],
            'military': icao in MILITARY,
            'lat': round(lat, 6), 'lon': round(lon, 6),
            'x': round(x, 1), 'z': round(z, 1),
            'elev': round(elev, 2),
            'freq': fr,
            'runways': rws,
        })
        print(f"{icao} {a['name'][:38]:38s} rwys={[r['id'] for r in rws]} freq={fr}")

    # Fit the sim declination D(x, z) = d0 + d1*x + d2*z (degrees east).
    A = np.array([[1.0, sx / 1e5, sz / 1e5] for sx, sz, _ in decl_samples])
    b = np.array([d for _, _, d in decl_samples])
    coef, *_ = np.linalg.lstsq(A, b, rcond=None)
    resid = A @ coef - b
    print('declination fit', coef, 'max residual', float(np.abs(resid).max()))

    navs = []
    for n in navaids:
        if n['type'] not in ('VOR', 'VORTAC', 'VOR-DME', 'VORDME'):
            continue
        lat, lon = fnum(n['latitude_deg']), fnum(n['longitude_deg'])
        if lat is None or lon is None or not (30.5 < lat < 41.5 and -125.5 < lon < -109.5):
            continue
        x, z = ll_to_world(lat, lon)
        if abs(x) > HALF_W or abs(z) > HALF_H:
            continue
        navs.append({'id': n['ident'], 'name': n['name'], 'type': n['type'],
                     'freq': round(fnum(n['frequency_khz'], 0) / 1000.0, 2),
                     'x': round(x), 'z': round(z)})
    print(len(navs), 'navaids')

    data = {
        'meta': {
            'source': 'OurAirports (public domain); elevation (c) Mapzen/AWS Terrain Tiles; '
                      'land colour Natural Earth. Not for real-world navigation.',
            'projection': {'type': 'stereographic', 'lat0': LAT0, 'lon0': LON0, 'radius': R_EARTH},
            'declination': {'d0': round(float(coef[0]), 4), 'd1': round(float(coef[1]), 5),
                            'd2': round(float(coef[2]), 5), 'unit': 'deg east per 100 km'},
        },
        'airports': out,
        'navaids': navs,
    }
    with open(OUT, 'w', encoding='utf-8') as fjson:
        json.dump(data, fjson, separators=(',', ':'))
    print('wrote', OUT, os.path.getsize(OUT) // 1024, 'kB')


if __name__ == '__main__':
    main()
