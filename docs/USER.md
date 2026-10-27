# deepnote-desktop - User guide

Pre-alpha. This guide describes what exists today and what to expect.

## What it does

deepnote-desktop runs `.deepnote` notebooks locally: edit code, SQL, text, input, and agent blocks; execute them against a local Jupyter kernel with live streamed outputs; browse project files; use a real terminal; view the block dependency graph; and optionally trigger runs on Deepnote Cloud.

## Requirements

- Linux or Windows (x86_64).
- Node.js 22+ (the sidecar runs on Node).
- Python 3.10+ with the Deepnote toolkit:

  ```
  pip install "deepnote-toolkit[server]"
  ```

  The app detects the interpreter through `DEEPNOTE_PYTHON`, a `.venv` in the project, or the system `python`. When the toolkit is missing, the sidebar shows the exact install command.

## Build from source

```
git clone https://github.com/Stuko0/deepnote-desktop.git
cd deepnote-desktop
pnpm install --config.strict-dep-builds=false
pnpm build:sidecar
pnpm build:frontend
wails build            # Linux: wails build -tags webkit2_41 on Ubuntu 24.04+
```

The binary is written to `build/bin/`. Releases ship tarballs for Linux and an NSIS installer for Windows.

## First run

1. Open the app and choose **Open project** (a `.deepnote` file).
2. Press **Run notebook**. The first run starts the kernel (a few seconds); later runs reuse it.
3. Edit any code block: changes save back into the `.deepnote` YAML after a 1.5 s debounce.

## Panels

- **Terminal**: real PTYs owned by the kernel session (start the kernel first).
- **Files**: the project directory.
- **Integrations**: declared project integrations and the environment variables they expect; values entered here are held for the session and persisted to the OS keychain inside the app.
- **AI provider**: `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` for agent blocks.
- **Deepnote Cloud** (optional): your API token from deepnote.com/settings, workspace check, and **Run notebook in cloud**.

## Agent blocks

Create one from the command palette (ctrl+P, "New agent block"), describe the task, set a provider key above, and run it. The agent streams its text, reasoning, and tool use into the block. Agent blocks can edit the notebook (they receive the block tools from the open-source runtime).

## Command palette

`ctrl+P` lists every command with its shortcut: run notebook/block, create blocks, restart kernel, dependency graph, and more.

## Known limitations (pre-alpha)

- Single-user, single-window: no realtime collaboration (cloud-only feature).
- The app icon is the Wails default; tray, notifications, crash reporting, and auto-update are not wired yet (release workflow produces installers without an updater).
- Full-notebook UI run coverage lives partly in the integration suite; see the test comments for the cold-start caveat.
- Cloud runs require a Deepnote plan with API access; only the token you enter is used, and it never leaves the OS keychain/session memory.
