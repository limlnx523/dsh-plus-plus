# dsh-plus-plus · v0.2.1

**DSH++ — a local-first control plane for DeepSeek Harness.** It runs on your machine, reads the same `$DSH_HOME` state as the harness, and gives you the operational layer the harness doesn't ship — through a CLI and a loopback-only web console.

## Highlights

- **Plugin security auditing** — `dshpp audit` inventories installed plugins, classifies the capabilities (seams) each one touches (filesystem, shell, network, credentials, sandbox, mcp, llm), grades risk, and flags what to remove.
- **Workflow regression testing** — `dshpp test` runs a fixed set of harness tasks against your current DSH configuration (model, prompt, plugins, config, harness version), compares to a stored baseline, and reports regressions. It exits non-zero on a regression, so it can be used as a CI regression gate.
- **Lifecycle management** — detect the install, snapshot and roll back `$DSH_HOME` configuration, run diagnostics, and manage providers and credentials.
- **Local-first** — everything stays on your machine. Secrets remain in `$DSH_HOME/.env`, are masked in listings, and the web console only binds to loopback.
- **Scope** — DSH++ tests the whole configured DSH system; it does not score or compare models.

## Install

```sh
npm i -g .
```

## Quick start

```sh
dshpp status     # overview of the DSH install
dshpp audit      # plugin security risk report
dshpp test       # regression-test the DSH workflow vs baseline
```

See the [README](../README.md) for the full CLI reference.