# 证券历史K线第二轮修复与线上验收（1.5.1）

> 此文为1.5.1历史记录；后续状态见[1.5.2同源窗口恢复及线上验收](SECURITY_HISTORY_RECOVERY_REPORT.md)，其中明确区分本次新取、缓存及仍不可用的复权请求。

2026-11-05。Schema保持1.5，服务升级1.5.1，原私有站点已成功部署Sites版本11。**本报告使用ChatGPT原生MCP实际调用部署后的Worker验收，替代上一报告“本会话没有新工具”的验收限制。** 不把接口注册、HTTP成功或缓存交付算成上游新取成功。

## 结论及根因边界

存在实际问题：旧实现只有东方财富历史通道；ETF没有已有成功缓存时，主源故障直接导致空结果；股票的已有缓存可能掩盖相同的主源故障。旧错误层没有保存HTTP错误正文；普通TTL过后，游标读取仍可能再次请求上游。

修复前对sh563360、sh510300、sz159842、sh600519分别强制刷新：四者均遇到东方财富HTTP520；前三个没有记录，600519从已有持久缓存交付21根。因此不能由“股票有数据、ETF没有”推断ETF需要不同secid或专用路径。

部署后，Worker实际收到的520正文为 `error code: 520\n`，响应头包含 `server: cloudflare`。保留真实状态和最多2048字节正文，仅保留允许列出的诊断响应头。代码没有把其他HTTP状态统一改写成520。部分后续东方财富ETF请求成功（518850的60分钟、563360的5分钟），说明同一映射和路径可以工作。**目前不能仅凭该正文确定故障发生于供应商源站、边缘网络还是请求限制；根因仍未完全定位。** 参数逗号规范化不被宣称为520根因修复。

上海 `1.CODE`、深圳 `0.CODE` 沿用原映射。未把股票与ETF的证券节点混用，解析时再次核对实际代码、市场和名称。本轮实时矩阵只覆盖沪深股票及ETF，不把上一轮北交所结果冒充本轮复验。

## 修改前后

| 问题 | 修复前 | 修复后 |
| --- | --- | --- |
| ETF主源故障 | 没有独立证券历史备用通道 | 无有效主源记录且遇可回退错误时，整段读取腾讯历史；来源显式切换 |
| HTTP520定位 | 状态存在，正文丢失 | 保留实际状态、有限正文及安全诊断头；超时仍是UPSTREAM_TIMEOUT |
| 周期与范围 | 易把源故障误读为周期不支持 | 按实际错误区分HTTP/超时/空历史/范围不足；不合成或替换周期 |
| 复权 | 单一fqt通道失效时不可读 | 东方财富仍用fqt=0/1/2；腾讯必须有明确day/qfqday/hfqday，拒绝把普通day当复权 |
| 游标与缓存 | TTL过期后翻页可能再次刷新并失败降级 | refresh=false的游标只读绑定提供方的成功缓存；缓存消失明确CURSOR_EXPIRED |
| 已有完整备用缓存 | 可能先尝试失败主源 | 优先检查两源各自正常有效且完整的缓存；命中时not_attempted、无本次失败或降级 |
| 缺少成交额 | 原字段只支持number | 腾讯逐根amount缺失时返回null且partial；不补算、不借其他源成交额 |
| 换源或复权批次 | 需要防止错误拼接 | 分源缓存、整段替换、游标绑定提供方、按复权读取日隔离；不跨未知因子版本拼接 |

## 修改文件与核心位置

| 文件 | 功能 |
| --- | --- |
| [lib/security-history.ts](../lib/security-history.ts) | parseTencentSecurityHistory（约57行）；分源请求与缓存（约93行）；独立刷新/质量/覆盖与分页（约126行）；getSecurityHistory整段备用入口（约155行） |
| [lib/quote-cache.ts](../lib/quote-cache.ts) | cacheOnly与cacheFresh选项，默认不影响旧工具；只读缓存不加入上游刷新任务 |
| [lib/upstream.ts](../lib/upstream.ts) | 按需获取HTTP错误正文和诊断头；保留真实状态与超时错误 |
| [app/mcp/route.ts](../app/mcp/route.ts) | 新来源、nullable amount、分页行为的工具说明与Catalog；服务版本1.5.1 |
| [scripts/security-history-cases.mjs](../scripts/security-history-cases.mjs)、[scripts/test-market-data.mjs](../scripts/test-market-data.mjs) | 证券备用、身份、复权、分页、缓存、真实HTTP语义回归 |
| [docs/SECURITY_HISTORY.md](SECURITY_HISTORY.md)、README.md、CHANGELOG.md、package.json | 字段、来源、版本与兼容说明 |

复用现有D1，无数据库迁移；没有改Secrets、站点访问范围、原有工具的业务计算；没有新增技术指标、交易信号或投资逻辑。

## 真实Worker逐证券逐周期矩阵

日K请求：2026-10-01至2026-11-05；分钟请求：2026-11-03至2026-11-05。均为none、refresh=true、limit=500。每项都检查实际非空记录及字段，**不是仅检查HTTP200**。

30个查询最终均交付非空记录，其中**28项为上游本次成功新取，2项为主源刷新失败后的已有成功缓存**。510300日K首次失败，下面列有限次复测的成功结果，失败证据另列。所有腾讯新取结果因缺少amount为partial，不能称为字段完整。

| 证券 | 周期 | 返回根数 | 交付来源 | 交付方式 | quality | degraded | 本次刷新 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| sh563360 | 1d | 21 | 腾讯证券历史 | 上游新取 | partial | false | succeeded |
| sh563360 | 1m | 319 | 腾讯证券历史 | 上游新取 | partial | false | succeeded |
| sh563360 | 5m | 144 | 腾讯证券历史 | 上游新取 | partial | false | succeeded |
| sh563360 | 15m | 48 | 腾讯证券历史 | 上游新取 | partial | false | succeeded |
| sh563360 | 30m | 24 | 腾讯证券历史 | 上游新取 | partial | false | succeeded |
| sh563360 | 60m | 12 | 腾讯证券历史 | 上游新取 | partial | false | succeeded |
| sh510300 | 1d | 21 | 腾讯证券历史 | 上游新取 | partial | false | succeeded |
| sh510300 | 1m | 319 | 腾讯证券历史 | 上游新取 | partial | false | succeeded |
| sh510300 | 5m | 144 | 腾讯证券历史 | 上游新取 | partial | false | succeeded |
| sh510300 | 15m | 48 | 腾讯证券历史 | 上游新取 | partial | false | succeeded |
| sh510300 | 30m | 24 | 腾讯证券历史 | 上游新取 | partial | false | succeeded |
| sh510300 | 60m | 12 | 腾讯证券历史 | 上游新取 | partial | false | succeeded |
| sh518850 | 1d | 21 | 腾讯证券历史 | 上游新取 | partial | false | succeeded |
| sh518850 | 1m | 319 | 腾讯证券历史 | 上游新取 | partial | false | succeeded |
| sh518850 | 5m | 144 | 腾讯证券历史 | 上游新取 | partial | false | succeeded |
| sh518850 | 15m | 48 | 腾讯证券历史 | 上游新取 | partial | false | succeeded |
| sh518850 | 30m | 24 | 腾讯证券历史 | 上游新取 | partial | false | succeeded |
| sh518850 | 60m | 12 | 东方财富 | 上游新取 | available | false | succeeded |
| sz159842 | 1d | 21 | 腾讯证券历史 | 上游新取 | partial | false | succeeded |
| sz159842 | 1m | 319 | 腾讯证券历史 | 上游新取 | partial | false | succeeded |
| sz159842 | 5m | 144 | 腾讯证券历史 | 上游新取 | partial | false | succeeded |
| sz159842 | 15m | 48 | 腾讯证券历史 | 上游新取 | partial | false | succeeded |
| sz159842 | 30m | 24 | 腾讯证券历史 | 上游新取 | partial | false | succeeded |
| sz159842 | 60m | 12 | 腾讯证券历史 | 上游新取 | partial | false | succeeded |
| sh600519 | 1d | 21 | 东方财富 | 缓存 | available | true | failed |
| sh600519 | 1m | 319 | 腾讯证券历史 | 上游新取 | partial | false | succeeded |
| sh600519 | 5m | 144 | 东方财富 | 缓存 | available | true | failed |
| sh600519 | 15m | 48 | 腾讯证券历史 | 上游新取 | partial | false | succeeded |
| sh600519 | 30m | 24 | 腾讯证券历史 | 上游新取 | partial | false | succeeded |
| sh600519 | 60m | 12 | 腾讯证券历史 | 上游新取 | partial | false | succeeded |

覆盖说明：

- 日K实际10月8日至11月5日，21个排定交易日；10月1–7日休市没有补造记录。
- 5分钟09:35–15:00，共144根；15分钟09:45–15:00，共48根；30分钟10:00–15:00，共24根；60分钟10:30–15:00，共12根，均覆盖本次三个交易日。
- 五只证券的腾讯1分钟可用窗口相同：2026-11-04 13:42至2026-11-05 15:00，319根；相对请求的720根排定常规分钟标签缺401根，因此coverage.range_complete=false。原响应320行中一条09:30开盘快照不满足常规分钟结束标签，拒绝该行并保留警告/可选原始响应。
- 此处证明的是本轮查询范围；不是承诺供应商对所有证券、所有日期始终保留同样长度。腾讯最近窗口请求的较大数量参数不保证返回数量。
- 600519日K和5分钟的缓存记录仍有效，quality=available；本次主源失败分别保留520/超时错误及degraded=true，不声称刷新成功。
- 后续563360单日5分钟强制刷新曾从东方财富成功读到48根；主源缓存包含该周144根。不能用这次间歇成功否认此前真实520。

## 复权真实结果及限制

none结果见上表。下表为独立refresh=true查询，无跨源复权拼接。

| 证券 | 周期 | adjust | 根数 | 来源/尝试来源 | quality | 最新实际时间 |
| --- | --- | --- | --- | --- | --- | --- |
| sh563360 | 1d | qfq | 0 | 腾讯证券历史 | unavailable | — |
| sh563360 | 1d | hfq | 0 | 腾讯证券历史 | unavailable | — |
| sh563360 | 5m | qfq | 0 | 腾讯证券历史 | unavailable | — |
| sh563360 | 5m | hfq | 0 | 腾讯证券历史 | unavailable | — |
| sh600519 | 1d | qfq | 20 | 腾讯证券历史 | partial | 2026-11-04 |
| sh600519 | 1d | hfq | 21 | 腾讯证券历史 | partial | 2026-11-05 |
| sh600519 | 5m | qfq | 144 | 东方财富 | available | 2026-11-05 15:00 |
| sh600519 | 5m | hfq | 0 | 腾讯证券历史 | unavailable | — |

具体失败与口径：

- 563360日K qfq：东方财富520；腾讯只返回普通day，没有明确qfqday，返回UNVERIFIED_ADJUSTMENT。5分钟qfq/hfq：主源520、备用分钟复权未核实。均不能把主源暂时失败等同于全局不支持，所以最终unavailable。
- 563360日K hfq：主源520；腾讯在两次受控调用中返回WAF501，仍为unavailable；开发端独立探测曾只有普通day，未据此伪造复权历史。
- 600519日K qfq首次遇WAF501，复测实际取得qfqday 20根，仅至11月4日，coverage缺11月5日，quality=partial。未用11月5日最新报价补齐。
- 600519日K hfq实际取得hfqday 21根，最新close=9974.833；不与上一轮东方财富hfq的8901.64拼接，不推断两供应商复权基准一致。
- 600519的5分钟qfq本次东方财富成功144根；hfq主源520，腾讯分钟复权未核实，返回unavailable。
- 1分钟qfq返回正常结构化unsupported/UNVERIFIED_ADJUSTMENT、count=0、not_attempted，不包装成INVALID_ARGUMENT。
- 复权元数据保留请求口径、供应商序列、读取日adjustment_epoch、原始provider_version。腾讯version=16的含义未验证，**不是复权因子版本**。factor_version=null、verified_factor_version=false、point_in_time_supported=false；提供供应商本次读取的调整版本，不声称是历史当时可获得版本。

## 分页、缓存与失败验收

| 场景 | 实际结果 |
| --- | --- |
| 563360 11月5日5分钟，东方财富新取 | 48根，按20+20+8完整读取；首请求succeeded，后两页not_attempted、cache_hit=true、degraded=false |
| 上述D1分页 | 后两页fetched_at均保持2026-11-05T10:03:13.002Z；retrieved_at分别更新；没有再次请求上游 |
| 563360 11月3–5日15分钟，腾讯已有成功缓存 | 20+20+8完整读取；三页均not_attempted，upstream_refresh_attempted=false，degraded=false；来源始终腾讯 |
| 腾讯缓存原时间 | 三页均保留2026-11-05T09:58:11.564Z，读取已在约6分钟后，未因普通短TTL重新刷新主源 |
| 正常完整缓存读取 | 563360三日5分钟144根，cache_hit=true，not_attempted，无刷新错误；此时选择后来成功保存的东方财富周缓存 |
| 主源实际失败且已有数据 | 600519日K/5分钟：非空缓存available、degraded=true、refresh=failed，原成功时间保留 |
| 两源都失败 | 510300日K首次主源520、腾讯WAF501：count=0、available=false、quality=unavailable，保留双源原因 |
| 备用数据新取成功 | 主源失败独立保留primary_refresh_error；腾讯本次新取时overall succeeded、degraded=false；字段缺失另标partial |
| 非法证券代码sh999999 | 真正参数错误INVALID_ARGUMENT，未访问上游 |
| 10月1–7日休市区间 | 0条、NO_TRADING_SESSIONS、not_attempted；不猜停牌，不补造K线 |
| 10月1–9日1分钟旧区间 | 主源520；腾讯明确记录实际近期窗口，范围内0条，HISTORY_RANGE_UNAVAILABLE；整体unavailable，不拿近期数据冒充 |

WAF501响应正文是指向waf.tencent.com的HTML跳转。只用于诊断，不执行脚本、不绕过校验。510300日K及600519 qfq各在一次额外复测后取得真实记录；563360 hfq仍失败。没有把有限重试的成功宣称为供应商稳定性保证。

所有返回页均通过：count与bars.length一致、available与count>0一致；OHLC约束、量额非负或明确null、时间升序唯一、上海时间与Unix timestamp对应、每根来源与响应一致、已完成K线的结束时间不晚于原fetched_at。两个分页序列均无重复或交叠。缓存只读、数据刷新、质量和字段完整性分别表达。

## 单位、时间与旧工具回归

腾讯价格人民币元、volume为手；四只ETF及600519日K的未复权close分别为1.133、4.195、8.514、0.973、1452，与同次线上get_security_quotes一致。ETF日成交量也与报价volume_lots核对。腾讯逐根成交额缺失返回null，**没有借报价总成交额或另一供应商逐根数据填入**；各周期不强行凑成同一量额。

时间继续使用Asia/Shanghai市场时间；日timestamp是当地日期零点键，分钟timestamp是结束标签；source_datetime保留原始紧凑分钟字符串。fetched_at为成功取数时间，retrieved_at为本次读取时间。当前测试发生于收盘后；未完成K线和未知日历的状态由确定性回归覆盖，未为测试改变生产时钟或伪造实时K线。

原生MCP get_market_catalog确认Schema1.5及腾讯备用与缺失amount规则。get_market_snapshot强制刷新13/13报价可读取、degraded=0、stale=0、unavailable=0；五只证券及上证指数报价正常。ETF五档均为五买五卖；上证指数order_book=null、order_book_status=unsupported。没有改报价工具单位或语义。

## 测试、提交及部署

- npm test：通过，证券历史84个场景、既有全球历史56个场景及原行情/协议/GBK/时间/缓存回归。
- npm run test:cache：通过，实际SQLite缓存验证。
- npm run typecheck：通过。
- 生产构建：通过，现有私有Sites版本11发布状态succeeded，MCP启用。
- 隔离故障测试：仅模拟主源520、实际读取腾讯，日/1/5/15分钟取得真实记录；模拟错误绝不作为生产根因证据。另有确定性双源失败、少记录替换保护、缓存TTL/丢失游标、复权拒绝和HTTP正文/状态测试。
- 本报告的30项矩阵、8项复权、两组分页和特殊场景均为部署后真实ChatGPT原生MCP调用；没有生产主源破坏性注入。
- 公开功能提交：[6da68c2](https://github.com/hao0527/market-observatory-mcp/commit/6da68c26a044e957d7e03264af5bd7ce31c0e203)。部署使用与此功能一致的现有站点私有源；公开版保持去身份模板，可按WORK_DEPLOY.md在自己的账号复现。
- 公开源分发检查：通过（154个文件）；不提交生产数据库、逐根采集结果、访问凭据或私有站点身份。

## 尚未解决与后续边界

1. 东方财富520/超时为间歇性真实故障，确切根因未完全定位；腾讯也可能被WAF501拦截。保留失败与有限重试，不能承诺全部available。
2. 备用amount缺失，返回partial；不估算，也不跨源补字段。
3. ETF qfq/hfq没有本轮可验证成功路径；部分股票复权及分钟复权也受故障/供应商能力限制；具体结果以上表为准。
4. 1分钟只有本次观察到的近期窗口，不是任意历史归档；普通分钟及日K范围也须按每次coverage读取。
5. 复权因子版本和历史当时版本未取得，不提供point-in-time复权数据；不把供应商version当作因子证明。
6. 2026年以外日历、停牌、上市边界和临时休市仍保留不确定性；本轮没有扩展日历或新证券类型的验收范围。

本轮没有发现必须重新设计数据层的架构问题。是否选用有稳定服务承诺、完整成交额及可追溯复权因子的授权源，是后续供应商选择问题；当前不为追求成功率扩大业务架构。

