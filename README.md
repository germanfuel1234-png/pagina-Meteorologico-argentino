# Mapa interactivo del tiempo · SMN (Argentina)

Un mapa meteorológico completo para Argentina con estética tipo **Windy.com**
pero bajo la marca y fuentes del **Servicio Meteorológico Nacional (SMN)**, listo
para desplegar en tu propio servidor. Antes de leer este README tené presente
que el proyecto son dos partes que trabajan juntas:

| Archivo          | Rol                                                        |
|------------------|------------------------------------------------------------|
| `index.html`     | Frontend (Leaflet + canvas): capas, línea de tiempo, UI.   |
| `smn_proxy.py`   | Backend FastAPI: consulta y **cachea** datos del SMN.      |
| `docker-compose.yml` | Build y orquestación (nginx + FastAPI + Redis).        |

---

## ✨ Características

- **Estaciones oficiales del SMN** en tiempo real (observación de red estaciones).
- **Avisos / zonas de alerta del SMN** en el mapa y panel de alertas.
- **Satélite GOES-16 / VIIRS** sobre Argentina (NASA GIBS, libre).
- **Radar de precipitación** (RainViewer, sin clave) con línea de tiempo animada.
- **Capas de datos**: temperatura, viento, nubes, lluvia, humedad, presión, olas y
  calidad del aire, sobre grilla real **Open-Meteo** (GFS / ECMWF / ICON).
- **Línea de tiempo** para recorrer el pronóstico y animar radar/satélite.
- **Mapa base Mapa / Satélite**, buscador de ciudades (OpenStreetMap), historial,
  webcams en vivo y vista Windy integrada.
- **Responsive** y con despliegue en contenedores (Docker Compose).

---

## 🧱 Arquitectura

```
                    ┌────────────────────────────┐
  navegador ───────▶│  nginx (frontend)          │
   /index.html      │  sirve index.html + /api → │
                    └──────────────┬─────────────┘
                                   │ /api/*
                    ┌──────────────▼─────────────┐
                    │  FastAPI  smn_proxy.py      │  cachea y normaliza
                    │  • /api/weather (SMN)       │
                    │  • /api/alerts  (SMN)       │
                    │  • /api/forecast (Open-Meteo)│
                    │  • /api/radar (RainViewer)  │
                    └──────────────┬─────────────┘
                                   │ (Redis, opcional)
                          fuentes upstream:
                    ws.smn.gob.ar · api.open-meteo.com
                    api.rainviewer.com · GIBS/NASA
```

El proxy centraliza lo que el frontend necesita (SMN + modelos + radar),
**cachea** cada respuesta y refresca en segundo plano, de modo que:
- no se saturan las APIs públicas,
- la carga se sirve rápido en Argentina,
- si una fuente cae, devuelve JSON vacío sin romper el mapa.

---

## 🚀 Instalación rápida (Docker, recomendado)

Prerrequisito: tener **Docker** y **Docker Compose v2**.

```bash
git clone <tu-repositorio> && cd pagina-tano
docker compose up --build -d
```

Abrir: <http://localhost:8080>

El frontend usa rutas relativas `/api/*`, así que Nginx resuelve todo sin CORS.

---

## 💻 Instalación manual (sin Docker, desarrollo)

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Correr el backend (una de las dos opciones)
uvicorn smn_proxy:app --host 0.0.0.0 --port 8000
python smn_proxy.py
```

El proxy sirve el propio `index.html` desde `/` (mismo directorio), así que podés
abrir http://localhost:8000. Si el proxy corré en otro origen, el frontend lo
detecta: al abrir en localhost usa http://localhost:8000. Para otro host, definí
antes de usar la app `window.SMN_PROXY_BASE = '/api';` (o la URL del proxy).

---

## ⚙️ Configuración (variables de entorno del backend)

| Variable          | Default                                     | Descripción                                   |
|-------------------|---------------------------------------------|-----------------------------------------------|
| `REDIS_URL`       | *(vacío → memoria)*                         | Cache compartida, ej. `redis://redis:6379/0`  |
| `REFRESH_MINUTES` | `15`                                        | Intervalo de refresco de datos del SMN (min). |
| `PORT`            | `8000`                                      | Puerto de uvicorn.                            |
| `SMN_WEATHER_URL` | `https://ws.smn.gob.ar/map_items/weather`   | Observaciones de estaciones (SMN).            |
| `SMN_ALERT_URL`   | `https://ws.smn.gob.ar/map_items/alert`     | Avisos / zonas de alerta (SMN).               |
| `SMN_CITIES_URL`  | `https://ws.smn.gob.ar/cities`              | Ciudades con pronóstico (SMN).                |
| `GOES_TILE_LAYER` | NASA GIBS WMS (se compone con z/x/y)        | Capa de satélite GOES-16 alternativa.         |

En Docker los valores se setean en el servicio `backend` del `docker-compose.yml`.

---

## 🔑 ¿Se necesitan API keys?

- **NO** para funcionar de base: los datos del SMN, Open-Meteo, RainViewer, GIBS
  y OpenStreetMap son públicos y sin clave.
- **Opcional (clave Windy)** si querés webcams dinámicas y timelapses en vivo:
  entrá tu clave `wx_…` en *Capas → Clave Windy API* (solo vive en tu navegador).
- Si vas a exponer el proxy en producción, restringí la lista `*` del CORS del
  archivo `smn_proxy.py` a tu dominio y protegé Nginx (HTTPS, rate-limit).

---

## 🚢 Despliegue en producción (servidor propio)

1. Subí todo el proyecto a tu VPS (requisito: Docker + Compose).
2. Ajustá `docker-compose.yml`: `REFRESH_MINUTES` y, si lo tenés, `REDIS_URL`.
3. Levantá y verifiqué:

```bash
docker compose up --build -d
curl http://localhost:8080/api/health   # -> {"status":"ok",...}
docker compose ps
```

4. **Nginx / HTTPS**: el archivo `nginx.conf` es de muestra (HTTP). Para exponer
   afuera poné un certificado (por ejemplo Let's Encrypt vía `certbot`) y pasá
   a HTTPS. Recomendado: dejar que un Nginx del host haga de borde y solo exponer
   el contenedor `frontend` sobre localhost.

### Estructura de archivos del proyecto

```
.
├── index.html            # Frontend (Leaflet + canvas)
├── smn_proxy.py          # Backend FastAPI (consulta + cache del SMN)
├── requirements.txt      # Dependencias de Python del backend
├── docker-compose.yml    # Orquestación: nginx + fastapi + redis
├── Dockerfile.backend    # Imagen del backend FastAPI
├── Dockerfile.frontend   # Imagen Nginx (frontend)
└── nginx.conf            # Proxy inverso /api -> backend
```

---

## ⚠️ Detalles y limitaciones honestas

- **SMN público (`ws.smn.gob.ar`)**: son servicios sin documentación formal y
  pueden devolver `4xx/5xx`, bloquear ciertos orígenes o cambiar su esquema.
  Por eso el proxy **normaliza y degrauda con elegancia**: si el SMN no está
  disponible, las capas *Estaciones SMN* y *Alertas SMN* quedan vacías sin romper
  el resto del mapa (que sigue usando Open-Meteo, RainViewer y GIBS).
- En este repositorio no se incluyen claves de terceros ni datos precargados
  oficiales del SMN (marcas, logos y avisos pertenecen al SMN). Podés colocar el
  logo oficial en `frontend/` y referenciarlo en el encabezado si lo autoriza el
  organismo.
- Las capas *Radar* (RainViewer) y *Satélite GOES-16* (GIBS/VIIRS) usan fuentes
  libres alternativas; si SMN publicara un WMS/WMTS de radar propio, bastará con
  apuntar `GOES_TILE_LAYER` / un tile URL equivalente en el frontend.
- **Idea de mejora**: `smn_proxy.py` guarda en memoria; agregar Redis (ya
  integrado vía `REDIS_URL`) es la vía recomendada para varias réplicas.

---

## 🧪 Ver qué fuente se está usando

El *chip* del encabezado (`#meta-text`) y los textos de ayuda de cada capa
(`#layer-meta`) describen la fuente activa (proxy SMN, Open-Meteo, RainViewer,
GIBS...). El endpoint `/api/config` lista las URLs upstream actuales.