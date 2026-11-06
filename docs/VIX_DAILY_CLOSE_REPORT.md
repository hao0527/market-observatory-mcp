# VIX 已完成日线可靠性修复 · 服务 1.6.3 / Schema 1.5

## 结论与范围

问题需要修复：旧实现只在请求异常时切换；Cboe CSV HTTP 200 但未更新仍然不能提供最新交易日。旧值已正确标 stale，不能将 stale 标记删除。此次不新增指标、工具、数据库、Secrets 或调度任务，不改变证券 K 线/归档及其他资产计算。

## 根因证据

2026-11-06 北京时间上午的真实请求：Yahoo 有 HTTP 429、超时，也有短暂恢复；Cboe VIX CSV 最新日期为 2026-11-04，值16.61。加日期查询参数及no-cache后仍旧。其响应 Last-Modified 为2026-11-05 02:10:51 GMT；官方 historical chart同样止于11月4日。可以确认官方日线端点滞后，不能断言供应商内部发布链/CDN的具体故障根因。

Investing默认VIX页面是CFD（id44336），不能使用。公开非CFD CBOE指数页面 `https://www.investing.com/indices/volatility-s-p-500-historical-data?cid=1096487` 的结构化历史明确标记 index、isCfd=false、symbol=VIX、exchange=CBOE、Daily，含11月5日28.18、11月4日16.61。只适配该经验证身份；不依赖页面名称判断，不使用CFD或期货替代。

## 修改前后

| 问题 | 修复前 | 修复后 |
| --- | --- | --- |
| HTTP200但旧日线 | 接受Cboe文件后停止寻找 | 并行比较独立已完成日线，按最新日期选整段来源，同日期优先官方CSV |
| VIX备用源 | Yahoo/Cboe | 增加严格验证的非CFD CBOE指数转发日线；任何身份不符均拒绝 |
| 盘中与日终 | Yahoo最新报价可能进入宏观值 | 仅用daily bar的close；忽略regularMarketPrice；未收盘日线过滤 |
| 官方核验 | 无分离字段 | official_daily_file_confirmed与official_close_window_confirmed分开，后者不构成历史记录 |
| 前收/涨幅 | 隐含依赖最近两条 | 同一所选来源必须含精确前一交易日；缺失不跨源补前收 |
| 日期一致性 | VIX/VXN可能日期不同但无统一诊断 | snapshot.volatility_date_consistency明确aligned/date_mismatch等状态，不改写数值 |
| 缓存 | 旧盘中缓存可能用于新日终定义 | 独立版本键隔离；保留旧D1行；旧日期不能覆盖较新日线缓存 |
| 失败/冲突 | 普通主备错误 | source_attempts保留逐源日期/值/错误，冲突显式partial，缺最新日期仍stale |

常规VIX传播到16:15 America/New_York；非官方日线额外等待到16:30再接纳当日值。沿用已核实NYSE排定交易日历；特别提前收盘精确时刻未核实时返回unknown。Cboe收盘观测仅核验日期、收盘与前收，绝不拼入历史，也不标作官方daily CSV已经发布。带偏移的观测时刻保留原文并明确转换，只有日期的日线as_of仍为null。

## 文件与核心位置

| 文件 | 功能 |
| --- | --- |
| lib/volatility.ts | 身份/日线最终状态校验、独立备源、日期选择、跨源比较、官方观测核验、日期一致性 |
| lib/market.ts | VIX/VXN走完成日线适配器；版本隔离缓存；快照附日期一致性 |
| lib/history.ts | 保留同源整段及核验证据；历史按波动率收盘边界判断；保留采集时间 |
| app/mcp/route.ts | Catalog说明新增来源及确认语义；服务1.6.3，工具参数/数量不变 |
| scripts/volatility-cases.mjs | 94个确定性波动率场景 |
| scripts/test-market-data.mjs | 接入测试与LIVE_VOLATILITY真实上游验收 |
| package.json、README、CHANGELOG、docs/HISTORY_CONTRACT.md、docs/ARCHITECTURE.md | 版本和接口说明 |

## 本地测试

- npm run typecheck：通过。
- npm test：原56组宏观历史、99组证券历史、行情/MCP/缓存回归通过；新增94组波动率测试通过。
- npm run test:cache：实际缓存SQL迁移/有序写入通过；21组实际SQLite/生产D1 SQL归档/HTTP场景通过。
- 新增覆盖：旧日线HTTP200继续备源、429单次请求、错误CFD/证券/频率/日期/OHLC拒绝、盘中值隔离、收盘缓冲、冬夏令时/周末/节假日/未知日历、同日冲突、前收缺失、D1失败/重启/旧记录保护、VIX/VXN日期不一致、真实MCP适配层。
- node scripts/check-public-source.mjs、git diff --check：通过；生产构建与部署验收见下方状态。

## 真实上游测试（未模拟行情）

LIVE_VOLATILITY=1 npm test 在2026-11-06 01:47–01:50 UTC真实请求：

| 指标/渠道 | 真实结果 | 数据日期/质量 |
| --- | --- | --- |
| VIX非CFD独立日线 | 成功；28.18、前收16.61；22条 | 11/05；history available，未完成官方确认时quote partial |
| VIX Yahoo日线 | 首次超时，后续成功；28.18000030517578、前收16.610000610351562 | 11/05；与独立源差异在0.005点容差内，保留原始数值精度 |
| VIX Cboe CSV | 首次超时，后续成功；16.61 | 11/04；不能冒充11/05 |
| Cboe收盘观测 | 前期独立探测读到28.18、前收16.61、last_trade_time=11/05 16:15:01；正式集成运行超时 | 不混入历史；运行失败不伪称当次核验成功 |
| VXN Cboe CSV | 成功38.26，前收25.08；22条 | 11/05；quote/history available |
| VXN Yahoo日线 | 成功38.2599983215332，前收25.079999923706055 | 11/05，与Cboe一致 |
| VXN FRED VXNCLS | 实际HTTP503 | 保留失败；不声称FRED通过真实成功验收 |

两次真实运行均成功取得11月5日VIX/VXN日线。首次VIX选择Investing，后续Yahoo恢复时选择Yahoo；未跨源拼接、未按抓取时间改写行情日期。FRED本身存在发布滞后，不能作为北京时间09:00的保证渠道；VIXCLS经调研但未为本修复强行接入。

## 线上状态

生产构建成功；2026-11-06 01:55:18 UTC部署成功，Sites版本18，服务1.6.3，Schema1.5，仍为所有者私有。未修改Secrets、数据库迁移、既有归档/盘前定时任务或访问范围。

Git功能提交：`a249286d4b5cbdbcb7f7bc7bdbf6061a5f73f3b3`；[PR #4](https://github.com/hao0527/market-observatory-mcp/pull/4)已合并，合并提交`14cc6eb50261e6e545ae63b423eb69cbf14cd8d9`。Sites精确构建源码提交：`d9a29f50c3ee3241051f2295373545e229132f4f`。公开仓库与私有部署分开保留Git来源，不公开站点身份或凭据。GitHub本次未返回PR工作流运行，验证由本次执行的实际命令完成，不声称CI另行通过。

### ChatGPT原生MCP验收

2026-11-06 01:55:52 UTC（北京时间09:55:52）实际调用get_market_snapshot(refresh=true)：13/13有有效数值，12项available、VIX一项partial，0项stale/unavailable。没有把有值等同于全部已完成官方核验。

| 指标 | 市场日期 | 线上quality | 来源 |
| --- | --- | --- | --- |
| VIX | 2026-11-05 | partial | Investing.com非CFD CBOE指数日线 |
| VXN | 2026-11-05 | available | Cboe CSV |
| 美国2Y/10Y/30Y | 2026-11-05 | available（各项） | U.S. Treasury |
| 黄金、布伦特 | 2026-11-06 | available（各项） | 原有新浪来源；布伦特仍明确CFD |
| 标普500、纳指综合、道指、SOX | 2026-11-05 | available（各项） | 原有新浪来源 |
| 日经225、KOSPI | 2026-11-06 | available（各项） | 原有东方财富、NAVER |

VIX=28.18，前收16.61（11/04），日变化+69.65683323%；VXN=38.26，前收25.08（11/04）。volatility_date_consistency=aligned_latest_completed、consistent=true，expected_last_completed_date=11/05。

线上当次Yahoo仍429，Cboe VIX CSV仍止于11/04；新增独立日线成功获取11/05。Cboe观测的last_trade_time仍为11/05 16:15:01，close=28.18，但prev_day_close已滚动成28.18（与真实11/04前收16.61不符），因此checks.previous_close=false、official_close_window_confirmed=false，保持quote partial、official_daily_file_confirmed=false。没有用这个已滚动前收计算日变化，也没有修改或插入历史。

01:56:31–33 UTC进一步实际调用两个get_market_history(refresh=true)：各22条，从10/07至11/05，history_quality=available、history_refresh_status=succeeded；VIX报价quality仍partial，历史新鲜度不替代报价验证。两者本次quote_source与history_source一致、cross_provider=false；VIX整段来自Investing，VXN整段来自Cboe，未追加观测记录。

01:57:05 UTC再调用VIX refresh=false，delivery=durable_cache；原fetched_at=01:56:32.367Z不变，retrieved_at变为01:57:05.075Z；history_refresh_status=not_attempted、history_degraded=false。真实D1缓存回读通过，没有把缓存读取当作上游刷新。

同轮原生MCP回归：黄金history=unsupported/count0/available=false，正常业务结果；上证指数sh000001盘口null/unsupported，sh563360 ETF正常五档买卖盘，均有有效报价。缓存上游失败/重启/过期及旧记录替换保护通过隔离测试完成，没有破坏生产上游来制造失败。

## 限制

- 09:00北京时间为验收目标，无法控制第三方发布时间和网络；不能提供每日无条件SLA。没有最新完整日线时仍stale，官方文件未核实时保持显式确认标记。
- 最新日期与官方文件确认是不同维度：provider_daily_index_close不能改名为official_daily_index_close。仅独立日线可读且官方观测失败时，quote partial、history按日期表达。
- 公开数据下载/页面结构可能变化；身份校验失败时宁可不可用，不绕过登录、反机器人或限流。
- 不扩充日历覆盖，不推测临时休市；无需新增架构，后续只有实质性数据错误再修。

## 参考

- Cboe方法说明：https://cdn.cboe.com/api/global/us_indices/governance/VIX_Methodology.pdf
- 官方日线：https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv
- 非CFD独立日线：https://www.investing.com/indices/volatility-s-p-500-historical-data?cid=1096487
- FRED序列：https://fred.stlouisfed.org/series/VXNCLS （此次下载本地503、生产520，仍未通过真实读取成功验收）
