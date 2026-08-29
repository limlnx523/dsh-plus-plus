# Changelog

## 0.2.0

- **Positioning**: scoped the project as a local-first control plane and operational tooling for DeepSeek Harness, centered on lifecycle, plugin security audit, and evaluation/regression.
- **CLI**: added the `audit` command (security risk summary + remediation guidance), completed the `--help` list (`sessions`/`plugins`/`audit` were missing), and made usage errors exit with code 2.
- **Security**:
  - All `dsh` invocations now spawn the resolved binary directly (no shell), removing the Node `DEP0190` shell-arg injection warning.
  - `status`/`doctor`/listings never print raw secret values; `--show` is the only opt-in.
  - Snapshot and restore warn when credentials (`.env`) are involved.
  - The web console stays loopback-only and now sends `X-Content-Type-Options`, `Referrer-Policy`, and a Content-Security-Policy; `/api/doctor` returns real diagnostics.
- **DSH decoupling**: centralized the change-prone DSH internals (session layout, zstd JSONL decoding, event/usage parsing, settings keys, `dsh` CLI invocation) into `src/dshadapter.mjs`.
- **Reliability**: fixed a snapshot-id collision when two snapshots were created within the same second (restore's automatic pre-restore snapshot could overwrite the target).
- **Tests & CI**: added a `node:test` suite for lifecycle/env/backup/providers/usage/plugins/adapter (22 cases, no network or model calls) and wired `npm test` plus a package dry-run into CI.
- **Docs**: rewrote `README.md` for a factual, first-screen positioning with a real CLI demo and a command list kept in sync with the implementation.

## 0.1.0

- Initial release.
- CLI: `status`, `doctor`, `env`, `backup`, `providers`, `usage`, `sessions`, `plugins`, `eval`, `budget`, `web`.
- Local web console (loopback `127.0.0.1:4848`).
- Provider and credential management against `$DSH_HOME/.env`.
- Usage & cost aggregation from DSH session logs (concatenated zstd via `node:zlib`), by model/day/project, cache-hit rate, monthly budget.
- Session list/export.
- Plugin inventory + capability (seam) audit + risk grading.
- Model evaluation probe (deterministic task), with baseline regression diff.
- Installed as a DeepSeek Harness plugin bundle (adds `/dshpp` command).
