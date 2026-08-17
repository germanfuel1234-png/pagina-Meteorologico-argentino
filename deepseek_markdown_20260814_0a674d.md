# Especificaciones Técnicas - Portal Climático Local con API Windy

## 1. Objetivo del Proyecto
Crear un portal web interactivo de pronóstico del tiempo, enfocado en ubicaciones locales, que replique la funcionalidad y estética de Windy.com utilizando su API oficial.

## 2. API de Windy - Configuración y Autenticación

### 2.1. Obtener Credenciales
- Registrarse en https://api.windy.com 
- Crear una API Key en la sección correspondiente 
- La URL base de la API es: `https://api.windy.com` 

### 2.2. Métodos de Autenticación
Según el endpoint a utilizar :

| Producto | Método de Autenticación |
|----------|------------------------|
| **Point Forecast API** | API Key en el cuerpo JSON bajo el campo `"key"` |
| **Webcams API** | Header `x-windy-api-key: API_KEY` |
| **Map Forecast API** | Header `x-windy-api-key: API_KEY` |

### 2.3. Endpoint Principal: Point Forecast
- **Método:** POST 
- **Endpoint:** `/api/point-forecast/v2` 
- **Parámetros requeridos:** 
  - `latitude` (número)
  - `longitude` (número)
  - `model` (string) - ver modelos disponibles
  - `parameters` (array) - ver parámetros disponibles
  - `key` (string) - tu API Key

### 2.4. Modelos de Pronóstico Disponibles 

| Modelo | Descripción |
|--------|-------------|
| `gfs` | Global Forecast System (por defecto en versión gratuita) |
| `iconeu` | ICON EU - modelo regional europeo |
| `gfs_wave` | Modelo de olas GFS |
| `namconus` | NAM CONUS - regional EE.UU. |
| `namhawaii` | NAM Hawaii |
| `namalaska` | NAM Alaska |
| `cams` | Modelo de calidad del aire |

⚠️ **Importante:** La versión gratuita de la API solo ofrece el modelo `gfs`. Para usar modelos adicionales se requiere la versión de pago ($720/año) .

### 2.5. Parámetros Climáticos Disponibles 

| Parámetro | Descripción | Niveles |
|-----------|-------------|---------|
| `temp` | Temperatura | `surface`, `850h`, `700h`, etc. |
| `wind` | Velocidad y dirección (u/v) | `surface` |
| `windGust` | Ráfagas de viento | `surface` |
| `dewpoint` | Punto de rocío | `surface`, niveles de presión |
| `precip` | Precipitación | `surface` |
| `convPrecip` | Precipitación convectiva | `surface` |
| `snowPrecip` | Precipitación de nieve | `surface` |
| `cape` | Energía potencial disponible | `surface` |
| `pressure` | Presión atmosférica | `surface` |
| `rh` | Humedad relativa | `surface`, niveles de presión |
| `lclouds`, `mclouds`, `hclouds` | Nubes baja/media/alta | `surface` |
| `gh` | Altura geopotencial | Niveles de presión |
| `ptype` | Tipo de precipitación | `surface` |

### 2.6. Ejemplo de Solicitud (JavaScript) 

```javascript
// Ejemplo de solicitud a la API Point Forecast
const apiKey = 'TU_API_KEY_AQUI';
const url = 'https://api.windy.com/api/point-forecast/v2';

const data = {
  latitude: -34.6037,  // Ejemplo: Buenos Aires
  longitude: -58.3816,
  model: 'gfs',
  parameters: ['temp', 'wind', 'precip', 'rh', 'pressure'],
  levels: ['surface'],
  key: apiKey
};

fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data)
})
.then(response => response.json())
.then(data => console.log(data))
.catch(error => console.error('Error:', error));