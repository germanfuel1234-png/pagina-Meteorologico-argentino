/* ===========================================================
   Globo 3D · God's Eye View — CesiumJS
   Vista experimental en paralelo al mapa 2D del SMN (index.html).
   Capas: nubes GOES-16 (GIBS), radar (RainViewer), estaciones AR
   (Open-Meteo), vuelos (OpenSky vía proxy), satélites (CelesTrak +
   satellite.js), cables submarinos (snapshot estático TeleGeography)
   y cámaras (OSM/Overpass, por la zona visible del mapa).
   Todas las capas se degradan solas (quedan vacías) si su fuente
   no responde, sin romper el resto del globo.
   =========================================================== */
(function () {
  'use strict';

  window.CESIUM_BASE_URL = 'https://unpkg.com/cesium@1.120.0/Build/Cesium/';

  // ---------------------------------------------------------
  // Backend proxy (mismo criterio que index.html / app.js)
  // ---------------------------------------------------------
  function proxyBase() {
    if (window.SMN_PROXY_BASE) return String(window.SMN_PROXY_BASE).replace(/\/+$/, '');
    var h = location.hostname;
    if (h === 'localhost' || h === '127.0.0.1') return 'http://localhost:8000/api';
    return '/api';
  }
  var PROXY = proxyBase();

  // ---------------------------------------------------------
  // Estaciones AR (coordenadas de capitales provinciales)
  // ---------------------------------------------------------
  var AR_CITIES = [
    ['Buenos Aires', -34.6037, -58.3816], ['Córdoba', -31.4201, -64.1888],
    ['Rosario', -32.9587, -60.6930], ['Mendoza', -32.8895, -68.8458],
    ['La Plata', -34.9215, -57.9545], ['San Miguel de Tucumán', -26.8083, -65.2176],
    ['Mar del Plata', -38.0055, -57.5426], ['Salta', -24.7859, -65.4117],
    ['Santa Fe', -31.6333, -60.7000], ['San Juan', -31.5375, -68.5364],
    ['Resistencia', -27.4514, -58.9867], ['Neuquén', -38.9516, -68.0591],
    ['Santiago del Estero', -27.7834, -64.2642], ['Corrientes', -27.4692, -58.8306],
    ['Posadas', -27.3671, -55.8961], ['Bahía Blanca', -38.7196, -62.2724],
    ['Paraná', -31.7333, -60.5238], ['Formosa', -26.1775, -58.1781],
    ['San Salvador de Jujuy', -24.1858, -65.2995], ['Río Gallegos', -51.6230, -69.2168],
    ['Ushuaia', -54.8019, -68.3030], ['San Carlos de Bariloche', -41.1335, -71.3103],
    ['Comodoro Rivadavia', -45.8641, -67.4966], ['La Rioja', -29.4131, -66.8558],
    ['San Fernando del Valle de Catamarca', -28.4696, -65.7852], ['Viedma', -40.8135, -62.9967],
    ['Rawson', -43.3002, -65.1023], ['Santa Rosa', -36.6167, -64.2833]
  ];

  var WMO_LABEL = {
    0: 'despejado', 1: 'mayormente despejado', 2: 'parcial nublado', 3: 'nublado',
    45: 'niebla', 48: 'niebla escarcha', 51: 'llovizna débil', 53: 'llovizna', 55: 'llovizna intensa',
    61: 'lluvia débil', 63: 'lluvia', 65: 'lluvia intensa', 71: 'nieve débil', 73: 'nieve', 75: 'nieve intensa',
    80: 'chubascos', 81: 'chubascos', 82: 'chubascos intensos', 95: 'tormenta', 96: 'tormenta c/granizo', 99: 'tormenta severa'
  };

  // ---------------------------------------------------------
  // Grupos de CelesTrak a combinar (mantiene el total manejable)
  // ---------------------------------------------------------
  var SAT_GROUPS = ['stations', 'weather', 'gps-ops', 'geo'];
  var SAT_GEO_CAP = 150; // 'geo' trae ~570; recortamos por performance

  // ===========================================================
  // Estado global
  // ===========================================================
  var viewer, satPoints, satRecords = [];
  var flightsDS, cablesDS;
  var goesLayer = null, radarLayer = null;
  var infoEl, infoTitleEl, infoBodyEl;

  document.addEventListener('DOMContentLoaded', boot);

  function boot() {
    infoEl = document.getElementById('hud-info');
    infoTitleEl = document.getElementById('hud-info-title');
    infoBodyEl = document.getElementById('hud-info-body');
    document.getElementById('hud-info-close').addEventListener('click', hideInfo);

    viewer = new Cesium.Viewer('cesiumContainer', {
      baseLayer: new Cesium.ImageryLayer(new Cesium.UrlTemplateImageryProvider({
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        credit: 'Esri, Maxar, Earthstar Geographics',
        maximumLevel: 18
      })),
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      animation: false,
      timeline: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
      shouldAnimate: true,
      skyAtmosphere: new Cesium.SkyAtmosphere()
    });

    window.viewer = viewer; // acceso rápido desde la consola del navegador para debug

    viewer.scene.globe.enableLighting = true;
    viewer.scene.globe.baseColor = Cesium.Color.BLACK;
    viewer.scene.backgroundColor = Cesium.Color.BLACK;
    viewer.scene.fog.enabled = true;
    viewer.clock.shouldAnimate = false;
    // Cachear más tiles en memoria: sin esto, cada vez que volvés a una zona
    // ya visitada Cesium la vuelve a pedir por red en vez de reusar el tile.
    viewer.scene.globe.tileCacheSize = 1000;

    wireIonKey();

    // Vista inicial: Argentina
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(-64.5, -35.5, 5200000),
      duration: 1.4
    });

    startClock();
    wireMouse();
    wireLayerToggles();

    initGoesLayer(true);
    initStations(true);
    initSatellites(true);
    initCables(false);
    initFlights(false);
    initCams(false);

    document.getElementById('hud-loading').classList.add('is-hidden');
  }

  // ===========================================================
  // Reloj + coordenadas bajo el cursor
  // ===========================================================
  function startClock() {
    var el = document.getElementById('hud-clock');
    function tick() {
      var d = new Date();
      var utc = d.toISOString().slice(11, 19);
      var local = d.toLocaleTimeString('es-AR', { hour12: false });
      el.innerHTML = '<b>' + utc + '</b> UTC · ' + local + ' local';
    }
    tick();
    setInterval(tick, 1000);
  }

  function wireMouse() {
    var coordsEl = document.getElementById('hud-coords');
    var handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction(function (movement) {
      var cartesian = viewer.camera.pickEllipsoid(movement.endPosition, viewer.scene.globe.ellipsoid);
      if (!cartesian) return;
      var carto = Cesium.Cartographic.fromCartesian(cartesian);
      var lat = Cesium.Math.toDegrees(carto.latitude).toFixed(4);
      var lon = Cesium.Math.toDegrees(carto.longitude).toFixed(4);
      coordsEl.innerHTML = 'LAT <b>' + lat + '</b> · LON <b>' + lon + '</b>';
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    handler.setInputAction(function (click) {
      var picked = viewer.scene.pick(click.position);
      if (!picked) { hideInfo(); return; }
      var data = (picked.id && picked.id.__hud) || picked.__hud;
      if (data) showInfo(data); else hideInfo();
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  }

  function showInfo(data) {
    infoTitleEl.textContent = data.title;
    infoBodyEl.innerHTML = data.rows.map(function (r) {
      return '<div class="hud-info-row"><span>' + r[0] + '</span><span>' + r[1] + '</span></div>';
    }).join('');
    infoEl.classList.add('is-visible');
  }
  function hideInfo() { infoEl.classList.remove('is-visible'); }

  // ===========================================================
  // Textura base del globo: Esri directo (gratis, sin clave) por
  // defecto; si hay una clave de Cesium ion guardada, se reemplaza
  // por imagery + terreno servidos por el CDN de ion (más fluido,
  // el mismo origen que usa el video).
  // ===========================================================
  function ionKey() { try { return (localStorage.getItem('cesiumIonKey') || '').trim(); } catch (e) { return ''; } }

  function wireIonKey() {
    var input = document.getElementById('ion-key');
    var status = document.getElementById('ion-key-status');
    var saveBtn = document.getElementById('ion-key-save');
    try { input.value = ionKey(); } catch (e) {}
    updateStatus();
    saveBtn.addEventListener('click', function () {
      var v = input.value.trim();
      try { v ? localStorage.setItem('cesiumIonKey', v) : localStorage.removeItem('cesiumIonKey'); } catch (e) {}
      updateStatus();
      if (v) upgradeToIonImagery(v);
    });
    if (ionKey()) upgradeToIonImagery(ionKey());
    function updateStatus() {
      var has = !!ionKey();
      status.textContent = has ? 'Usando imagery + terreno de Cesium ion.' : 'Usando Esri directo (sin clave).';
      status.classList.toggle('is-active', has);
    }
  }

  function upgradeToIonImagery(key) {
    Cesium.Ion.defaultAccessToken = key;
    Promise.all([
      Cesium.createWorldImageryAsync(),
      Cesium.createWorldTerrainAsync()
    ]).then(function (results) {
      // Solo se reemplaza la capa base (índice 0, Esri directo); GOES/radar,
      // que se agregan encima en otro momento, no se tocan.
      var oldBase = viewer.imageryLayers.get(0);
      viewer.imageryLayers.add(new Cesium.ImageryLayer(results[0]), 0);
      viewer.imageryLayers.remove(oldBase, true);
      viewer.terrainProvider = results[1];
    }).catch(function () {
      var status = document.getElementById('ion-key-status');
      status.textContent = 'La clave no funcionó (¿la copiaste bien?) — seguimos con Esri directo.';
      status.classList.remove('is-active');
    });
  }

  // ===========================================================
  // Toggles del panel de capas
  // ===========================================================
  function wireLayerToggles() {
    on('layer-goes', function (v) { if (goesLayer) goesLayer.show = v; });
    on('layer-radar', function (v) { initRadarLayer(v); });
    on('layer-stations', function (v) { if (stationsDS) stationsDS.show = v; });
    on('layer-satellites', function (v) { if (satPoints) satPoints.show = v; });
    on('layer-cables', function (v) { initCables(v); if (cablesDS) cablesDS.show = v; });
    on('layer-flights', function (v) { initFlights(v); if (flightsDS) flightsDS.show = v; });
    on('layer-cams', function (v) { initCams(v); if (camsDS) camsDS.show = v; });
  }
  function on(id, fn) {
    var el = document.getElementById(id);
    el.addEventListener('change', function () { fn(el.checked); });
  }

  // ===========================================================
  // Capa: nubes GOES-16 (NASA GIBS WMTS, sin clave, se refresca sola)
  // ===========================================================
  function initGoesLayer(enabled) {
    addGoes();
    setInterval(addGoes, 10 * 60 * 1000); // recarga cada 10' para no quedarse con tiles cacheados viejos
    function addGoes() {
      var prev = goesLayer;
      // Sin parámetro TIME: el endpoint WMS "best" de GIBS ya resuelve solo
      // al último granule publicado (a diferencia del WMTS en tiles, que
      // exige coincidencia exacta con su grilla y devuelve 404 fuera de ella).
      var provider = new Cesium.WebMapServiceImageryProvider({
        url: 'https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi',
        layers: 'GOES-East_ABI_GeoColor',
        parameters: { service: 'WMS', version: '1.1.1', transparent: true, format: 'image/png' },
        tilingScheme: new Cesium.WebMercatorTilingScheme(),
        credit: 'NASA GIBS · GOES-East ABI GeoColor',
        maximumLevel: 7
      });
      goesLayer = viewer.imageryLayers.addImageryProvider(provider);
      goesLayer.alpha = 0.85;
      goesLayer.show = enabled !== false && document.getElementById('layer-goes').checked;
      if (prev) viewer.imageryLayers.remove(prev, true);
    }
  }

  // ===========================================================
  // Capa: radar de lluvia (RainViewer, sin clave)
  // ===========================================================
  function initRadarLayer(enabled) {
    if (!enabled) { if (radarLayer) radarLayer.show = false; return; }
    if (radarLayer) { radarLayer.show = true; return; }
    fetch('https://api.rainviewer.com/public/weather-maps.json')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var last = d.radar && d.radar.past && d.radar.past[d.radar.past.length - 1];
        if (!last) return;
        var provider = new Cesium.UrlTemplateImageryProvider({
          url: d.host + last.path + '/256/{z}/{x}/{y}/2/1_1.png',
          credit: 'RainViewer',
          maximumLevel: 12
        });
        radarLayer = viewer.imageryLayers.addImageryProvider(provider);
        radarLayer.alpha = 0.65;
      })
      .catch(function () { /* capa queda vacía si RainViewer no responde */ });
  }

  // ===========================================================
  // Capa: estaciones AR (Open-Meteo, sin clave, refresco 10')
  // ===========================================================
  var stationsDS;
  function initStations(enabled) {
    stationsDS = new Cesium.CustomDataSource('stations');
    viewer.dataSources.add(stationsDS);
    stationsDS.show = enabled;
    loadStations();
    setInterval(loadStations, 10 * 60 * 1000);
  }

  function loadStations() {
    var lats = AR_CITIES.map(function (c) { return c[1]; }).join(',');
    var lons = AR_CITIES.map(function (c) { return c[2]; }).join(',');
    var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lats + '&longitude=' + lons +
      '&current=temperature_2m,wind_speed_10m,wind_direction_10m,weather_code,relative_humidity_2m,surface_pressure&timezone=auto';
    fetch(url).then(function (r) { return r.json(); }).then(function (data) {
      var list = Array.isArray(data) ? data : [data];
      stationsDS.entities.removeAll();
      list.forEach(function (d, i) {
        var city = AR_CITIES[i];
        if (!city || !d || !d.current) return;
        var c = d.current;
        var temp = c.temperature_2m;
        var color = temp >= 30 ? Cesium.Color.fromCssColorString('#ff5b5b')
          : temp >= 20 ? Cesium.Color.fromCssColorString('#ffb84b')
          : temp >= 10 ? Cesium.Color.fromCssColorString('#6fd1ff')
          : Cesium.Color.fromCssColorString('#8fb8ff');
        var entity = stationsDS.entities.add({
          position: Cesium.Cartesian3.fromDegrees(city[2], city[1]),
          point: { pixelSize: 9, color: color, outlineColor: Cesium.Color.BLACK, outlineWidth: 1.5,
            disableDepthTestDistance: Number.POSITIVE_INFINITY },
          label: {
            text: city[0] + '  ' + Math.round(temp) + '°C',
            font: '11px "JetBrains Mono", monospace',
            fillColor: Cesium.Color.fromCssColorString('#d6f5ec'),
            outlineColor: Cesium.Color.BLACK, outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(12, 0), horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            scaleByDistance: new Cesium.NearFarScalar(1.0e6, 1.0, 1.0e7, 0.0)
          }
        });
        entity.__hud = {
          title: city[0],
          rows: [
            ['Temperatura', temp + ' °C'],
            ['Sensación/estado', WMO_LABEL[c.weather_code] || '—'],
            ['Viento', Math.round(c.wind_speed_10m) + ' km/h · ' + Math.round(c.wind_direction_10m) + '°'],
            ['Humedad', c.relative_humidity_2m + ' %'],
            ['Presión', Math.round(c.surface_pressure) + ' hPa'],
            ['Fuente', 'Open-Meteo']
          ]
        };
      });
    }).catch(function () { /* capa queda vacía si Open-Meteo no responde */ });
  }

  // ===========================================================
  // Capa: satélites en órbita (CelesTrak + satellite.js)
  // ===========================================================
  function initSatellites(enabled) {
    satPoints = viewer.scene.primitives.add(new Cesium.PointPrimitiveCollection());
    satPoints.show = enabled;

    // FORMAT=json de CelesTrak trae elementos OMM (sin líneas TLE de texto);
    // satellite.js necesita el par de líneas TLE clásico, así que se pide
    // FORMAT=tle (3 líneas por satélite: nombre + línea 1 + línea 2).
    var fetches = SAT_GROUPS.map(function (g) {
      return fetch('https://celestrak.org/NORAD/elements/gp.php?GROUP=' + g + '&FORMAT=tle')
        .then(function (r) { return r.text(); })
        .then(function (text) { return parseTleGroup(text, g === 'geo' ? SAT_GEO_CAP : Infinity); })
        .catch(function () { return []; });
    });

    Promise.all(fetches).then(function (groups) {
      var seen = {};
      groups.flat().forEach(function (sat) {
        var noradId = sat.line2.substring(2, 7).trim();
        if (seen[noradId]) return;
        seen[noradId] = true;
        var satrec = satellite.twoline2satrec(sat.line1, sat.line2);
        if (!satrec) return;
        var point = satPoints.add({
          position: Cesium.Cartesian3.ZERO,
          pixelSize: 4,
          color: Cesium.Color.fromCssColorString('#4bffd6'),
          outlineColor: Cesium.Color.fromCssColorString('#0a2a24'),
          outlineWidth: 1
        });
        point.__hud = { name: sat.name, noradId: noradId };
        satRecords.push({ satrec: satrec, point: point, meta: { OBJECT_NAME: sat.name, NORAD_CAT_ID: noradId } });
      });
      tickSatellites();
      setInterval(tickSatellites, 3000);
    });
  }

  function parseTleGroup(text, cap) {
    var lines = text.split('\n').map(function (l) { return l.replace(/\r$/, ''); }).filter(function (l) { return l.length > 0; });
    var out = [];
    for (var i = 0; i + 2 < lines.length; i += 3) {
      if (out.length >= cap) break;
      out.push({ name: lines[i].trim(), line1: lines[i + 1], line2: lines[i + 2] });
    }
    return out;
  }

  function tickSatellites() {
    var now = new Date();
    var gmst = satellite.gstime(now);
    for (var i = 0; i < satRecords.length; i++) {
      var rec = satRecords[i];
      var pv = satellite.propagate(rec.satrec, now);
      if (!pv || !pv.position) continue;
      var geo = satellite.eciToGeodetic(pv.position, gmst);
      var lon = satellite.degreesLong(geo.longitude);
      var lat = satellite.degreesLat(geo.latitude);
      var height = geo.height * 1000; // km -> m
      rec.point.position = Cesium.Cartesian3.fromDegrees(lon, lat, height);
      rec.point.__hud = {
        title: rec.meta.OBJECT_NAME,
        rows: [
          ['NORAD ID', rec.meta.NORAD_CAT_ID],
          ['Altitud', Math.round(geo.height) + ' km'],
          ['Latitud', lat.toFixed(2) + '°'],
          ['Longitud', lon.toFixed(2) + '°'],
          ['Fuente', 'CelesTrak TLE']
        ]
      };
    }
  }

  // ===========================================================
  // Capa: cables submarinos (snapshot estático TeleGeography)
  // ===========================================================
  function initCables(enabled) {
    if (cablesDS) { cablesDS.show = enabled; return; }
    Cesium.GeoJsonDataSource.load('data/submarine-cables.geo.json', { clampToGround: false })
      .then(function (ds) {
        cablesDS = ds;
        cablesDS.show = enabled;
        viewer.dataSources.add(ds);
        ds.entities.values.forEach(function (e) {
          if (!e.polyline) return;
          var color = (e.properties && e.properties.color && e.properties.color.getValue()) || '#7a5cff';
          e.polyline.material = new Cesium.PolylineGlowMaterialProperty({
            glowPower: 0.15, color: Cesium.Color.fromCssColorString(color)
          });
          e.polyline.width = 2;
          var name = (e.properties && e.properties.name && e.properties.name.getValue()) || 'Cable submarino';
          e.__hud = { title: name, rows: [['Tipo', 'Cable de fibra óptica submarino'], ['Fuente', 'TeleGeography']] };
        });
      })
      .catch(function () { /* capa queda vacía si el archivo no está disponible */ });
  }

  // ===========================================================
  // Capa: vuelos en vivo (OpenSky vía proxy backend — CORS lo exige)
  // ===========================================================
  var flightsPollTimer = null;
  function initFlights(enabled) {
    if (!flightsDS) {
      flightsDS = new Cesium.CustomDataSource('flights');
      viewer.dataSources.add(flightsDS);
    }
    flightsDS.show = enabled;
    if (!enabled) { if (flightsPollTimer) clearInterval(flightsPollTimer); return; }
    loadFlights();
    if (flightsPollTimer) clearInterval(flightsPollTimer);
    flightsPollTimer = setInterval(loadFlights, 30000);
  }

  function loadFlights() {
    var url = PROXY + '/flights?lamin=-56&lomin=-76&lamax=-20&lomax=-52';
    fetch(url).then(function (r) {
      if (!r.ok) throw new Error('proxy no disponible');
      return r.json();
    }).then(function (data) {
      document.getElementById('flights-hint').hidden = true;
      var states = data && data.states || [];
      var seen = {};
      states.forEach(function (s) {
        var icao = s[0], callsign = (s[1] || '').trim() || icao, lon = s[5], lat = s[6],
          onGround = s[8], velocity = s[9], track = s[10], geoAlt = s[13] || s[7];
        if (lon == null || lat == null || onGround) return;
        seen[icao] = true;
        var existing = flightsDS.entities.getById(icao);
        var alt = Math.round((geoAlt || 0));
        var kts = Math.round((velocity || 0) * 1.94384);
        var hudData = {
          title: callsign,
          rows: [
            ['Altitud', alt + ' m'],
            ['Velocidad', kts + ' kts'],
            ['Rumbo', Math.round(track || 0) + '°'],
            ['Origen', s[2] || '—'],
            ['Fuente', 'OpenSky Network']
          ]
        };
        if (existing) {
          existing.position = Cesium.Cartesian3.fromDegrees(lon, lat, geoAlt || 8000);
          if (existing.billboard) existing.billboard.rotation = Cesium.Math.toRadians(-(track || 0));
          existing.__hud = hudData;
        } else {
          var e = flightsDS.entities.add({
            id: icao,
            position: Cesium.Cartesian3.fromDegrees(lon, lat, geoAlt || 8000),
            point: { pixelSize: 6, color: Cesium.Color.fromCssColorString('#ffb84b'),
              outlineColor: Cesium.Color.BLACK, outlineWidth: 1, disableDepthTestDistance: Number.POSITIVE_INFINITY },
            label: {
              text: callsign, font: '10px "JetBrains Mono", monospace',
              fillColor: Cesium.Color.fromCssColorString('#ffb84b'),
              outlineColor: Cesium.Color.BLACK, outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE,
              pixelOffset: new Cesium.Cartesian2(10, 0), horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
              scaleByDistance: new Cesium.NearFarScalar(1.0e5, 1.0, 3.0e6, 0.0)
            }
          });
          e.__hud = hudData;
        }
      });
      // limpiar vuelos que salieron del bbox / dejaron de reportar
      flightsDS.entities.values.slice().forEach(function (e) {
        if (!seen[e.id]) flightsDS.entities.remove(e);
      });
    }).catch(function () {
      document.getElementById('flights-hint').hidden = false;
    });
  }

  // ===========================================================
  // Capa: cámaras (OSM/Overpass) — se pide por la zona visible del
  // mapa, no de golpe para toda Argentina/el mundo (sería enorme y
  // Overpass es un servicio compartido: hay que pedirle con cuidado).
  // ===========================================================
  var camsDS, camsEnabled = false, camsBusy = false, camsMoveEndListener = null, camsDebounceTimer = null;
  var CAMS_MAX_HEIGHT_M = 400000; // por arriba de esta altura no se pide (bbox demasiado grande)

  function initCams(enabled) {
    if (!camsDS) {
      camsDS = new Cesium.CustomDataSource('cams');
      viewer.dataSources.add(camsDS);
    }
    camsEnabled = enabled;
    camsDS.show = enabled;
    if (!enabled) {
      if (camsMoveEndListener) { camsMoveEndListener(); camsMoveEndListener = null; }
      return;
    }
    loadCamsForView();
    if (!camsMoveEndListener) {
      var handler = function () {
        clearTimeout(camsDebounceTimer);
        camsDebounceTimer = setTimeout(loadCamsForView, 700);
      };
      viewer.camera.moveEnd.addEventListener(handler);
      camsMoveEndListener = function () { viewer.camera.moveEnd.removeEventListener(handler); };
    }
  }

  function loadCamsForView() {
    if (!camsEnabled || camsBusy) return;
    var countEl = document.getElementById('cams-count');
    var height = viewer.camera.positionCartographic.height;
    if (height > CAMS_MAX_HEIGHT_M) {
      countEl.textContent = 'Acercate más para ver cámaras (zona visible muy grande)';
      camsDS.entities.removeAll();
      return;
    }
    var rect = viewer.camera.computeViewRectangle(viewer.scene.globe.ellipsoid);
    if (!rect) return;
    var west = Cesium.Math.toDegrees(rect.west), south = Cesium.Math.toDegrees(rect.south);
    var east = Cesium.Math.toDegrees(rect.east), north = Cesium.Math.toDegrees(rect.north);
    var bbox = south + ',' + west + ',' + north + ',' + east;
    var query = '[out:json][timeout:20];(' +
      'node["man_made"="surveillance"](' + bbox + ');' +
      'node["surveillance"](' + bbox + ');' +
      'node["highway"="speed_camera"](' + bbox + ');' +
      ');out body 300;';

    camsBusy = true;
    countEl.textContent = 'Buscando cámaras en la zona visible…';
    fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(query) })
      .then(function (r) { if (!r.ok) throw new Error('overpass'); return r.json(); })
      .then(function (data) {
        camsDS.entities.removeAll();
        (data.elements || []).forEach(function (el) {
          if (el.type !== 'node') return;
          var kind = el.tags.highway === 'speed_camera' ? 'Cámara de velocidad'
            : el.tags.surveillance === 'traffic' ? 'Cámara de tránsito'
            : el.tags.surveillance === 'public' ? 'Cámara de vigilancia pública'
            : 'Cámara (OSM)';
          var e = camsDS.entities.add({
            position: Cesium.Cartesian3.fromDegrees(el.lon, el.lat),
            point: { pixelSize: 6, color: Cesium.Color.fromCssColorString('#ff4d6d'),
              outlineColor: Cesium.Color.BLACK, outlineWidth: 1, disableDepthTestDistance: Number.POSITIVE_INFINITY }
          });
          e.__hud = {
            title: kind,
            rows: [
              ['Tipo OSM', el.tags.surveillance || el.tags.highway || '—'],
              ['Nodo', String(el.id)],
              ['Fuente', 'OpenStreetMap / Overpass']
            ]
          };
        });
        countEl.textContent = data.elements.length + ' cámaras en la zona visible (OSM)';
        camsBusy = false;
      })
      .catch(function () {
        countEl.textContent = 'No se pudo consultar Overpass ahora mismo.';
        camsBusy = false;
      });
  }

})();
