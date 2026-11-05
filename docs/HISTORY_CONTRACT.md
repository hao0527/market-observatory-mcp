# 历史数据契约 v1.4

本次仅修正数据质量、能力描述和接口语义。资产仍为 13 项；不添加预测、评分或交易建议。

## 兼容决策

保留原字段、工具名和参数。`quality` 始终是 `quote_quality` 的兼容别名，只描述报价；报价的 `market_date`、`as_of`、`fetched_at`、涨跌和昨收均不因历史源改变。不能用它判断历史状态。

旧 `history_supported` 原来混用了“支持路径”和“本次成功”。v1.4 固定为能力别名：

```text
history_supported = (quote_source_history_supported === true) || independent_history_supported
history_available = history_count > 0
```

因此上游失败时 `history_supported` 仍可为 true，但实际历史必须是 `history_available=false`、`history_count=0`、`history_quality=unavailable`。这项语义修正有意保留字段，调用方不应再用它代替成功状态。

| 字段 | 含义 |
| --- | --- |
| quote_source_history_supported | 本项目是否为当前报价供应商实现了同品种历史通道；可通过单独接口读取，不表示本次成功。没有可识别当前源时可为 null。 |
| independent_history_supported | 已配置并实现独立历史路径，不受本次成功 / 失败影响。独立路径可与报价来自同一供应商品牌。 |
| history_available | 本次实际取得有效非空记录，含明确标注的故障缓存。 |
| history_count | 验证后的记录数；0 必须对应 available=false。 |
| history_included | 是否在返回中附带 history 数组。精简快照可省略已随报价取得的数组，但保留其真实记录数及质量。 |
| history_requested | 是否显式请求历史；报价响应顺带取得历史时可为 false。 |
| history_quality | 独立历史状态，见下表。 |
| history_error | 结构化错误：code、message、retryable、source、source_url、可得的 http_status、causes。 |

## 历史状态

| history_quality | 含义 |
| --- | --- |
| available | 有有效记录且最新完整日线日期符合要求。 |
| stale | 有记录但落后于应有完整交易日，或缓存的当日值采集于收盘前。 |
| unavailable | 本次历史请求失败或没有有效记录；如仍交付故障缓存，会另标 degraded=true。 |
| unsupported | 当前品种没有可比的历史实现；例如黄金当前来源及新浪布伦特 CFD。 |
| forming | 本交易日的最新日线仍在形成，午休也不代表日线收盘。 |
| unknown | 有记录，但日历覆盖、特殊时段或完成状态未核实，不能称为已验证最新完整历史。 |
| not_requested | 未请求独立历史，报价响应也未取得记录。 |

如果请求失败但仍有有效故障缓存，`history_available=true` 仅说明有可读记录。`history_error` 和 `history_metadata.degraded=true` 必须保留；旧记录按日期标 stale，日期仍匹配但刷新失败时标 unavailable。成功读取时间不能改成本次交付时间。

历史独立提供 `history_metadata.{source,source_url,series,market_date,as_of,source_timezone,market_timezone,timestamp_timezone,report_timezone,fetched_at,retrieved_at,quality,stale,freshness}`；顶层 `history_source`、`history_market_date`、`history_fetched_at`、`history_retrieved_at`、`history_freshness` 是便捷字段。历史只有日期时 `as_of=null`；没有记录时 time_precision=unknown，unsupported 的 frequency=null，不为不存在的数据宣称时间精度或频率。

未请求报价的黄金历史响应明确 quote_requested=false、quote_quality=null、quality=null。黄金保持旧 MCP `isError=true` 和 HTTP 400 行为，并在错误正文中补全 unsupported / count=0 / available=false 状态。其他正常返回的历史状态也必须检查 history_quality。

## 交易日与日线完成状态

- `latest_session_date`：已开始的最近交易日，不等于最后一个完整收盘日。
- `expected_last_completed_date`：按市场当地日历和收盘边界应有的完整日线日期。
- `bar_status`：forming / completed / unknown / none / unsupported，描述最新返回日线。
- 历史 `freshness.expected_date` 为 `expected_last_completed_date` 的兼容别名，附 `expected_date_semantics` 明示含义。
- 日经在 2026-11-05 北京时间 13:24（东京 14:24）仍交易时：latest_session_date=11-05、expected_last_completed_date=11-04、当日条目 bar_status=forming，历史质量为 forming，而非 stale。
- 日本使用 Asia/Tokyo、JPX 2026–2027 现金市场日历及午休；美国使用 America/New_York、已核实的休市 / 提前收盘 / DST。美债沿用独立 SIFMA 日历和 18:30 应用检查线；已提前发布的官方当日日终值不会标为形成中的 K 线。
- 韩国使用 Asia/Seoul，保留 calendar_verified=false。不套用美 / 日休市日。只有明确供应商时段或近期 OPEN 状态支持的当日信息才能用于判断 forming；前一完整交易日无法核实则留空、返回 unknown。
- 静态日历只覆盖已排定安排，emergency_closures_verified=false。供应商报告暂停或与常规开市冲突时返回 unknown，不推测临时休市时长。
- 未核实商品合约交易 / 结算日历时返回 unknown，不套用 NYSE 日历。
- 收盘前采集的缓存不会因时钟越过收盘就被改称完整收盘数据。

## 来源与映射

| 指标 | 历史主源 | 历史备用 |
| --- | --- | --- |
| sp500 | 东方财富 100.SPX | FRED SP500 |
| dow | 东方财富 100.DJIA | FRED DJIA |
| nasdaq | Nasdaq COMP（综合指数） | FRED NASDAQCOM |
| sox | Nasdaq SOX（价格指数） | FRED NASDAQSOX |
| nikkei225 | 东方财富 100.N225 | NAVER .N225 |
| kospi | 东方财富 100.KS11 | NAVER KOSPI |
| vix / vxn | 随报价取得的同源历史 | Cboe 官方日终 CSV |
| us2y / us10y / us30y | 美国财政部官方日终 par yield | 无新增来源 |

同源报价已经带有有效日线时优先保留该段历史，不为凑到更新日期混拼另一来源。独立历史也不能用于填补另一供应商的昨收日期或补算报价日变化。

KOSPI `100.KS11` 的相同参数已在直接请求中核实 code=KS11、market=100、name=韩国KOSPI，并与 NAVER 已完成日收盘值交叉核对。HTTP 520 本身不能证明代码或参数错误；生产与直接请求可用性存在差异，记录为上游 / 请求路径失败，不伪称已定位其根因。

NAVER 备用历史先核验 basic 接口的指数身份及市场时区。日本历史行还必须是 .N225 / Asia/Tokyo；KOSPI 使用固定 KOSPI 路径、已验证的 basic 身份与已核实交叉收盘值。保留原始历史响应于故障缓存，默认不扩大发送原始字段。

## FRED 验证与限制

四个序列均是同一价格指数、指数点位、日频观测，不使用 Nasdaq 100、SOX 总回报、ETF 或其他品种代替。FRED 是转发源，发布可能滞后，不能因源权威而把旧日期标为最新。

官方元数据：
- https://fred.stlouisfed.org/series/SP500
- https://fred.stlouisfed.org/series/DJIA
- https://fred.stlouisfed.org/series/NASDAQCOM
- https://fred.stlouisfed.org/series/NASDAQSOX

回归测试对四项分别模拟历史主源失败，实际执行 FRED 路由及解析代码，核验序列头、缺失值、无效日期、未来日期、滞后状态及错误链。`LIVE_FALLBACKS=1 npm test` 只在本地拦截主源请求，继续真实访问备用源，不改变生产配置。

2026-11-05 本轮真实 CSV 请求四项均返回 HTTP 503。该结果表示当前下载不可用，不能声称 FRED 真实成功；接口保留结构化失败和重试属性。序列映射正确不等于每次下载可用，生产验收另见质量修复报告。

## 布伦特与盘口

Catalog 使用“布伦特原油参考报价”：主源 BZ=F 为近月连续期货，备用 hf_OIL 为 CFD，不是已验证的相同合约，且均不能冒充官方期货结算价。保留 instrument_changed / source_transition。CFD 历史明确 unsupported，不能接入期货历史。

指数盘口仍为 null / unsupported，ETF 仍返回正常五档；不修改成交价、成交量单位或原有证券代码规则。
