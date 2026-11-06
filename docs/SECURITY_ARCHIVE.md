# 证券历史稳定性与长期归档（服务 1.6.0 / Schema 1.5）

新增字段及工具均为兼容扩展。保留原五个工具的职责，不添加分析、信号或自动交易。

## 请求与来源

`get_security_history` 参数不变。每次先尝试有边界的完整区间请求，东方财富遇可重试错误时等待300ms再尝试同源保留窗口；每个策略只请求一次，401/403/429不扩大重试。响应先验证证券/周期/复权序列/OHLC/交易时段，再严格过滤请求日期。窗口覆盖不足仍为partial；一次520不能证明周期不支持。失败HTTP保留至多2048字节正文及非敏感响应头。

主源部分可用也会尝试腾讯完整区间，按已验证交易日历覆盖选择一个完整提供方结果；未选备用的错误仍可追溯。既不跨供应商拼接K线，也不借备用成交额补主源字段。针对缺失交易日的精确重试由归档任务执行，每个任务是symbol+period+date。单查询最多366个日历日（日线）或62日（分钟）。供应商窗口不是承诺的历史保留期限。

## 持久化

沿用DB绑定及Drizzle，不添加数据库产品。原`market_last_success`仍为14天故障缓存；新增归档无自动过期或删除：

| 表 | 内容 |
| --- | --- |
| security_history_bars | 已验证、已完成、不复权K线；唯一键symbol+period+adjust+source+timestamp |
| security_history_fetches | 成功/失败采集证据、原始JSON、请求范围、原始采集时间、拒绝原因、是否完成入库 |
| security_archive_jobs | 作业范围、状态和90秒租约 |
| security_archive_tasks | 每个交易日/证券/周期任务、覆盖缺口、失败、重试次数和next_retry_at |
| security_archive_settings | 可配置观察列表及周期 |

只用同一提供方、同一none口径的已完成K线增量补齐。整根记录择优：不以缺字段的新版本覆盖更完整记录，相同字段完整度时仅接收更新采集版本；不逐字段拼价格。历次原始采集证据保留供核对。JSON分批入库，最多700行/约750KB一批，原始响应单行上限1.8MB，入库不完整可幂等重试。D1容量有限；状态工具提供归档行数与范围，不自动清理历史。

现有成功缓存中最多两个最近原始批次会按需验证后转入归档，保持原fetched_at。供应商窗口虽超出请求范围，可保存其已校验完整记录；向调用方返回时仍严格过滤。归档保存失败不会伪称持久化成功，sync作业会实际回读记录验证。

## 质量字段

| 字段 | 语义 |
| --- | --- |
| bar_coverage | 日历覆盖、expected_count、received_count、missing_count、逐日缺失标签和连续缺失区间 |
| field_completeness | OHLCV/amount是否完整、缺成交额记录数；amount=null不是缺K线 |
| source_quality | 供应商字段/恢复/降级状态 |
| cache_status | upstream / last_success_cache / durable_archive / archive_plus_upstream、完整度、过期、降级 |
| refresh_status / history_refresh_status | 本次刷新succeeded / failed / not_attempted，两者一致 |
| degraded | 因刷新失败而交付历史缓存/归档；失败证据独立保留 |
| rejected_count / rejection_reasons | 本批被拒绝的原始行数及原因 |
| quality | 兼容总体状态；缺字段仍可partial，但bar_coverage可以complete |

完整有效归档即使本次刷新失败，数据质量仍可available；必须同时返回degraded=true、refresh_status=failed及错误证据。空历史从不history_available=true。无记录字段完整度为null，不能把空数组说成完整字段。

已核实2026年沪深北排定休市日；临时停牌、上市边界、无成交与突发休市未独立核实。缺失默认missing_unverified，不凭数量猜测停牌或供应商保留期限。non_trading_day仅来自已核实排定日历；采集失败另记upstream_failed。不插入人工K线。

分钟timestamp是UTC Unix秒，代表供应商K线结束标签；datetime为Asia/Shanghai，source_datetime原样保留，bar_end对应结束时刻。日线timestamp是交易日期当地零点的规范化键，bar_end为会话结束，二者刻意不同。is_final依据原fetched_at与已知交易时段，不用retrieved_at追认旧未完成K线。raw_volume/raw_amount/raw_units保留原始单位；标准价格人民币元、成交量手（100份/股）、成交额人民币元。腾讯缺少逐根成交额时null，不估算。

前后复权继续使用明确fqt或命名qfqday/hfqday序列，原始批次单独保留；没有独立因子版本，不声称历史时点可复现。仅1分钟none已验证开放，其余1分钟复权unsupported。稳定归档目前仅none，防止跨因子版本混合。

## 工具

- `configure_security_archive({symbols?, periods?, enabled?})`：持久化观察列表；缺省列表来自config/security-watchlist.json。默认sh563360、sh510300、sh518850、sz159842、sh600519，周期1m/5m/15m/1d。sz159842实为券商ETF银华，名称以源为准。禁用不删除记录，不更改云调度时间。
- `sync_security_history({symbols?, periods?, start_date?, end_date?, max_tasks?, retry_missing?, force_refresh?})`：默认当日，单次处理1项、最多2项，每个作业最多400项/62日；返回job_id。后续只传`{job_id,max_tasks:1,retry_missing:true}`恢复。force_refresh创建独立刷新作业；参数保存在作业中，恢复后仍执行刷新。重复普通请求复用同一作业。
- `get_security_archive_status({job_id?, fetch_id?})`：无参数读取配置、分证券周期来源的持久化范围和最近8个作业；job_id读取任务/缺口，fetch_id读取原始证据。均有新retrieved_at。

归档只在已核实交易日15:35后开始；自动任务建议16:05北京时间。未收盘not_ready、未知日历calendar_unverified都不算complete。作业complete要求已完成K线覆盖完整且从D1回读数量一致；amount缺失单独表达。部分/失败任务保留，按60秒起指数退避、最大6小时再试。作业租约防重复执行；中断后保留已入库记录，租约到期可恢复。并发限制为单作业，不宣称全世界跨实例统一限流。

历史归档满足请求时refresh=false直接读取；refresh=true仍请求上游。分页绑定单一来源与数据内容指纹；归档页不请求上游。更正了历史值会令旧cursor明确过期；不要继续拼接已过期分页。部署/归一化版本升级也可能令旧游标过期，请重读第一页。

## 自动执行与授权

归档写入是此所有者私有站点的共享市场资料更新，不是第三方应用账户写入。保持owner-private。Sites平台校验服务访问；定时任务使用本站已连接MCP，或通过get_site取得本次支持的服务访问方式，仅发给该站点；不得保存服务凭据到源码、文件或任务提示词。公开部署若允许其他访客，必须另行加写权限，不能直接公开更新端点。

云任务先读取配置/目录，再逐批sync并回读状态；失败任务留待补采，不能把任务保存说成已经运行。未来会话可从本站目录重取完整采集契约，不依赖作者会话。常规采集不重新发布站点。实际任务时间、启用状态和手动验收以本轮验收报告为准。

## 验证与复现

运行npm test、npm run test:cache、npm run typecheck及当前Sites构建流程。test:cache包含真正SQLite迁移及生产D1 SQL适配器测试：归档重开、1008条分页、319→480同源补采、逐条字段质量、缓存失败、原始审计、幂等/租约/中断/指数退避。测试数据明确为fixture。

`node scripts/test-security-history-live.mjs`读取真实上游；`node scripts/test-security-history-recovery-live.mjs`核实区间/窗口及复权路径。`node scripts/verify-security-archive-online.mjs`通过真实线上MCP协议执行，凭据仅隐藏stdin，mode=matrix/archive/read分别验证查询矩阵/归档写入与回读/新进程持久化读取。归档模式会真实写入指定观察证券2026-11-05数据，使用前核对日期，不改生产主源。

只承诺实际验证覆盖区间，不保证供应商将来持续保存同样长度。历史缺口若两个来源都无数据，保持partial并明确记录，归档不能倒推出已经丢失的真实行情。


### 私有服务执行入口（1.6.1修复）

实际平台验收证实：站点服务凭据可访问普通API，但`/mcp`仍要求独立OAuth（openid resource.invoke email）。二者不能混用，也不需要轮换Secret或放开站点访问。

增加`/api/security-archive`，由同一owner-private平台边界验证服务访问；GET读取状态（可传job_id/fetch_id），POST `{"operation":"sync","arguments":{...}}`或`{"operation":"configure","arguments":{...}}`复用完全相同的归档函数。已有MCP工具保持独立OAuth。此入口不伪造visitor identity，不连接其他应用。

在线脚本archive/read模式使用该服务API；matrix模式使用MCP OAuth `oauth_token`，或由ChatGPT原生MCP调用完成。未经OAuth的/mcp返回401是正确的权限边界，不能误报为业务参数或数据源故障。未来云任务若新工具尚未加载，可从get_site即时获取现有服务访问凭据，仅发给本站API；不可把凭据写进提示词、源码或报告。


### D1归档读取兼容修复（1.6.2）

线上D1对较长LIKE/GLOB模式报`LIKE or GLOB pattern too complex`。旧缓存键前缀改用主键的上下界范围查询；不再使用LIKE。旧缓存导入是可选路径，其失败单独记录legacy_import错误，始终继续读取正式归档，不影响已持久化数据可读性。已归档数据和原采集时间均保留。增加真实SQLite的长中文前缀检索、可选旧缓存导入异常隔离回归；最终以生产D1的归档分页回读确认。


## 1.6.4：执行状态与全量待补采发现

settings.enabled仅允许采集，不证明外部调度正在运行。configure/get_status/sync新增execution，collection_enabled为该开关的只读表达；scheduler_status=unknown、scheduler_verified=false，因为本站Worker无法核实Sites/Automations状态。调用方需独立读取实际任务的is_enabled与next_run_time。单日job.complete不代表长期周期任务应停用。

next_retry_at表示最早允许重试时间，不是已经安排的执行时间。Worker没有自动重试定时器；只有外部调用sync才执行。原recent_jobs保留最近8项活动记录，新增backfill直接查询所有未完成任务：

- pending_jobs/pending_tasks：全部未完成数量。
- due_jobs/due_tasks：queued或已到next_retry_at的可重试数量。
- blocked_tasks：日历未核实、未知状态或缺少有效重试时间的任务，不宣称可自动执行。
- jobs：最多40个当前可执行作业，优先请求范围结束于当日的作业，其后按最早到期排列。due_task_count等字段由当前任务表计算，不依赖作业摘要是否在崩溃前更新。
- truncated：仍有未返回的到期作业；不能把列表为空/截断误当全部完成。

没有新表或迁移，也不改现有记录。归档设置停用时sync仍为no-op。暂停外部任务不会自动修改settings.enabled；这两个独立开关不应互相伪装。

### 调用方执行流程

先读取Catalog及归档状态，保留配置。若collection_enabled=false，停止自动采集。先用sync_security_history(max_tasks:1,retry_missing:false)建立/续跑当日任务，处理queued；再重新读取backfill.jobs，按job_id、max_tasks:1、retry_missing:true补采已到期任务。每次补采后重新读状态，遵守新退避时间；每轮总计最多40次sync调用，在平台运行时限内结束，不循环等待未来截止时间。最终回读任务和D1数量，报告剩余缺口及允许重试时间。

这是可调用的有限补采路径，不是分钟级自动唤醒承诺。现有每日一次调度可能错过短保留窗口内的重试；若需要更及时补采，应在用户确认后调整现有调度的有限重试执行频率，不能仅新增next_retry_at字段声称已部署补采调度。暂停状态及未知停用原因应如实保留并报告。
