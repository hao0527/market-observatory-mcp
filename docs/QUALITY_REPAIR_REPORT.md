# 市场数据 MCP 第二轮质量修复报告

验收窗口：2026/11/5 14:12:40 至 2026/11/5 14:13:06，Asia/Shanghai。schema 1.4，Sites 保存版本 8，生产部署成功。部署源提交：fba9521de0fafc4ecbb86a62b8bb24f2187fb08c。资产仍为 13 项，没有新增分析、预测或买卖逻辑。

## 1. 修改文件与职责

| 文件 | 对应功能 |
| --- | --- |
| lib/history.ts（新增） | 历史能力、结果、质量、不变量及故障缓存的统一生成位置；历史获取不改写报价。 |
| lib/freshness.ts | 独立历史交易日 / 完整收盘日 / bar_status；各市场时区、午休、提前收盘、未知日历及供应商暂停状态。 |
| lib/index-sources.ts | 核实 KS11 参数；NAVER 日韩历史备用与身份校验；FRED 四序列、真实错误源和完整失败链。 |
| lib/time-metadata.ts | market_timezone / timestamp_timezone / report_timezone；保留 source_timezone；quote_quality 别名。 |
| lib/market.ts | Catalog 布伦特中性描述；快照 / 历史共用语义；黄金结构化 unsupported。 |
| lib/upstream.ts | 错误补充 source / causes，保留 HTTP 状态和可重试属性。 |
| app/mcp/route.ts、app/api/history/route.ts | 新版工具说明、Catalog 契约；黄金旧错误标记和 HTTP 状态兼容。 |
| lib/tencent.ts | schema 与 quote_quality / 时区字段一致；原盘口规则不变。 |
| app/page.tsx | 展示独立历史质量、完整日线日期与四类时区含义。 |
| scripts/history-quality-cases.mjs（新增）、scripts/test-market-data.mjs | 单元、MCP/HTTP 集成、故障缓存、区域时间和备用路径验证。 |
| docs/HISTORY_CONTRACT.md 等 | 兼容性、复现验收及当前限制。 |

## 2. 修复前后

| 问题 | 修复前 | 修复后 |
| --- | --- | --- |
| 历史能力 | history_supported 随请求成功变化，快照与历史不一致 | 报价源能力、独立能力分别声明；旧字段固定为能力别名。 |
| 空历史 | 配置了路径也可能 available=true | available 严格等于 count>0；空数组 / 全部失败无缓存为 false。 |
| 历史质量 | 同源历史继承报价 quality，独立历史只嵌套标 stale | quote_quality / history_quality 独立，quality 保留报价兼容语义；顶层和嵌套历史质量一致。 |
| KOSPI 520 | 难区分无历史 / 可调用路径，失败链不完整 | KS11 同参数直接返回有效记录并与 NAVER 完成日收盘交叉核对；520 保留为上游/请求路径失败，不推断成映射错误；NAVER 经校验后备用。 |
| 日经日期 | expected_date 含义模糊 | 最近交易日、应有完整收盘日、bar_status 分开；旧 expected_date 明确为完整收盘日别名。 |
| 韩国日历 | 可能让供应商成功响应掩盖未知日历 | Asia/Seoul；没有完整覆盖或明确供应商时段时 unknown，calendar_verified=false。 |
| 时区 | 来源时区和交易市场时区易混淆 | 明确市场、时间戳、报告时区，原来源时区不被替换。 |
| 布伦特 Catalog | 名称只强调期货 | 中性参考报价，说明 BZ=F 连续期货 / 新浪 CFD 边界；CFD 历史 unsupported，零拼接。 |
| FRED | 备用路径是否实际调用难确认 | 四条模拟主源故障路由通过；真实失败有 source / URL / HTTP / causes，未伪称下载成功。 |

兼容性细节：黄金保留 MCP isError=true 和 HTTP 400，但正文补齐完整 unsupported 契约。平台的 MCP 错误包装可能在 structuredContent 只给通用错误码；验收读取 content 中的业务 JSON，确认 unsupported / count=0 / available=false。未请求报价的黄金历史响应 quote_quality=null，不用未知报价质量代替历史质量。

## 3. 单元与集成测试

- npm test：通过。36 组历史契约不变量场景，以及原有解析、单位、GB18030、涨跌、有限重试、证券部分失败、缓存、时间、MCP 协议回归。
- npm run typecheck：通过。
- npm run test:cache：通过；真实 SQLite 迁移、有序覆盖和有界过期清理。
- Sites 生产构建：通过。
- 公开源码检查及 git diff --check：通过。
- 所有线上快照及 13 个历史正文均检查 count/available、能力别名、报价质量别名、历史质量别名；未发现违例。
- 确定性覆盖：KOSPI 所有源 HTTP 520 时 count=0 / available=false / unavailable；黄金 unsupported；CFD 不混入期货；报价失败但独立历史成功；旧历史不改最新报价涨跌。
- 交易时点覆盖：日本形成中 / 午休 / 收盘前缓存跨过收盘 / 黄金周 / 周末；美国提前收盘与原有 DST；韩国不套用日本节日或美国日历；已明确暂停返回 unknown；年份覆盖外 unknown。
- 黄金 HTTP 400 和 MCP 旧错误标记通过集成测试；正文仍提供新字段。

## 4. 13 项快照线上验收

13/13 报价可读取，degraded=0、stale=0、unavailable=0。逐项 D1 cache_backend=durable；默认没有附带历史数组。最终版本8重新刷新13项并逐一调用13个历史接口，所有不变量检查均通过；无记录时间精度为 unknown，unsupported 的 frequency=null。

| 指标 | quote_quality | 报价市场日期 | 报价来源 | market_timezone |
| --- | --- | --- | --- | --- |
| VIX (vix) | available | 2026-11-04 | Cboe | America/New_York |
| VXN (vxn) | available | 2026-11-04 | Cboe | America/New_York |
| 美债 2 年期 (us2y) | available | 2026-11-04 | U.S. Treasury | America/New_York |
| 美债 10 年期 (us10y) | available | 2026-11-04 | U.S. Treasury | America/New_York |
| 美债 30 年期 (us30y) | available | 2026-11-04 | U.S. Treasury | America/New_York |
| 现货黄金（伦敦金 CFD） (gold) | available | 2026-11-05 | 新浪财经 / 汇通网 | 未核实/非单一市场 |
| 布伦特原油（CFD备用报价） (brent) | available | 2026-11-05 | 新浪财经 | 未核实/非单一市场 |
| 标普 500 (sp500) | available | 2026-11-04 | 新浪财经 | America/New_York |
| 纳斯达克综合 (nasdaq) | available | 2026-11-04 | 新浪财经 | America/New_York |
| 道琼斯 (dow) | available | 2026-11-04 | 新浪财经 | America/New_York |
| 费城半导体 (sox) | available | 2026-11-04 | 新浪财经 | America/New_York |
| 日经 225 (nikkei225) | available | 2026-11-05 | NAVER Finance | Asia/Tokyo |
| 韩国 KOSPI (kospi) | available | 2026-11-05 | NAVER Finance | Asia/Seoul |

例如美股新浪来源时区仍是 Asia/Shanghai，市场时区为 America/New_York，ISO 时间戳为 UTC，报告显示时区为 Asia/Shanghai。只有日期的官方日终值继续 as_of=null。

精简快照中，美股及日韩未请求的独立历史为 count=0 / available=false / not_requested，同时能力仍为 true；不是一次历史失败，也不代表已经取得记录。同源报价已取得历史时可 count>0，数组由 history_included=false 说明被省略。

## 5. 历史接口逐项线上验收

| id | quote_quality | history_quality | history_count | history_available | 历史来源 | 历史市场日期 | 故障缓存 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| vix | available | available | 22 | true | Cboe | 2026-11-04 | 否 |
| vxn | available | available | 22 | true | Cboe | 2026-11-04 | 否 |
| us2y | available | available | 22 | true | U.S. Treasury | 2026-11-04 | 否 |
| us10y | available | available | 22 | true | U.S. Treasury | 2026-11-04 | 否 |
| us30y | available | available | 22 | true | U.S. Treasury | 2026-11-04 | 否 |
| gold | 未请求 | unsupported | 0 | false | — | — | 否 |
| brent | available | unsupported | 0 | false | — | — | 否 |
| sp500 | available | unavailable | 22 | true | 东方财富 | 2026-11-04 | 是 |
| nasdaq | available | stale | 22 | true | Nasdaq | 2026-11-03 | 否 |
| dow | available | unavailable | 22 | true | 东方财富 | 2026-11-04 | 是 |
| sox | available | stale | 22 | true | Nasdaq | 2026-11-03 | 否 |
| nikkei225 | available | available | 22 | true | NAVER Finance | 2026-11-04 | 否 |
| kospi | available | forming | 22 | true | NAVER Finance | 2026-11-05 | 否 |

- 纳斯达克 / SOX 最新报价日期为 11月4日，历史只到 11月3日，保持 stale，不借用报价拼出新的历史。
- 日经在版本7验收时，东方财富提供11月5日条目，正确标 forming。最终版本8验收时，NAVER只提供至11月4日的完整日线，正确标 available / completed；latest_session_date仍为11月5日，expected_last_completed_date仍为11月4日。不拿当日最新报价填补历史。
- KOSPI 最终通过 NAVER 备用取得22条记录，含11月5日当日值；依据该供应商明确 OPEN 状态标 forming，latest_session_date=11月5日，完整前一交易日仍为 null、calendar_verified=false。此前东方财富报价没有明确时段证据时返回 unknown，同样保留了不确定性。本地模拟全源520的无记录情况另有覆盖。
- 标普 / 道指本次东方财富和 FRED 请求链均遇到 HTTP 520，保留了 11月4日的 22 条有效 D1 缓存。available=true 只表示确有记录；history_quality=unavailable、degraded=true、原 fetched_at 和结构化错误共同说明刷新失败。没有把缓存当作新的成功读取。
- 黄金与当前布伦特 CFD 均为 unsupported / 0 / false；布伦特报价仍保留 instrument_changed 和不同品种来源切换说明。

盘口验收：

| 证券 | quote_quality | order_book_supported | 盘口 |
| --- | --- | --- | --- |
| sh000001 | available | false | null |
| sz159842 | available | true | 5 买档 / 5 卖档 |
| sh518850 | available | true | 5 买档 / 5 卖档 |

## 6. FRED 实际验证

| 备用序列 | 指标映射 | 频率 / 单位 | 本轮真实 CSV 请求 |
| --- | --- | --- | --- |
| SP500 | 标普 500 价格指数 | 日度收盘 / 指数点 | 本地 503；线上标普失败链观察到 520。 |
| DJIA | 道琼斯工业平均价格指数 | 日度收盘 / 指数点 | 本地 503；线上道指失败链观察到 520。 |
| NASDAQCOM | 纳斯达克综合，非 Nasdaq 100 | 日度收盘 / 指数点，1971-02-05=100 基值 | 本地 503；本轮线上由 Nasdaq 主历史源返回记录。 |
| NASDAQSOX | SOX 价格指数，非总回报指数 | 日度 / 指数点 | 本地 503；本轮线上由 Nasdaq 主历史源返回记录。 |

官方系列元数据已逐项核对：

- https://fred.stlouisfed.org/series/SP500
- https://fred.stlouisfed.org/series/DJIA
- https://fred.stlouisfed.org/series/NASDAQCOM
- https://fred.stlouisfed.org/series/NASDAQSOX

四项分别在本地模拟主历史源失败后，真实执行 FRED 路由和受控 CSV 解析，验证相应序列头、缺失值、日期、stale 及完整错误链。真实备用访问测试只拦截本地的主源请求，生产主源没有被改动或破坏。

结论：逻辑路径和序列匹配已验证；本轮未取得成功的真实 FRED CSV 下载，不能宣称 FRED 当前在线可用。保留它作为已实现、可明确失败的备用路径，不用网页观测值伪造 CSV 历史。发布滞后按历史自身日期标 stale。

本地真实 NAVER 备用测试：KOSPI 经备用路径返回 22 条记录，标 forming；日本备用当次超时，已保留错误。最终生产验收中日经 NAVER 备用已真实返回22条截至11月4日的完整日线；KOSPI NAVER 备用也已真实返回22条记录。源仍可能超时，不能据一次成功承诺稳定性。

## 7. 未解决的外部限制与架构判断

- FRED CSV 真实下载及部分东方财富生产请求可用性不稳定；同参数直接请求成功不等于已定位生产 520 的根因。
- 韩国完整年度休市及特别时段尚未核实。保留 unknown / null / calendar_verified=false；供应商明确状态仅提供局部证据。
- 临时休市不能靠静态日历推断。已明确暂停或状态冲突返回 unknown；没有信息时明确 emergency_closures_verified=false。
- 各历史供应商可能延迟，源成功不等于当日完整收盘已更新。
- 没有必须留给更高推理模型的架构阻塞。当前实现保留简单的采集、校验、缓存与展示分层；独立复核交易时点和错误包装可作为后续审查。

## 8. Git 与部署

开始状态：公开仓库 main，817e2a13d9789805a1ecc66ec3932f48b903f4b4；线上 Sites 版本 6 / schema 1.3。

完成状态：部署源 fba9521de0fafc4ecbb86a62b8bb24f2187fb08c，Sites 保存版本 8，production succeeded、MCP ready、schema 1.4。公开仓库同步相同功能源码、契约文档和本报告；具体公开提交以本报告所属 Git 提交为准。

既有站点身份、受众、Secrets 和数据库 schema 未修改。
