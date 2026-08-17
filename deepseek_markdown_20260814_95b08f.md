# Especificaciones Técnicas - Portal Climático Local con API Windy

## 5. Consideraciones Técnicas

### 5.1. Almacenamiento
- Usar `localStorage` del navegador para guardar el historial. Es persistente, rápido y no requiere backend.
- Estructura simple (un array de objetos).

### 5.2. Geocodificación
- **Nominatim (OSM):** Gratuito, pero con límite de 1 solicitud por segundo. Implementar una cola de peticiones.
- **Mapbox Geocoding:** Requiere API Key, pero es más rápido y permite más solicitudes.

### 5.3. Visualización de Datos en el Mapa
- Para las capas superpuestas, se pueden generar imágenes en el backend (usando Python/Node) o renderizar directamente en el frontend con Canvas/WebGL.
- **Alternativa simple:** Usar la API de mapas de Windy directamente para ciertas capas (si tienen endpoints públicos para ello).

### 5.4. Rendimiento y UX
- El historial debe cargar **instantáneamente**.
- Las peticiones a la API de Windy deben ser **asíncronas** y mostrar un indicador de carga.
- **Diseño responsivo:** Adaptable a móviles y tablets.

## 6. Funcionalidades Extra (Para un Portal más Completo)

### 6.1. Webcams
- La API de Windy también ofrece acceso a una amplia red de webcams. Podrías mostrar imágenes en tiempo real de la ubicación seleccionada.
- **Endpoint:** `/api/webcams/v1` (requiere autenticación con header `x-windy-api-key`).

### 6.2. Alertas Meteorológicas
- Integrar un sistema simple de alertas para fenómenos extremos (basado en los datos de la API).

## 7. Flujo de Usuario Ideal
