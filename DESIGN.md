---
name: 2MiNo
description: Club digital de dominó y juegos de mesa clásicos en tiempo real
colors:
  bg-canvas: "#070b10"
  bg-table: "#0b1614"
  bg-felt: "#0e241c"
  surface-card: "#0f172a"
  surface-overlay: "rgba(15, 23, 42, 0.88)"
  surface-glass: "rgba(255, 255, 255, 0.05)"
  border-subtle: "rgba(255, 255, 255, 0.08)"
  border-focus: "#38bdf8"
  text-primary: "#f8fafc"
  text-secondary: "#94a3b8"
  text-muted: "#64748b"
  tile-bone: "#fefefe"
  tile-pip: "#0f172a"
  tile-border: "#cbd5e1"
  tile-spinner: "#d97706"
  accent-gold: "#f59e0b"
  accent-emerald: "#10b981"
  accent-rose: "#f43f5e"
  accent-sky: "#0284c7"
typography:
  display:
    fontFamily: "Outfit, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "clamp(1.75rem, 4vw, 2.5rem)"
    fontWeight: 800
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  heading:
    fontFamily: "Outfit, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Outfit, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  numeric:
    fontFamily: "Outfit, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "normal"
rounded:
  sm: "6px"
  md: "12px"
  lg: "18px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.accent-emerald}"
    textColor: "#041f14"
    rounded: "{rounded.md}"
    padding: "10px 20px"
  button-secondary:
    backgroundColor: "{colors.surface-glass}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: "10px 18px"
  card-lobby:
    backgroundColor: "{colors.surface-card}"
    rounded: "{rounded.lg}"
    padding: "20px"
---

# Design System: 2MiNo Private Domino Club

## Overview

2MiNo adopta la estética de un club privado de juegos de salón: atmósfera oscura, elegante, con paño verde bosque profundo, fichas con textura de hueso acrílico pulido y herrajes metálicos sutiles. La interfaz se sitúa en modo **Operate & Experience**: la prioridad absoluta es la claridad y la legibilidad de la mesa de juego, sin artefactos chillones de IA, rebotes caricaturescos ni elementos flotantes invasivos.

## Colors

- **Canvas y Fondo (`#070b10` a `#0b1614`)**: Un degradado radial de noche profunda que centra la atención en el área de juego.
- **Mesa de Paño (`#0e241c` a `#122b22`)**: Verde fieltro oscuro de club inglés/caribeño, cálido y mate, diseñado para largas sesiones sin fatiga visual.
- **Fichas de Dominó (`#fefefe` con puntos `#0f172a`)**: Blanco marfil con ligero bisel y sombra suave de contacto. El remache central (*spinner*) es de latón envejecido (`#d97706`).
- **Superficies y Paneles (`rgba(15, 23, 42, 0.85)`)**: Paneles de vidrio oscuro con desenfoque de fondo (`backdrop-filter: blur(12px)`) y bordes de 1px con brillo sutil superior.
- **Acentos Funcionales**:
  - Esmeralda (`#10b981`): Acciones afirmativas, turno propio y victorias.
  - Oro (`#f59e0b`): Capicúas, logros, estatus de sala y llamadas de UNO.
  - Rosa / Carmesí (`#f43f5e`): Alertas, penalizaciones y acciones de salida.
  - Azul Cielo (`#0284c7`): Información de sistema y enlaces de invitación.

## Typography

- Fuente base: `Inter`, con fallback al sistema `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto`.
- Los valores numéricos (puntos, fichas restantes en el pozo, temporizador de turno) emplean obligatoriamente `font-variant-numeric: tabular-nums` para evitar oscilaciones y temblores de ancho durante la partida.
- No se permite texto con degradado (`background-clip: text` decorativo). El énfasis y la jerarquía se comunican mediante peso tipográfico (`font-weight: 700 / 800`) y escala de color contrastante.

## Layout

- **Estructura de Partida**:
  1. Barra Superior (`GameBar`): Compacta, fijada arriba, con el marcador, código de sala y controles de audio/menú.
  2. Área Central de Mesa (`GameBoard`): El lienzo de fichas con zoom inteligente centrado.
  3. Cinta de Turno (`CintaTurno`): Discreta, sin invadir la mesa.
  4. Mano del Jugador (`PlayerHand`): Contenedor inferior accesible con fichas alineadas y controles contextuales directos (Robar / Pasar).
- **Estructura del Lobby**:
  - Rejilla responsiva limpia de tres columnas / bloques:
    - Tarjeta de Creación de Sala y Modos.
    - Buscador y Lista de Salas Públicas.
    - Panel lateral de Chat / Estado de Conexión.

## Elevation & Depth

- Sombras físicas naturales con desenfoque suave y desplazamiento vertical (`box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4)`).
- Se prohíben las sombras duras de bloque sin desenfoque (`box-shadow: 4px 4px 0`) y los halos de neón circulares sin desplazamiento.
- Las fichas en la mesa proyectan una sombra suave de 2px a 4px que las despega físicamente del fieltro.

## Shapes

- Fichas de dominó: Proporción física exacta 1:2 con esquinas suavemente redondeadas (`border-radius: 6px` a `8px`).
- Botones de control y selector de opciones: `border-radius: 10px` a `12px`.
- Pills de estado y badges de capicúa: `border-radius: 9999px` (píldora).

## Components

- **Botón Primario**: Esmeralda profundo con texto contrastante, transición de iluminación en hover y sin desplazamientos de layout.
- **Segmented Control (Selector de Opciones)**: Contenedor con fondo oscuro y botones compactos que cambian de estado con iluminación interior sutil, no con bordes llamativos de 3px.
- **Lobby Chat**: Contenedor integrado con lista de mensajes escaneable, avatares discretos y campo de entrada rápido con botón enviar.

## Do's and Don'ts

### Do's
- Mantener números tabulares en todos los marcadores y relojes de turno.
- Usar curvas de desaceleración física (`cubic-bezier(0.16, 1, 0.3, 1)`) para modales y fichas.
- Animar propiedades aceleradas por GPU (`transform`, `opacity`).
- Respetar los nombres propios (`Dominó Online`, `Uno`, `Tres en Raya`) sin alteración.
- Asegurar contraste superior a 4.5:1 en cualquier texto o indicador.

### Don'ts
- **No** usar `transition: width`, `height`, `padding` o `margin` (generan saltos de fotograma y jank).
- **No** usar rebotes elásticos estilo caricatura (`cubic-bezier(0.34, 1.56...)`).
- **No** usar pestañas laterales con bordes gruesos de color (`border-left: 3px solid #...`), un claro indicio de IA genérica.
- **No** usar texto decorativo con degradado (`background-clip: text`).
- **No** colocar paneles flotantes o botones FAB que tapen el tablero o distraigan al jugador durante su turno.
