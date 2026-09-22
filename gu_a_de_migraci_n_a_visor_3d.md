# Guía de Migración: De Mapa 2D a Plataforma Globe 3D

Este documento detalla el plan de reestructuración técnica para transformar el repositorio actual en una plataforma de visualización espacial 3D en tiempo real con interfaz táctica (estilo *God's Eye View*).

---

## 1. Arquitectura Objetivo
El objetivo es migrar la vista cartesiana/2D hacia una pila tecnológica basada en renderizado WebGL/GPU:

* **Engine Principal:** [CesiumJS](https://cesium.com/platform/cesiumjs/) (Motor 3D para la representación del globo terráqueo, terreno y satélites).
* **UI/UX Layer:** React o Vanilla JS modular con TailwindCSS / CSS personalizado para la estética HUD/Cyberpunk.
* **Cálculo Orbital & Render de Puntos:** `satellite.js` integrado en Workers del navegador para evitar bloquear el hilo principal (*Main Thread*).

---

## 2. Hoja de Ruta de Migración (Paso a Paso)

### Fase 1: Configuración del Entorno 3D Base
1. **Reemplazar el contenedor 2D (Leaflet/Mapbox):**
   * Crear el div principal `#cesiumContainer`.
   * Inicializar el visor de CesiumJS con controles de cámara personalizados.
2. **Aplicar Estilo Visual HUD/Cyberpunk:**
   * Desactivar los widgets por defecto de Cesium (NavigationHelp, SceneModePicker, Geocoder) para implementar un HUD minimalista.
   * Configurar fondo estelar oscuro, atmósfera neón y sombras tácticas.
   * Agregar efectos CSS de post-procesamiento (`scanlines`, CRT overlay, viñeta, tipografía monoespaciada tipo `Courier` o `JetBrains Mono`).

### Fase 2: Integración de Capas de Datos Meteorológicos (Enfoque Argentina)
1. **Capa Satelital GOES-16:**
   * Configurar un proveedor de imágenes WMS/Tiles sobre el mapa para visualizar la cobertura de nubes sobre Sudamérica.
2. **Estaciones Meteorológicas (SMN / Redes Abiertas):**
   * Renderizar las estaciones de medición como marcadores 3D (*Billboards* con íconos vectoriales).
   * Implementar modales desplegables (pop-ups) al hacer clic en una estación para mostrar temperatura, presión, humedad y viento.

### Fase 3: Capas de Datos Globales (Estilo God's Eye)
1. **Capa Satelital en Tiempo Real:**
   * Consumir TLEs de CelesTrak.
   * Utilizar `satellite.js` para iterar las posiciones satelitales y dibujarlas como `PointPrimitiveCollection` en Cesium.
   * Permitir el "anclaje" de cámara a cualquier satélite seleccionado.
2. **Capa de Tráfico Aéreo (OpenSky API):**
   * Peticiones periódicas a la API para dibujar vectores de vuelo y modelos 3D (`.gltf`/`.glb`) de aviones.
3. **Infraestructura y Cables Submarinos:**
   * Cargar el GeoJSON de cables de fibra óptica y representarlos como políneas brillantes (`PolylineGlowMaterialProperty`).

### Fase 4: Optimización y Performance
1. **Uso de Web Workers:**
   * Mover los cálculos intensivos de propagación orbital y procesamiento de archivos JSON/GRIB2 a hilos secundarios.
2. **Nivel de Detalle (LOD):**
   * Filtrar la cantidad de entidades visibles según la distancia de la cámara al globo para mantener 60 FPS en el navegador.

---

## 3. Estructura de Archivos Recomendada para el Repo

```text
/
├── index.html
├── src/
│   ├── assets/          # Texturas, íconos HUD y efectos visuales
│   ├── css/             # Estilos Cyberpunk, HUD y filtros CRT
│   ├── js/
│   │   ├── main.js      # Inicialización del Cesium Viewer
│   │   ├── layers/      # Módulos independientes por capa
│   │   │   ├── weather.js
│   │   │   ├── satellites.js
│   │   │   ├── flights.js
│   │   │   └── infrastructure.js
│   │   └── workers/     # Web Workers para procesamiento en segundo plano
│   └── config.js        # Configuración de API Keys y endpoints
├── apis-y-fuentes-de-datos.md
└── guia-de-migracion-3d.md
```