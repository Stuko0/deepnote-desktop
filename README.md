# deepnote-desktop

A local-first desktop application (Linux and Windows) for creating, editing, and running Deepnote notebooks, built on top of the [open-source Deepnote core](https://github.com/deepnote/deepnote).

> This project is not affiliated with or endorsed by Deepnote Inc. "Deepnote" is a trademark of Deepnote Inc. This application reuses the Apache-2.0 licensed packages published by Deepnote and implements its own desktop shell and UI.

## Status

Pre-alpha. The repository currently holds the development plan, architecture decisions, and research artifacts used to design the product. The first executable milestone is Phase 0 (see ROADMAP). Do not expect a working installer yet.

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

- The reusable core is TypeScript on Node. Wails does not embed Node, so a Bun-compiled sidecar hosts the execution engine and exposes a versioned local protocol (HTTP + WebSocket) to the UI. This mirrors how Deepnote ships its own CLI (`bun build --compile`).
- The sidecar is the single writer of notebook state; the UI applies optimistic updates and reconciles per block version.
- The `.deepnote` file on disk is the source of truth. Outputs are stored in execution snapshots, following the upstream snapshot format.
- The frontend and sidecar are shell-agnostic: a future migration to Tauri or Electron touches only the host layer.

See `PLAN.md` (Spanish) for the full development plan: patterns, optimizations, testing strategy, and phases.

## Tech stack

- Shell: Go with Wails v2
- Sidecar: TypeScript on Bun, reusing the `@deepnote/*` packages
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

Prerequisites: Go 1.22+, Node 22, pnpm, Bun, Python 3.10+ with `pip install "deepnote-toolkit[server]"`.

```
git clone https://github.com/Stuko0/deepnote-desktop.git
cd deepnote-desktop
# Phase 0 scaffold instructions will live here
```

## Testing

- `pnpm test` runs unit tests (Vitest) for the sidecar domain and frontend.
- `pnpm test:integration` runs against a real `deepnote-toolkit` server (Linux CI only).
- Playwright end-to-end tests exercise the UI against the local sidecar, including visual regression screenshots.
- Smoke tests launch the compiled binary on both Ubuntu and Windows.

All CI jobs run on Ubuntu and Windows.

## Roadmap

Phase 0: toolchain, scaffold, CI. Phase 1: execution engine, live outputs, snapshots. Phase 2: notebook editing (Monaco, markdown, SQL, rich outputs). Phase 3: reactivity, terminal, files, integrations. Phase 4: local agents and MCP. Phase 5: optional cloud mode. Phase 6: installers, auto-update, v0.1.0.

The detailed plan, with acceptance criteria per phase, is in `PLAN.md`.

## License

Apache-2.0, consistent with the upstream packages this project reuses.
