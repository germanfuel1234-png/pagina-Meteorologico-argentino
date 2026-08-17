/* ==========================================================================
   SMN · Módulo externo: barra lateral estilo Windy, favoritos, alertas,
   herramientas de medición, instalación PWA, gráficos de tendencia y
   marcadores de evento en el timeline.

   Se ejecuta con `defer` tras el script principal, que expone
   `window.__SMN_HOOKS` para acceder al estado y a las acciones del mapa.
   ========================================================================== */
(function () {
  'use strict';

  /* Inyectar la librería Leaflet global (window.L) al ámbito del módulo.
     Las herramientas de medición usan L (layerGroup, polyline, polygon,
     circleMarker, marker, DomEvent). Sin esto lanzarían "L is not defined"
     y detendrían toda la ejecución del módulo. */
  const L = window.L;
  if (!L) {
    console.error('❌ app.js: Leaflet (L) no está cargado. Las herramientas de medición fallarán.');
    return; // Detener la ejecución para evitar errores en cadena ("L is not defined").
  }

  // Esperar a que el motor del mapa (index.html) cree los hooks
let H = window.__SMN_HOOKS;
if (!H || !H.state) {
    // Si no está listo, intentamos cada 200ms hasta que aparezca
    const waitForHooks = setInterval(() => {
        if (window.__SMN_HOOKS && window.__SMN_HOOKS.state) {
            H = window.__SMN_HOOKS;
            clearInterval(waitForHooks);
            // Una vez que tengamos los hooks, seguimos
        }
    }, 200);
}   // Los listeners de capas/mapa base y de medición se vinculan al final del módulo

  const $ = (id) => document.getElementById(id);

  const store = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* --- Mini toast local --- */
  const toastEl = $('smn-alert-toast');
  let toastT = null;
  function toast(msg, ms) {
    if (!toastEl) return;
    toastEl.innerHTML = msg;
    toastEl.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => toastEl.classList.remove('show'), ms || 4200);
  }

  /* --- Proxy base ('' = mismo origen) --- */
  function base() {
    try { return (H.proxyBase && H.proxyBase()) || ''; } catch (e) { return ''; }
  }
  function proxy(p, opts) {
    return fetch(base() + '/api' + p, opts).then(r => r.ok ? r.json() : null).catch(() => null);
  }

  /* ======================================================================
     1) BARRA LATERAL (abrir / cerrar)
     ====================================================================== */
  function toggleSidebar(open) {
    const sb = $('smn-sidebar');
    if (!sb) return;
    const on = typeof open === 'boolean' ? open : !sb.classList.contains('open');
    sb.classList.toggle('open', on);
  }
  $('btn-menu')?.addEventListener('click', () => toggleSidebar());
  $('sb-close')?.addEventListener('click', () => toggleSidebar(false));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') toggleSidebar(false); });

  /* ======================================================================
     2) FAVORITOS  —  localStorage `smn_favs` + sync opcional con el proxy.
     ====================================================================== */
  const FAV_KEY = 'smn_favs';
  let favs = store.get(FAV_KEY, []);
  const favList = $('fav-list');
  const favEmpty = $('fav-empty');

  function favGo(f) {
    H.flyTo(f.lat, f.lon, 8);
    try { H.goToPlace({ nombre: f.name, lat: f.lat, lon: f.lon, region: f.region }); } catch (e) {}
    toggleSidebar(false);
  }

  function renderFavs() {
    if (!favList) return;
    favList.innerHTML = '';
    if (!favs.length) { favEmpty.style.display = ''; return; }
    favEmpty.style.display = 'none';
    favs.forEach((f, i) => {
      const li = document.createElement('li');
      li.className = 'fav-item';
      const info = document.createElement('div');
      info.className = 'fav-info';
      info.innerHTML = '<div class="fav-name">' + esc(f.name) + '</div>' +
        '<div class="fav-reg">' + esc(f.region || '') + ' · ' + Number(f.lat).toFixed(2) + ', ' +
        Number(f.lon).toFixed(2) + '</div>';
      info.addEventListener('click', () => favGo(f));
      const del = document.createElement('button');
      del.className = 'sb-del';
      del.textContent = '✕';
      del.title = 'Quitar de favoritos';
      del.addEventListener('click', (ev) => {
        ev.stopPropagation();
        favs.splice(i, 1);
        store.set(FAV_KEY, favs);
        renderFavs();
        proxy('/favorites/' + encodeURIComponent(f.id + ''), { method: 'DELETE' });
      });
      li.appendChild(info);
      li.appendChild(del);
      favList.appendChild(li);
    });
  }

  $('fav-add')?.addEventListener('click', () => {
    const c = H.city && H.city();
    if (!c || !c.lat) { toast('Sin ubicación para guardar.', 3000); return; }
    const item = { id: 'fav-' + Date.now(), name: c.name, lat: c.lat, lon: c.lon, region: c.region || '' };
    favs = favs.filter(f => !(f.lat === item.lat && f.lon === item.lon));
    favs.unshift(item);
    favs = favs.slice(0, 40);
    store.set(FAV_KEY, favs);
    renderFavs();
    proxy('/favorites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(item)
    });
    toast('⭐ <b>' + esc(c.name) + '</b> guardado en favoritos.', 3000);
  });

  /* ======================================================================
     3) ALERTAS PERSONALIZADAS  —  storage + sync con el proxy.
     ====================================================================== */
  const AL_KEY = 'smn_custom_alerts';
  let alerts = store.get(AL_KEY, []);
  const AL_LABEL = {
    temp_high: 'Temperatura alta', temp_low: 'Temperatura baja',
    wind: 'Viento fuerte', rain: 'Lluvia fuerte'
  };

  function renderAlerts() {
    const ul = $('al-list');
    if (!ul) return;
    ul.innerHTML = '';
    if (!alerts.length) {
      const li = document.createElement('li');
      li.className = 'sb-empty';
      li.textContent = 'Sin alertas. Agregá una con el formulario.';
      ul.appendChild(li);
      return;
    }
    alerts.forEach((a, i) => {
      const li = document.createElement('li');
      const info = document.createElement('div');
      info.className = 'fav-info';
      info.innerHTML = '<div class="fav-name">' + esc(AL_LABEL[a.type] || a.type) + '</div>' +
        '<div class="fav-reg">umbral ' + esc(String(a.value)) + '</div>';
      const del = document.createElement('button');
      del.className = 'sb-del';
      del.textContent = '✕';
      del.addEventListener('click', (ev) => {
        ev.stopPropagation();
        alerts.splice(i, 1);
        store.set(AL_KEY, alerts);
        renderAlerts();
        proxy('/custom-alerts/' + encodeURIComponent(a.id + ''), { method: 'DELETE' });
      });
      li.appendChild(info);
      li.appendChild(del);
      ul.appendChild(li);
    });
  }

  $('al-add')?.addEventListener('click', () => {
    const type = $('al-type')?.value || 'temp_high';
    const value = parseFloat($('al-value')?.value);
    if (Number.isNaN(value)) { toast('Ingresá un umbral válido.', 3000); return; }
    const a = { id: 'al-' + Date.now(), type, value: +value.toFixed(1), active: true };
    alerts.push(a);
    store.set(AL_KEY, alerts);
    renderAlerts();
    proxy('/custom-alerts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(a)
    });
    $('al-value').value = '';
    toast('⚠️ Alerta <b>' + esc(AL_LABEL[type]) + '</b> configurada (umbral ' + value + ').', 3000);
  });

  /* ======================================================================
     4) HERRAMIENTAS DE MEDICIÓN  (distancia y área con primitivas Leaflet)
     ====================================================================== */
  let measure = { mode: null, pts: [], layer: null };

  function distLL(a, b) {
    const R = 6371, dLat = (b[0] - a[0]) * Math.PI / 180, dLon = (b[1] - a[1]) * Math.PI / 180;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * Math.PI / 180) * Math.cos(b[0] * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }
  function areaKm2(pts) {
    let mLat = 0; for (const p of pts) mLat += p[0]; mLat /= pts.length;
    const k = 111.32, kx = 111.32 * Math.cos(mLat * Math.PI / 180);
    const XY = pts.map(p => [p[0] * k, p[1] * kx]);
    let area = 0;
    for (let i = 0; i < XY.length; i++) { const a = XY[i], b = XY[(i + 1) % XY.length]; area += a[0] * b[1] - b[0] * a[1]; }
    return Math.abs(area) / 2;
  }
  function measureLabel() {
    if (!measure.pts.length) return 'Clic para agregar puntos';
    if (measure.mode === 'area' && measure.pts.length >= 3) return 'Área: ' + areaKm2(measure.pts).toFixed(2) + ' km²';
    let tot = 0; for (let i = 1; i < measure.pts.length; i++) tot += distLL(measure.pts[i - 1], measure.pts[i]);
    return 'Distancia: ' + tot.toFixed(2) + ' km';
  }
  function measureReset(silent) {
    const map = H._map && H._map();
    if(!map){measure={mode:null,pts:[],layer:null};if(!silent&&$('tool-status'))$('tool-status').textContent='Clic en el mapa para dibujar o medir.';return;}
    try { map && measure.layer && map.removeLayer(measure.layer); } catch (e) {}
    measure = { mode: null, pts: [], layer: null };
    try { map && (map.getContainer().style.cursor = ''); } catch (e) {}
    if (!silent && $('tool-status')) $('tool-status').textContent = 'Clic en el mapa para dibujar o medir.';
  }
  function measureRedraw() {
    const map = H._map && H._map(); if (!map) return;
    if (measure.layer) map.removeLayer(measure.layer);
    const g = L.layerGroup();
    if (measure.pts.length === 1) L.circleMarker(measure.pts[0], { radius: 5, color: '#4a9eff', fillColor: '#4a9eff', fillOpacity: 1 }).addTo(g);
    if (measure.pts.length >= 2) {
      if (measure.mode === 'area') L.polygon(measure.pts, { color: '#ffd23f', weight: 2, fillColor: '#ffd23f', fillOpacity: 0.18 }).addTo(g);
      else L.polyline(measure.pts, { color: '#4a9eff', weight: 2.5, dashArray: '4 4' }).addTo(g);
    }
    for (const p of measure.pts) L.circleMarker(p, { radius: 3.5, color: '#fff', fillColor: '#4a9eff', fillOpacity: 1 }).addTo(g);
    if (measure.pts.length >= 2) {
      L.marker(measure.pts[measure.pts.length - 1], { opacity: 0 })
        .bindTooltip(measureLabel(), { permanent: true, direction: 'top', className: 'smn-measure-lbl', offset: [0, 6] })
        .addTo(g);
    }
    measure.layer = g; g.addTo(map);
    if ($('tool-status')) $('tool-status').textContent = measureLabel() + '  ·  doble clic para terminar.';
  }
  function startMeasure(mode) {
    measureReset(true);
    measure.mode = mode;
    const map = H._map && H._map();
    if (map) map.getContainer().style.cursor = 'crosshair';
    if ($('tool-status')) $('tool-status').textContent = 'Clic en el mapa para agregar puntos.';
  }
  $('tool-distance')?.addEventListener('click', () => startMeasure('distance'));
  $('tool-area')?.addEventListener('click', () => startMeasure('area'));
  $('tool-clear')?.addEventListener('click', () => measureReset(false));

  /* ======================================================================
     CORRECCIÓN DE ERROR EN CONSOLA: 
     El mapa.on('click') y 'dblclick' NO deben estar dentro de un setTimeout.
     Tampoco deben depender de que exista H._map() en el momento exacto.
     Usamos un pequeño intervalo para esperar a que Leaflet esté disponible.
     ====================================================================== */
  function bindMeasureEvents() {
    const map = H._map && H._map();
    if (!map) {
      // Si el mapa aún no está listo, intentamos de nuevo en 200ms
      setTimeout(bindMeasureEvents, 200);
      return;
    }

    // Limpiamos eventos previos por seguridad (en caso de recarga de módulo)
    map.off('click', measureClickHandler);
    map.off('dblclick', measureDblClickHandler);

    // Definimos los manejadores
    function measureClickHandler(e) {
      if (!measure.mode) return;
      measure.pts.push([e.latlng.lat, e.latlng.lng]);
      measureRedraw();
    }

    function measureDblClickHandler(e) {
      if (measure.mode) {
        if (e.originalEvent) L.DomEvent.stop(e.originalEvent);
        measureReset(false);
      }
    }

    // Los vinculamos al mapa
    map.on('click', measureClickHandler);
    map.on('dblclick', measureDblClickHandler);
  }

  // Iniciamos la vinculación de eventos
  bindMeasureEvents();

  /* ======================================================================
     4) CONEXIÓN UI → MOTOR DEL MAPA
     Escucha los clics del panel de capas (#layers .layer) y del mapa base
     (#base-seg .seg-btn) y los traduce a los hooks del motor. Sustituye a
     los listeners que vivían en index.html (ahora comentados) para evitar
     doble vinculación.
     ====================================================================== */
  function connectLayersUI() {
    // --- CAPAS (Temperatura, Viento, etc.) ---
    document.querySelectorAll('#layers .layer').forEach(btn => {
      btn.addEventListener('click', function () {
        const layer = this.dataset.layer;
        if (!layer) return;
        if (H.setLayer) {
          // El hook renderiza la capa y marca/desmarca 'active' por sí solo.
          H.setLayer(layer);
        } else {
          // Fallback manual si el hook no está disponible.
          document.querySelectorAll('#layers .layer').forEach(b => b.classList.remove('active'));
          this.classList.add('active');
          const s = H.state && H.state();
          if (s) s.layer = layer;
        }
      });
    });

    // --- MAPA BASE (Mapa / Satélite) ---
    document.querySelectorAll('#base-seg .seg-btn').forEach(btn => {
      btn.addEventListener('click', function () {
        const base = this.dataset.base;
        if (!base) return;
        if (H.setBase) {
          // El hook aplica el fondo (dark/sat) y marca el botón activo.
          H.setBase(base);
        } else {
          // Fallback manual.
          document.querySelectorAll('#base-seg .seg-btn').forEach(b => b.classList.remove('active'));
          this.classList.add('active');
          const s = H.state && H.state();
          if (s) s.base = base;
          const map = H._map && H._map();
          if (map) map.setView(map.getCenter());
        }
      });
    });
  }

  // Vincular la UI cuando el HTML esté listo (con `defer` el DOM está parseado).
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', connectLayersUI);
  } else {
    connectLayersUI();
  }

/* ==========================================================================
   FUNCIÓN: Pick de temperatura / Capa al hacer clic (Sondeo de punto)
   ========================================================================== */
let pickMarker = null;
let pickLine = null;
let pickPopup = null;

function initPickTool() {
    const map = H._map && H._map();
    if (!map) return;

    map.on('click', function(e) {
        const lat = e.latlng.lat;
        const lng = e.latlng.lng;
        const state = H.state();
        const layer = state.layer;
        
        // Obtener el valor de la capa actual en ese punto (temperatura, viento, etc.)
        const valueObj = H.layerVal(lat, lng);
        const valor = valueObj.txt;
        const nombreCapa = valueObj.label;

        // Limpiar marcadores anteriores
        if (pickMarker) map.removeLayer(pickMarker);
        if (pickLine) map.removeLayer(pickLine);

        // 1. Crear la línea punteada vertical que conecta el punto con la etiqueta
        const puntoAbajo = L.latLng(lat, lng);
        const puntoArriba = L.latLng(lat + 0.25, lng); // Subimos 0.25 grados para poner la etiqueta
        pickLine = L.polyline([puntoAbajo, puntoArriba], {
            color: '#ffffff',
            weight: 1.5,
            dashArray: '4 6',
            opacity: 0.7
        }).addTo(map);

        // 2. Crear el punto blanco (el lugar exacto donde hiciste clic)
        pickMarker = L.circleMarker(puntoAbajo, {
            radius: 4,
            color: '#ffffff',
            fillColor: '#ffffff',
            fillOpacity: 1,
            weight: 1
        }).addTo(map);

        // 3. Crear la etiqueta flotante (Pop-up personalizado)
        const popupContent = `
            <div style="
                background: rgba(20, 24, 36, 0.92);
                backdrop-filter: blur(8px);
                border: 1px solid rgba(255, 255, 255, 0.15);
                border-radius: 10px;
                padding: 10px 14px;
                min-width: 140px;
                color: white;
                font-family: system-ui, sans-serif;
                box-shadow: 0 8px 24px rgba(0,0,0,0.6);
                pointer-events: none;
            ">
                <div style="font-size: 11px; color: #a0b4cc; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px;">
                    ${nombreCapa}
                </div>
                <div style="font-size: 22px; font-weight: 700; letter-spacing: -0.5px; display: flex; align-items: center; gap: 6px;">
                    🌡️ ${valor}
                </div>
                <div style="font-size: 10px; color: #7a86a0; margin-top: 4px; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 4px;">
                    ${lat.toFixed(4)}, ${lng.toFixed(4)}
                </div>
            </div>
        `;

        // Crear el pop-up y anclarlo al punto de arriba de la línea
        pickPopup = L.popup({
            className: 'custom-pick-popup',
            closeButton: false,
            offset: L.point(0, -10)
        }).setLatLng(puntoArriba).setContent(popupContent).openOn(map);
    });
}

// Ejecutar al cargar la página
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPickTool);
} else {
    initPickTool();
}
  /* ======================================================================
     5) PRONÓSTICO EXTENDIDO (7 días) — panel desplegable con gráfico
     Línea: T máx · Barras: lluvia acumulada (mm) y viento medio (km/h).
     Los datos salen de H.state().hourly (claves cortas de Windy o claves
     largas de Open-Meteo) agrupados por día.
     ====================================================================== */
  function extCssVar(name, fb) {
    try { const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); return v || fb; } catch (e) { return fb; }
  }

  function extChartColors() {
    return {
      accent: extCssVar('--accent', '#4a9eff'),
      muted: extCssVar('--muted', '#7a86a0'),
      fg: extCssVar('--fg', '#e6ecf7'),
      border: extCssVar('--border', 'rgba(255,255,255,.14)'),
      grid: 'rgba(255,255,255,.06)'
    };
  }

  // Agrupa STATE.hourly por día (7 desde hoy) y calcula máx / lluvia acumulada / viento medio.
  function buildExtendedDays(st) {
    const h = st && st.hourly;
    if (!h || !h.time || !h.time.length) return null;
    const temp = h.temp || h.temperature_2m;
    const prec = h.precip || h.precipitation;
    const wsp = h.wind || h.wind_speed_10m;
    if (!temp) return null;

    const map = new Map();
    for (let i = 0; i < temp.length; i++) {
      const ds = String(h.time[i] || '').slice(0, 10);
      if (!ds) continue;
      let g = map.get(ds);
      if (!g) { g = { tmax: -Infinity, rain: 0, ws: 0, wn: 0 }; map.set(ds, g); }
      if (typeof temp[i] === 'number') g.tmax = Math.max(g.tmax, temp[i]);
      g.rain += typeof (prec && prec[i]) === 'number' ? prec[i] : 0;
      if (typeof (wsp && wsp[i]) === 'number') { g.ws += wsp[i]; g.wn++; }
    }
    const arr = Array.from(map.entries()).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const nowDate = String((h.time[st.t0Index] || '')).slice(0, 10);
    let start = 0;
    for (let k = 0; k < arr.length; k++) if (arr[k][0] >= nowDate) { start = k; break; }
    const DOW = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
    return arr.slice(start, start + 7).map(([ds, g]) => {
      const d = new Date(ds + 'T12:00:00');
      const dw = isNaN(d.getTime()) ? 0 : d.getDay();
      return {
        label: DOW[dw] + ' ' + String(d.getDate()).padStart(2, '0'),
        tmax: Math.round(g.tmax),
        rain: Math.round(g.rain * 10) / 10,
        wind: g.wn ? Math.round(g.ws / g.wn) : 0
      };
    });
  }

  function initExtendedForecast() {
    const btn = document.getElementById('btn-extended-forecast');
    const panel = document.getElementById('forecast-panel');
    const cvs = document.getElementById('extended-chart');
    if (!btn || !panel || !cvs) return;

    let chart = null;
    let lastKey = '';

    function render() {
      const st = (H.state && H.state()) || {};
      const days = buildExtendedDays(st);
      if (!days || !days.length || typeof Chart === 'undefined') {
        cvs.getContext('2d').clearRect(0, 0, cvs.width, cvs.height);
        return;
      }
      const c = extChartColors();
      const labels = days.map(d => d.label);
      const tmax = days.map(d => d.tmax);
      const rain = days.map(d => d.rain);
      const wind = days.map(d => d.wind);

      if (chart) { chart.destroy(); chart = null; }
      chart = new Chart(cvs.getContext('2d'), {
        type: 'bar',
        data: {
          labels,
          datasets: [
            { type: 'line', label: 'T máx', data: tmax, yAxisID: 'y',
              borderColor: c.accent, backgroundColor: c.accent, borderWidth: 2,
              tension: 0.32, pointRadius: 2.5, pointBackgroundColor: c.accent, fill: false },
            { type: 'bar', label: 'Lluvia mm', data: rain, yAxisID: 'y1',
              backgroundColor: 'rgba(72,160,216,.85)', borderRadius: 3, barPercentage: 0.5 },
            { type: 'bar', label: 'Viento km/h', data: wind, yAxisID: 'y1',
              backgroundColor: 'rgba(201,167,255,.42)', borderRadius: 3, barPercentage: 0.5 }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { labels: { color: c.fg, boxWidth: 8, boxHeight: 8, font: { size: 9 }, usePointStyle: true } },
            tooltip: {
              backgroundColor: 'rgba(10,13,20,.94)', titleColor: c.fg, bodyColor: c.fg,
              borderColor: c.border, borderWidth: 1, padding: 8
            }
          },
          scales: {
            x: { ticks: { color: c.muted, font: { size: 9 } }, grid: { display: false } },
            y: { position: 'left', title: { display: true, text: '°C', color: c.muted, font: { size: 9 } },
                 ticks: { color: c.muted, font: { size: 8 } }, grid: { color: c.grid } },
            y1: { position: 'right', beginAtZero: true, title: { display: true, text: 'mm · km/h', color: c.muted, font: { size: 8 } },
                  ticks: { color: c.muted, font: { size: 8 } }, grid: { display: false } }
          }
        }
      });
    } // <--- CIERRE DE LA FUNCIÓN render() (Agregado)

    btn.addEventListener('click', () => {
      const opening = !panel.classList.contains('open');
      panel.classList.toggle('open', opening);
      panel.setAttribute('aria-hidden', opening ? 'false' : 'true');
      btn.setAttribute('aria-expanded', opening ? 'true' : 'false');
      btn.classList.toggle('active', opening);

      if (!opening) return;
      const st = (H.state && H.state()) || {};
      const key = ((st.city && st.city.name) || '') + '|' + st.t0Epoch;
      if (chart && key !== lastKey) { chart.destroy(); chart = null; }
      lastKey = key;

      // Esperar a que el panel termine de expandirse para que el lienzo tenga ancho real.
      setTimeout(() => {
        if (chart) { try { chart.resize(); } catch (e) {} }
        else render();
      }, 30);
    });
  } // <--- CIERRE DE LA FUNCIÓN initExtendedForecast() (Agregado)

  initExtendedForecast();

  /* En tu app.js, busca la función openCam(w) y agrégale esto: */
  function openCam(w) {
    if (!w) return;
    wbCur = w;
    document.getElementById('wbc-city').textContent = w.city + ' · ' + w.region;

    const card = document.getElementById('wbcard'), img = document.getElementById('wbc-img');
    card.classList.add('wb-nophoto'); // Mostramos el placeholder negro por si acaso

    // Intentamos cargar la imagen...
      // Intentamos cargar la imagen...
  img.dataset.base = w.full;
  img.src = w.full;

  // --- CORRECCIÓN AÑADIDA ---
  img.onerror = () => {
      // Cerramos el pop-up de tu página
      closeCam();
      // Y abrimos la pestaña de Windy con la cámara real
      window.open(w.page, '_blank');
  };
  // --------------------------
  }

})(); // <--- CIERRE FINAL DEL MÓDULO IIFE  