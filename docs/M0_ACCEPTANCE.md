# M0 Acceptance Record

> **Historical Evidence Only(2026-08-22)**:本文件是 Legacy 里程碑验收证据,其编号不定义当前 Milestone。当前基线见 `docs/Rhiza_开发路线图_V4.1_20260824.md`(统一 M01+ 编号)。

验收日期：2026-08-14

## 结论

M0 — Clean Base & Engineering Baseline 已完成。

## 验收映射

| 验收标准 | 实现与自动化证据 |
| --- | --- |
| Rhiza 可独立 build / run | `npm run build` 同时产出 `dist/` 与 `dist-server/`；`npm start` 由单进程提供 API 和前端。 |
| 上游更新不直接修改 Rhiza Domain | LibreChat baseline 固定为 v0.8.7 / commit `9e74cc0e...`，代码只通过 `librechat-data-provider@0.8.509` 与 Runtime Adapter 边界复用。 |
| Product Domain 不 import LibreChat Conversation / Mongo domain | `server/architecture.test.ts` 自动检查 Domain import 边界。 |
| PostgreSQL 可创建和迁移基础 schema | `db/migrations/0001_rhiza_core.*.sql`、checksum/事务迁移器；本地嵌入式 PostgreSQL 正反向 E2E，CI PostgreSQL 17 真服务幂等迁移 E2E。 |
| provider request + streaming E2E | `e2e/provider-stream.e2e.test.ts` 通过两个真实 HTTP socket 验证 OpenAI-compatible SSE → Runtime Event → Rhiza SSE → 原子 commit。 |
| CI 覆盖 lint / typecheck / unit / basic E2E | `.github/workflows/ci.yml` 使用 Node 24 + PostgreSQL 17 执行全部门禁。 |
| 第三方许可证扫描可重复生成 | `npm run licenses:generate` / `npm run licenses:verify`，提交 `reports/third-party-licenses.json`。 |

## M0 交付项

- 固定 LibreChat baseline：完成。
- License cleanup：上游 MIT 文本、第三方 notices 和完整生产依赖报告已提交。
- Runtime Adapter skeleton：`AIRuntime` / `RuntimeEvent` / `ProviderRuntime`。
- UI Adapter skeleton：`src/api.ts` 隔离 HTTP/SSE wire contract，组件只消费前端领域类型。
- PostgreSQL migration baseline：完成。
- Basic CI：完成。
- Unit / Integration / E2E skeleton：完成并有实际覆盖。
- Error logging：请求 ID、访问日志、Runtime 错误归一化和未处理错误日志已存在。
- Feature flag 基础：默认关闭、未知值快速失败，健康检查暴露安全的 flag snapshot。

## 标准验证命令

```bash
npm ci
npm run verify:m0
```

提供 `DATABASE_URL` 时，`npm run test:e2e` 还会执行外部 PostgreSQL 真库用例；CI 默认提供 PostgreSQL 17。
