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

---

# Segunda auditoría — 2026-07-27 (con toolchain, verificada por ejecución)

> Commit auditado: `14356fb` · Método: `pnpm install --frozen-lockfile`, 15 suites, ESLint, build de Vite y **pruebas de explotación contra el servidor en marcha**.

La auditoría anterior se escribió **sin toolchain** y declaró la Fase 1 (seguridad) esencialmente
completa. Con node/pnpm disponibles se ha podido ejecutar y explotar el servidor real, y el
resultado es distinto: existía la *fachada* de seguridad (`identity.js`, `security.js`, tokens
HMAC, rate-limit) sin que ninguna barrera cerrase.

## Correcciones a la auditoría del 2026-07-24

Tres afirmaciones de su registro de implementación son **inexactas** (verificado, no deducido):

1. **«higiene: README UTF-8»** — falso. `README.md` y `server/README.md` siguen en UTF-16.
   `README.md` no tiene BOM, así que `file` lo identifica como imagen Targa y
   `git diff --numstat` devuelve `-  -`: **git los trata como binarios** (sin diffs ni revisión).
2. **«la capa económica/social usa ahora la identidad vinculada»** — parcial. `create_room`,
   `quick_play` y `join_room` siguen usando el `playerId` crudo del payload, y esos caminos
   escriben en BD vía `getOrCreateUser` (que actualiza el `username`).
3. **«pendiente: activar `AUTH_STRICT=1`»** — activarlo no habría protegido nada: el handshake
   `hello` **emite el token de sesión de cualquier `playerId` a quien lo pida** (ver C-2).

## Recuento

| Severidad | Nº | Titulares |
|---|---|---|
| 🔴 Crítico | 4 | DoS con un evento · oráculo de tokens · secuestro de salas · sin red de seguridad de proceso |
| 🟠 Alto | 7 | Capa de sala sin identidad · ELO/economía farmeables · CI descarta el lint · hooks condicionales · WebRTC sin renegociar · READMEs binarios · god component |
| 🟡 Medio | ~11 | CORS abierto · `findMe` O(N) · sin límite por IP · 0 tests de cliente · CSS monolítico · código muerto |

---

## ✅ Bloqueantes corregidos en esta pasada

### C-1 · DoS remoto trivial: `findMe` no estaba importado
`gameHandler.js` usaba `findMe` en `game_action` y `start_game` sin importarlo del `roomManager`.
**Explotado en vivo:** un socket anónimo, sin sala y sin autenticar, emitía `start_game` y el
proceso moría con `ReferenceError` — cayendo **todas** las partidas, torneos y llamadas en curso.
De paso, el motor multi-juego entero (tres en raya) era inarrancable.
**Corregido:** añadido al `require`. Verificado que el hub arranca de verdad, no solo que no revienta.

### C-4 · El proceso no tenía ninguna red de seguridad
Cero `uncaughtException`/`unhandledRejection` sobre 53 eventos de socket. Es lo que convertía
C-1 de bug en DoS. Además, tres puntos dentro de timers llamaban al motor **sin `try/catch`**
—`forceTurn()`, `startNewRound()` y `recordMatchEnd()` sin `.catch()`— pese a que
`scheduleBotTurn` ya aplicaba ese criterio.
**Corregido:** guardas de proceso que registran y siguen sirviendo, más `try/catch` en los tres
timers. **Matiz importante:** una guarda global convertiría un fallo de arranque (`EADDRINUSE`)
en un proceso zombi vivo pero sin escuchar —peor que caerse, porque el health check lo daría por
bueno—, así que `server.on('error')` sigue siendo **fatal con `exit(1)`**. Verificado ambos casos.

### C-3 · Cualquiera podía inutilizar todas las salas públicas
`add_bot`, `remove_bot` y `swap_seats` validaban el schema pero **no la pertenencia a la sala**,
y `lobby_subscribe` publica los `roomId` gratis. **Explotado en vivo:** un extraño que nunca entró
llenaba una sala ajena de bots hasta que desaparecía del lobby. Un bucle sobre `rooms_list` dejaba
el matchmaking público muerto.
**Corregido:** helper `myRoom()` (`findMe` + comprobación de sala) en los tres handlers y en
`toggle_ready`. Se exige **pertenencia, no ser anfitrión**, porque la UI ofrece estas acciones a
cualquier jugador de la sala (solo expulsar es del anfitrión) — el arreglo no recorta funcionalidad.

### A-3 · El CI veía el bug crítico y descartaba el resultado
Ambos lints estaban en `continue-on-error: true`. ESLint marcaba el `no-undef` de C-1 y cuatro
`rules-of-hooks`, y el CI seguía adelante. **Esta es la causa raíz de que C-1 llegara a `main`.**
**Corregido:** lint bloqueante (los avisos no bloquean, los errores sí), `pnpm install
--frozen-lockfile`, y los **20 errores a 0**: `findMe`, los hooks de `UnifiedVoiceWidget` (A-4) y
13 `no-case-declarations` en `gameLogic.js` (fugas de scope en el `switch` de poderes).

### A-4 · Hooks condicionales en `UnifiedVoiceWidget`
`if (!voice) return null` por encima de tres `useState` y un `useEffect` — la misma clase de bug
que C4 de la auditoría anterior, reintroducida. Latente hoy (el contexto no transiciona en una
instancia montada) pero el widget se monta en 4 sitios.
**Corregido:** hooks por encima de cualquier `return`.

### Nueva suite: `server/testHandlers.js` (integración)
Las 15 suites existentes son **todas de lógica pura**, y por eso ninguna vio estos cuatro fallos:
eran de **cableado y ciclo de vida**. La suite nueva arranca `server.js` de verdad en su propio
puerto y le habla con un cliente Socket.IO real (11 asserts): eventos anónimos y malformados no
tumban el proceso, un extraño no manipula salas ajenas, y **el jugador legítimo sí puede** hacerlo.
`socket.io-client` añadido a las devDeps del server.

**Verificado que la suite falla al revertir los arreglos** (no es decorativa):
revertir C-1+C-4 → la suite muere con `ECONNREFUSED` (exit 1); revertir solo `add_bot` → 3 asserts
en rojo (exit 1).

### Estado tras los arreglos
```
pnpm install --frozen-lockfile   ✅  reproducible
pnpm test                        ✅  16/16 suites (exit 0)
pnpm --filter domino-* lint      ✅  0 errores (exit 0), avisos visibles
pnpm --filter domino-client build ✅  459 KB / 132 KB gzip
```

---

## ✅ C-2 corregido — el oráculo de tokens (segunda tanda)

**El fallo.** El handler `hello` emitía un token para **cualquier** `playerId` que le pidieran:
si el token presentado no era válido, en vez de rechazar, *firmaba uno nuevo y lo devolvía*. Como
el `playerId` real de cuenta viaja en `game_state` a rivales y espectadores, bastaba con mirar una
partida, pedir el token de otro y reconectar con él. El token era `HMAC(playerId)` puro: sin
caducidad, sin nonce y sin revocación — una contraseña permanente derivable a petición.
Peor: la vinculación socket↔identidad ocurría **aunque no se autenticase**, y la capa social usaba
esa vinculación, así que `AUTH_STRICT=1` no protegía de nada.

**Lo corregido**, en cuatro piezas:

1. **Registro de reclamación (fin del oráculo).** Cada identidad guarda un secreto propio
   (`users.auth_nonce`, columna nueva). La primera conexión que presenta un id libre lo reclama y
   recibe su token; a partir de ahí el servidor **no vuelve a emitir token para ese id**. La
   reclamación es atómica (`UPDATE ... WHERE auth_nonce IS NULL RETURNING`), así que dos conexiones
   simultáneas con el mismo id nuevo no pueden ganarla las dos.
2. **Vinculación solo con prueba.** Si no demuestras la propiedad, el socket **no queda vinculado**
   y la capa social/económica no encuentra identidad. Antes se vinculaba igualmente.
3. **Token v2** — `v2.<caducidad>.<firma>`, firmado sobre el nonce de la cuenta: caduca (180 días,
   renovado en cada conexión) y es **revocable** rotando el nonce en BD.
4. **Fallo cerrado.** Si hay BD y la consulta falla, se deniega. Nunca se concede una identidad
   porque la base de datos esté caída.

**Alcance ampliado a la misma superficie de suplantación** (no tenía sentido cerrar una puerta y
dejar las otras):
- **A-1** · `create_room`/`quick_play`/`join_room` usan ya la identidad vinculada. Antes,
  `getOrCreateUser(playerId, name)` con un id ajeno **renombraba la cuenta de otro** y las
  estadísticas de la partida se acreditaban a la cuenta suplantada.
- **Capa de voz** · `call_friend`, `invite_to_pool`, `accept_call` y `end_call` tomaban el
  `callerId`/`playerId` del payload: se podía aparecer en un grupo de voz con el nombre y el id de
  otra persona, y `end_call` con un id ajeno **echaba a otro de la llamada**.

**La carrera que había que resolver.** El cliente emite `get_profile` en el **mismo tick** que
`hello`; al pasar el handshake a asíncrono (consulta el registro), esa primera petición se habría
perdido en silencio. `beginHandshake` fija la promesa en `socket.data` de forma **síncrona** y los
handlers la esperan con `identity.ready(socket)`. Cubierto por un test explícito.

**Cliente.** Si el servidor deniega la identidad (`reason: 'reclamada'` — token caducado tras medio
año sin jugar, o localStorage a medias), el cliente empieza una identidad nueva en vez de quedarse
con perfil, tienda y amigos fallando en silencio para siempre.

**Verificación**
- `testIdentity.js` reescrito: **24 asserts** (token v2, caducidad, revocación por rotación de
  nonce, y el oráculo end-to-end: víctima reclama → atacante pide → no recibe token ni vinculación).
- `testHandlers.js`: **8 asserts nuevos** de integración contra el servidor real, incluidos la
  carrera `hello`/`get_profile` y A-1 (crear sala con el id de otro no sienta a la víctima).
- El exploit original de esta auditoría, contra el servidor parcheado:
  `{"playerId":null,"token":null,"authed":false,"reason":"reclamada"}` — antes devolvía el token de
  la víctima y `AUTENTICADO COMO LA VICTIMA: true`.
- **Verificado que los tests fallan al reintroducir el oráculo** (`owns = true`): `testIdentity`
  exit 1, `testHandlers` 3 asserts en rojo.

### 🔧 Cambio operativo obligatorio: `AUTH_SECRET`
Con las reclamaciones persistidas en BD, **`AUTH_SECRET` deja de ser opcional**. Las identidades
sobreviven al reinicio pero los tokens se firman con ese secreto: si fuera efímero, tras cada
reinicio ningún token verificaría, todos los ids seguirían reclamados y cada jugador sería
rechazado y empezaría de cero — pérdida silenciosa e irreversible de monedas, skins, ELO y amigos
de todo el mundo, en cada reinicio.

Por eso el servidor ahora **se niega a arrancar** si hay `DATABASE_URL` y falta `AUTH_SECRET`, con
un mensaje que explica el motivo y cómo generarlo. Es preferible un fallo inmediato y visible a una
pérdida de datos callada. Sin BD sigue arrancando con secreto efímero (no hay nada que perder,
porque el registro de reclamaciones también es en memoria). Verificados los tres casos.

**Acción requerida antes de desplegar:** definir `AUTH_SECRET` estable en el entorno de Render.

### ⚠️ Límite conocido y asumido
Sin registro (ni email ni contraseña) esto es **confianza en el primer uso**: quien reclame un id
antes que su dueño se queda con él, y al desplegar hay una **ventana de migración** en la que las
cuentas existentes están sin reclamar. Como los `playerId` llevan difundiéndose desde siempre, esa
ventana no se cierra con ids efímeros (el daño de la fuga pasada ya está hecho). Cerrarlo de verdad
exige **autenticación real** (OAuth/email), que es una decisión de producto, no un parche.

---

## ✅ A-2 corregido — ELO y economía farmeables (tercera tanda)

**El fallo tenía tres capas.**

1. **`create_room` aceptaba `ranked: true` del cliente**, así que cualquiera montaba una partida
   clasificatoria a medida saltándose el emparejamiento.
2. **El ELO era de suma positiva**: ±fijo (+25 / −10) con suelo `GREATEST(1000, ...)`. Cada partida
   *inyectaba 15 puntos*. Dos pestañas alternando victorias subían **las dos** indefinidamente
   (+750 cada una en 100 partidas): la clasificación medía constancia, no habilidad.
3. **Las monedas se pagaban en toda partida terminada, también contra bots y sin tope.** Un script
   que abriera sala, metiera un bot y la cerrara en bucle compraba la tienda entera (~7.650) en
   minutos — el resto de ingresos (racha 10-70/día, misiones ~150-290/día) ya estaban acotados.

**Lo corregido.**
- `ranked` **fuera del schema** y forzado a `false` en `createRoomFor`. Solo `createRankedMatch`
  —desde la cola de emparejamiento— crea partidas clasificatorias. Como efecto añadido, dos cuentas
  cómplices ya no eligen rival: la cola empareja por ELO.
- **Elo clásico de suma cero** (K=32) calculado entre los dos jugadores a la vez, con el resultado
  esperado según la diferencia de puntuación: ganar a alguien muy inferior apenas suma, perder
  contra él cuesta caro. El suelo se respeta **sin romper la suma cero**: si el perdedor no puede
  pagar el delta completo, el ganador cobra solo lo que se le ha podido descontar.
  Además el ELO exige ahora **1v1 con exactamente 2 humanos** (antes bastaba `>= 2`).
- **Las monedas solo se pagan con ≥2 humanos** (decisión del propietario). Jugar contra bots sigue
  contando para estadísticas y misiones, así que el jugador en solitario progresa igual; lo que
  desaparece es el único ingreso ilimitado y automatizable.
- **Cliente:** se retira el interruptor «Clasificatoria» del formulario de crear sala — habría
  quedado mintiendo al jugador («Afecta al ELO») sin hacer nada. La vía clasificatoria es el botón
  de emparejamiento, que ya estaba en el mismo lobby. Retiradas también sus 2 claves i18n
  (paridad verificada: 3 × 568).

**Verificación** — `testEconomy.js`, **30 asserts** sobre las funciones puras extraídas
(`computeEloDelta`, `coinsForMatch`), más 1 de integración:
- el total de ELO del sistema no varía en ninguna partida, ni en resultados extremos;
- tras 100 partidas alternas entre dos cuentas el total sigue siendo 2400 (antes +1500) y **es
  imposible que suban las dos**;
- el recorte por suelo mantiene la suma cero y el perdedor nunca baja de él;
- 1.000 partidas contra bots dan 0 monedas (antes 50.000, seis veces la tienda);
- `create_room` con `ranked: true` no crea sala clasificatoria.

> **Nota honesta sobre el ELO:** la suma cero impide *crear* puntos, pero no impide que alguien
> infle una cuenta sacrificando un alt. Eso es inherente al Elo y las defensas reales
> (partidas provisionales, mínimo de rivales distintos, señales de cuenta) son otra tarea. Lo que
> se ha eliminado es el «+15 gratis para todos», que era un fallo, no un compromiso de diseño.

---

## ✅ A-5 y A-6 corregidos (cuarta tanda)

### A-5 · WebRTC no renegociaba
Toda la maquinaria de *perfect negotiation* estaba ahí (`polite`/`makingOffer`/`ignoreOffer`,
resolución de colisiones) pero **faltaba el disparador**: sin `onnegotiationneeded`, el
`addTrack`/`removeTrack` de `toggleCam` se aplicaba sobre conexiones ya negociadas y el otro par
no se enteraba nunca. Encender la cámara a mitad de llamada solo «funcionaba» si ya estaba
encendida antes de crear el peer; apagarla tampoco se propagaba.

**Corregido** con un `onnegotiationneeded` deliberadamente conservador: se **ignora el disparo
inicial** (el que provoca añadir el micrófono al crear la conexión) mediante un flag
`canRenegotiate` que solo se activa cuando la conexión vuelve a `stable` teniendo ya descripción
remota, es decir, cuando el intercambio inicial oferta/respuesta ha terminado. Así el
establecimiento de la llamada —que funciona— no se toca, y solo se atienden los cambios de pista
posteriores, que es exactamente lo que estaba roto. Se revalida `signalingState` después del
`await` de `createOffer` por si llegó una oferta del otro par entretanto.

> ⚠️ **Sin verificar en navegador.** Esto es lo único de todas las tandas que no he podido probar
> ejecutándolo: requiere dos navegadores con cámara y un TURN. Está revisado línea a línea y
> compila, pero **hay que comprobarlo a mano**: llamada entre dos equipos → encender la cámara en
> uno → debe aparecer en el otro; apagarla → debe desaparecer; repetir el ciclo varias veces.
> Punto concreto a vigilar en esa prueba: cada ciclo apagar/encender usa `removeTrack` + `addTrack`,
> que puede ir añadiendo secciones `m=` al SDP. Si se observa degradación tras varios ciclos, la
> solución es reutilizar el `RTCRtpSender` (`replaceTrack` + `transceiver.direction`) en vez de
> añadir pistas nuevas; no lo he hecho a ciegas porque el manejo de transceivers es fácil de
> romper sin un navegador delante.

### A-6 · READMEs corruptos (git los trataba como binarios)
Ambos estaban en UTF-16 —`README.md` sin BOM, hasta el punto de que `file` lo identificaba como
imagen Targa— y `git diff` devolvía `-  -`: sin diffs, sin revisión posible. Convertidos a UTF-8
(verificado: el contenido nuevo diffea como texto, 84 y 64 líneas).

`server/README.md` resultó ser un muñón de **15 caracteres** (`# 2mino-bcknd`), así que se ha
escrito de verdad: arranque, mapa del módulo, cómo añadir un juego al hub, rutas HTTP y —lo más
útil— una tabla de **qué mecanismo de confianza aplica cada capa** (`ownsPlayer` / `myRoom` /
`identity.ready`), que es justo lo que se confundía en los fallos de esta auditoría.

El README raíz tenía además la tabla de variables desactualizada: faltaban `AUTH_SECRET`,
`AUTH_STRICT`, `CLIENT_ORIGINS`, `MAX_ROOMS` y `DB_SSL_*`, y no advertía de que sin
`VITE_SERVER_URL` el cliente en producción apunta a su propio origen. Corregido, con el aviso
destacado de `AUTH_SECRET`.

---

## ⏳ Abierto — por prioridad

### 🟠 Resto de C-2: dejar de difundir el `playerId` real de cuenta
`getGameStateForPlayer`/`getSpectatorState` siguen enviando `id: p.id` —el id de cuenta— a rivales
y espectadores. Con el oráculo cerrado y A-1 arreglado, **ya no es una vía de robo de cuenta**:
queda como divulgación de identificador (rastreo entre partidas) y como facilitador de la ventana
de migración descrita arriba.

No se ha hecho en esta pasada porque **no es un parche, es un cambio de arquitectura**:
`useGameStore` documenta que el id de cuenta *es* el id de asiento a propósito («Identidad
canónica: SIEMPRE el id persistente… El servidor devuelve este mismo id»). Separarlos obliga a
mantener un mapa asiento↔cuenta en el servidor (`addPlayer`, `roomManager`, torneos, matchmaking,
`recordMatchEnd`) y a revisar en el cliente todo el targeting por `player.id` (poderes, emotes,
expulsar, intercambiar asientos, espía, voz). Merece su propia pasada con navegador delante.

### 🟠 Antes de abrir al público
- **A-7** · `App.jsx` sigue siendo god component: **959 líneas**, ha crecido desde las 926.

### 🟡 Medios
CORS abierto por defecto (y el CORS no protege de clientes no-navegador: las tres pruebas de
explotación usaron `socket.io-client` desde Node y lo ignoraron — la barrera real es la
autorización) · rate-limit solo por socket, sin tope de conexiones por IP · `findMe` hace scan
lineal de todas las salas en cada evento con `MAX_ROOMS=3000` · `/health` sin rate-limit expone
`rss`/`heap` · `socket.js` cae a `window.location.origin` en producción si falta
`VITE_SERVER_URL` · **0 tests de cliente** reales · `index.css` de 7.815 líneas · código muerto
que el lint ya señala (`setJoined`/`setConnecting`/`setError`/`setPeerStates`/`setSpeaking` en
`useVoiceChat` — la detección de "quién habla" sigue sin cablear).
