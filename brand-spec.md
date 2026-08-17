# Brand spec — Servicio Meteorológico Nacional (Argentina)

Fuente de referencia: https://www.argentina.gob.ar/smn (portal oficial de la República Argentina)
Extraído el 2026-08-13. Layout de referencia: mapa interactivo tipo Windy (huracanes + capas).

## Tokens de color (OKLch)

```css
:root {
  --bg:      oklch(0.14 0.02 255);   /* fondo profundo azul-negro (canvas de mapa) */
  --surface: oklch(0.19 0.025 255);  /* paneles, translúcidos con blur */
  --fg:      oklch(0.93 0.01 250);   /* texto principal */
  --muted:   oklch(0.62 0.02 250);   /* texto secundario */
  --border:  oklch(0.32 0.03 255);   /* hairlines */
  --accent:  oklch(0.74 0.13 235);   /* celeste SMN — única capa activa */
  --navy:    oklch(0.30 0.05 258);   /* azul marino #242C4F (marca arg.gob.ar) */
  --warn:    oklch(0.75 0.16 75);    /* alertas */
  --danger:  oklch(0.62 0.20 25);    /* tormenta severa */
  --ok:      oklch(0.70 0.14 150);   /* buen tiempo */
}
```

`#242C4F` (azul marino) es el color dominante extraído del portal. El sistema de
alerta argentino (SMN) usa celeste / amarillo / naranja / rojo: esos se reservan
para estado de alerta y categoría de tormenta, nunca como decoración.

## Tipografía

- UI: system-ui stack (los portales de gobierno argentino usan fuentes de sistema / sans humanistas).
- Display/headers: system-ui con tracking ajustado (-0.01em), pesos 600–700.
- Valores numéricos y coordenadas: mono (`ui-monospace`, JetBrains Mono, Menlo) con `tabular-nums`.

## Postura de layout

1. Mapa a sangre completa, oscuro; chrome en azul marino translúcido (frosted, blur).
2. Una sola capa de datos activa a la vez + base independiente (Mapa / Satélite), como Windy.
3. Un acento celeste por pantalla (capa activa); ámbar/rojo solo para alertas y categorías de tormenta.
4. Bordes hairline, radios 6–8px, sin sombras pesadas. Micro-etiquetas en mayúsculas con letter-spacing.
5. Lecturas numéricas en mono (temperatura, viento, presión, coordenadas bajo el cursor).
