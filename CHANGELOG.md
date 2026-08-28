# Changelog

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
