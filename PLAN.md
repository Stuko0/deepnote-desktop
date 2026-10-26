# deepnote-desktop - Plan de desarrollo completo

Estado: planificacion (Fase 0 pendiente). Fecha: 2026-10-26.
Decisiones ya tomadas: arquitectura hibrida (Opcion C), shell Wails (Go), frontend React+Chakra con los tokens extraidos de la SaaS, nucleo de ejecucion = packages TypeScript del repo open-source de Deepnote corriendo en un sidecar Node/Bun.

---

## 1. Vision y alcance

Aplicacion de escritorio para Linux y Windows que permite crear, editar y ejecutar notebooks `.deepnote` de forma local-first, con la experiencia de la UI de Deepnote Cloud (mapeada en `research/ui/SPEC-UI.md`) y con modo cloud opcional usando el cliente oficial `@deepnote/cloud`.

En alcance: editor de bloques (codigo, SQL, texto, inputs, charts), ejecucion reactiva local (DAG), terminal, explorador de archivos, integraciones de base de datos por env vars, agentes con bring-your-own-key, MCP local, snapshots e historial, conversion ipynb/qmd/marimo, packaging para Linux (deb/rpm/AppImage) y Windows (NSIS).

Fuera de alcance (fase inicial): colaboracion en tiempo real, hosting de apps/Streamlit, SSO/equipos, compute gestionado. Todo eso pertenece al modo cloud y se accede via API oficial, no se replica.

## 2. Arquitectura

### 2.1 Capas

```
+---------------------------------------------------------------+
| Shell Wails (Go)                                              |
|  - ventanas, menus, tray, dialogs, notificaciones, single-    |
|    instance, deep links, auto-update                          |
|  - lifecycle del sidecar (spawn, health, restart)             |
+-----------------------------+---------------------------------+
                              | WailsJS bindings (IPC tipado)
+-----------------------------v---------------------------------+
| Frontend (React 18 + Chakra UI + Monaco + xterm + Vega-Lite)  |
|  - estado: Zustand (slices por dominio)                       |
|  - datos: WS + fetch contra el sidecar local                  |
|  - atajos y command palette (ctrl+P) sobre el mismo modelo    |
+-----------------------------+---------------------------------+
                              | HTTP + WS en 127.0.0.1:PORT (token)
+-----------------------------v---------------------------------+
| Sidecar TS (binario Bun compile)                              |
|  - importa @deepnote/runtime-core, blocks, reactivity,        |
|    convert, mcp, cloud                                        |
|  - sesion de kernel Jupyter persistente (ServerPool)          |
|  - protocolo de eventos de notebook (ver 2.3)                 |
+-----------------------------+---------------------------------+
                              | protocolo Jupyter estandar
+-----------------------------v---------------------------------+
| Python local: `python -m deepnote_toolkit server`             |
|  (Jupyter server + kernel Deepnote + LSP, puertos consecutivos)|
+---------------------------------------------------------------+
```

Justificacion del sidecar: el nucleo reutilizable es TypeScript/Node (spawn de Python, @jupyterlab/services, AI SDK, MCP). Wails no embebe Node, asi que el sidecar es el puente minimo; es el mismo patron que Deepnote usa para distribuir su CLI (`bun build --compile` -> binario standalone). El frontend y el sidecar son agnosticos del shell: si en el futuro se migra a Tauri/Electron, solo cambia la capa Go/Rust/Node main.

### 2.2 Proceso y ciclo de vida

- El shell Go es el unico proceso visible para el usuario. Arranca el sidecar en el arranque de la app (o lazy, en el primer proyecto abierto) con `--port 0 --token <random>` y vigila su salud (heartbeat HTTP cada 5 s; restart con backoff exponencial).
- El sidecar mantiene un `ServerPool` de servidores toolkit calientes (idle 5 min, health-check antes de reutilizar) para eliminar el coste de arranque por ejecucion (el `runWithInputs` de upstream mata el servidor en cada run; esto es una de las diferencias centrales de este proyecto).
- Cierre ordenado: Ctrl+C/SIGTERM del shell -> graceful shutdown del sidecar (10 s) -> SIGKILL de los hijos Python (en Windows se usa Job Object desde Go, porque upstream depende de `pgrep` que no existe ahi).

### 2.3 Protocolo sidecar (contrato versionado)

- HTTP (JSON) para comandos request/response: abrir proyecto, validar, guardar, convertir, snapshot, integraciones, configuracion de interpreter.
- WS para el flujo del notebook. Mensajes tipados y versionados (`{v: 1, type, payload}`):
  - del sidecar al cliente: `notebook:loaded`, `block:added|updated|removed|moved`, `exec:queued|started|output|done|error`, `kernel:state`, `vars:update`, `terminal:data`, `run:summary`
  - del cliente al sidecar: `exec:block` (con upstream opcional), `exec:stop`, `input:changed`, `block:create|update|delete|move`, `kernel:restart`
- El estado del notebook en el sidecar es el unico writer; el cliente aplica actualizaciones optimistas y se reconcilia por `version` de bloque (como hace la SaaS con `SubmitBlockTransactions` + `WatchNotebookBlockUpdate`).
- Persistencia: el archivo `.deepnote` en disco es la fuente de verdad. Guardado explicito + autosave con debounce (1.5 s). Outputs no viven en el archivo de trabajo: se escriben en `snapshots/*.snapshot.deepnote` (formato upstream) y en cache LRU en memoria.

### 2.4 Seguridad

- El sidecar solo escucha en loopback y exige un token de sesion generado por el shell (evita ataques DNS-rebinding/csrf desde el browser del sistema; upstream ya tiene guardas de Origin en `serve-static.ts` que se reutilizan).
- Outputs HTML se renderizan en iframe sandbox con origin nulo (practica ya usada por los ejemplos upstream).
- Secretos de integraciones: exclusivamente env vars (`DEEPNOTE_SQL_CONN_*`), nunca en el `.deepnote`; el UI lee/establece valores via keyring del SO (Go: keyring de Wails o libsecret/wincred).
- El modo cloud usa `DEEPNOTE_TOKEN` del keyring, jamas en disco en texto plano.

## 3. Patrones de diseno

### 3.1 Frontend

- Feature-sliced: `features/{notebook-editor,run-controller,files,terminal,integrations,agent,...}`, `entities/{block,project,notebook,runtime}`, `shared/{ui,api,hooks}`. Cada feature expone un modelo tipado; nada importa de otra feature directamente.
- Container/presenter: los componentes contenedores suscriben Zustand/WS; los presentadores son puros y testeables con props.
- Zustand con slices por dominio (`useNotebook`, `useRuntime`, `useUi`); derivaciones con selectors para evitar re-renders de la lista de bloques (key = block.id + version).
- Command pattern para todas las acciones del usuario: cada comando es un objeto `{id, title, shortcut, run()}` registrado en un CommandRegistry que alimenta la paleta (ctrl+P), los menus y los atajos. Garantiza que atajo, menu y paleta nunca diverjan (el copy oficial de la SaaS esta en `SPEC-UI.md` seccion 9).
- Actualizaciones optimistas + reconciliacion por version de bloque; los conflicts se resuelven aplicando el estado del sidecar (single writer).
- Rendering: block list virtualizada; los outputs tabulares usan windowing (10 filas por pagina como la SaaS, `deepnote_table_state` con pageIndex/filters/sortBy para paginar servidor-side sobre el dataframe en el kernel).

### 3.2 Sidecar TS

- Arquitectura hexagonal: `core/` (dominio puro: parseo `.deepnote`, DAG, plan de ejecucion) sin IO; `adapters/` (jupyter, filesystem, ws, keyring) y `app/` (composicion). El dominio es testeable sin Python.
- State store inmutable con reducers puros por notebook (eventos tipados); un unico writer por notebook y fan-out por subscriber WS.
- Pub/sub con backpressure: eventos de salida se coalescen por tick (16 ms) y se envian en lote; los outputs grandes (tablas > 50 KB) no viajan por WS sino que el sidecar los persiste y el cliente los fetchea por HTTP (mismo patron `outputs_reference` de la SaaS).
- Errores: discriminar categorias como upstream (`KernelDiedError`, `ServerExitedError`, `ExecutionTimeoutError`) y mapearlas a la UI de error que ya vimos (resumen + accion).

### 3.3 Shell Go

- Interfaces pequenas; options pattern para construir servicios; `context.Context` por operacion con timeouts.
- Toda accion nativa (dialogs, fs, tray) pasa por el IPC tipado de WailsJS; el Go no conoce el modelo del notebook (separa responsabilidades).

## 4. Optimizaciones

- Arranque: sidecar lazy + ServerPool caliente: eliminar el penaultimo arranque de Jupyter por run (upstream arranca y mata en cada run). Objetivo: segundo run < 500 ms hasta el primer output.
- Monaco: un model por blockId cacheado (evita recrear modelos al re-render), lazy load del bundle de lenguajes (python/sql), `automaticLayout` con ResizeObserver propio (mas barato que el de Monaco).
- Tablas grandes: virtualizacion de filas y columnas, paginacion de 10 en 10 igual que la SaaS, cache LRU de paginas ya fetchadas, prefetched de la pagina siguiente al 80 % de scroll.
- WS: batching/coalescing de eventos de output (16 ms), compresión permessage-deflate, heartbeat con reconexion exponencial y resync por `NotebookCatchup` (upstream hace lo mismo: `NotebookCatchup`/`KernelCatchup`).
- Memoria: limite de outputs en memoria por bloque (evitar OOM con DataFrames enormes), streaming de outputs a disco en snapshots.
- Binario: Bun compile con tree-shaking; assets del frontend minificados y con hashing; iconos SVG inline (sin sprites externos).
- Windows: path handling centralizado (sin `/` hardcodeados), Job Objects para limpieza de procesos hijos (remplaza `pgrep`), pruebas de rutas con espacios y no-ASCII desde el dia 1.

## 5. Testing

- Unit (Vitest, TS): dominio puro del sidecar (parseo, DAG, reducers, plan de ejecucion) y hooks/selectores del frontend. Cobertura minima 80 % en `core/`.
- Contract: fixtures golden files de `.deepnote` (parseo -> serializacion estable, roundtrip identico), igual que upstream pero con nuestros fixtures en `test-fixtures/`.
- Integration (solo Linux en CI, con `pip install "deepnote-toolkit[server]"`): arranque real del servidor toolkit, ejecucion de notebook real, outputs en formato nbformat. Excluidas de `pnpm test` (patron upstream: `*.integration.test.ts`).
- E2E de UI (Playwright contra el sidecar real, en browser embebido/headless): abrir proyecto -> ejecutar bloque -> ver output; editor de markdown; inputs; save/autosave. Incluye capturas visuales para regression visual (tolerancia pixel).
- E2E desktop: smoke tests del binario compilado (abrir, cargar proyecto, ejecutar, cerrar limpio) en Linux y Windows; validacion de arranque/parada del sidecar y limpieza de hijos (sin procesos huerfanos en Windows).
- Cross-OS: toda la matriz corre en `ubuntu-latest` y `windows-latest` (este es el riesgo nro 1 del upstream: no tiene tests en Windows).
- Lint/format: Biome + Prettier (heredados del repo upstream, misma config) para TS; golangci-lint para Go.

## 6. CI/CD (GitHub Actions)

Repositorio: `github.com/Stuko0/deepnote-desktop` (publico, main protegida: 1 review obligatoria, sin force-push, sin delete; los admin pueden bypass mientras no haya otros colaboradores).

- `ci.yml` (pull requests y pushes a main): lint (biome + golangci-lint), typecheck (`pnpm typecheck`), unit tests matriz ubuntu/windows, integration tests (ubuntu, con toolkit Python), E2E Playwright (ubuntu), build de smoke (wails build en ubuntu y windows).
- `release.yml` (tag `v*`): build cross-platform (linux amd64/arm64, windows amd64), empaquetado (deb/rpm/AppImage, NSIS), checksums SHA-256, notas de release automaticas desde conventional commits, publicacion de artefactos en GitHub Releases (el auto-update feed se conecta en la Fase 6).
- Versionado: conventional commits + tags manuales al principio (release-please se evalua despues).
- Rama: `main` siempre verde; trabajo en ramas `feat/*`, `fix/*`, `chore/*` con PR.

## 7. Fases

### Fase 0 - Fundacion (1 semana)
Repo, licencia Apache-2.0, toolchain (Go 1.x, Node 22, pnpm, Bun), scaffold Wails con frontend React+Chakra (tokens de `research/ui`), CI base (lint+typecheck+unit), sidecar Bun minimo que parsea un `.deepnote` y responde `GET /project`.
Entregable: app que abre un `.deepnote` y muestra sus bloques en modo solo lectura. Criterio: CI verde en Linux y Windows.

### Fase 1 - Motor local (2-3 semanas)
Sidecar con ExecutionEngine + ServerPool persistente, protocolo WS versionado, ejecucion de bloque/notebook con outputs en vivo, stop/restart kernel, snapshots, inputs aplicados.
Entregable: desde la UI se abre un proyecto, se ejecuta un notebook completo y se ven outputs en vivo; al reabrir, los snapshots cargan la ultima ejecucion. Criterio: E2E Playwright "run y ve output" verde; segundo run < 500 ms.

### Fase 2 - Notebook lectura + escritura basica (2-3 semanas)
Editor Monaco, markdown (texto enriquecido), SQL con integracion seleccionable, outputs ricos (dataframe paginado, HTML sandbox, imagenes, errores con "Show error details"), crear/borrar/reordenar bloques, autosave, command palette y atajos con el copy del SPEC.
Entregable: un notebook completo editable y ejecutable, close to paridad con el flujo de la SaaS para uso individual.

### Fase 3 - Reactividad y entorno (2 semanas)
DAG visual (solo upstream/downstream como la SaaS), execution mode (block / block and dependent blocks), inputs widgets completos (8 tipos), terminal (xterm sobre el terminal del toolkit), explorador de archivos del proyecto, integraciones DB via env vars con keyring, deteccion/instalacion de Python (guia first-run).
Entregable: parity funcional del modo local con lo mapeado en SPEC-UI secciones 8 y 12.

### Fase 4 - Agentes y MCP (1-2 semanas)
Bloque `agent` local con BYO key (OpenAI/Anthropic/openai-compatible), panel lateral de agente con modos Chat+edit / Only chat (usando el bloque agent + @deepnote/mcp), 18 herramientas del MCP local expuestas al agente.
Entregable: "arregla este notebook" funciona offline con la key del usuario.

### Fase 5 - Modo cloud opcional (2 semanas)
`@deepnote/cloud`: login por token, runs en cloud, schedules, export/import de proyectos, `deepnote sync` de carpetas. La UI de Share/Comments/Runs de la SaaS solo se ofrece en este modo (wrap o link).
Entregable: sincronizar un proyecto local con un workspace cloud y lanzar un run remoto.

### Fase 6 - Productizacion (2 semanas)
Installers (deb/rpm/AppImage/NSIS), auto-update firmado, iconos/tray/notificaciones, crash reporting opt-in, documentacion de usuario, smoke E2E del binario en ambos SO en CI, release v0.1.0.

Total estimado: ~12-14 semanas de una persona.

## 8. Riesgos y mitigaciones

- `deepnote-toolkit` externo e inestable: abstraer tras un adaptador propio (`KernelPort`) con tests de contract; versionar la dependencia y tener fallback de mensajes de error claros.
- Upstream con "expect breaking changes": pin de versiones exactas de los packages en el lockfile; upgrades como PR dedicadas con suite verde.
- Windows sin tests upstream: matriz CI desde el dia 1 + Job Objects; tratar Windows como target de igual rango, no como afterthought.
- Deepnote lance "Local Singleplayer": el proyecto se mantiene como envoltorio de librerias Apache-2.0 (actualizables) y aporta el UI/desktop; mitigacion de timing: priorizar las fases que replican paridad rapidamente.
- Marca "Deepnote": repo y app con disclaimer de no-afiliacion; el trademark pertenece a Deepnote Inc.

## 9. Estructura del repo

```
deepnote-desktop/
  cmd/sidecar/        # entrypoint TS del sidecar (Bun)
  sidecar/src/
    core/             # dominio puro (sin IO)
    adapters/         # jupyter, fs, ws, keyring
    app/              # composicion + protocolo v1
  internal/           # Go: lifecycle sidecar, job objects, servicios Wails
  frontend/
    src/features|entities|shared/
  test-fixtures/      # .deepnote golden files
  .github/workflows/  # ci.yml, release.yml
  docs/
  research/           # NO se commitea (analisis previo, local)
```
