# DSH++ · control plane

在 DeepSeek Harness (dsh) 上做一层的**生命周期与 Provider 管理端**。本地优先、零运行时依赖，界面走简约高级的工程工具风。

> 定位：不是“又一个插件清单/桌面壳”，而是对标 codex-plus-plus 之于 Codex——**装/更/回滚 + Provider/凭据统一 + 诊断备份**。官方已有 `dsh-market` 插件市场，这里对接而非重造。

![License](https://img.shields.io/github/license/limlnx523/dsh-plus-plus) ![Node](https://img.shields.io/badge/node-%3E%3D20-3c873a) ![DeepSeek Harness](https://img.shields.io/badge/DeepSeek_Harness-dsh-%230a0c10) ![CI](https://img.shields.io/github/actions/workflow/status/limlnx523/dsh-plus-plus/ci.yml?branch=main)


## 为什么值得 star

> DeepSeek Harness 生态缺的不是更多插件，而是**信任、治理与可观测**。其它工具帮你“跑起来”，DSH++ 帮你**看清楚、管得住、测得出**。

- **一套全管**：安装/凭据/备份/诊断 + 用量成本（模型/天/项目/预算/缓存/趋势）+ 会话管理 + 插件安全审计 + 模型实测评估
- **本地优先 · 零依赖**：纯 `node:zlib` 读 DSH 压缩会话，无第三方运行时依赖
- **无 AI 味**：工程工具质感，不搞紫色渐变/玻璃拟态
- **可回滚**：写操作前自动快照

如果你在用 DeepSeek Harness（dsh），这个仓库值得你 [star ⭐](https://github.com/limlnx523/dsh-plus-plus)。

## M1（当前）已落地

- `dshpp status` —— 概览（DSH home / dsh CLI / .env / settings / 快照）
- `dshpp doctor` —— 环境诊断（Node、DSH 存在性、.env 格式与秘钥卫生、settings 可解析、备份目录）
- `dshpp env ls|set|rm` —— `$DSH_HOME/.env` 凭据保险柜，密钥默认脱敏，`--show` 才显示原文
- `dshpp backup create|ls|restore|rm` —— 快照（管理 `.env` / `settings.yaml`），还原前自动先建当前快照
- `dshpp web [--port N] [--open]` —— 访问 `http://127.0.0.1:4848/` 的本地控制台
- `dshpp usage` —— 聚合会话日志的 token 用量（input/output/cache/reasoning）与 per-model 软估算成本；Web 控制台同款“用量/成本”面板
  - 面板另含：**缓存命中率**（cacheRead/(input+cacheRead)）、**按天**、**按项目(cwd)** 聚合；真实数据来自 DSH 会话 JSONL（node:zlib 多帧解压，零新依赖）
  - 另含：**月预算**（`dshpp budget set <USD>`，进度条+超阈值标红）、**按天成本趋势**（SVG 线图）、**自动刷新**（面板 30s 实时拉取）
- `dshpp providers ls|export|probe` —— Provider 注册表 / 配置导出 / 端点模型探测（M2）
- `dshpp sessions [export <id>]` —— 会话列表（id/项目/日期/轮次/模型/token）+ 导出可读日志（Web 面板“会话”同步）
- `dshpp plugins` —— 已装插件清单 + **seam 安全审计**（fs/shell/subprocess/network/credentials/sandbox/mcp/llm）+ risk 分级 + kind（官方/第三方）（Web 面板“插件”同步）
- `dshpp eval [flash|pro|flash,pro]` —— **合成任务实测**各模型：成功/延迟/token/成本/正确性，并把结果存基线做**回归 diff**（升级/改配置后是否变差）；Web 面板“评估 · 模型 A/B”用按钮触发

## 运行

```sh
node bin/dshpp.mjs web          # 本地控制台，默认 127.0.0.1:4848
node bin/dshpp.mjs doctor       # 诊断
node bin/dshpp.mjs status       # 概览
node bin/dshpp.mjs env set DEEPSEEK_API_KEY=sk-...   # 写入凭据
```

需要 Node >= 20，无第三方运行时依赖（不用 `npm install`）。

## 路径约定

- DSH home：`$DSH_HOME` 或 `~/.dsh`
- 凭据：`$DSH_HOME/.env`（DSH 的 `credentials-local` 即读此处）
- DSH++ 自身状态：`~/.dsh-plus-plus/`（含 `backups/`）

## M2 · Provider / 模型 / 凭据面板（已落地大部分）

**已在控制台落地**：`dshpp providers ls|export|probe` + Web 面板 —— provider 注册表（`~/.dsh-plus-plus/providers.json`）、端点模型探测、env 凭据引用、默认模型、配置导出。尚未做：把 provider 路由真正写进 harness 的 settings/plugin 配置、以及成本/用量面板（等 harness 装上后才有真实数据）。

- **Provider / 模型 / 凭据统一面板**：探测端点 → 列出模型（走 DSH 的 `listModels` / `discoverModels`）→ 采纳进配置；provider 路由（base_url / api / 模型映射）增删改；默认模型与 `reasoningEffort` 切换（对应 `dsh-agent-default-model` 的 `{provider, model}`）；用量 / 成本面板。
- **版本兼容矩阵 + 升级守卫/回滚**：渲染 config-catalog 成表单；对 dev preview 的 breaking change 做兼容标记与回滚。
- **Windows 优先生命周期**：绕过 `github.com` 被重置的安装路径（走 npm registry / 镜像），装/更/自愈/守护。
