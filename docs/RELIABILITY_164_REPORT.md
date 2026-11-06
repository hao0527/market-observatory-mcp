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
- scripts/snapshot-metadata-cases.mjs：35组snapshot函数/持久缓存适配器隔离测试、混合刷新、全失败及空数据/未知质量测试。
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

生产构建及公开源码检查通过。2026-11-06 12:10:29 UTC（北京时间20:10:29）私有部署成功：Sites版本19，服务1.6.4，Schema1.5。精确部署源码提交0b3084b292a000d261e0e8cf1a0924f467f0f726；[PR #5](https://github.com/hao0527/market-observatory-mcp/pull/5)已合并，功能提交f698fac92c7fa5afb2148d7e9a8034fb581c08f5，合并提交5b7dc953827edb120b96ed6b76dad9884ee77687。未观察到独立GitHub Actions运行；测试由本次实际执行命令完成，不声称CI另行通过。

### 原生ChatGPT MCP：快照与缓存

20:11:11北京时间强制刷新：13/13返回有效数值，coverage.available=13，by_quality合计13；partial/unknown/other等计数显式为0。VIX=28.18、VXN=38.26，均为11/05的Cboe官方日线，日期一致性检查通过。

首次快照时间：

- generated_at / retrieved_at：2026-11-06T12:11:11.906Z。
- fetched_at / latest_fetched_at：2026-11-06T12:11:11.737Z。
- oldest_fetched_at：2026-11-06T12:11:10.690Z。

20:11:56再次读取refresh=false：cache_hit=true，13项delivery全部durable_cache；顶层fetched_at、最早/最近采集时间及逐项fetched_at均与第一次完全相同，仅generated_at/retrieved_at变为2026-11-06T12:11:56.366Z。原问题的全缓存重标采集时间已不再复现。partial及未知质量的计数通过隔离测试验收，不人为破坏生产数据制造状态。

### 真实补采：服务授权、写入与D1回读

上线后先用原生MCP确认backfill发现旧1分钟作业，due_jobs=1、due_tasks=1、limit=40、truncated=false；采集配置与原值一致。再通过当前Sites返回的服务访问方式，仅向本站/api/security-archive发起GET、POST sync和回读，未将服务凭据用于/mcp，也未写入文件、日志或提示词。

对原sh563360、2026-11-04、1m作业实际执行一次max_tasks=1、retry_missing=true：processed_this_call=1，attempts从2增到3，last_attempt_at=2026-11-06T12:12:19.091Z，作业于12:12:26.684Z更新。

结果仍为partial、79/240根、缺161根，source=腾讯证券历史，refresh_status=failed、degraded=true。原成功fetched_at=2026-11-06T00:14:28.885Z保持不变。**这次真实请求的东方财富响应已能解码，但实际只返回11/06 09:31–15:00；腾讯实际窗口为11/05 13:42–11/06 15:00，两者均没有目标日缺失区间。**错误为HISTORY_RANGE_UNAVAILABLE/HISTORY_REFRESH_INCOMPLETE，不继续把这次请求写成HTTP520，也不把它认定为永久不支持或停牌。

新next_retry_at=2026-11-06T12:16:26.450Z（北京时间20:16:26），仅表示最早可再试时间。刚执行后的backfill.pending_jobs=1、due_jobs=0，符合退避；不宣称安排了20:16自动执行。该阶段D1回读为11,650条按来源保存的K线、209份原始采集记录；本次新取得的有效窗口原始记录按现有规则保存，但没有越界交付为11/04历史或冒充该日补齐。配置未变化。21:06北京时间再次读取，D1仍为11,650行、原始采集记录212份；退避已过，backfill.due_jobs恢复为1，未把它描述为已经自动执行。

### 分页、日线与其他回归

21:05北京时间继续使用原生MCP完成11/04–11/06的1分钟分页：200+200+159=559，总数与pagination.total_count一致，559个唯一时间戳，全部升序、OHLC有效、is_final=true，三页snapshot_id完全相同。后两页为缓存只读，history_refresh_status=not_attempted、upstream_refresh_attempted=false。逐日条数仍为79/240/240，缺161根；整段均为腾讯，不与东方财富拼接。逐根amount仍为null且字段完整性独立说明。

11/05–11/06日线为东方财富2根、quality=available，11/06收盘1.112，原采集时间2026-11-06T08:13:44.727Z保留；与最新证券行情1.112一致。上证指数盘口null/unsupported，sh563360及sz159842均有正常五档；sz159842源名称为券商ETF银华。黄金历史正常unsupported、count0、available=false；KOSPI保留NAVER历史22条、history_quality=unknown及calendar_verified=false，没有虚构完整日历。

### 调度状态

已更新原归档任务的执行指令：使用backfill.jobs发现所有到期任务，保留当日优先、原job_id续跑、最多40批及新退避约束；不再把recent_jobs当全部未完成作业清单。仅改prompt，工作日北京时间16:05计划、关联站点、启用/暂停状态均未改动。

Sites与Automations再次回读确认：is_enabled=false、next_run_time=null；采集settings.enabled=true且原观察列表/周期/updated_at未变。暂停原因仍无法从可用字段核实，故未擅自恢复、未重复创建任务。服务端execution.scheduler_status=unknown是其核实能力边界，外部实际paused由平台记录单独确认。**自动归档当前没有启用，也没有下一次执行时间；本次手动真实补采成功执行不代表自动调度已恢复。**

## 执行边界

现有每日一次调度不能保证到next_retry_at就立即执行，暂停的调度更不会自动补采。新backfill与既有sync形成可调用的有限执行路径，不是新部署的分钟级重试调度器。调度暂停原因未知时保留暂停；若用户希望恢复或缩短重试间隔，应明确该操作并使用原任务，不能重复建任务。不能保证旧缺口一定能从第三方追回。
