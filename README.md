# deepnote-desktop

A local-first desktop application (Linux and Windows) for creating, editing, and running Deepnote notebooks, built on top of the [open-source Deepnote core](https://github.com/deepnote/deepnote).

> This project is not affiliated with or endorsed by Deepnote Inc. "Deepnote" is a trademark of Deepnote Inc. This application reuses the Apache-2.0 licensed packages published by Deepnote and implements its own desktop shell and UI.

## Status

Pre-alpha. Phases 0 through 3 of the roadmap are implemented and verified end to end.

- **Execution**: the sidecar opens `.deepnote` projects, starts a local Jupyter kernel through `deepnote-toolkit`, streams block outputs over WebSocket, and persists execution snapshots. The kernel starts on first run and stays warm (a full fixture run takes tens of milliseconds). Reactive runs ("block and dependent blocks") expand through the open reactivity DAG.
- **Editing**: Monaco (self-hosted from npm, offline) for code and SQL, a plain textarea for text blocks, per-block run/move/delete, block creation from the block menu or the palette, and debounced autosave that persists edits straight into the `.deepnote` YAML.
- **Command palette** (ctrl+P) over a single command registry that also feeds the keyboard shortcuts (ctrl+Enter runs the selected block).
- **Inputs**: the eight `input-*` block types render as widgets and their values travel with every run.
- **Environment**: project files explorer, integrations status with editable secrets, execution mode selector, kernel state bar, and a first-run hint when the toolkit is missing.
- **Terminal**: a real local terminal (xterm.js) bridged through the sidecar to the toolkit's Jupyter terminals (PTYs owned by the kernel session).
- **Dependency graph**: the notebook DAG rendered with React Flow; clicking a node selects the block and dependent runs highlight.
- **Secrets**: integration secrets entered in the UI are held in the sidecar for the session and persisted in the OS keychain (libsecret / Credential Manager / Keychain) through the Wails shell.
- **Outputs**: streams, results, sandboxed HTML, PNG images, errors with a "Show error details" toggle, and the Deepnote dataframe MIME rendered as a paginated table.

Verified with 18 unit tests, 4 integration tests against a real kernel (including edit-over-WS persistence), 3 Playwright end-to-end tests (edit in Monaco + autosave + run edited code, palette, full notebook run), and `wails build` on Linux and Windows in CI.

Not implemented yet: automatic Python installers (the UI shows the exact command to run instead).

There is no installer yet; build from source (see Development).

## Why

Deepnote open-sourced its core (notebook format, runtime, CLI, cloud client, MCP server) but not the web UI. The official roadmap promises a local UI ("Local Singleplayer") that does not exist yet. This project fills that gap with a desktop application that:

- Reads and writes the `.deepnote` YAML project format natively.
- Executes notebooks locally against the Deepnote kernel (`deepnote-toolkit`), speaking the standard Jupyter protocol.
- Runs fully offline by default, with an optional cloud mode that talks to the official Deepnote Cloud API.
- Supports Linux and Windows as first-class targets (upstream CI does not test on Windows).

## Architecture

```
+---------------------------------------------------------------+
| Wails shell (Go)                                              |
|  windows, menus, tray, notifications, single instance,       |
|  sidecar lifecycle and supervision                            |
+-----------------------------+---------------------------------+
                              | typed IPC (WailsJS)
+-----------------------------v---------------------------------+
| Frontend (React 18 + Chakra UI + Monaco + xterm + Vega-Lite) |
+-----------------------------+---------------------------------+
                              | HTTP + WebSocket on 127.0.0.1 (token)
+-----------------------------v---------------------------------+
| Sidecar (TypeScript, compiled with Bun)                       |
|  @deepnote/runtime-core, blocks, reactivity, convert, mcp,    |
|  cloud; persistent kernel sessions via ServerPool              |
+-----------------------------+---------------------------------+
                              | standard Jupyter protocol
+-----------------------------v---------------------------------+
| Local Python: python -m deepnote_toolkit server               |
+---------------------------------------------------------------+
```

Design notes:

- The reusable core is TypeScript on Node. Wails does not embed Node, so a sidecar process hosts the execution engine and exposes a versioned local protocol (HTTP + WebSocket, loopback + session token) to the UI. Bun compilation remains a packaging option for a single-binary sidecar (it mirrors how Deepnote ships its CLI).
- The sidecar is the single writer of notebook state; the UI applies optimistic updates and reconciles per block version.
- The `.deepnote` file on disk is the source of truth. Outputs are stored in execution snapshots, following the upstream snapshot format.
- The frontend and sidecar are shell-agnostic: a future migration to Tauri or Electron touches only the host layer.

See `PLAN.md` (Spanish) for the full development plan: patterns, optimizations, testing strategy, and phases.

## Tech stack

- Shell: Go with Wails v2
- Sidecar: TypeScript on Node.js, reusing the `@deepnote/*` packages
- Frontend: React 18, Chakra UI, Monaco, xterm.js, Vega-Lite, Zustand
- Runtime: Python 3.10+ with `deepnote-toolkit[server]`
- Testing: Vitest, Playwright, Go testing
- CI: GitHub Actions (Ubuntu and Windows matrices)

## Repository layout

```
cmd/sidecar/     sidecar entrypoint (TypeScript)
sidecar/src/     core (pure domain), adapters (jupyter, fs, ws), app (protocol v1)
internal/        Go services (sidecar supervision, job objects, Wails bindings)
frontend/        React application
test-fixtures/   golden .deepnote files
docs/            architecture and protocol documentation
.github/         CI and release workflows
```

## Development

Prerequisites: Go 1.22+, Node 22, pnpm (via corepack), Python 3.10+ with `pip install "deepnote-toolkit[server]"` in a virtualenv.

```
git clone https://github.com/Stuko0/deepnote-desktop.git
cd deepnote-desktop
pnpm install --config.strict-dep-builds=false
pnpm build:sidecar
pnpm build:frontend
wails build          # produces build/bin/deepnote-desktop
```

For development with hot reload, run `pnpm build:sidecar` once and then `wails dev`. The shell locates the sidecar at `sidecar/dist/index.js`; override with `DND_ROOT` if your layout differs. Point the app (or `?project=` in a browser) at a `.deepnote` file; Python resolution follows `DEEPNOTE_PYTHON`, then the project `.venv`. The install flag above is required: pnpm 12 aborts on the skipped build scripts of esbuild/biome (their platform binaries ship via optional dependencies, so nothing is lost).

## Testing

- `pnpm test` runs unit tests (Vitest) for the sidecar domain: protocol validation and `.deepnote` parsing against golden fixtures.
- `pnpm test:integration` starts a real `deepnote-toolkit` server and executes the fixture notebook over the WebSocket protocol (requires `DEEPNOTE_PYTHON`).
- `pnpm test:e2e` drives the built UI with Playwright against the built sidecar and a real kernel.
- `pnpm biome:check` lints the TypeScript codebase.

CI runs lint, typecheck, unit tests, integration tests, the Playwright suite, and desktop builds on both Ubuntu and Windows.

## Roadmap

Phase 0: toolchain, scaffold, CI. Phase 1: execution engine, live outputs, snapshots. Phase 2: notebook editing (Monaco, markdown, SQL, rich outputs). Phase 3: reactivity, terminal, files, integrations. Phase 4: local agents and MCP. Phase 5: optional cloud mode. Phase 6: installers, auto-update, v0.1.0.

The detailed plan, with acceptance criteria per phase, is in `PLAN.md`.

## License

Apache-2.0, consistent with the upstream packages this project reuses.
