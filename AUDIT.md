# Auditoría técnica — Domino Online

> Fecha: 2026-07-24 · Alcance: monorepo completo (server Node/Express/Socket.IO + client React/Vite + Postgres/Supabase)
> Objetivo: pasar de MVP a producto robusto y bien diseñado.

## Veredicto ejecutivo

El proyecto es **mucho más ambicioso que un MVP típico**: ~16k LOC con dominó completo (poderes, parejas, variantes, blitz), torneos, matchmaking por ELO, voz/vídeo WebRTC, tienda, misiones diarias, amigos, espectadores, i18n (es/pt/en) y un intento de "hub multi-juego". Hay **piezas de calidad real** (capa de BD con operaciones atómicas y precios autoritativos, `GameBoard`, limpieza de WebRTC con *perfect negotiation*, reglas puras de dominó bien testeadas).

Pero como base de producto tiene **cuatro problemas que hoy lo hacen frágil o directamente no desplegable**, y una **capa social sin autenticación** que permite suplantar a cualquier jugador. La deuda es mayoritariamente **estructural y de robustez del ciclo de vida**, no de las reglas puras del juego.

### Recuento por severidad

| Severidad | Nº | Titulares |
|---|---|---|
| 🔴 Crítico | 5 | Repo no clona/arranca · sin auth (suplantación) · torneos se cuelgan · crash de hooks en espectador · `dist/` roto versionado |
| 🟠 Alto | 8 | Sin rate-limit/hardening · abstracción multi-juego rota · god component · WebRTC cámara mid-call · lockfiles duplicados · lint roto/sin CI |
| 🟡 Medio | ~14 | Bugs de estado de poderes/rondas · estado cliente incoherente · errores invisibles fuera de partida · código muerto · tests ad-hoc |
| 🔵 Bajo | ~10 | a11y · carreras menores · campos muertos · `engines` · docs |

---

## 🔴 Críticos (bloquean estabilidad/despliegue)

### C1 · El repositorio no arranca tras un clon limpio
`server/core/`, `server/games/`, `client/src/games/` y `client/src/hub/` están **sin trackear en git**, pero `server/server.js:27` hace `require('./games/TicTacToeGame')`. Un `git clone` + `npm start` en Render falla con `MODULE_NOT_FOUND`. El refactor multi-juego quedó a medio commitear (igual en cliente).
**Fix:** commitear esos directorios (o revertir el `require`). **Nada debe desplegarse hasta resolverlo.**

### C2 · Sin autenticación: suplantación total de identidad en la capa social
No existe identidad verificada. El `playerId` se genera en el cliente (`client/src/store/useGameStore.js:3`, localStorage) y el servidor lo cree a ciegas en **toda** la capa social/BD: `get_profile`, `equip_skin`, `claim_mission`, `friend_add/respond`, `join_queue`, `presence.register` (`server/handlers/roomHandler.js`). Cualquiera que envíe el `playerId` de otro puede **gastar sus monedas, reclamar sus misiones/recompensas, manipular su ELO, aceptar/rechazar sus amistades y falsear su presencia**.
Contraste revelador: las **jugadas** sí están protegidas (`ownsPlayer` en `server/handlers/gameHandler.js:28`), pero la capa social no aplica el mismo criterio.
**Fix:** emitir un token de sesión firmado por el servidor al conectar (o handshake autenticado) y **vincular socket ↔ playerId**; rechazar cualquier operación cuyo `playerId` no coincida con el socket. Patrón a replicar: `findMe(socket.id)` en vez de confiar en `playerId` del payload.

### C3 · Los torneos (y salas con humano desconectado) se cuelgan para siempre
`armTurnTimer` solo avanza en `status==='playing'` (`server/roomManager.js:173`), y salir de `round_ended` depende de que el cliente emita `next_round` (`server/handlers/gameHandler.js:208`). Si en una partida de torneo (multi-ronda) el humano se desconecta, queda como humano sin socket (`server/server.js:163`), la sala no se destruye, el reloj auto-juega los turnos… pero al cerrar una ronda **nadie dispara `startNewRound`**: la partida se congela, `onMatchEnd` no se llama y **el cuadro entero del torneo queda bloqueado**.
**Fix:** que el servidor auto-avance `round_ended → startNewRound` con un temporizador cuando no haya humano conectado que pueda pulsar "siguiente ronda" (siempre, en salas de torneo/ranked).

### C4 · Crash de React al entrar/salir del modo espectador
`client/src/App.jsx:664` llama `useHubStore()` **después** de un `return` condicional en `:654`. Cuando `spectating` cambia, el número de hooks varía entre renders → *"Rendered fewer hooks than expected"* rompe la app en un flujo real de usuario. (El segundo `if (spectating)` del `return` es además inalcanzable.)
**Fix:** mover `useHubStore()` arriba, junto al resto de hooks, antes de cualquier `return`.

### C5 · `client/dist/` versionado y roto
El build está trackeado (13 archivos) y el `index.html` commiteado apunta a bundles (`index-B6oS_zom.js`) que **no existen** entre los assets trackeados (`index-kvEBjgbq.js`). Quien haga checkout obtiene un HTML que referencia archivos inexistentes, más conflictos de merge perpetuos por los hashes.
**Fix:** `git rm -r --cached client/dist` + añadir a `.gitignore`; dejar que Vercel construya (ya está configurado).

---

## 🟠 Altos

### A1 · Cero hardening y sin rate-limiting sobre 51 eventos de socket
Sin `helmet`, sin `express-rate-limit`, sin límite de creación de salas (DoS de memoria trivial: spam de `create_room`), CORS `origin:'*'` en Express y Socket.IO (`server/server.js:30,117`). Positivos: `maxHttpBufferSize: 1e5` y `perMessageDeflate:false`.
**Fix:** rate-limit por socket (fichas/segundo), tope global y por-IP de salas, CORS restringido al dominio de Vercel, `helmet` en los endpoints HTTP.

### A2 · Conexión a Postgres sin verificar certificado
`ssl: { rejectUnauthorized: false }` (`server/db.js:19`) desactiva la validación TLS del certificado del servidor de BD (riesgo MITM). Común con Supabase/Render pero debería usar la CA correcta.

### A3 · La abstracción multi-juego está rota fuera de dominó
`DominoGame` **no** extiende `BaseGame` ni pasa por `GameRegistry` (se instancia directo con otra firma y un `try/catch` de fallback, `server/roomManager.js:331`). Peor: `scheduleBotTurn`/`armTurnTimer` están cableados al `botLogic` **de dominó** y a la forma de retorno de `forceTurn` de dominó. Crear una sala `tictactoe` y añadir un bot lanza `TypeError` (`game.getValidMoves` no existe) dentro de un `setTimeout` no capturado, y el reloj emite mensajes con `NaN`. Hoy el "hub" solo funciona de verdad para dominó.
**Fix:** subir el pilotaje de bots y el contrato de `forceTurn` (`{action, playerId, playerName, drew}`) a `BaseGame`; que `roomManager` delegue en el juego, no en `botLogic` de dominó. Migrar `DominoGame` a `BaseGame` y registrarlo.

### A4 · `App.jsx` es un god component (926 líneas)
Concentra ~21 listeners de socket, ~20 emisores de acción, la lógica de "momentos épicos"/logros/sonidos y 6 ramas de vista. Como el `gameState` vive aquí, **todo el árbol se re-renderiza en cada tick de `game_state`**.
**Fix:** extraer `useGameSocket` (listeners) y `useGameActions` (emisores), un router de vistas (`<Hub/> <Lobby/> <Tournament/> <Game/>`) y mover logros/épicos a su hook. Memoizar contenedores.

### A5 · WebRTC no renegocia: encender cámara/mic a mitad de llamada no llega al par
No hay `pc.onnegotiationneeded` en ninguna `RTCPeerConnection` (`client/src/hooks/useVoiceChat.js`). `toggleCam` hace `addTrack` sobre peers ya negociados sin renegociar → el remoto **nunca recibe el vídeo** (solo funciona si la cámara estaba encendida antes de crear el peer).
**Fix:** implementar `onnegotiationneeded` dentro de la máquina de *perfect negotiation* que ya usan.

### A6 · El mega-`useEffect` re-registra 21 listeners al cambiar de idioma
El array de dependencias incluye `t` (`client/src/App.jsx:453`) porque `onKicked` usa `t(...)` directo en vez de `tRef.current`. Cada cambio de idioma desmonta/re-monta los 21 listeners y re-invoca `connect()`, con ventana para perder eventos entrantes.
**Fix:** usar `tRef.current` en `onKicked` y quitar `t` de las dependencias.

### A7 · Gestor de paquetes ambiguo: `package-lock.json` **y** `pnpm-lock.yaml` a la vez
En los 3 niveles coexisten ambos lockfiles, más un `client/pnpm-workspace.yaml` anidado que contradice al raíz. Instalaciones no reproducibles.
**Fix:** quedarse con pnpm; `git rm` los `package-lock.json`, los lockfiles de `client/`+`server/` y el workspace anidado. Un único `pnpm-lock.yaml` en la raíz.

### A8 · Lint roto y sin CI
`client/package.json` define un script `lint` pero **no existe** ninguna config de ESLint; el server no tiene lint. No hay `.github/workflows` ni pre-commit. Nada impide que un merge rompa build/tests (causa directa de C1 y C5).
**Fix:** `eslint.config.js` (flat) en cliente y server; workflow de GitHub Actions con `install + test + build` en cada PR.

---

## 🟡 Medios (selección)

- **Bugs de estado del motor:**
  - `gameWinner` no se limpia en `startNewGame`; `roundWinnerTeam` no se limpia en `startNewRound` (`server/gameLogic.js:326,336`) → banner de ganador obsoleto tras `play_again`.
  - `usePowerCard` nunca llama `checkRoundEnd` (`server/gameLogic.js:937`): `smuggle` puede vaciarte la mano sin declarar victoria/dominó → estado terminal sin resolver.
  - Falsa "tranca" cuando *Congelar*/*Maldición* fuerzan pases de jugadores que sí tienen ficha (`server/gameLogic.js:812`).
  - `activeEffects` se inicializa en 3 sitios divergentes (constructor / `resetGame` / `startNewRound`) — unificar en `freshActiveEffects()`.
- **Cliente:**
  - Estado incoherente: `showProfile` en zustand pero `showLeaderboard/showStore/showFriends/tournament/...` en `useState`; `selectedGameId` en un 3.º store; `playerId` con **doble fuente** (store + `getOrCreatePersistentPlayerId()` esparcido). Unificar en una sola fuente de verdad.
  - Errores del servidor y "conexión perdida" **solo se ven dentro de la partida**; en Lobby/Hub un `error_msg` o una caída del socket no dan señal (`client/src/App.jsx:764`).
  - `useVoiceChat` no desestructura `name` → usa `window.name` (`client/src/hooks/useVoiceChat.js:33`); "funciona" solo por el fallback a localStorage.
  - Literales en español sin `t()` en toda la UI de voz (`UnifiedVoiceWidget.jsx`) y varios títulos (`GameBoard`, `GameBar`, `PlayerSeats`).
  - Código muerto: `GlobalVoiceOverlay` (importado, nunca renderizado), `VoiceChat` (ignora props), `games/registry.js`+`TemplateBoard` (registro sin uso), y el estado `speaking`/`voiceFilter`/`peerStates` que nunca se cablea (detección de "quién habla" muerta).
  - Memoización escasa: solo `DominoTile` y `PlayerSeats` usan `React.memo`.
- **Seguridad/robustez:**
  - `send_quick_message.text` y `send_emote.emoji` **sin límite de longitud** (`server/schemas.js:96`; `send_emote` ni pasa por zod) → spam/consumo de ancho de banda. Los handlers de voz confían en `callerId`/`playerId` del cliente (mismo patrón que C2).
  - `findMe` hace un **scan lineal de todas las salas** por cada acción de socket (`server/roomManager.js:421`) → O(N) por evento; mantener índice `socketId → roomId`.
- **DevOps:**
  - README raíz y `server/README.md` **corruptos** (UTF-16 con BOM, basura de una línea) → sin documentación de arranque/arquitectura/despliegue.
  - No hay `.env.example`; variables sin documentar (`DATABASE_URL`, `DB_POOL_MAX`, `CF_TURN_*`, `TURN_*`, `PORT`, `TURN_SECONDS`, `VITE_SERVER_URL`).
  - Tests **ad-hoc sin framework** (~309 asserts con `assert`): `testMatchmaking`, `testTournament`, `testTicTacToe` **no están** en el script `test` de la raíz. **0 tests de cliente.**

## 🔵 Bajos (selección)

- a11y: botones icon-only sin `aria-label` (`Chat.jsx:38`, `UnifiedVoiceWidget`), asientos `div[role=button]` sin `tabIndex`/`onKeyDown` (`PlayerSeats.jsx:45`).
- Carrera en matchmaking: `push` a la cola tras `await getUserProfile` sin revalidar `socket.connected` (`server/matchmaking.js`).
- `onMatchFound` emite `join_room` sin `name` (`client/src/App.jsx:384`).
- `curseServed` es campo muerto (`server/gameLogic.js:149`); fallback de ganador de torneo sesgado a `'b'`.
- Sin `engines.node` en ningún `package.json`; `concurrently` debería ser `devDependency`.
- `.gitignore` insuficiente (no cubre `dist/`, `coverage/`, `*.log`, `.DS_Store`, `.env.*`).
- Server sin `render.yaml`/`Dockerfile`/`Procfile` (config solo en el dashboard de Render, no versionada).

---

## ✅ Lo que ya está bien hecho (no romper)

- **Capa de BD (`server/db.js`):** operaciones atómicas (compra de skins, `claimMission`, `rollDaily`), **precio autoritativo del servidor**, modo degradado sin BD, guards contra doble cobro/carreras. Es lo más sólido del backend.
- Jugadas protegidas por `ownsPlayer` (socket ↔ playerId) en el `gameHandler`.
- Sin `dangerouslySetInnerHTML`/`eval`; React escapa el texto; `theme.js` valida skins contra un catálogo local (no inyecta valores del servidor). `maxHttpBufferSize` limitado.
- i18n con **paridad perfecta 567/567 claves** en es/pt/en, con fallback.
- `GameBoard.jsx` ejemplar (layout memoizado, keys estables, `ResizeObserver`/listeners con cleanup). WebRTC con *perfect negotiation* y limpieza correcta de tracks/streams. Reconexión de socket bien configurada (resync por estado completo).
- Reglas puras de dominó (reparto, colocación, robo, dominó/tranca, puntuación individual y por parejas) **sólidas y razonablemente testeadas**.

---

## Roadmap de mejora sugerido

### Fase 0 — Estabilización (desbloquea despliegue) · ~1 día
1. **C1:** commitear `server/core`, `server/games`, `client/src/games`, `client/src/hub`. Verificar arranque desde clon limpio.
2. **C5:** dejar de versionar `client/dist` + `.gitignore`.
3. **C4:** subir `useHubStore()` antes del `return` en `App.jsx`.
4. **C3:** auto-avance de `round_ended` en el servidor.
5. **A7:** un solo gestor de paquetes (pnpm), eliminar lockfiles duplicados.
6. Quick wins de higiene: README UTF-8, `.env.example`, `.gitignore` ampliado, `engines.node`, 3 suites de test que faltan en el script.

### Fase 1 — Seguridad y robustez · ~3–5 días
7. **C2:** identidad verificada (token de sesión firmado, vincular socket↔playerId, `findMe` en la capa social). Es el cambio de mayor impacto para "robustez".
8. **A1:** rate-limiting por socket, tope de salas, CORS restringido, `helmet`. Límites de longitud en chat/emote.
9. **A2:** TLS de BD con CA correcta.
10. **A8:** ESLint (cliente+server) + CI en GitHub Actions (install/test/build).

### Fase 2 — Arquitectura · ~1–2 semanas
11. **A3/A4:** sanear `BaseGame` (contrato de bots y `forceTurn`), migrar `DominoGame` al registry; descomponer `App.jsx` en hooks (`useGameSocket`/`useGameActions`) + router de vistas; una sola fuente de verdad de estado en cliente.
12. Refactor de poderes a módulo por-efecto con `checkRoundEnd()` y `freshActiveEffects()` (M2+M4).
13. **A5** + saneo de la capa de voz (renegociación, `name`, i18n, borrar código muerto).

### Fase 3 — Calidad y escala · continuo
14. Migrar tests a `node:test`/vitest con coverage; smoke tests de cliente.
15. Índice `socketId→roomId`; memoización de componentes; a11y.
16. `render.yaml`, observabilidad (Sentry ya disponible como MCP), métricas.

---

## Registro de implementación (2026-07-24)

> Cambios en el árbol de trabajo, **sin commitear** (revisar con `git diff` y luego `git add -A && git commit`).
> Verificación local: 10/10 suites ejecutables con `node` puro (incluye 2 nuevas: `testSecurity`, `testIdentity`). Las suites `testMatchmaking`/`testTournament` requieren `pg` (no hay `node_modules` en esta máquina) y no se pudieron ejecutar aquí.

### ✅ Fase 0 — estabilización (COMPLETA)
C1 módulos ahora trackeados (repo clona/arranca) · C3 auto-avance de `round_ended` (`roomManager.scheduleRoundAdvance`) · C4 `useHubStore` subido antes de los `return` · C5 `dist/` fuera de git · A7 un solo lockfile (pnpm) · higiene: README UTF-8, `.env.example`, `.gitignore`, `engines.node>=20`, script `test` con todas las suites, `concurrently`→devDeps.

### ✅ Fase 1 (parcial) — seguridad y robustez
- **A1 hardening** (`server/security.js`, sin dependencias nuevas): allowlist de CORS por `CLIENT_ORIGINS` (Express + Socket.IO), rate-limit por socket (token bucket vía `socket.use`: cubo general + cubo "pesado" para BD/creación + cubo anti-spam de chat), cabeceras de seguridad tipo helmet-lite, rate-limit HTTP por IP en `/ice-config`. Tope global `MAX_ROOMS` aplicado en `create_room`/`quick_play`/`friend_challenge`.
- **SEC-4**: `send_quick_message.text` ≤200 y `type` ≤24; `send_emote` ahora validado por schema (emoji ≤16) y con comprobación de propiedad del emisor (no suplantable).
- **C2 identidad** (`server/identity.js`, HMAC con `crypto`, sin deps): handshake `hello`/`session` (servidor + cliente) que **vincula el socket a su `playerId`** y emite/verifica un token de sesión firmado. La capa económica/social (`get_profile`, `equip_skin`, `claim_mission`, `get_match_history`, amigos, torneos, cola) usa ahora la **identidad vinculada**, no el `playerId` del payload → un socket ya no puede operar como varias identidades. `equip_skin`/`claim_mission` respetan `AUTH_STRICT` (modo estricto opcional que exige token válido; **desactivado por defecto** para no bloquear a nadie).
- **A2 TLS de BD** (`server/db.js`): SSL configurable por entorno (`DB_SSL_CA` en PEM, o `DB_SSL_STRICT=1`). **Se mantiene el default `rejectUnauthorized:false`** a propósito: cambiarlo a ciegas rompería la conexión con el pooler de Supabase/Render (certificados que no validan contra las CA del sistema). Endurecer en producción tras verificar la CA.
- **A8 ESLint + CI**: `client/.eslintrc.cjs` (react/hooks/refresh) y `server/.eslintrc.cjs` (Node); se quitó `--max-warnings 0` para que el lint sea usable; `eslint` añadido a devDeps del server con script `lint`. Workflow `.github/workflows/ci.yml`: `pnpm install` → `pnpm test` (en CI sí hay `pg`, corren las 12 suites) → lint (advisory) → build del cliente.
- **Nuevas variables** documentadas en `server/.env.example`: `CLIENT_ORIGINS`, `MAX_ROOMS`, `AUTH_SECRET`, `AUTH_STRICT`, `DB_SSL_CA`, `DB_SSL_STRICT`.

### ✅ Fase 2 (parcial) — corrección del motor y abstracción multi-juego
- **A3/A2-abstracción (bug reproducido y corregido)**: crear una sala `tictactoe` con un bot lanzaba `TypeError: game.getValidMoves is not a function` dentro de un `setTimeout` no capturado, y su `forceTurn()` devolvía `{success:true}` en vez del contrato esperado (mensajes con `undefined`). **Corrección**: el contrato subió a `BaseGame` (`getCurrentPlayer()`, `handlesOwnBots()`, `playBotTurn()`, y `forceTurn()` documentado como `{action, playerId, playerName, drew}`); `roomManager.scheduleBotTurn` ahora **delega en el juego** en lugar de invocar la IA de dominó, ya no lee `currentPlayerIndex` directamente y envuelve la jugada del bot en try/catch; `armTurnTimer` tolera retornos pobres sin narrar basura. `TicTacToeGame` declara `handlesOwnBots()` y normaliza `forceTurn()`; `DominoGame` expone `playBotTurn()` encapsulando `botLogic`.
- **M4**: `activeEffects` se inicializaba por triplicado y las copias habían divergido (`resetGame` olvidaba `spyAll*`/`curse*` → quedaban `undefined`). Ahora hay una **factoría única** `freshActiveEffects()`.
- **M1**: `startNewGame` no limpiaba `gameWinner` (banner de ganador fantasma tras `play_again`) y `startNewRound` no limpiaba `roundWinnerTeam`. Corregido.
- **M2**: `usePowerCard` nunca revalidaba el fin de ronda; regalar tu última ficha con Contrabando dejaba la partida colgada en `playing` con la mano vacía. Ahora revalida (`checkRoundEnd`) tras los poderes que mutan manos/tablero.
- **Corrección a esta auditoría**: el informe original afirmaba que `DominoGame` no extiende `BaseGame`. **Es inexacto**: sí lo extiende y se registra en el `GameRegistry` (`gameLogic.js:1`). Lo que sí era real —y está corregido— es que el *orquestador* dependía de detalles concretos de dominó. El `try/catch` de fallback en `createRoomFor` sigue ahí como red de seguridad.
- **Tests nuevos**: `testEngineFixes` (12 asserts, regresiones M1/M2/M4 — verificado que **fallan** si se revierte el arreglo) y `testGameContract` (16 asserts; **recorre todos los juegos del registry**, así que cualquier juego futuro queda obligado a cumplir el contrato).

### ✅ Fase 2 (cliente) — arreglos quirúrgicos
Se optó por **correcciones localizadas y no por el refactor grande de `App.jsx`**: sin `pnpm`/build en esta máquina no se puede compilar ni abrir el navegador, y reestructurar 900 líneas de React a ciegas era desproporcionado. Todos los cambios se verificaron leyendo el código, con balance estructural y con el nuevo test de i18n.
- **A6 (real, afectaba a todos los que cambian de idioma)**: `onKicked` usaba `t(...)` directo, lo que obligaba a incluir `t` en las dependencias del efecto y **re-registraba los ~21 listeners de socket + `connect()` en cada cambio de idioma** (con ventana para perder eventos). Ahora usa `tRef.current` y `t` salió de las dependencias. Verificado que **no queda ningún `t(` dentro del efecto** (si no, sería un *stale closure* con el idioma congelado).
- **M7**: `useVoiceChat` no desestructuraba `name`, así que dentro del hook `name` resolvía al global `window.name`; solo "funcionaba" por el respaldo a localStorage. Corregido en la firma.
- **M6**: el aviso de "conexión perdida" y el toast de error del servidor vivían **dentro de la rama de partida** → eran invisibles en lobby y hub. Movidos al nivel raíz; su CSS pasó de `absolute` a `fixed` (comprobado que solo se usan en `App.jsx` y que `.app-container` ocupa el viewport, así que no cambia su aspecto en partida). El error local del `Lobby` es otro mecanismo (validación de cliente), así que no hay duplicado.
- **B12**: `onMatchFound` emitía `join_room` sin `name`; se añade leyendo de localStorage (no del estado) para no crear un *stale closure* ni una dependencia nueva.
- **a11y**: `aria-label`/`aria-expanded` en el botón flotante de chat (con clave i18n nueva) y acceso por teclado (`tabIndex` + Enter/Espacio) en los asientos seleccionables, que anunciaban `role="button"` sin cumplirlo.
- **Código muerto**: eliminado el import de `GlobalVoiceOverlay` (importado pero **nunca renderizado**, entraba al bundle). **El archivo se conserva** por si formaba parte de trabajo en curso. `VoiceChat` **no** se tocó: pese a lo que sugería el informe, sí se usa (`WaitingRoom`, `GameBar`).
- **Test nuevo `testTranslations.mjs`**: paridad de idiomas (claves faltantes/sobrantes/duplicadas/vacías). Resultado actual: **3 idiomas × 570 claves, paridad completa**.

### ✅ M3 — Falsa tranca por efectos temporales (decisión del propietario)
**Regla acordada: un pase provocado únicamente por un efecto temporal NO declara bloqueo.** El tablero no está cerrado, solo bloqueado un instante, y el efecto caduca enseguida.

Implementación en `gameLogic.js`, en tres capas:
1. `hasValidMove(playerId, { ignoreBlocks })` — nuevo parámetro opcional (los ~6 llamadores existentes no cambian de comportamiento) que responde «¿podría jugar si no fuera por el efecto?».
2. `passForcedByEffectsOnly(playerId)` — distingue el pase por *mano muerta* del pase por *Congelar Extremo / Bloqueo Total / Maldición*. En `passTurn`, un pase por efecto **no incrementa `passedTurns`**.
3. `checkRoundEnd` ya no se fía solo del contador: antes de cerrar por tranca **confirma que nadie tiene jugada legal** ignorando los bloqueos temporales; si la hay, es falsa alarma y reinicia el contador.

**Bug adicional encontrado al implementarlo**: `passTurn` registraba en `playerPassedOn` que el jugador «no tiene esos extremos» incluso cuando el pase era por congelación — **información falsa que alimentaba a los bots difíciles** (podía tener la ficha y no poder soltarla). Ahora solo se registra en pases genuinos.

Cubierto por `testFalseBlock.js` (13 asserts), que verifica tanto que el bloqueo temporal **no** cierra la ronda como que **la tranca real se sigue detectando** —el riesgo real de este cambio— y que el pase genuino sigue contando.

**Estado de verificación: 14/14 suites ejecutables en verde** (`testSecurity` 14 + `testIdentity` 11 + `testEngineFixes` 12 + `testGameContract` 16 + `testTranslations` asserts nuevos).

### ⏳ Pendiente para cerrar Fase 1 / seguridad
- **C2 endurecimiento final** (requiere prueba en staging): activar `AUTH_STRICT=1` y **dejar de difundir el `playerId` real de cuenta a los rivales** (usar un id efímero por asiento en `getGameStateForPlayer`/`getSpectatorState` y en el targeting del cliente). Sin esto, un rival que ya conoce tu id podría reclamarlo en su propio socket; la vinculación por socket + rate-limit mitigan el abuso masivo, pero la protección completa depende de estos dos pasos.
- **Regenerar `pnpm-lock.yaml`** (no hay pnpm en la máquina de desarrollo) tras los cambios de `package.json` (eslint devDep, engines) y pasar el CI a `--frozen-lockfile`.
- **Fase 2 restante (cliente) — requiere `pnpm install` + build/navegador**: descomponer `App.jsx` en `useGameSocket`/`useGameActions` + router de vistas y memoizar hijos (A4); unificar la fuente de verdad de `playerId` y los flags de modal (M5); **`onnegotiationneeded` en WebRTC** (A5: encender la cámara a mitad de llamada no llega al otro par); i18n de `UnifiedVoiceWidget` (M8); decidir si implementar o retirar la detección de "quién habla" (`speaking`/`voiceFilter` no cableados) y `games/registry.js`.
- **Primer arranque tras estos cambios**: verificar en navegador el modo espectador (C4), el lobby con el socket caído (M6) y una llamada de voz (M7), que son los flujos tocados sin poder compilar aquí.
- ~~**M3 (falsa tranca por Congelar/Maldición)**~~ → **RESUELTO** (ver abajo).
- **Antes de desplegar**: revisar y commitear todo el árbol (`git add -A && git commit`), definir `CLIENT_ORIGINS` y `AUTH_SECRET` en el entorno de producción.

> Nota de entorno: en esta máquina no hay `pnpm`/`npm`/`node_modules`, así que no se pudo ejecutar `pnpm install`, el build de Vite, ESLint, ni las 2 suites que dependen de `pg`. Todo lo verificado localmente son las 10 suites de lógica pura (con `node`) y `node --check` de sintaxis. El resto debe validarse en el primer CI/staging.
