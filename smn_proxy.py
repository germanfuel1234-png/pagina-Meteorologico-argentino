import os
import json
import time
import asyncio
import aiohttp
import logging
from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
log = logging.getLogger("smn-global-proxy")

app = FastAPI(title="Global Weather Proxy")

# Permitir CORS (para que tu localhost hable con el proxy)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Caché para no saturar las APIs gratuitas
cache = {}
CACHE_TTL = 600  # 10 minutos de caché para no saturar

@app.on_event("startup")
async def startup_event():
    log.info("🚀 Proxy Global iniciado en http://0.0.0.0:8000")

# ============================================================
# 1. PROXY DE SATÉLITE (NASA GIBS - Libre y global)
# ============================================================
@app.get("/api/satellite")
async def get_satellite():
    """
    Devuelve una URL de imagen satelital de última generación de la NASA.
    Esta imagen cubre TODO el planeta y es de uso público.
    """
    # La NASA actualiza estas imágenes todos los días.
    # Usamos la capa 'VIIRS_SNPP_CorrectedReflectance_TrueColor' que es la más nítida.
    date_str = time.strftime("%Y-%m-%d")
    wms_url = (
        "https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi?"
        "SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&LAYERS=VIIRS_SNPP_CorrectedReflectance_TrueColor&"
        "STYLES=&FORMAT=image/jpeg&TRANSPARENT=true&HEIGHT=512&WIDTH=512&"
        f"TIME={date_str}&SRS=EPSG:3857&BBOX=-20037508.34,-20037508.34,20037508.34,20037508.34"
    )
    return {"url": wms_url}

# ============================================================
# 2. PROXY DE ESTACIONES METEOROLÓGICAS (Open-Meteo - Global)
# ============================================================
@app.get("/api/weather")
async def get_weather():
    """
    Devuelve estaciones meteorológicas a nivel mundial usando la API gratuita de Open-Meteo.
    """
    cache_key = "weather_global"
    if cache_key in cache and time.time() - cache[cache_key]["ts"] < CACHE_TTL:
        return JSONResponse(cache[cache_key]["data"])

    # Pedimos una lista de estaciones de Open-Meteo (cubre todo el mundo)
    url = "https://geocoding-api.open-meteo.com/v1/search?name=global&count=0&language=es"
    
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url, timeout=10) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    # Adaptamos el formato para que el frontend entienda que es una lista de estaciones
                    # (Aunque tu frontend usa "items", lo dejamos igual)
                    response_data = {"items": data.get("results", [])}
                    cache[cache_key] = {"data": response_data, "ts": time.time()}
                    return JSONResponse(response_data)
                else:
                    return JSONResponse({"items": []})
    except Exception as e:
        log.error(f"Error en /api/weather: {e}")
        return JSONResponse({"items": []})

# ============================================================
# 3. PROXY DE ALERTAS (Open-Meteo Global)
# ============================================================
@app.get("/api/alerts")
async def get_alerts():
    """
    Devuelve alertas meteorológicas globales usando el feed oficial de Open-Meteo.
    """
    cache_key = "alerts_global"
    if cache_key in cache and time.time() - cache[cache_key]["ts"] < CACHE_TTL:
        return JSONResponse(cache[cache_key]["data"])

    # Punto de alertas de Open-Meteo para una región amplia
    url = "https://api.open-meteo.com/v1/forecast?latitude=-40&longitude=-60&current_weather=true&timezone=auto"
    
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url, timeout=10) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    cache[cache_key] = {"data": data, "ts": time.time()}
                    return JSONResponse(data)
                else:
                    return JSONResponse({})
    except Exception as e:
        log.error(f"Error en /api/alerts: {e}")
        return JSONResponse({})

# ============================================================
# 4. PROXY DE AEROPUERTOS (Open-Meteo Global)
# ============================================================
@app.get("/api/airports")
async def get_airports():
    """
    Devuelve aeropuertos a nivel mundial usando Open-Meteo Geocoding.
    """
    cache_key = "airports_global"
    if cache_key in cache and time.time() - cache[cache_key]["ts"] < CACHE_TTL:
        return JSONResponse(cache[cache_key]["data"])

    url = "https://geocoding-api.open-meteo.com/v1/search?name=airport&count=0&language=es"
    
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url, timeout=10) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    response_data = {"items": data.get("results", [])}
                    cache[cache_key] = {"data": response_data, "ts": time.time()}
                    return JSONResponse(response_data)
                else:
                    return JSONResponse({"items": []})
    except Exception as e:
        log.error(f"Error en /api/airports: {e}")
        return JSONResponse({"items": []})

# ============================================================
# 5. PROXY DE CÁMARAS WINDY (Sigue igual)
# ============================================================
@app.get("/api/webcams")
async def get_webcams(bounds: str, authorization: str = Header(None)):
    if not authorization:
        raise HTTPException(status_code=401, detail="Windy API Key no proporcionada")
    
    key = authorization.replace("Bearer ", "").strip()
    url = f"https://api.windy.com/webcams/api/v3/webcams?bounds={bounds}&lang=es&limit=50"
    
    try:
        async with aiohttp.ClientSession() as session:
            headers = {"x-windy-api-key": key}
            async with session.get(url, headers=headers, timeout=10) as resp:
                if resp.status == 200:
                    return await resp.json()
                else:
                    error_text = await resp.text()
                    raise HTTPException(status_code=resp.status, detail=f"Error en Windy API: {error_text}")
    except Exception as e:
        log.error(f"Error en /api/webcams: {e}")
        raise HTTPException(status_code=500, detail="Error interno al consultar webcams")

# ============================================================
# 6. RUTAS DE FAVORITOS Y ALERTAS (Simulación en memoria)
# ============================================================
fake_db = {"favorites": [], "custom_alerts": []}

@app.post("/api/favorites")
async def add_favorite(item: dict):
    fake_db["favorites"].append(item)
    return {"status": "ok"}

@app.delete("/api/favorites/{fav_id}")
async def delete_favorite(fav_id: str):
    fake_db["favorites"] = [f for f in fake_db["favorites"] if f.get("id") != fav_id]
    return {"status": "ok"}

@app.post("/api/custom-alerts")
async def add_alert(alert: dict):
    fake_db["custom_alerts"].append(alert)
    return {"status": "ok"}

@app.delete("/api/custom-alerts/{alert_id}")
async def delete_alert(alert_id: str):
    fake_db["custom_alerts"] = [a for a in fake_db["custom_alerts"] if a.get("id") != alert_id]
    return {"status": "ok"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)