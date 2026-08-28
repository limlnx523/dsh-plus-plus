# dsh-plus-plus

A local-first companion for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`). It adds the operational layer that the harness does not ship: lifecycle management, provider and credential handling, usage and cost analytics, session management, plugin security auditing, and a model evaluation harness.
A local-first companion for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`). It adds operational tooling that the harness does not ship: install detection, configuration snapshot and rollback, provider and credential handling, usage and cost analytics, session management, plugin security auditing, and a model evaluation harness.

DeepSeek Harness is an agent framework where *everything is a plugin*. `dsh-plus-plus` works alongside it rather than replacing it — it reads the same `$DSH_HOME` state and surfaces it through a CLI and a local web console.

![License](https://img.shields.io/github/license/limlnx523/dsh-plus-plus) ![Node](https://img.shields.io/badge/node-%3E%3D20-3c873a) ![CI](https://img.shields.io/github/actions/workflow/status/limlnx523/dsh-plus-plus/ci.yml?branch=main)

## Features

- **Lifecycle** — detect the harness install, snapshot and roll back configuration, and run `doctor` diagnostics.
- **Providers & credentials** — manage provider routes; store credentials in `$DSH_HOME/.env`; probe an endpoint to discover models; set the default model.
- **Usage & cost** — read DSH session logs (concatenated zstd frames via built-in `node:zlib`) and report tokens and cost by model, day, and project; cache-hit rate; monthly budget with a progress bar.
- **Sessions** — list, preview, and export DSH session logs.
- **Plugin security** — inventory installed plugins and audit the capabilities (seams) each one touches: fs, shell, subprocess, network, credentials, sandbox, mcp, llm. Risk-graded.
- **Evaluation** — run a deterministic probe through the harness per model; measure pass/fail, latency, tokens, cost, and answer correctness; compare against a stored baseline to catch regressions after upgrades or config changes.

## Requirements

- Node.js >= 20. The project uses only built-in modules (`node:zlib` for zstd decode) — no third-party runtime dependencies.

## Install

```sh
npm i -g .
```

The harness home is resolved from `$DSH_HOME` or `~/.dsh`.

It can also be installed as a DeepSeek Harness plugin (adds a `/dshpp` slash command):

```sh
dsh plugin --profile web add github:limlnx523/dsh-plus-plus
```

## CLI

```sh
dshpp status                 # overview
dshpp doctor                 # diagnostics
dshpp env ls|set|rm          # credentials (masked by default)
dshpp backup create|ls|restore|rm
dshpp providers ls|export|probe
dshpp usage                  # token/cost; by model/day/project; cache-hit rate
dshpp sessions [export <id>]
dshpp plugins                # inventory + seam audit
dshpp eval [flash|pro|flash,pro]
dshpp budget set <usd>
dshpp web                    # local console on 127.0.0.1:4848
```

## Web console

`dshpp web` serves a local console at `http://127.0.0.1:4848/` (loopback only). It surfaces providers, masked credentials, backups, usage and cost, sessions, plugins, and evaluation results. The UI is intentionally restrained — no gradients, no emoji, no dark-pattern styling.

## Configuration

- Harness home: `$DSH_HOME` or `~/.dsh`
- Credentials: `$DSH_HOME/.env`
- dsh-plus-plus state: `~/.dsh-plus-plus/` (backups, provider manifest, eval baseline, settings)

## Development

```sh
npm link
node bin/dshpp.mjs --help
```

## License

MIT
