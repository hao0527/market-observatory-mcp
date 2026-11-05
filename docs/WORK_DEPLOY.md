# 在 ChatGPT Work / Sites 中复现

本文面向把仓库交给 Work 执行的用户，也为接手项目的 AI 提供步骤。平台界面、工具名和帮助脚本可能更新，**以当前安装的 Sites 技能为准**，不要照抄作者机器上的绝对路径。

## 1. 前提与产物

需要：

- 能使用 ChatGPT Work 和 Sites 的账号；是否可用取决于当前账号与产品开放情况。
- Work 能读取公开 GitHub 仓库并执行 Sites 的构建 / 发布流程。
- 运行环境可通过 HTTP 访问行情源。部分源受限时允许明确降级，但不得填入演示数据假装成功。

源码地址：<https://github.com/hao0527/market-observatory-mcp>

完成后应该得到：自己的私有站点、自己的 D1 缓存、自己的 Sites 个人 MCP 插件。GitHub 上的公开代码本身不会赋予任何人访问作者私有站点或数据库的权限。

## 2. 复制到 Work 的完整提示词

README 中提供了可直接复制的提示词。也可以追加以下验收要求：

```text
部署验收要求：
1. 公开模板不应包含 project_id；只使用此次创建时平台真实返回的 ID。
2. get_market_catalog 能返回当前 schema_version、指标、备用源、日历覆盖和缓存策略。
3. get_market_snapshot 默认不附带 history / raw_fields；缺失项单独报错。
4. get_security_quotes 查询 sz159842 和 sh518850；加一个不存在的代码检查逐项失败。
5. get_market_history("vix") 只读取该指标；不支持历史的备用源应明确标注。
6. 确认有 D1 持久缓存绑定，并检查 cache_backend / cache_warning。
7. 不要为验收人为破坏生产源或关闭访问保护。故障与缓存过期用确定性测试验证。
8. 报告实际可用项、来源、数据日期、降级或品种变化；不要将13/13作为必须造出的结果。
```

## 3. 获取源码与执行环境

先读 `AGENTS.md` 和当前 Sites 技能。可以克隆公开仓库；也可以下载其源码快照。已有源码时不要运行“空目录初始化”覆盖项目。

当前 Sites 工作流支持保留模板：在**新的空工作目录**调用当前插件的 `scripts/project-setup.mjs --template-source <已清理源码的绝对目录>`，让它配置当前执行环境并保留本项目源码。模板源应排除 `.git`、`node_modules`、`.sites-runtime`、`.wrangler`、构建产物和凭据。

若直接使用已有克隆目录，应按当前 Sites 技能修复 / 配置 execution profile；当前版本的帮助脚本为 `scripts/configure-execution-profile.mjs`。这些路径相对于**当前安装的 Sites 插件目录**，不是本仓库里的脚本。

本仓库保留了 Sites 的 `sites()` Vite 集成和运行脚本。不要将其随意替换成普通静态导出：行情读取、MCP 和 D1 需要 Worker 后端。

## 4. 注册属于自己的新站点

公开模板 `.openai/hosting.json` 为：

```json
{
  "d1": "DB",
  "r2": null,
  "capabilities": ["mcp"]
}
```

此处**没有 `project_id`**。AI 应调用当前 Sites 的创建工具一次，标题和 slug 可由读者选择。创建后立即把平台返回的准确 ID 写入当前部署目录，保留其余字段。

- 如果当前目录已经有此次创建的 ID，应复用；遇到后续错误不要再创建第二个站点。
- 不要从作者截图、旧对话或其他账号复制站点 ID。
- 新站点默认 owner-private；公开 GitHub 并不要求把站点改成公开。
- MCP 为本站对外提供的工具，不需要为了它启用访问其他应用的 BYOP 能力。
- 不需要复制作者的 Secrets。当前行情读取不要求在源码中填写 API key。

## 5. 安装与确定性测试

在 Work 中优先使用当前 Sites 的依赖安装帮助脚本，只运行一个安装流程。保留 `pnpm-lock.yaml` 和依赖策略。

```bash
npm test
npm run test:cache
npm run typecheck
```

分别验证：行情解码 / 时间 / 单位 / 涨跌基准 / 有限重试 / 日历 / 持久缓存降级；真实 SQLite 迁移和有序覆盖；TypeScript。

`LIVE_DATA=1 npm test` 会额外读取真实行情源。它是独立的连通性检查，受限流、市场状态和网络影响，不能用它替代确定性测试，也不能以网络失败为由补造价格。

`node scripts/check-public-source.mjs` 是**公开源码分发检查**，要求没有部署 ID。完成注册的部署目录自然会有自己的 ID，因此不要在部署副本里为了通过该检查而删除真实身份。再次公开导出时，应在单独的清理副本中检查。

## 6. D1 迁移与构建

`d1="DB"` 声明让 Sites 为新站点创建 / 绑定独立 D1。运行时通过 `worker/index.ts` 将该绑定传给缓存层。

保留已经提交的 `drizzle/*.sql`、schema snapshot 和 journal。部署现有 schema 不需要再次生成一套迁移。修改 schema 时才运行 `npm run db:generate`，并提交新迁移；不要改写已应用的迁移。

生产构建应使用当前 Sites 的 `scripts/build-site.mjs`。其内部调用本项目构建脚本；构建输出为 `dist` 下的 Worker 及客户端资源。Sites 的构建集成会把 hosting 配置和 Drizzle 迁移放入部署产物。

本地 D1 验证需先构建以生成 `dist/server/wrangler.json`，再按当前 Sites 技能对 `.wrangler/state` 应用尚未应用的迁移。生产迁移由 Sites 发布流程处理，不要把本地数据库上传为生产数据库。

## 7. 提交源码与私有发布

按当前 Sites 技能的 source helper 完成 Git 准备、校验 / 构建、源码提交和打包。

- 使用此次站点返回的 source repository credential；凭据只通过隐藏 stdin 传递，不能写入文件、命令参数或日志。
- `work_proxy` 模式不需要自己拼 token 或认证头。
- 保存版本时传入对应的准确 project ID、已推送的完整 commit SHA 和同一状态的构建归档。
- 已确认 owner-private 时使用私有保存 / 部署流程。
- 返回 pending / building / publishing 时继续查询该次 deployment ID；成功后以工具返回的 URL 为准。
- 凭据过期时为同一项目更新凭据；不要重建项目。

## 8. 在其他会话中使用 MCP

配置 `capabilities=["mcp"]` 并发布后，Sites 会为站点创建 / 更新个人插件。优先使用该插件，不需要另外创建一套本地 MCP 配置。

如果当前会话没有新工具：读取当前站点的 MCP 连接信息，使用平台返回的插件 ID 安装 / 连接；必要时新开会话刷新工具清单。插件 ID 是每个部署独立的，不要复制作者的插件 ID。

用新的会话依次测试目录、快照、证券和历史。目标定时任务的执行环境也必须能访问该插件；**仅把 `/mcp` URL 写进提示词并不等于已完成授权**。

私有站点的网页 / HTTP API 需要登录。直接匿名请求得到登录页或拒绝访问并不代表数据接口损坏。平台提供的 service access token 只能交给授权的站点并留在会话内，不能放在 README、GitHub Actions、公开链接或定时任务提示词中。

## 9. 验收检查表

| 检查 | 应看到的结果 |
| --- | --- |
| 站点身份 | 平台新建、归属当前账号、默认私有 |
| MCP 目录 | 四个工具及来源 / 日历 / 缓存说明 |
| 默认快照 | 无历史点；来源、日期、时间和 quality 完整 |
| 指定证券 | 有效代码可读；无效代码单独失败 |
| 最近成功缓存 | `cache_backend=durable`，正常写入无 `cache_warning` |
| 缓存降级测试 | `degraded=true` 且原 `as_of` / `fetched_at` 不变 |
| VIX / VXN 备用 | Cboe 日终值，不能标为盘中实时 |
| 美股指数备用历史 | Sina 报价的独立历史通过 `history_metadata` 标明来源和日期；全部历史源失败且无有效缓存时返回 `history_available=false`、`history_quality=unavailable`；存在有效缓存时按日期标 available/stale/forming/unknown，并保留刷新失败与缓存交付证据；`history_supported` 仍表示能力 |
| 黄金 / 布油换源 | 检查 `instrument_changed` 和 `source_transition` |
| 前值缺失 | 日变化为空，不能跨源补算 |
| 日历覆盖之外 | 返回 `unknown`，不猜节假日 |

日韩验收：目录包含 `nikkei225`、`kospi`；快照含各自时区 / 报价时间 / 昨收与日变化，未知的韩国年度日历不得伪称已核实。通过 `get_market_history` 验证按需历史；独立历史不能改变当前报价的参考值。查询 `sh000001` 时应返回 `order_book=null`、`order_book_status=unsupported`，前端应能正常显示。

历史契约验收：检查 quote_quality 与 history_quality 独立；history_count=0 必须 history_available=false；history_quality=unavailable 不能同时有有效非空记录；历史 supported 是能力，不等于本次成功。history_refresh_status / history_refresh_error 独立说明刷新结果，TTL缓存读取为not_attempted。quote_source / history_source / cross_provider 必须以同一次响应为准。黄金或布伦特CFD的unsupported为正常业务返回，非法ID才报INVALID_ARGUMENT。日本当日日线未完成时为 forming，韩国未知日历保留 calendar_verified=false。运行 `LIVE_FALLBACKS=1 npm test` 可在本地模拟历史主源失败并访问真实备用源，不改变生产主源。全部可用不是验收前提，详见 HISTORY_CONTRACT.md及ROUND3_QUALITY_REPORT.md。

## 10. 独立本地开发（可选）

本地调试只验证代码，不会自动提供 Sites 的私有登录和个人插件。需要 Node.js、Python 3，以及 pnpm 11.25.0 / Corepack；具体 Node 约束见 `package.json`。

```bash
git clone https://github.com/hao0527/market-observatory-mcp.git
cd market-observatory-mcp
corepack enable
corepack prepare pnpm@11.25.0 --activate
pnpm install --frozen-lockfile
pnpm test
pnpm run test:cache
pnpm run typecheck
pnpm build
pnpm dev
```

本地副本默认 portable profile。若先前由 Work 配置了 managed-linux profile，应按当前 Sites 工具切换到本地适用 profile。普通本地开发可使用内存缓存；需要 D1 降级持久化测试时按上述迁移步骤配置本地 D1。

## 11. 常见问题

- **Yahoo 429**：使用独立 Cboe / Sina 备用源，不能循环重试或用假价格填空。
- **某项仍缺失**：查看逐项 error、source URL、时间和缓存标记；不是每个来源都支持所有字段。
- **引用来源后数值变化**：核对 market_date、as_of 和品种，CFD 与期货不能视为完全相同合约。
- **D1 不可用**：检查 manifest、绑定和迁移；内存缓存正常不代表跨实例持久化已成功。
- **未来年份时效 unknown**：更新 `lib/freshness.ts` 中已核实日历及来源，不能静默推测。
- **账号没有 Sites / Work**：该复现路径依赖产品能力开放；仅有本地源码不能替代平台权限。
