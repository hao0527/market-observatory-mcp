# 历史稳定性与长期归档交付报告

验收时间：2026-11-06上午，Asia/Shanghai。最终服务 **1.6.2**、**Schema 1.5兼容扩展**、Sites **版本17**，部署状态 **succeeded**。原先版本14为1.5.3。本轮没有增加资产指标或投资分析；保留原五个工具职责。

## 1. 修复范围与前后对比

| 问题 | 修复前 | 最终实现 |
| --- | --- | --- |
| 主源缺段 | 有任意记录便提前返回 | 主源不完整也尝试完整备用区间，按覆盖选单一提供方；不跨源拼接 |
| 多日期请求 | 按周反复请求可能相同的保留窗口 | 有边界整段查询、至多一次同源窗口恢复；归档精确到日补采 |
| 永久历史 | 依赖14天故障缓存 | 同一D1新增不自动过期的none已完成K线及原始批次 |
| K线与字段混淆 | amount=null容易被当作缺K线 | bar_coverage、field_completeness、source_quality、cache_status、refresh_status、degraded、rejected_count独立 |
| 缓存刷新失败 | 容易混淆数据可用与刷新成功 | 有效记录保持其质量，失败单独记录；完整归档可available且degraded=true、refresh=failed |
| 缺口追踪 | 查询后缺少持久化补采任务 | 逐日任务、精确缺失标签/区间、失败证据、next_retry_at及指数退避 |
| 无人值守权限 | 误把站点服务凭据当作MCP OAuth | 私有/api/security-archive复用归档函数；MCP继续独立OAuth |
| D1兼容问题 | 长中文LIKE模式失败会跳过归档读取 | 索引上下界查询取代LIKE；可选旧缓存导入失败不阻断正式归档 |

没有核实的停牌、上市边界、临时休市、固定历史保留天数和复权因子版本继续明确未知。缺失默认missing_unverified；不补造K线。

## 2. 文件与代码位置

| 文件 / 位置 | 功能 |
| --- | --- |
| [lib/security-history.ts](../lib/security-history.ts#L78) blocks/getBlock/readSecurityHistory/getSecurityHistory | 整段恢复、完整备用、同源归档增量读取、原始响应和独立质量/分页 |
| [lib/security-history.ts](../lib/security-history.ts#L142) securityCoverage | 2026排定日历、预期标签、缺失连续区间、未知原因 |
| [lib/security-store.ts](../lib/security-store.ts) | 请求级归档接口、整根记录择优、来源隔离 |
| [db/security-archive.ts](../db/security-archive.ts#L6) | D1 JSON批量幂等入库、优质记录保护、原始证据、配置、租约和任务 |
| [lib/security-archive.ts](../lib/security-archive.ts#L14) | 配置、归档执行、状态及原始审计三个工具 |
| [app/api/security-archive/route.ts](../app/api/security-archive/route.ts#L8) | 服务授权下执行与回读，复用同一业务函数 |
| [app/mcp/route.ts](../app/mcp/route.ts#L9) | 8个MCP工具注册、目录、服务版本，原有职责不变 |
| config/security-watchlist.json | 可配置五证券观察列表和默认周期 |
| db/schema.ts、drizzle/0001_noisy_lyja.sql、meta | 追加五张归档表，未改写已应用0000迁移 |
| worker/index.ts | 沿用DB绑定注入归档上下文 |
| scripts/test-security-archive.mjs | 实际SQLite和生产SQL/HTTP回归 |
| scripts/verify-security-archive-online.mjs | 真实服务写入/回读与MCP OAuth验收入口 |
| SECURITY_ARCHIVE.md、SECURITY_HISTORY.md、WORK_DEPLOY.md、README、CHANGELOG | 字段语义、边界、复现及部署说明 |

## 3. 工具、存储与补采

新增：configure_security_archive、sync_security_history、get_security_archive_status；get_security_history参数保持兼容。初始观察列表sh563360、sh510300、sh518850、sz159842、sh600519；sz159842实际名称为**券商ETF银华**。默认归档1m/5m/15m/1d、不复权；30/60分钟可配置。

沿用D1的DB绑定，线上已确认六张表：原market_last_success，以及security_history_bars、security_history_fetches、security_archive_settings、security_archive_jobs、security_archive_tasks。正式归档无自动过期或删除；故障缓存仍保留14天。

唯一键symbol+period+adjust+source+timestamp。只接收校验通过且已完成的none K线；raw保留原始供应商时间、量额、复权批次、错误及拒绝原因。整根记录择优，不把缺字段的新数据覆盖更完整数据，不拼供应商或复权基准。原始采集时间不因读取而更新。复权原始批次保存，稳定K线归档暂仅none，避免混入不同复权因子版本。

sync每次默认1项、最多2项，作业最多400项/62日；job_id续跑，90秒租约、幂等写入、逐日缺口与失败留痕。失败最早60秒后重试，指数退避上限6小时；next_retry_at是最早允许重试时间，不代表每分钟自动唤醒。下次调度或手动调用可补采。未收盘not_ready、未知日历calendar_unverified均不算完成。

## 4. 确定性与本地集成测试

- npm run typecheck：通过。
- npm test：原56组全球历史、99组证券历史，以及既有报价/盘口/时间/缓存/MCP契约通过。
- npm run test:cache：原缓存真实SQL测试及**21组实际SQLite/生产SQL/HTTP归档场景通过**。
- 当前Sites生产构建：通过。
- 本地D1按序应用0000、0001迁移；线上Sites迁移后表结构真实存在。

21组覆盖：持久文件数据库重开、1008条分页、刷新失败但归档完整、整源替换、319→480同源补采（明确fixture）、原始审计、质量保护、复权隔离、幂等/租约/中断续跑/退避、未知日历、HTTP业务状态、长中文前缀查询及可选旧缓存导入异常隔离。

本地构建Worker外网fetch报internal UPSTREAM_NETWORK，20项明确failed、零K线；这是本地连通性阻塞，**没有算作真实行情采集成功**。独立Node真实上游曾成功获取563360全部日/5/15/30/60分钟窗口和qfq/hfq通道；具体线上结果以下表为准，不能以本机曾成功替代线上验收。

## 5. ChatGPT原生MCP真实验收

固定请求日期：月度2026-10-01至11-05；1分钟两日11-04至11-05；对照证券分钟范围11-03至11-05。日期范围内排定交易日21天。共**18组原生MCP查询**，16组有非空记录；质量统计{'available': 10, 'partial': 6, 'unavailable': 2}。非空不代表完整，amount缺失也不等于缺K线。

| 场景 | 证券 | 周期 / 复权 | 实际/预期根数 | 来源 | quality | 本次刷新 / 降级 | amount |
| --- | --- | --- | --- | --- | --- | --- | --- |
| daily | sh563360 | 1d / none | 21/21 | 东方财富 | available | succeeded / degraded=false | 完整 |
| 5m_refresh | sh563360 | 5m / none | 1008/1008 | 东方财富 | available | succeeded / degraded=false | 完整 |
| 15m_month | sh563360 | 15m / none | 320/336 | 腾讯证券历史 | partial | succeeded / degraded=false | 缺失或无数据 |
| 1m_two_days | sh563360 | 1m / none | 319/480 | 腾讯证券历史 | partial | succeeded / degraded=false | 缺失或无数据 |
| 1m_day | sh563360 | 1m / none | 240/240 | 东方财富 | available | succeeded / degraded=false | 完整 |
| 30m_month | sh563360 | 30m / none | 168/168 | 腾讯证券历史 | partial | succeeded / degraded=false | 缺失或无数据 |
| 60m_month | sh563360 | 60m / none | 84/84 | 东方财富 | available | succeeded / degraded=false | 完整 |
| daily_qfq | sh563360 | 1d / qfq | 0/21 | 腾讯证券历史 | unavailable | failed / degraded=false | 缺失或无数据 |
| daily_hfq | sh563360 | 1d / hfq | 0/21 | 腾讯证券历史 | unavailable | failed / degraded=false | 缺失或无数据 |
| 5m_recent | sh563360 | 5m / none | 144/144 | 东方财富 | available | failed / degraded=true | 完整 |
| sh510300_1d | sh510300 | 1d / none | 21/21 | 东方财富 | available | failed / degraded=true | 完整 |
| sh510300_5m | sh510300 | 5m / none | 144/144 | 腾讯证券历史 | partial | succeeded / degraded=false | 缺失或无数据 |
| sh518850_1d | sh518850 | 1d / none | 21/21 | 东方财富 | available | succeeded / degraded=false | 完整 |
| sh518850_5m | sh518850 | 5m / none | 144/144 | 腾讯证券历史 | partial | succeeded / degraded=false | 缺失或无数据 |
| sz159842_1d | sz159842 | 1d / none | 21/21 | 腾讯证券历史 | partial | succeeded / degraded=false | 缺失或无数据 |
| sz159842_5m | sz159842 | 5m / none | 144/144 | 东方财富 | available | succeeded / degraded=false | 完整 |
| sh600519_1d | sh600519 | 1d / none | 21/21 | 东方财富 | available | succeeded / degraded=false | 完整 |
| sh600519_5m | sh600519 | 5m / none | 144/144 | 东方财富 | available | succeeded / degraded=false | 完整 |

qfq/hfq日线本轮线上均unavailable：东方财富HTTP520；腾讯没有明确请求的复权序列，返回UNVERIFIED_ADJUSTMENT，拒绝用day数组冒充复权。保留因子版本未知、point_in_time_supported=false；不能把普通不复权数据改名为前/后复权。直接Node此前成功不等于本轮线上通过。

5m_recent和sh510300日线出现真实上游失败后交付完整D1归档：quality=available、degraded=true、refresh_status=failed，原fetched_at保留；这是期望的状态拆分，不将缓存伪称本次新取。

### 分页与持久化

- 563360月度5分钟：**200+200+200+200+200+8=1008**，6页snapshot_id一致、无重复/遗漏；全部delivery=durable_archive、refresh=not_attempted。
- 15分钟：200+120=320，2页同一快照；只承诺320条真实记录，缺少的16条不补造。
- 1分钟两日：200+119=319，2页同一快照；缺161条明确保留。
- 完整归档在后续部署的新Worker仍可读取，不依赖原进程内存。旧缓存导入错误隔离修复后，生产归档读取不再出现LIKE/GLOB错误。

### 价格、时间与单位

11-05的563360：日线、240根分钟线均来自东方财富；日线收盘1.133、最后一分钟收盘1.133、腾讯最新可得报价1.133一致。分钟量合计60507820手，等于日线60507820手；分钟额合计6860477170元，等于日线6860477170元。没有以价格乘量估算成交额。

240根时间戳均与bar_end对应，is_final全部true，datetime为Asia/Shanghai、timestamp为UTC Unix秒；日线timestamp明确为当地日期零点键，非收盘时间。原source_datetime、raw_volume/raw_amount/raw_units保留。跨源抽查曾发现09:31量额口径不完全相同，因此继续禁止未经验证的跨源拼接。

## 6. 归档真实写入与回读

11-05五证券×四周期 **20/20任务完成并实际从D1回读**。每证券1d/1m/5m/15m分别1/240/48/16根。本次初始归档均切换腾讯备用，amount=null明确标为字段不完整，bar_coverage完整；没有把字段缺失算作缺K线。

重复同一作业processed_this_call=0，未重复采集或插入。实际raw通过fetch_id回读成功，ingest_complete=true。随后经过原生MCP查询及补采，末次只读状态统计为**9150条按来源独立存储的K线、127个原始采集/失败批次**；跨来源相同时间的记录在存储中各自保留，查询不会静默合并。

两个精确补采任务已持久化：

| 缺口 | 实际补采结果 | 持久状态 |
| --- | --- | --- |
| 563360 10-08 15分钟，缺16根 | 主源刷新失败，备用窗口不覆盖该日，0条有效记录 | pending_backfill；upstream_failed；结构化错误与next_retry_at保留 |
| 563360 11-04 1分钟，缺161根 | 腾讯仅提供该日79根；未取得剩余161根 | partial；missing_unverified；79条已存、缺失区间及next_retry_at保留 |

这两段**仍未恢复**。observed_start/end表示实际观察窗口，不是独立核实的供应商最大保留期限；未验证停牌/上市/固定保留期不能擅自归因。

## 7. 自动归档与访问边界

关联Site的“证券历史每日归档”已保存且**is_enabled=true**，exact_schedule，工作日**16:05 Asia/Shanghai**。已通过Sites关联列表及Automations私下读取核对，仅创建一项，无重复任务；原盘前监测任务未改。

任务按现有观察列表执行，最多40次有限批处理；优先当日，再按next_retry_at补采最近未完成作业，回读实际持久化数量。正常采集不重新部署、不改变Secrets、不做市场分析。

**首次定时执行尚未发生，last_run_time和next_run_time在平台返回中为空。** 已完成的是手动实际writer/持久化readback验收及调度保存，未声称未来任务已运行。

MCP入口单独要求openid/resource.invoke/email OAuth；站点服务凭据只访问本站普通API，不能替代MCP OAuth。/api/security-archive由现有owner-private平台访问边界保护，GET读状态、POST sync/configure调用同一归档函数。服务凭据只即时获取、仅发给本站；没有写进源码、任务提示词或报告。

本会话原生工具卡片仍缓存旧清单：已有读取工具实际走ChatGPT MCP完成验收；新增归档写入/配置/状态经同一业务函数的私有服务API实测，未冒充本会话已直接调用新原生工具。新会话可刷新插件清单；任务同时保存了支持的服务执行路径。站点访问范围继续为所有者私有；部署env_set_revision=0，未修改Secrets。

## 8. 原有工具回归

- 强制刷新全球快照：13/13有值；其中VIX和布伦特按实际时效返回stale，其余11项available。没有把“可读取”写成全部最新。
- sh000001盘口null/unsupported；563360、159842、600519各5档买卖，报价可读取。
- 黄金历史正常业务返回unsupported、history_count=0、history_available=false、UNSUPPORTED_HISTORY、工具isError=false。
- 非法股票历史代码sh123456：MCP工具正确返回INVALID_ARGUMENT、isError=true。
- 同一查询仅返回一种来源，OHLC/升序/唯一时间戳/日期范围/单位和history_available不变量均校验。

## 9. Git与部署

| 内容 | 功能提交 | 合并记录 |
| --- | --- | --- |
| 历史恢复、D1归档、作业、质量语义 | 28f1b995e9cbec571b1599d0e21dc097e0346a77 | [PR #1](https://github.com/hao0527/market-observatory-mcp/pull/1)，849df6038de2e94aa983d98bd03bd00f46f0d022 |
| 无人值守服务访问与MCP OAuth隔离 | f7424d3b4e46a343dc7099429c9dec097374b007 | [PR #2](https://github.com/hao0527/market-observatory-mcp/pull/2)，037ea507c4fd9d805b5d761efe471d7d78a24b3b |
| D1前缀查询、归档读取隔离 | 4493b967bceda734333cc55200834cf98484f3a7 | [PR #3](https://github.com/hao0527/market-observatory-mcp/pull/3)，b4d24242aede406228ce1e4525184ca51c4ddc3d |

最终生产版本17 / 服务1.6.2 / Schema1.5，状态succeeded；以推送的准确私有源和同一状态构建归档发布。新迁移通过Sites流程应用，未上传本地数据库。公开源码分发检查、diff检查通过；其他用户可按WORK_DEPLOY.md创建自己的私有Site、D1与调度，不复制作者身份或凭据。

## 10. 未解决事项与架构边界

- 15分钟旧缺16根、1分钟旧缺161根尚无法从实际接口恢复，保留待补采；不虚构成功。
- 本轮线上qfq/hfq不可用，保留真实上游/复权序列错误；未取得独立因子版本及历史时点复权能力。
- 腾讯逐根成交额缺失，不估算；K线覆盖完整时字段质量仍可partial。
- 日历已核实范围为2026排定休市日；2027及临时休市/停牌/上市边界未经核实继续unknown。
- D1容量有限、归档不自动删除；目前未增加第二套存储或未经验证的跨源拼接。
- 自动任务已启用，但首次真正定时运行结果尚待发生。

本轮没有需要更高推理模型才能解决的已知架构阻塞。跨来源分段合并若未来成为明确需求，需要另行核验重叠区间与冲突处理；当前按要求保持保守，不因数据缺失扩大架构或增加投资分析。
