# 同源窗口恢复、复权与缓存验收（服务1.5.2）

2026-11-05，北京时间。Schema保持1.5，服务1.5.2已部署至现有所有者私有站点，Sites版本13，发布状态succeeded。主体17项原生MCP验收对应版本12；版本13仅修正复权抓取跨日的可重试标记，另作最终版本回归。下表与开发环境、上一轮结果分开记录。

## 本轮处理范围

继续处理1.5.1留下的ETF复权和数据源间歇故障，不增加证券、指标、技术指标或投资逻辑。原工具、D1结构、Secrets及访问范围保持原样。

东方财富按原日期区间请求时存在520/超时；实际开发端探测发现同一接口使用beg=0的保留窗口有时能取得真实记录，包含ETF的复权价格和成交额。它是同一供应商的另一次请求，不是新供应商，也不是“把不复权数据当复权”。

**根因仍未完全定位**。不能仅由“区间失败、窗口成功”断言日期参数错误，或把Cloudflare 520全部归因于超时。腾讯WAF501也仍可能出现。本轮只增加有界恢复和清楚的证据，不声称所有供应商故障已解决。

## 修改与兼容

| 位置 | 核心变化 |
| --- | --- |
| [lib/security-history.ts](../lib/security-history.ts)的requestUrl/getBlock | 原区间发生可重试故障时，最多再用beg=0请求同源窗口；保持secid、klt、fqt、end不变，随后严格筛选用户范围 |
| 同文件readSecurityHistory | source_requests新增fetch_strategy、fetch_attempt_metadata，保留成功取数过程中的原错误、实际URL和时间；旧缓存缺少证据时为null，不虚构 |
| [lib/upstream.ts](../lib/upstream.ts)的DataIssue | 增加结构化request_attempts；两次失败保留原区间错误及两次实际尝试，有限窗口无数据不能证明原接口不支持 |
| [lib/quote-cache.ts](../lib/quote-cache.ts) | 较少记录的刷新被拒绝替换时，仍保留新请求证据；有效旧缓存质量不受上游失败覆盖 |
| [app/mcp/route.ts](../app/mcp/route.ts) | 服务版本1.5.2、工具说明和Catalog中的range_retry策略 |
| [scripts/security-history-cases.mjs](../scripts/security-history-cases.mjs) | 增加13个回归场景，合计97个证券历史场景 |
| [scripts/test-security-history-recovery-live.mjs](../scripts/test-security-history-recovery-live.mjs) | 真实源验证器，可明确模拟原区间故障，但不模拟任何有效K线 |
| package.json、README.md、CHANGELOG.md、[SECURITY_HISTORY.md](SECURITY_HISTORY.md) | 版本、读取策略、证据语义和可复现说明 |

每段最多两个东方财富请求、每个6.5秒；腾讯备用每次4.5秒、最多两次。401/403/429不会触发东方财富窗口重试；不绕过认证、限流或WAF验证。最多两段并发。请求行数上界10000，响应超出则拒绝保存。

复权抓取跨日时保持ADJUSTMENT_EPOCH_CHANGED的retryable=true，允许调用方整体重试；同一旧基准内不自动请求窗口，也不跨读取日拼接。

证券、周期、复权或提供方不混拼，换源仍整段替换。窗口的有效记录如果只覆盖部分日期，返回partial；不补造、不改用其他周期。缓存键沿用原结构，无D1迁移。复权因子版本仍未知，factor_version=null、point_in_time_supported=false，不声称能还原历史当时可见的复权版本。

## 真实Worker主体验收（版本12）

日K请求2026-10-01至11月5日；分钟请求11月3日至5日。均refresh=true、limit=500、include_raw=false。日K排定应有21根；三个交易日5/15/30/60分钟分别应有144/48/24/12根。

**17项中：12项为本次真实上游新取，1项为有效缓存降级，4项仍unavailable。** 其中4项真实走通“原区间520 → 同源窗口成功 → 解析并筛选 → 返回非空记录”的新路径，没有向生产注入故障。

| 证券 | 周期 | adjust | 根数 | 来源/尝试源 | quality | 交付 | 本次刷新 | 成功请求策略 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| sh563360 | 1d | none | 21 | 腾讯证券历史 | partial | 本次上游 | succeeded | requested_range |
| sh563360 | 1d | qfq | 0 | 腾讯证券历史 | unavailable | 本次上游 | failed | — |
| sh563360 | 1d | hfq | 0 | 腾讯证券历史 | unavailable | 本次上游 | failed | — |
| sh563360 | 1m | none | 240 | 东方财富 | partial | 本次上游 | succeeded | provider_window |
| sh563360 | 5m | none | 144 | 东方财富 | available | 本次上游 | succeeded | requested_range |
| sh563360 | 5m | qfq | 144 | 东方财富 | available | 本次上游 | succeeded | requested_range |
| sh563360 | 5m | hfq | 0 | 腾讯证券历史 | unavailable | 本次上游 | failed | — |
| sh563360 | 15m | none | 48 | 腾讯证券历史 | partial | 本次上游 | succeeded | requested_range |
| sh563360 | 15m | qfq | 48 | 东方财富 | available | 本次上游 | succeeded | provider_window |
| sh563360 | 15m | hfq | 0 | 腾讯证券历史 | unavailable | 本次上游 | failed | — |
| sh563360 | 30m | none | 24 | 腾讯证券历史 | partial | 本次上游 | succeeded | requested_range |
| sh563360 | 60m | none | 12 | 东方财富 | available | 本次上游 | succeeded | provider_window |
| sz159842 | 1d | qfq | 21 | 东方财富 | available | 本次上游 | succeeded | requested_range |
| sh600519 | 1d | qfq | 21 | 东方财富 | available | 本次上游 | succeeded | provider_window |
| sh600519 | 1d | hfq | 21 | 东方财富 | available | 本次上游 | succeeded | requested_range |
| sh600519 | 5m | qfq | 144 | 东方财富 | available | 缓存 | failed | — |
| sh600519 | 5m | hfq | 144 | 东方财富 | available | 本次上游 | succeeded | requested_range |

四次线上窗口恢复：

- 600519前复权日K：21根，实际10月8日至11月5日，available。此前腾讯样本只到11月4日，本次取得东方财富自身完整日线，没有追加最新报价补齐。
- 563360前复权15分钟：48根，三个交易日完整覆盖，available，逐根成交额来自东方财富原字段。
- 563360不复权60分钟：12根，三个交易日完整覆盖，available。
- 563360不复权1分钟：240根，只覆盖11月5日09:31–15:00，原请求三个交易日预计720根、缺480根，partial。窗口恢复成功不等于整个请求范围完整。

仍失败的四项：563360日K qfq/hfq、5分钟hfq、15分钟hfq。东方财富两次请求均返回520；腾讯未返回可核实的对应复权序列，结构化保留UNVERIFIED_ADJUSTMENT。最终为unavailable，不把普通day数组冒充复权，也不把一次网络故障判为周期不支持。

563360前复权5分钟和159842前复权日K本次也成功，但成功策略是requested_range，**不把它们算作窗口恢复成功**。600519前复权5分钟本次刷新失败，交付144根已有完整缓存，quality=available、cache_hit=true、degraded=true、history_refresh_status=failed；没有当成新取成功。

腾讯交付的563360不复权日K/15分钟/30分钟有记录且请求日期覆盖完整，但缺少逐根成交额，amount=null、quality=partial。没有用东方财富成交额或收盘价乘成交量填入。

1分钟的实际保留范围随来源不同：上一轮腾讯读到11月4日13:42以后319根；本轮主源读到11月5日240根。主源有有效记录即按其真实范围交付，不为凑更大数量跨源拼接，也不承诺固定保留天数。

## 缓存、分页和不变量

563360前复权15分钟用refresh=false完整读取20+20+8=48根：

- 三页均cache_hit=true、history_refresh_status=not_attempted、upstream_refresh_attempted=false、degraded=false，history_refresh_error=null。
- 原fetched_at均保持2026-11-05T13:28:24.608Z，retrieved_at各自更新。
- fetch_strategy仍为provider_window，fetch_attempt_metadata保留原抓取中的520和后续成功。这是原成功抓取的证据，**不能把其中的历史失败误读成本次刷新失败**。
- 页面来源始终东方财富，时间升序、唯一、无交叠，未因15秒普通TTL重新请求供应商。

当前未核实的1分钟qfq继续正常返回unsupported、count=0、UNVERIFIED_ADJUSTMENT、not_attempted，外层isError=false；没有包装成INVALID_ARGUMENT。

全部非空返回检查：count=bars.length、available等价于count>0；无数据时不标available；OHLC约束、成交量非负、成交额为非负数或明确null；时间唯一升序且严格在请求日期内；每根来源与整体来源一致；is_final=true的结束时间不晚于原成功fetched_at。未完成缓存不会随读取时间自动成为最终K线。

正常缓存、实际刷新失败、部分覆盖和原抓取历史错误分别表达。少记录不能覆盖完整缓存，拒绝替换仍保留两次新请求证据。未知日历、午休、未完成K线、游标缓存失效和不同复权缓存隔离沿用原有逻辑并通过回归。

## 开发端真实集成测试

此处与上述真实Worker验收分开：隔离脚本只把原区间请求替换为明确的ISOLATED_RANGE_FAILURE错误，窗口及备用请求全部访问真实供应商，**没有模拟有效记录，也未破坏生产主源**。

初次4.5秒预算未成功验证窗口；单独真实请求曾测得响应头约6.263秒、完整响应约6.384秒，证明该预算会提前中止至少部分可用响应。恢复东方财富6.5秒后，下列6项中4项通过真实同源窗口恢复；另外两项仍失败。

| 证券 | 周期 | adjust | 根数 | 交付来源 | quality | 窗口验收 |
| --- | --- | --- | --- | --- | --- | --- |
| sh563360 | 1d | qfq | 0 | 腾讯证券历史 | unavailable | 未验证成功 |
| sh563360 | 1d | hfq | 0 | 腾讯证券历史 | unavailable | 未验证成功 |
| sz159842 | 1d | qfq | 21 | 东方财富 | available | 真实窗口成功 |
| sh563360 | 5m | qfq | 144 | 东方财富 | available | 真实窗口成功 |
| sh563360 | 15m | hfq | 48 | 东方财富 | available | 真实窗口成功 |
| sh600519 | 1d | hfq | 21 | 东方财富 | available | 真实窗口成功 |

可复现：

```bash
npm test
npm run typecheck
npm run test:cache
# 默认：全部请求真实；结果逐项报告，不以脚本退出成功冒充行情全部可用
node scripts/test-security-history-recovery-live.mjs
# 隔离：仅原区间错误为明确模拟，所有有效K线必须来自真实上游
SECURITY_RECOVERY_ISOLATED=1 node scripts/test-security-history-recovery-live.mjs
```

测试默认日期固定为本轮2026-10-01至11月5日，可用SECURITY_HISTORY_END配置结束日。未来重放时，分钟保留窗口可能已变化；不能要求为通过测试而伪造旧分钟数据。隔离模式没有任何真实窗口成功时会退出2，并标NOT VERIFIED。

## 旧工具、测试与发布

- TypeScript检查通过；npm test通过，97个证券历史场景、原56个全球历史契约场景及既有行情/GBK/协议/时间/缓存回归均通过。
- SQLite缓存测试通过；生产构建及归档通过。
- 部署后原生get_market_catalog返回Schema1.5及新的range_retry定义。
- 全球快照强制刷新13/13可读取，degraded=0、stale=0、unavailable=0。VIX/VXN和美债日期11月4日，亚洲与商品按各自真实口径和日期返回，不称所有数据为盘中实时。
- 563360、159842报价正常，五买五卖；上证指数order_book=null、不支持盘口。563360日Kclose=1.133与同次最新报价一致。
- 现有私有站点Sites版本13发布状态succeeded，MCP已启用；访问范围、Secrets、D1绑定未改变。
- 功能提交：[7510efb](https://github.com/hao0527/market-observatory-mcp/commit/7510efb11017a57f169edb0fd35688b8a2f3bb58)；跨日兼容修正：[8b0ac32](https://github.com/hao0527/market-observatory-mcp/commit/8b0ac325fc04492bd9ed78054612b973431df0ed)。
- 公开模板继续可按[WORK_DEPLOY.md](WORK_DEPLOY.md)由其他Work账号复现；没有提交运行数据库、逐根采集结果或访问凭据。

## 最终版本13原生MCP回归

部署状态succeeded后，线上Catalog确认no_window_retry_error_codes包含ADJUSTMENT_EPOCH_CHANGED。

| 查询 | 结果 |
| --- | --- |
| 600519前复权日K，refresh=true | 东方财富原区间本次新取21根，available、degraded=false、succeeded，最新日期11月5日 |
| 563360前复权15分钟，refresh=false | 原窗口成功缓存48根，available、degraded=false、not_attempted；保留原fetched_at=2026-11-05T13:28:24.608Z |
| 全球快照强制刷新 | 13/13，degraded=0、stale=0、unavailable=0 |
| ETF及指数盘口 | 563360五买五卖；上证指数null/unsupported |

最终包的功能源文件与公开仓库逐文件校验一致。跨日情形由受控时钟的第97项测试验证，未改变生产时钟制造验收结果。公开源码检查通过（156个文件）。

## 尚未解决

1. 563360的上述四项复权请求仍未成功；不能宣称ETF复权已全部修复。成功与失败均按本轮表格说明。
2. 520/超时及腾讯WAF501的确切根因未完全定位；新请求策略改善可读取性，不构成稳定服务保证。
3. 腾讯逐根成交额缺失、1分钟历史范围有限、因子版本与历史当时复权口径不可核实，这些限制仍保留。
4. 非2026日历、停牌、上市边界和临时休市仍不推测；本轮没有扩大业务或日历覆盖。

当前没有需要更换数据层架构的问题。本轮修改局限于读取恢复、证据和必要回归；后续只有出现实质性数据错误时再改动。

