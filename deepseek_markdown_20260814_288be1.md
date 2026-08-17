# Especificaciones Técnicas - Portal Climático Local con API Windy

## 3. Funcionalidades Principales de la Página

### 3.1. Mapa Interactivo (Core del Portal)
- **Librería recomendada:** Leaflet.js (gratuita y ligera) o Mapbox (para mayor personalización).
- **Capas base:**
  - Mapa callejero.
  - Mapa satelital (usando tiles de OSM u otros).
- **Capas superpuestas de datos:** 
  - Temperatura (colores según intensidad).
  - Precipitación (colores según intensidad).
  - Viento (flechas o líneas de corriente).
  - Presión atmosférica (isobaras).
- **Control de capas:** Permitir al usuario activar/desactivar las capas superpuestas.
- **Interacción:** Al hacer clic en el mapa, obtener el pronóstico para ese punto específico.

### 3.2. Historial de Búsquedas (Replicando el diseño original)
- **Ubicación:** En un panel lateral o desplegable.
- **Lista vertical** de las ubicaciones consultadas recientemente.
- **Cada entrada debe mostrar:** 
  - Nombre del lugar (ej. "Buenos Aires").
  - Región/Provincia (para desambiguar).
  - **Dato contextual destacado:** Temperatura actual o una frase como "Lluvia fuerte". **Este es un punto clave del diseño original.**
- **Orden:** Las más recientes primero.
- **Acción al hacer clic:** Centrar el mapa en esa ubicación y cargar los datos.
- **Botón "Borrar historial":** Que vacíe toda la lista.

### 3.3. Panel de Información y Pronóstico
- Al seleccionar una ubicación (desde el mapa o el historial), mostrar un panel con:
  - **Datos actuales:** Temperatura, viento, humedad, presión, precipitación.
  - **Pronóstico extendido:** Gráfico simple o tabla para los próximos días (ej. temperaturas máximas/mínimas).
- **Diseño limpio y moderno**, con iconografía clara (sol, nubes, lluvia).

### 3.4. Función de Búsqueda por Texto
- **Campo de búsqueda** en la parte superior.
- **Geocodificación:** Al escribir el nombre de una ciudad/localidad, resolver sus coordenadas. Se recomienda usar un servicio como **Nominatim** (OpenStreetMap) o el servicio de geocodificación de Mapbox.
- **Manejo de ambigüedades:** Si el nombre coincide con varios lugares (ej. "San José"), mostrar una lista con sus provincias/países para que el usuario elija.
- **Guardado automático:** Tras seleccionar un resultado, guardarlo en el historial.

## 4. Estructura de Datos (Historial)

Cada entrada del historial debe guardarse como un objeto JSON:

```json
{
  "id": "unique_id",
  "nombre": "Ciudad de Buenos Aires",
  "region": "Buenos Aires",
  "pais": "Argentina",
  "lat": -34.6037,
  "lon": -58.3816,
  "ultima_consulta": "2026-08-14T10:30:00Z",
  "dato_contextual": "22°C" // O "Soleado", etc.
}