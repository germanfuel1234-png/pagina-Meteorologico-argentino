# Catálogo de APIs y Fuentes de Datos Gratuitas

Este documento reúne las fuentes de datos en tiempo real, conjuntos de datos públicos y librerías necesarias para integrar capas de información geoespacial en la plataforma 3D.

---

## 1. Satélites y Mecánica Orbital
* **CelesTrak / NORAD**
  * **Tipo:** API REST / Archivos TLE (Two-Line Element).
  * **Uso:** Obtención de elementos orbitales actualizados de satélites activos (ej. ISS, GOES, SAOCOM, Starlink).
  * **Costo:** Gratis (Acceso público sin API Key).
  * **URL:** `https://celestrak.org/`
* **Satellite.js (Librería)**
  * **Uso:** Decodifica archivos TLE y calcula la posición exacta $(X, Y, Z)$ de un satélite en tiempo real directamente en el navegador.
  * **Licencia:** MIT.

---

## 2. Meteorología, Radar y Capas Ambientales
* **Open-Meteo API**
  * **Tipo:** API REST (JSON).
  * **Uso:** Pronósticos globales, viento a diferentes altitudes, temperatura, humedad y modelos GFS / ECMWF.
  * **Costo:** Gratis para uso no comercial (hasta 10,000 peticiones/día).
  * **URL:** `https://open-meteo.com/`
* **NOAA / NASA GOES-16 (Geostationary Operational Environmental Satellite)**
  * **Tipo:** GeoTIFF / AWS S3 Public Bucket / WMS.
  * **Uso:** Imágenes satelitales en tiempo casi real de Sudamérica y el Atlántico (ideal para Argentina).
  * **Costo:** Gratis y de libre acceso.
* **RainViewer API**
  * **Tipo:** API de mosaicos de radar (Tiles PNG/WebP).
  * **Uso:** Capas de reflectividad de radar meteorológico animadas en tiempo real.
  * **Costo:** Plan gratuito para desarrolladores.
  * **URL:** `https://www.rainviewer.com/api.html`
* **NASA FIRMS (Fire Information for Resource Management System)**
  * **Tipo:** API REST / CSV / GeoJSON.
  * **Uso:** Detección de focos de incendio en tiempo real vía satélites MODIS y VIIRS.
  * **Costo:** Gratis (requiere MAP_KEY gratuita).
  * **URL:** `https://firms.modaps.eosdis.nasa.gov/`

---

## 3. Tráfico Aéreo (ADS-B)
* **OpenSky Network**
  * **Tipo:** API REST (JSON).
  * **Uso:** Datos de telemetría de vuelos comerciales y privados en tiempo real (altitud, velocidad, rumbo, coordenadas).
  * **Costo:** Gratis para proyectos educativos e investigación (sin API key con restricciones o con cuenta gratuita).
  * **URL:** `https://opensky-network.org/`

---

## 4. Infraestructura y Redes Globales
* **TeleGeography Submarine Cable Map**
  * **Tipo:** GeoJSON / Dataset estático.
  * **Uso:** Rutas y puntos de amarre de cables de fibra óptica submarinos en todo el mundo.
  * **Costo:** Open Data / CC-BY-SA.
  * **URL:** `https://github.com/telegeography/submarine-cable-map`
* **OpenStreetMap (OSM) / Overpass API**
  * **Tipo:** API de consultas geoespaciales.
  * **Uso:** Extracción de infraestructura energética (redes eléctricas, represas, centrales térmicas/solares en Argentina).
  * **Costo:** Gratis.

---

## 5. Eventos Geológicos y Sismos
* **USGS Earthquake Hazards Program**
  * **Tipo:** GeoJSON Feed.
  * **Uso:** Terremotos y eventos sísmicos registrados globalmente en la última hora, 24 horas o 7 días.
  * **Costo:** Gratis sin autenticación.
  * **URL:** `https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php`

---

## Summary de Requisitos de Autenticación
Ninguna de estas APIs requiere tarjeta de crédito para iniciar. Se recomienda crear un archivo `.env` local para gestionar las claves de acceso (*API Keys*) que requieran registro previo (ej. FIRMS o Cesium ion).