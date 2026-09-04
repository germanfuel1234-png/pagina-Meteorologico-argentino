#!/usr/bin/env python3
"""
Baja el viento en 10 m (UGRD/VGRD) del último ciclo de GFS 0.25° disponible en
NOMADS, recortado a la región de Argentina, lo decodifica y publica un JSON
compacto en public/wind-latest.json para servir desde GitHub Pages.

No requiere cuenta ni clave: NOMADS es público. El filtro de NOMADS ya recorta
al bounding box y a las variables pedidas, así que la descarga es liviana
(no se baja el GRIB2 global).
"""
import datetime
import json
import os
import sys
import urllib.parse
import urllib.request

import cfgrib
import numpy as np

# Bounding box de la región de interés (Argentina + margen)
BBOX = {"left": -76.0, "right": -52.0, "top": -20.0, "bottom": -57.0}

# Downsample: 1 = resolución nativa (0.25°), 2 = cada 2do punto, etc.
STRIDE = 2

NOMADS_BASE = "https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl"
OUT_PATH = os.path.join(os.path.dirname(__file__), "..", "public", "wind-latest.json")


def latest_cycle(now=None):
    """Ciclo GFS más reciente con datos ya publicados (00/06/12/18Z, con ~4h de rezago)."""
    now = now or datetime.datetime.utcnow()
    lagged = now - datetime.timedelta(hours=4, minutes=30)
    cycle_hour = (lagged.hour // 6) * 6
    cycle_dt = lagged.replace(hour=cycle_hour, minute=0, second=0, microsecond=0)
    return cycle_dt


def build_url(cycle_dt, fhour=0):
    date_str = cycle_dt.strftime("%Y%m%d")
    hh = cycle_dt.strftime("%H")
    params = {
        "file": f"gfs.t{hh}z.pgrb2.0p25.f{fhour:03d}",
        "lev_10_m_above_ground": "on",
        "var_UGRD": "on",
        "var_VGRD": "on",
        "subregion": "",
        "leftlon": str(BBOX["left"]),
        "rightlon": str(BBOX["right"]),
        "toplat": str(BBOX["top"]),
        "bottomlat": str(BBOX["bottom"]),
        "dir": f"/gfs.{date_str}/{hh}/atmos",
    }
    qs = "&".join(f"{k}={urllib.parse.quote(str(v))}" for k, v in params.items())
    return f"{NOMADS_BASE}?{qs}"


def download(url, dest):
    req = urllib.request.Request(url, headers={"User-Agent": "smn-viento/1.0"})
    with urllib.request.urlopen(req, timeout=120) as r, open(dest, "wb") as f:
        f.write(r.read())


def main():
    cycle_dt = latest_cycle()
    grib_path = "/tmp/gfs_wind.grib2"
    last_err = None
    # Reintenta con ciclos anteriores si el más reciente todavía no está publicado
    for back in range(0, 4):
        try_cycle = cycle_dt - datetime.timedelta(hours=6 * back)
        url = build_url(try_cycle)
        try:
            download(url, grib_path)
            if os.path.getsize(grib_path) > 1000:
                cycle_dt = try_cycle
                break
        except Exception as e:  # noqa: BLE001
            last_err = e
    else:
        print(f"No se pudo bajar ningún ciclo reciente: {last_err}", file=sys.stderr)
        sys.exit(1)

    ds = cfgrib.open_datasets(grib_path)
    u = v = None
    for d in ds:
        if "u10" in d.variables:
            u = d["u10"]
        if "v10" in d.variables:
            v = d["v10"]
    if u is None or v is None:
        print("No se encontraron variables u10/v10 en el GRIB2", file=sys.stderr)
        sys.exit(1)

    lats = u.latitude.values[::STRIDE]
    lons = u.longitude.values[::STRIDE]
    uu = u.values[::STRIDE, ::STRIDE]
    vv = v.values[::STRIDE, ::STRIDE]

    out = {
        "updated": datetime.datetime.utcnow().isoformat() + "Z",
        "cycle": cycle_dt.strftime("%Y-%m-%dT%H:00:00Z"),
        "source": "NOAA GFS 0.25° · NOMADS · 10 m AGL",
        "lat0": float(lats[0]),
        "lon0": float(lons[0]),
        "dlat": float(lats[1] - lats[0]) if len(lats) > 1 else 0.25 * STRIDE,
        "dlon": float(lons[1] - lons[0]) if len(lons) > 1 else 0.25 * STRIDE,
        "rows": len(lats),
        "cols": len(lons),
        "u": np.round(uu.flatten(), 2).tolist(),
        "v": np.round(vv.flatten(), 2).tolist(),
    }

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"OK: {out['rows']}x{out['cols']} puntos · ciclo {out['cycle']} → {OUT_PATH}")


if __name__ == "__main__":
    main()
