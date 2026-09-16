# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Jugadores casuales y competitivos de dominó y juegos de mesa tradicionales de Latinoamérica, España, Brasil y la comunidad global que buscan partidas fluidas en tiempo real con amigos, salas públicas o partidas clasificatorias por ELO.

## Product Purpose

2MiNo es un club digital de dominó y juegos de mesa clásicos (Dominó Doble 6 y Doble 9, Uno, Tres en Raya, Conecta 4) que recrea la emoción y la inmersión de una mesa real de juego, combinando reglas criollas auténticas (Capicúa, Tranca, Parejas 2v2), chat de voz WebRTC integrado de latencia ultra baja y síntesis de audio procedural en tiempo real con cero descargas.

## Positioning

A diferencia de las aplicaciones comerciales móviles cargadas de anuncios invasivos, monedas de pago engañosas y gráficos caricaturescos baratos, 2MiNo ofrece una experiencia de club elegante, ligera, instantánea y enfocada 100% en la jugabilidad pura, las reglas auténticas y la camaradería.

## Operating Context

- **Entornos**: Navegadores modernos de escritorio (Chrome, Firefox, Safari, Edge) y navegadores móviles de smartphones y tablets.
- **Conectividad**: Diseñado para resistir microcortes y reconexiones fluidas de WebSockets y WebRTC.
- **Sesiones**: Desde partidas rápidas express (5-10 minutos) hasta torneos de eliminación directa y partidas largas por equipos (2v2).

## Capabilities and Constraints

- **Capacidades**:
  - Motor de dominó reglamentario (Doble 6 con 28 fichas, Doble 9 con 55 fichas).
  - Modos individual y por parejas (2v2) con marcador conjunto.
  - Reglas criollas: detección de Capicúa reglamentaria con puntos dobles, tranca ganadora por menor puntuación en mano, y límites configurables (50, 100, 150, 200, 300 pts).
  - Modos especiales: Cartas de Poder tácticas y Modo Blitz con reloj de tiempo.
  - Bots inteligentes con 4 niveles calibrados (Fácil, Normal, Difícil, Maestro) y simulación probabilística de manos.
  - Motor de cartas Uno con acumulación, penalizaciones y avisos de canto.
  - Chat de voz WebRTC en malla con detección de actividad de voz (VAD) y políticas de privacidad y consentimiento.
  - Síntesis de sonido Web Audio API procedural con 0 bytes de transferencia.
  - Soporte multilingüe completo y paritario en Español, Portugués e Inglés.
- **Restricciones Técnicas**:
  - Tolerancia estricta de paridad en traducciones (`testTranslations.mjs` con 0 cadenas duras con caracteres especiales fuera de `t()`).
  - No usar Tailwind en stylesheets propios; diseño con CSS puro, tokens semánticos y variables CSS.
  - Compatibilidad de accesibilidad (contraste WCAG AA, navegación completa por teclado, `aria-*` tags).

## Product Principles

1. **La Mesa es el Producto**: Nada debe estorbar la visión del tablero, las fichas y los extremos jugables. Los controles flotantes superfluos se eliminan en favor de un espacio limpio y legible.
2. **Artesanía Táctil Auténtica**: Las fichas, el paño de mesa y los sonidos deben sentirse físicos, pesados y placenteros, sin efectos baratos de rebote caricaturesco ni artificios de IA.
3. **Cero Fricción y Latencia**: Cargas instantáneas, audio generado proceduralmente sin archivos pesados que descargar, y reconexión resiliente.
4. **Respeto a las Reglas Tradicionales**: El dominó latino y caribeño tiene una rica cultura; Capicúas, trancas, salidas de doble y juego por parejas se respetan con rigor matemático.

## Accessibility & Inclusion

- Soporte total de navegación por teclado en lobby y partidas (`Tab`, `Enter`, enlaces de salto para la mano).
- Contraste superior a 4.5:1 en textos e indicadores.
- Soporte para usuarios con preferencia de movimiento reducido (`prefers-reduced-motion`).
