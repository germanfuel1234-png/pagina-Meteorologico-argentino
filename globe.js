/* ===========================================================
   Globo 3D · God's Eye View — CesiumJS
   Vista experimental en paralelo al mapa 2D del SMN (index.html).
   Capas: nubes GOES-16 (GIBS), radar (RainViewer), vuelos (OpenSky
   vía proxy, con dead reckoning para movimiento suave entre polls),
   satélites (CelesTrak + satellite.js), cables submarinos (snapshot
   estático TeleGeography) y cámaras (OSM/Overpass, por la zona
   visible del mapa).
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
  // Grupos de CelesTrak a combinar (mantiene el total manejable)
  // ---------------------------------------------------------
  var SAT_GROUPS = ['stations', 'weather', 'gps-ops', 'geo', 'starlink'];
  // Recorte por grupo para no matar el performance: 'geo' trae ~570,
  // 'starlink' ronda los 10.000 (megaconstelación completa) — con 600 ya
  // se ve bien la "malla" característica sin recalcular miles de órbitas
  // cada 3s.
  var SAT_GROUP_CAP = { geo: 150, starlink: 600 };
  var SAT_GROUP_COLOR = {
    stations: '#ffe14b', weather: '#6fd1ff', 'gps-ops': '#ffb84b',
    geo: '#c9a227', starlink: '#4bffd6'
  };
  var SAT_GROUP_LABEL = {
    stations: 'Estación espacial', weather: 'Satélite meteorológico', 'gps-ops': 'GPS',
    geo: 'Geoestacionario', starlink: 'Starlink'
  };

  // ===========================================================
  // Estado global
  // ===========================================================
  var viewer, satPoints, satRecords = [];
  var cablesDS;
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
    initWorldClouds(false);
    initSatellites(true);
    initCables(false);
    initFlights(false);
    initMilitary(false);
    initCams(false);
    initInfra(false);
    initQuakes(false);
    initFires(false);

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
      if (data) {
        showInfo(data);
        if (data.__flyTo) { stopTracking(); data.__flyTo(); } else { trackPicked(picked); }
      } else { hideInfo(); }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  }

  function showInfo(data) {
    infoTitleEl.textContent = data.title;
    infoBodyEl.innerHTML = data.rows.map(function (r) {
      return '<div class="hud-info-row"><span>' + r[0] + '</span><span>' + r[1] + '</span></div>';
    }).join('');
    infoEl.classList.add('is-visible');
  }
  function hideInfo() { infoEl.classList.remove('is-visible'); stopTracking(); }

  // ===========================================================
  // Click-to-track: engancha la cámara al objeto clickeado (avión,
  // satélite, barco...) y lo sigue mientras se mueve, reusando el
  // trackedEntity nativo de Cesium — funciona igual para Entities
  // (cámaras, energía) y para PointPrimitives sueltos
  // (vuelos, militares, satélites, incendios), sin reimplementar
  // la cámara a mano.
  // ===========================================================
  var trackerEntity, _trackedPoint, _trackedPointColor;
  var TRACK_TINT = Cesium.Color.CYAN; // mismo criterio de color que el proyecto real: cyan = trackeado
  function trackPicked(picked) {
    if (_trackedPoint && _trackedPointColor) { _trackedPoint.color = _trackedPointColor; }
    _trackedPoint = null;
    _trackedPointColor = null;

    var getPosition;
    if (picked.id && picked.id.position) {
      var entity = picked.id;
      getPosition = function (time) { return entity.position.getValue(time); };
    } else if (picked.position) {
      getPosition = function () { return picked.position; };
      if (picked.color) {
        _trackedPoint = picked;
        _trackedPointColor = picked.color.clone();
        picked.color = TRACK_TINT;
      }
    } else {
      return; // ej. una polilínea de cable: no hay un único punto que seguir
    }
    if (!trackerEntity) {
      trackerEntity = viewer.entities.add({ name: 'tracker' });
    }
    trackerEntity.position = new Cesium.CallbackProperty(getPosition, false);
    viewer.trackedEntity = trackerEntity;
    document.getElementById('hud-info').classList.add('is-tracking');
  }
  function stopTracking() {
    if (viewer.trackedEntity) viewer.trackedEntity = undefined;
    if (_trackedPoint && _trackedPointColor) { _trackedPoint.color = _trackedPointColor; }
    _trackedPoint = null;
    _trackedPointColor = null;
    var infoEl2 = document.getElementById('hud-info');
    if (infoEl2) infoEl2.classList.remove('is-tracking');
  }

  // ===========================================================
  // Textura base del globo: Esri directo (gratis, sin clave) por
  // defecto; si hay una clave de Cesium ion guardada, se reemplaza
  // por imagery + terreno servidos por el CDN de ion (más fluido,
  // el mismo origen que usa el video).
  // ===========================================================
  function ionKey() {
    try {
      var stored = (localStorage.getItem('cesiumIonKey') || '').trim();
      if (stored) return stored;
      // Fallback: clave local del desarrollador (local-ion-key.js, en .gitignore,
      // nunca se sube al repo). Si existe, se copia a localStorage una sola vez.
      var fallback = (window.CESIUM_ION_KEY_DEFAULT || '').trim();
      if (fallback) { localStorage.setItem('cesiumIonKey', fallback); return fallback; }
      return '';
    } catch (e) { return ''; }
  }

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
    on('layer-world-clouds', function (v) { if (worldCloudsLayer) worldCloudsLayer.show = v; });
    on('layer-radar', function (v) { initRadarLayer(v); });
    on('layer-satellites', function (v) { if (satPoints) satPoints.show = v; });
    on('layer-cables', function (v) { initCables(v); if (cablesDS) cablesDS.show = v; });
    on('layer-flights', function (v) { initFlights(v); });
    on('layer-military', function (v) { initMilitary(v); });
    on('layer-cams', function (v) { initCams(v); });
    on('layer-infra', function (v) { initInfra(v); });
    on('layer-quakes', function (v) { initQuakes(v); });
    on('layer-fires', function (v) { initFires(v); });
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
  // Capa: nubes mundo (NASA GIBS, VIIRS truecolor diario — GOES-16
  // solo cubre América; esta es la única capa de nubes con
  // cobertura de planeta entero en GIBS, aunque no es tiempo real).
  // ===========================================================
  var worldCloudsLayer = null;
  function initWorldClouds(enabled) {
    add();
    setInterval(add, 60 * 60 * 1000); // el composite diario cambia una vez por día
    function add() {
      var prev = worldCloudsLayer;
      var provider = new Cesium.WebMapServiceImageryProvider({
        url: 'https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi',
        layers: 'VIIRS_SNPP_CorrectedReflectance_TrueColor',
        parameters: { service: 'WMS', version: '1.1.1', transparent: true, format: 'image/png' },
        tilingScheme: new Cesium.WebMercatorTilingScheme(),
        credit: 'NASA GIBS · VIIRS SNPP True Color (diario, mundial)',
        maximumLevel: 8
      });
      worldCloudsLayer = viewer.imageryLayers.addImageryProvider(provider);
      worldCloudsLayer.alpha = 0.85;
      worldCloudsLayer.show = enabled !== false && document.getElementById('layer-world-clouds').checked;
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
        .then(function (text) {
          var list = parseTleGroup(text, SAT_GROUP_CAP[g] || Infinity);
          list.forEach(function (s) { s.group = g; });
          return list;
        })
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
          color: Cesium.Color.fromCssColorString(SAT_GROUP_COLOR[sat.group] || '#4bffd6'),
          outlineColor: Cesium.Color.fromCssColorString('#0a2a24'),
          outlineWidth: 1
        });
        point.__hud = { name: sat.name, noradId: noradId, group: sat.group };
        satRecords.push({ satrec: satrec, point: point, meta: { OBJECT_NAME: sat.name, NORAD_CAT_ID: noradId, GROUP: sat.group } });
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
      var line1 = lines[i + 1], line2 = lines[i + 2];
      // CelesTrak devuelve un aviso de texto (no TLEs) si ya se pidió el mismo
      // grupo hace menos de 2h ("GP data has not updated..."); sin este chequeo
      // ese aviso se leería como un satélite fantasma con datos basura.
      if (!line1 || !line2 || line1.charAt(0) !== '1' || line2.charAt(0) !== '2') continue;
      out.push({ name: lines[i].trim(), line1: line1, line2: line2 });
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
          ['Categoría', SAT_GROUP_LABEL[rec.meta.GROUP] || '—'],
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
  // Capa: vuelos en vivo, todo el mundo (OpenSky vía proxy backend
  // — CORS lo exige). Miles de aviones a la vez: se usa la misma
  // técnica liviana de puntos que los satélites, no Entities con
  // etiqueta fija (sería ilegible y pesado a escala global).
  //
  // Movimiento suave entre polls (cada 45s) por DEAD RECKONING:
  // el proyecto real (bilawalsidhu/gods-eye-view) logra esto
  // renderizando 30s "detrás" del tiempo real para poder interpolar
  // siempre entre dos fixes ya conocidos — con nuestro intervalo de
  // 45s ese margen no alcanza, así que en cambio proyectamos la
  // posición hacia adelante con el rumbo/velocidad reportados
  // (marco ENU de Cesium), y cuando llega un fix real nuevo no
  // saltamos: blendeamos desde la posición actual en pantalla hacia
  // la nueva en FLIGHT_CORRECTION_MS.
  // ===========================================================
  var flightPoints, flightPointsMap = {}, flightsPollTimer = null;
  var FLIGHT_POLL_MS = 45000;
  var FLIGHT_CORRECTION_MS = 1500;
  var FLIGHT_COLOR = Cesium.Color.fromCssColorString('#ffb84b');
  var _drOrigin = new Cesium.Cartesian3();
  var _drOffset = new Cesium.Cartesian3();
  var _drMatrix = new Cesium.Matrix4();
  var _drScratchA = new Cesium.Cartesian3();
  var _drScratchB = new Cesium.Cartesian3();

  function deadReckon(fix, nowMs, out) {
    var dt = Math.min(Math.max((nowMs - fix.t) / 1000, 0), 120); // tope 2min si dejó de reportar
    var distM = (fix.speed || 0) * dt;
    var rad = Cesium.Math.toRadians(fix.heading || 0);
    _drOffset.x = distM * Math.sin(rad); // este
    _drOffset.y = distM * Math.cos(rad); // norte
    _drOffset.z = (fix.vrate || 0) * dt; // arriba
    Cesium.Cartesian3.fromDegrees(fix.lon, fix.lat, fix.alt, undefined, _drOrigin);
    Cesium.Transforms.eastNorthUpToFixedFrame(_drOrigin, undefined, _drMatrix);
    return Cesium.Matrix4.multiplyByPoint(_drMatrix, _drOffset, out);
  }

  function tickFlights() {
    var now = Date.now();
    for (var icao in flightPointsMap) {
      var f = flightPointsMap[icao];
      var target = deadReckon(f.fix, now, _drScratchA);
      if (f.correctFrom && now - f.correctStartT < FLIGHT_CORRECTION_MS) {
        var frac = (now - f.correctStartT) / FLIGHT_CORRECTION_MS;
        f.point.position = Cesium.Cartesian3.lerp(f.correctFrom, target, frac, _drScratchB);
      } else {
        f.point.position = target;
      }
    }
  }

  function initFlights(enabled) {
    if (!flightPoints) {
      flightPoints = viewer.scene.primitives.add(new Cesium.PointPrimitiveCollection());
      viewer.scene.preRender.addEventListener(tickFlights);
    }
    flightPoints.show = enabled;
    if (!enabled) { if (flightsPollTimer) clearInterval(flightsPollTimer); return; }
    loadFlights();
    if (flightsPollTimer) clearInterval(flightsPollTimer);
    flightsPollTimer = setInterval(loadFlights, FLIGHT_POLL_MS);
  }

  function loadFlights() {
    var url = PROXY + '/flights?lamin=-90&lomin=-180&lamax=90&lomax=180';
    fetch(url).then(function (r) {
      if (!r.ok) throw new Error('proxy no disponible');
      return r.json();
    }).then(function (data) {
      document.getElementById('flights-hint').hidden = true;
      var states = data && data.states || [];
      var seen = {};
      var now = Date.now();
      states.forEach(function (s) {
        var icao = s[0], callsign = (s[1] || '').trim() || icao, lon = s[5], lat = s[6],
          onGround = s[8], velocity = s[9], track = s[10], vrate = s[11], geoAlt = s[13] || s[7];
        if (lon == null || lat == null || onGround) return;
        seen[icao] = true;
        var alt = Math.round(geoAlt || 0);
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
        var newFix = { lon: lon, lat: lat, alt: geoAlt || 8000, heading: track || 0, speed: velocity || 0, vrate: vrate || 0, t: now };
        var f = flightPointsMap[icao];
        if (!f) {
          var point = flightPoints.add({
            position: Cesium.Cartesian3.fromDegrees(lon, lat, geoAlt || 8000),
            pixelSize: 5, color: FLIGHT_COLOR,
            outlineColor: Cesium.Color.BLACK, outlineWidth: 1, disableDepthTestDistance: Number.POSITIVE_INFINITY
          });
          f = { point: point, fix: newFix, correctFrom: null, correctStartT: 0 };
          flightPointsMap[icao] = f;
        } else {
          f.correctFrom = Cesium.Cartesian3.clone(f.point.position);
          f.correctStartT = now;
          f.fix = newFix;
        }
        f.point.__hud = hudData;
      });
      // limpiar vuelos que salieron del área o dejaron de reportar
      Object.keys(flightPointsMap).forEach(function (icao) {
        if (!seen[icao]) { flightPoints.remove(flightPointsMap[icao].point); delete flightPointsMap[icao]; }
      });
      var countEl = document.getElementById('flights-hint-text');
      if (countEl) countEl.textContent = states.length + ' vuelos en el aire (OpenSky, mundial)';
    }).catch(function () {
      document.getElementById('flights-hint').hidden = false;
    });
  }

  // ===========================================================
  // Capa: vuelos militares (adsb.lol, sin clave, CORS abierto —
  // a diferencia de OpenSky, esta se pide directo desde el
  // navegador, sin pasar por el backend).
  // ===========================================================
  var milPoints, milPointsMap = {}, milPollTimer = null;
  function initMilitary(enabled) {
    if (!milPoints) {
      milPoints = viewer.scene.primitives.add(new Cesium.PointPrimitiveCollection());
    }
    milPoints.show = enabled;
    if (!enabled) { if (milPollTimer) clearInterval(milPollTimer); return; }
    loadMilitary();
    if (milPollTimer) clearInterval(milPollTimer);
    milPollTimer = setInterval(loadMilitary, 30000);
  }

  function loadMilitary() {
    var countEl = document.getElementById('mil-count');
    fetch('https://api.adsb.lol/v2/mil')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var aircraft = data.ac || [];
        var seen = {};
        aircraft.forEach(function (a) {
          var hex = a.hex, lon = a.lon, lat = a.lat;
          if (hex == null || lon == null || lat == null) return;
          seen[hex] = true;
          var altFt = a.alt_baro === 'ground' ? 0 : (a.alt_baro || 0);
          var hudData = {
            title: (a.flight || hex).trim(),
            rows: [
              ['Altitud', Math.round(altFt) + ' ft'],
              ['Velocidad', Math.round(a.gs || 0) + ' kts'],
              ['Tipo', a.t || '—'],
              ['Operador', a.ownOp || '—'],
              ['Fuente', 'adsb.lol (militar)']
            ]
          };
          var point = milPointsMap[hex];
          if (!point) {
            point = milPoints.add({
              position: Cesium.Cartesian3.fromDegrees(lon, lat, altFt * 0.3048),
              pixelSize: 5, color: Cesium.Color.fromCssColorString('#c9a227'),
              outlineColor: Cesium.Color.BLACK, outlineWidth: 1, disableDepthTestDistance: Number.POSITIVE_INFINITY
            });
            milPointsMap[hex] = point;
          } else {
            point.position = Cesium.Cartesian3.fromDegrees(lon, lat, altFt * 0.3048);
          }
          point.__hud = hudData;
        });
        Object.keys(milPointsMap).forEach(function (hex) {
          if (!seen[hex]) { milPoints.remove(milPointsMap[hex]); delete milPointsMap[hex]; }
        });
        if (countEl) countEl.textContent = aircraft.length + ' vuelos militares (adsb.lol, mundial)';
      })
      .catch(function () {
        if (countEl) countEl.textContent = 'No se pudo consultar adsb.lol ahora mismo.';
      });
  }

  // ===========================================================
  // Helper genérico: capas que se piden a Overpass por la zona
  // visible del mapa (no de golpe para todo el mundo, que sería
  // enorme) — lo usan Cámaras e Infraestructura energética.
  // ===========================================================
  function makeViewportOverpassLayer(dsName, maxHeightM, buildQuery, renderResults, countElId, tooFarText) {
    var ds = new Cesium.CustomDataSource(dsName);
    viewer.dataSources.add(ds);
    var enabled = false, busy = false, moveEndOff = null, debounceTimer = null;

    function load() {
      if (!enabled || busy) return;
      var countEl = document.getElementById(countElId);
      var height = viewer.camera.positionCartographic.height;
      if (height > maxHeightM) {
        countEl.textContent = tooFarText;
        ds.entities.removeAll();
        return;
      }
      var rect = viewer.camera.computeViewRectangle(viewer.scene.globe.ellipsoid);
      if (!rect) return;
      var bbox = Cesium.Math.toDegrees(rect.south) + ',' + Cesium.Math.toDegrees(rect.west) + ',' +
        Cesium.Math.toDegrees(rect.north) + ',' + Cesium.Math.toDegrees(rect.east);
      busy = true;
      countEl.textContent = 'Consultando OpenStreetMap…';
      fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(buildQuery(bbox)) })
        .then(function (r) { if (!r.ok) throw new Error('overpass'); return r.json(); })
        .then(function (data) {
          ds.entities.removeAll();
          var elements = data.elements || [];
          renderResults(ds, elements);
          countEl.textContent = elements.length + ' resultados en la zona visible (OSM)';
          busy = false;
        })
        .catch(function () {
          countEl.textContent = 'No se pudo consultar Overpass ahora mismo.';
          busy = false;
        });
    }

    return {
      set: function (v) {
        enabled = v;
        ds.show = v;
        if (!v) { if (moveEndOff) { moveEndOff(); moveEndOff = null; } return; }
        load();
        if (!moveEndOff) {
          var handler = function () { clearTimeout(debounceTimer); debounceTimer = setTimeout(load, 700); };
          viewer.camera.moveEnd.addEventListener(handler);
          moveEndOff = function () { viewer.camera.moveEnd.removeEventListener(handler); };
        }
      }
    };
  }

  // ===========================================================
  // Capa: cámaras (OSM/Overpass)
  // ===========================================================
  var camsLayer;
  function initCams(enabled) {
    if (!camsLayer) {
      camsLayer = makeViewportOverpassLayer('cams', 400000, function (bbox) {
        return '[out:json][timeout:20];(' +
          'node["man_made"="surveillance"](' + bbox + ');' +
          'node["surveillance"](' + bbox + ');' +
          'node["highway"="speed_camera"](' + bbox + ');' +
          ');out body 300;';
      }, function (ds, elements) {
        elements.forEach(function (el) {
          if (el.type !== 'node') return;
          var kind = el.tags.highway === 'speed_camera' ? 'Cámara de velocidad'
            : el.tags.surveillance === 'traffic' ? 'Cámara de tránsito'
            : el.tags.surveillance === 'public' ? 'Cámara de vigilancia pública'
            : 'Cámara (OSM)';
          var e = ds.entities.add({
            position: Cesium.Cartesian3.fromDegrees(el.lon, el.lat),
            point: { pixelSize: 6, color: Cesium.Color.fromCssColorString('#ff4d6d'),
              outlineColor: Cesium.Color.BLACK, outlineWidth: 1, disableDepthTestDistance: Number.POSITIVE_INFINITY }
          });
          // Algunos nodos de OSM traen el rumbo real de la cámara (camera:direction);
          // cuando está, el "buceo" mira exactamente para donde apunta la cámara real.
          var dirTag = el.tags['camera:direction'] || el.tags.direction;
          var headingDeg = dirTag != null && !isNaN(parseFloat(dirTag)) ? parseFloat(dirTag) : null;
          e.__hud = {
            title: kind,
            rows: [
              ['Tipo OSM', el.tags.surveillance || el.tags.highway || '—'],
              ['Nodo', String(el.id)],
              ['Fuente', 'OpenStreetMap / Overpass']
            ],
            __flyTo: function () {
              var heading = headingDeg != null ? Cesium.Math.toRadians(headingDeg) : viewer.camera.heading;
              viewer.camera.flyTo({
                destination: Cesium.Cartesian3.fromDegrees(el.lon, el.lat, 130),
                orientation: { heading: heading, pitch: Cesium.Math.toRadians(-18) },
                duration: 1.5
              });
            }
          };
        });
      }, 'cams-count', 'Acercate más para ver cámaras (zona visible muy grande)');
    }
    camsLayer.set(enabled);
  }

  // ===========================================================
  // Capa: infraestructura energética (centrales, represas — OSM/Overpass)
  // ===========================================================
  var infraLayer;
  function initInfra(enabled) {
    if (!infraLayer) {
      infraLayer = makeViewportOverpassLayer('infra', 600000, function (bbox) {
        return '[out:json][timeout:20];(' +
          'node["power"="plant"](' + bbox + ');way["power"="plant"](' + bbox + ');' +
          'node["waterway"="dam"](' + bbox + ');way["waterway"="dam"](' + bbox + ');' +
          'node["man_made"="dam"](' + bbox + ');way["man_made"="dam"](' + bbox + ');' +
          ');out center 200;';
      }, function (ds, elements) {
        elements.forEach(function (el) {
          var pos = el.type === 'node' ? el : el.center;
          if (!pos) return;
          var isDam = el.tags.waterway === 'dam' || el.tags.man_made === 'dam';
          var kind = isDam ? 'Represa' : 'Central eléctrica' + (el.tags['plant:source'] ? ' (' + el.tags['plant:source'] + ')' : '');
          var e = ds.entities.add({
            position: Cesium.Cartesian3.fromDegrees(pos.lon, pos.lat),
            point: { pixelSize: 7, color: Cesium.Color.fromCssColorString(isDam ? '#6fd1ff' : '#ffb84b'),
              outlineColor: Cesium.Color.BLACK, outlineWidth: 1, disableDepthTestDistance: Number.POSITIVE_INFINITY }
          });
          e.__hud = {
            title: el.tags.name || kind,
            rows: [
              ['Tipo', kind],
              ['Fuente', el.tags['plant:source'] || '—'],
              ['OSM', el.type + '/' + el.id]
            ]
          };
        });
      }, 'infra-count', 'Acercate más para ver infraestructura (zona visible muy grande)');
    }
    infraLayer.set(enabled);
  }

  // ===========================================================
  // Capa: sismos recientes (USGS, sin clave, M2.5+ última semana)
  // ===========================================================
  var quakesDS;
  function initQuakes(enabled) {
    if (!quakesDS) {
      quakesDS = new Cesium.CustomDataSource('quakes');
      viewer.dataSources.add(quakesDS);
      loadQuakes();
      setInterval(loadQuakes, 5 * 60 * 1000);
    }
    quakesDS.show = enabled;
  }

  function loadQuakes() {
    fetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        quakesDS.entities.removeAll();
        (data.features || []).forEach(function (f) {
          var mag = f.properties.mag;
          if (mag == null) return;
          var c = f.geometry.coordinates; // [lon, lat, depth_km]
          var color = mag >= 6 ? '#ff5b5b' : mag >= 5 ? '#ffb84b' : mag >= 4 ? '#ffe14b' : '#8fa0b8';
          var e = quakesDS.entities.add({
            position: Cesium.Cartesian3.fromDegrees(c[0], c[1]),
            point: { pixelSize: 5 + mag * 2, color: Cesium.Color.fromCssColorString(color).withAlpha(0.75),
              outlineColor: Cesium.Color.fromCssColorString(color), outlineWidth: 1.5,
              disableDepthTestDistance: Number.POSITIVE_INFINITY }
          });
          e.__hud = {
            title: 'M' + mag.toFixed(1) + ' · ' + f.properties.place,
            rows: [
              ['Profundidad', c[2].toFixed(0) + ' km'],
              ['Hora (UTC)', new Date(f.properties.time).toISOString().slice(0, 16).replace('T', ' ')],
              ['Fuente', 'USGS']
            ]
          };
        });
      })
      .catch(function () { /* capa queda vacía si USGS no responde */ });
  }

  // ===========================================================
  // Capa: incendios activos, todo el mundo (NASA FIRMS vía proxy —
  // sin CORS directo). Puede haber decenas de miles de focos en
  // temporada de incendios: se usan puntos livianos, no Entities.
  // ===========================================================
  var firePoints;
  function initFires(enabled) {
    if (!firePoints) {
      firePoints = viewer.scene.primitives.add(new Cesium.PointPrimitiveCollection());
    }
    firePoints.show = enabled;
    if (!enabled) return;
    loadFires();
  }

  function loadFires() {
    var hintEl = document.getElementById('fires-hint');
    fetch(PROXY + '/fires?bbox=-180,-90,180,90').then(function (r) {
      if (!r.ok) throw new Error('proxy no disponible');
      return r.json();
    }).then(function (data) {
      if (data.error) {
        hintEl.textContent = 'Backend sin FIRMS_MAP_KEY configurada (ver README) — esta capa no tiene datos.';
        hintEl.hidden = false;
        return;
      }
      hintEl.hidden = true;
      var countText = document.getElementById('fires-hint-text');
      if (countText) countText.textContent = (data.items || []).length + ' focos activos (FIRMS, mundial)';
      firePoints.removeAll();
      (data.items || []).forEach(function (fpt) {
        var point = firePoints.add({
          position: Cesium.Cartesian3.fromDegrees(fpt.lon, fpt.lat),
          pixelSize: 4, color: Cesium.Color.fromCssColorString('#ff7a3d'),
          outlineColor: Cesium.Color.fromCssColorString('#ffdd3d'), outlineWidth: 1,
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        });
        point.__hud = {
          title: 'Foco de calor',
          rows: [
            ['Confianza', String(fpt.confidence || '—')],
            ['FRP', (fpt.frp || '—') + ' MW'],
            ['Fecha', fpt.date || '—'],
            ['Fuente', 'NASA FIRMS (VIIRS)']
          ]
        };
      });
    }).catch(function () {
      hintEl.hidden = false;
    });
  }

})();
