# 服务1.5.3：ETF历史请求协议与真实MCP验收

2026-11-05，北京时间。Schema保持1.5，服务1.5.3已部署到原私有站点，Sites版本14，状态succeeded。线上结果由ChatGPT原生MCP实际调用取得，不把开发端成功、缓存交付或HTTP200当成本次新取成功。

## 本轮判断

上轮剩余四项563360复权查询。本轮修改前复测：后复权日K在1.5.2原代码下即成功新取21根，其他三项失败。因此不存在“只要失败就是周期不支持”的结论，也不能将后续成功全部归功于此次修改。

对照[AKShare原仓库的ETF历史实现](https://github.com/akfamily/akshare/blob/main/akshare/fund/fund_etf_em.py)，核查了东方财富公开历史客户端参数、日K字段、分钟保留窗口格式。直接请求东方财富端点实际取得前复权日K21根、后复权5分钟144根、后复权15分钟48根，检查了记录身份、字段和日期。旧请求在一次开发端对照中同样成功，**不足以断定某个参数是520的唯一根因，也没有证据保证更新后的总体成功率**。

本轮是对请求协议的兼容调整；没有新增源、证券、周期、投资指标或分析逻辑。仍按每次实际结果返回available、partial、缓存降级或unavailable。

## 修改文件与核心逻辑

| 文件 | 修改 |
| --- | --- |
| [lib/security-history.ts](../lib/security-history.ts) requestUrl | 使用公开历史客户端ut参数；日K额外请求f116；分钟备用窗口使用供应商20500000上界标记 |
| 同文件securityHistoryInfo | Catalog说明请求参考、客户端行数检查和分钟窗口标记 |
| [scripts/security-history-cases.mjs](../scripts/security-history-cases.mjs) | 新增协议参数、额外原始字段和历史截止日期过滤测试，证券历史合计99个场景 |
| [app/mcp/route.ts](../app/mcp/route.ts)、package.json | 服务版本1.5.3，Schema仍1.5，工具参数保持不变 |
| [SECURITY_HISTORY.md](SECURITY_HISTORY.md)、README.md、CHANGELOG.md | 当前请求协议、限制和版本说明 |

ut是公开客户端参数，不是个人账号凭据，不需要修改Secrets。额外字段保留在原始响应，不改动原11列OHLC/量额含义与单位。公开参考实现是请求格式依据，不是供应商可用性或复权因子正确性的背书。

分钟窗口的20500000仅为上游协议标记，不是行情日期。所有时间仍需通过实际日期与时段校验，记录按内部段及用户请求日期筛选，不用较新数据冒充旧区间。实际请求URL、observed_start/end和fetch_attempt_metadata可追溯源窗口。

不依赖lmt保证返回行数；响应超过10000行仍拒绝保存。每段最多两次同源请求、有限超时、401/403/429不做窗口重试、复权读取日隔离、较少记录不能覆盖完整缓存等规则不变。D1结构、原缓存键、Secrets、访问范围未改变。

## 线上逐项结果

日K范围：2026-10-01至11月5日；分钟范围：11月3日至5日。以下16项均refresh=true、limit=500、include_raw=false。

**7项本次新取、7项故障缓存、2项仍unavailable。** 无数据时“来源”只是尝试来源；不是成功取得历史的供应商。

| 证券 | 周期 | adjust | 根数 | 交付源/尝试源 | quality | 交付方式 | 本次刷新 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| sh563360 | 1d | qfq | 0 | 腾讯证券历史 | unavailable | 无记录 | failed |
| sh563360 | 1d | hfq | 21 | 东方财富 | available | 故障缓存 | failed |
| sh563360 | 5m | hfq | 0 | 腾讯证券历史 | unavailable | 无记录 | failed |
| sh563360 | 15m | hfq | 48 | 东方财富 | available | 本次新取 | succeeded |
| sh563360 | 1d | none | 21 | 腾讯证券历史 | partial | 本次新取 | succeeded |
| sh563360 | 1m | none | 240 | 东方财富 | partial | 故障缓存 | failed |
| sh563360 | 5m | none | 144 | 东方财富 | available | 故障缓存 | failed |
| sh563360 | 5m | qfq | 144 | 东方财富 | available | 本次新取 | succeeded |
| sh563360 | 15m | qfq | 48 | 东方财富 | available | 故障缓存 | failed |
| sh563360 | 30m | none | 24 | 腾讯证券历史 | partial | 本次新取 | succeeded |
| sh563360 | 60m | none | 12 | 东方财富 | available | 故障缓存 | failed |
| sh510300 | 1d | none | 21 | 腾讯证券历史 | partial | 本次新取 | succeeded |
| sz159842 | 1d | qfq | 21 | 东方财富 | available | 故障缓存 | failed |
| sh518850 | 1d | none | 21 | 腾讯证券历史 | partial | 本次新取 | succeeded |
| sh600519 | 1d | qfq | 21 | 东方财富 | available | 故障缓存 | failed |
| sh600519 | 1d | hfq | 21 | 东方财富 | available | 本次新取 | succeeded |

重点对比：

| 563360查询 | 本轮修改前，版本13 | 部署后，版本14 |
| --- | --- | --- |
| 日K qfq | 0根，unavailable | 0根，unavailable |
| 日K hfq | 21根本次新取 | 21根故障缓存，available、degraded=true、refresh=failed |
| 5分钟hfq | 0根，unavailable | 0根，unavailable |
| 15分钟hfq | 0根，unavailable | 48根本次新取，available、degraded=false、refresh=succeeded |

后复权日K在部署后没有成功刷新，fetched_at仍与修改前的成功抓取完全一致，未覆盖成本次时间。不能把21根缓存算成“新协议已成功读取日K”。

本轮仍失败的两项：

- 563360前复权日K：东方财富两次HTTP520，腾讯本次HTTP501。count=0、available=false、quality=unavailable，保留全部请求证据。
- 563360后复权5分钟：东方财富两次HTTP520，腾讯复权序列未核实，UNVERIFIED_ADJUSTMENT。最终unavailable，不用none或其他周期替代。

日K有效范围为10月8日至11月5日，共21个排定交易日。完整三日5/15/30/60分钟分别144/48/24/12根。1分钟此次交付240根已有东方财富缓存，仅11月5日09:31–15:00；相对三日范围不完整，quality=partial且degraded=true。本轮没有取得更长1分钟历史。

腾讯交付的日K/30分钟等记录仍缺逐根成交额，amount=null、quality=partial；不拼接东方财富成交额或估算补齐。其他缓存即便日期覆盖完整、quality=available，也独立保留degraded=true及本次刷新失败。

## 分页、范围和不变量验收

563360后复权15分钟用refresh=false读取：

- 三页20+20+8=48根，无重复、无交叠、升序，来源始终东方财富。
- 每页cache_hit=true、degraded=false、history_refresh_status=not_attempted、upstream_refresh_attempted=false。
- 原fetched_at均保持2026-11-05T14:13:00.491Z，retrieved_at按本次读取更新。
- 历史范围改为11月3–4日时返回32根，actual_end_datetime=2026-11-04 15:00；虽然源观察窗口到11月5日，较新记录没有出现在bars中。
- 确定性测试另以真实协议标记20500000返回包含请求结束日之后的模拟样本，验证严格过滤；该样本不作为线上真实记录。

所有线上返回检查：history_count=bars.length，history_available等价于count>0；unavailable时没有非空记录；时间与Asia/Shanghai规范化Unix秒一致、升序唯一、在用户日期内；OHLC约束、成交量非负、成交额非负或明确null；每根来源与响应一致。未补造缺失K线，未跨源或复权口径拼接。

## 开发端真实数据与隔离测试

与线上验收分开记录。直接上游对照中：

- 新客户端格式前复权日K21根，最新close=1.133。
- 新客户端分钟窗口后复权5分钟144根、后复权15分钟48根。
- 旧日K请求在一次对照中也取得21根，证明本轮不能认定“旧参数必错、新参数必成功”。
- 仅追加公共参数的部分请求仍超时；没有用这些失败推断证券或周期不支持。

另执行现有真实恢复脚本：只模拟原区间的明确失败，窗口及备用请求仍访问真实供应商，没有模拟有效K线，没有修改生产主源。结果如下：

| 证券 | 周期 | adjust | 根数 | 来源 | quality | 窗口验收 |
| --- | --- | --- | --- | --- | --- | --- |
| sh563360 | 1d | qfq | 0 | 腾讯证券历史 | unavailable | 未验证窗口成功 |
| sh563360 | 1d | hfq | 0 | 腾讯证券历史 | unavailable | 未验证窗口成功 |
| sz159842 | 1d | qfq | 21 | 东方财富 | available | 真实窗口恢复 |
| sh563360 | 5m | qfq | 144 | 东方财富 | available | 真实窗口恢复 |
| sh563360 | 15m | hfq | 48 | 东方财富 | available | 真实窗口恢复 |
| sh600519 | 1d | hfq | 21 | 东方财富 | available | 真实窗口恢复 |

隔离测试4/6完成真实窗口恢复；两项日K仍未验证成功，未写成通过。

## 测试与原工具回归

- npm test通过：99个证券历史场景、原56个全球历史契约场景及既有行情/GBK/时间/协议/缓存回归。
- npm run typecheck、npm run test:cache通过。
- 生产构建、源推送和归档通过。
- 线上Catalog确认Schema1.5及新的request_profile。
- 全球快照强制刷新13/13可读取，degraded=0、stale=0、unavailable=0；各自日期和时区保留，13项可读取不等于全部实时。
- 四只ETF、600519和上证指数报价均可读取；股票/ETF五买五卖，上证指数盘口null/unsupported。
- 未复权563360、510300、518850的日K最新close与同次最新报价一致；没有强制修改历史量额凑成报价汇总。
- 未修改原行情、宏观历史、日历、分析职责或数据库设计。

## Git、部署与未解决问题

功能提交：[d5b873b](https://github.com/hao0527/market-observatory-mcp/commit/d5b873b7225b04f8447ac3d0ed513e99e8f9858f)。原所有者私有站点Sites版本14、服务1.5.3已成功发布，MCP启用，站点权限与Secrets不变。

公开源码继续按[WORK_DEPLOY.md](WORK_DEPLOY.md)供其他Work账号复现；本报告不包含运行数据库、逐根采集结果、个人凭据或私有站点身份。

尚未解决：563360前复权日K、后复权5分钟本轮未取得数据；520/超时/WAF501仍间歇发生，确切根因未完全定位。腾讯成交额缺失、分钟保留范围有限、复权因子版本未知、point_in_time_supported=false等限制仍保留。旧缓存不能作为本次刷新成功的证据。

没有发现需要重新设计数据层的架构问题。本轮限定为请求协议兼容及必要验证；后续继续以实质性数据错误为修改依据。

