# 可靠性与字段语义修复 · 1.6.4 / Schema 1.5

## 核查结论

基线已重新核对：公开main为17925acbdeafbe82e441b2aea75f3e67c84a9610，部署源码为d9a29f50c3ee3241051f2295373545e229132f4f，线上Sites版本18、服务1.6.3、Schema1.5；两个恢复的工作区开始均干净。此次沿用现有项目、D1、八个工具和数据源，不引入数据库、指标、投资分析或新架构。

| 项目 | 证据与判断 | 处理 |
| --- | --- | --- |
| 自动归档暂停 | Sites与Automations均确认is_enabled=false、next_run_time=null，但采集settings.enabled=true；无停用操作者/原因审计证据，相关上下文也不能确认用户主动或误停 | 不将其归因于MCP代码，不擅自恢复；API明确区分collection_enabled与未知外部scheduler状态 |
| 顶层fetched_at | 代码每次生成当前时间；先前线上全包D1命中也更新，逐项采集时间不变 | 顶层改为latest_fetched_at兼容别名，新增oldest_fetched_at/generated_at；本次返回使用retrieved_at |
| 质量汇总 | coverage漏partial，未来/未知状态也未计入 | 保留原计数，补partial/unknown/other及by_quality；不改变指标质量 |
| 旧补采发现 | db/security-archive.ts的recentJobs只取最近8项，旧未完成任务可能永久掉出调用方视野 | 新增全量未完成任务查询backfill，不受活动列表窗口限制；先当日、再最早到期，最多40个并报告truncated |
| next_retry_at | 只是退避截止时间，Worker无独立自动重试timer | 在接口、Catalog和执行说明中明确“最早允许重试”，由原执行通道按job_id调用；不冒充已安排执行 |
| 旧1分钟缺口 | sh563360，11/04，79/240根；东方财富520，腾讯近期窗口不包含目标日 | 真实补采结果在上线验收中记录；不伪造、不跨源补缝、不降低周期 |
| FRED | 真实下载不可用，而非序列代码混用 | 保留失败；新增隔离真实读取检查，不将合成CSV当真实成功 |

## 文件与核心位置

- lib/market.ts：snapshotMetadata与snapshot，聚合真实采集时间范围、完整互斥质量计数。
- app/page.tsx：页面“本次返回”改用retrieved_at，逐项成功采集时间仍为原字段。
- lib/security-store.ts：待补采发现结果类型及原存储接口增量方法。
- db/security-archive.ts：pendingJobs，从原任务表全量发现queued/到期重试任务，未到期及无法核实执行条件的任务不列为可执行。
- lib/security-archive.ts：execution说明、全局backfill响应；原configure/sync行为及退避保持。
- app/mcp/route.ts：Catalog时间契约、归档描述及服务1.6.4；工具参数与数量不变。
- scripts/snapshot-metadata-cases.mjs：35组实际快照/D1缓存组合、混合刷新、全失败及空数据/未知质量测试。
- scripts/test-security-archive.mjs：新增9组实际SQLite查询/退避/旧作业恢复场景，合计30组。
- scripts/volatility-cases.mjs：新增6组FRED隔离路径、准确序列头和日期滞后检查，合计100组。
- scripts/test-market-data.mjs：接入新回归及LIVE_FRED_VXN真实隔离检查。
- README、CHANGELOG、docs/SECURITY_ARCHIVE.md、docs/WORK_DEPLOY.md：兼容语义与有限执行流程。

## 兼容性

Schema仍为1.5，服务修订为1.6.4。顶层fetched_at字段名保留，语义纠正为包中最近一次成功采集时间，并通过fetched_at_semantics明确；最早时间另行给出，逐项时间不变。全无有效采集时间时为null，不能拿返回时间伪造成功采集。旧调用方若把顶层fetched_at当“本次生成时间”，应改读generated_at或retrieved_at。

coverage原字段保留；partial/unknown/other与完整by_quality为兼容新增，计数互斥且总和等于metrics.length。历史quality/quote_quality、跨源、复权、盘口和日历语义保持。

settings.enabled保持原值且不重写配置。execution.scheduler_status=unknown是服务端没有核实外部调度的事实；外部实际暂停状态由Sites/Automations独立确认。job.complete只表示该次任务，不改变周期调度状态。没有数据库迁移，既有SQL迁移文件和归档数据不删除、不改写。

## 测试

- TypeScript检查通过。
- 确定性测试：56组全球历史、99组证券历史、100组波动率及35组快照元数据；原报价/解码/时间/盘口/MCP回归通过。
- 实际缓存SQL迁移/有序覆盖测试通过。
- 30组实际SQLite/生产D1 SQL/HTTP归档测试通过。新场景将旧partial作业埋在10个较新complete作业后，确认recent_jobs看不到但backfill仍发现；排除未到退避时间和未知日历任务，验证截断、当日优先、只读状态不改配置。
- 被发现的旧任务经原sync写入器实际执行，测试数据库中79根变为240根并再次回读，完整后退出待补采清单。这是隔离测试，不冒充生产数据。
- 生产构建、公开源码检查与线上验收状态见下文。

## FRED真实检查

LIVE_FRED_VXN=1 npm test只在本地注入Yahoo/Cboe失败，FRED网络请求保持真实。请求为fredgraph.csv?id=VXNCLS&cosd=2026-09-02，结果HTTP503，未取得记录；日志明确status=blocked、real_read_passed=false。

另直接请求明确日期范围CSV和/data/VXNCLS.txt，两者均503，server=envoy，正文为连接在响应头前重置（remote reset）。该证据说明当前运行环境到FRED的下载链受阻，不能仅凭此定位为FRED源站错误、也不能声称改请求头已解决。

[FRED官方序列页](https://fred.stlouisfed.org/series/VXNCLS)确认VXNCLS为Cboe NASDAQ100波动率指数、Index、Daily Close；本次网页仍显示11/04的25.08，更新时间11/05 08:37 CST。即使下载成功也必须检查发布滞后，不把旧日期标新。没有强行换成其他指数、API密钥或未经验证接口。

## 部署与线上验收

待生产构建、Git合并、私有部署及真实MCP/服务API验证后补充。此处未将本地或隔离测试称为线上成功。

## 执行边界

现有每日一次调度不能保证到next_retry_at就立即执行，暂停的调度更不会自动补采。新backfill与既有sync形成可调用的有限执行路径，不是新部署的分钟级重试调度器。调度暂停原因未知时保留暂停；若用户希望恢复或缩短重试间隔，应明确该操作并使用原任务，不能重复建任务。不能保证旧缺口一定能从第三方追回。
