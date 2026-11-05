# 第三轮质量修复与验收（服务 1.4.1）

2026-11-05。保持 Schema 1.4、13 项指标、原工具名与参数。范围仅为历史质量、来源元数据及正常业务状态；不增加预测、评分、买卖建议、Secrets 或架构层。

## 修复前后

| 问题 | 修复前证据 | 本次处理 |
| --- | --- | --- |
| 新鲜缓存被标 unavailable | 修改前重现标普500 22条、11月4日、durable_cache/degraded=true，却 history_quality=unavailable；当时东方财富和FRED均520。道指当次主源已恢复。 | 记录存在性、记录质量与本次刷新分离。缓存按实际日期为 available/stale/forming/unknown；刷新失败为 history_refresh_status=failed，保留错误、交付方式与原 fetched_at。 |
| VIX跨源备注 | 本次修改前VIX/VXN实际均为Cboe→Cboe，未重现同次响应矛盾；此前两次独立请求的来源差异不能直接证明错误。 | 中央输出统一计算本次 quote_source/history_source/cross_provider/same_instrument；纠正旧元数据的冲突备注。跨供应商的同品种不声明相同报价口径。 |
| FRED备用真实成功未验证 | 修改前生产请求真实触发FRED但返回520；代码路径存在不代表网络可用。 | 验证四条序列、CSV范围/序列头/缺失值/日期/单位/日频与滞后逻辑；隔离主源失败后真实FRED请求仍503。保留阻塞，未声称真实成功。 |
| 黄金被包装INVALID_ARGUMENT | 修改前真实MCP isError=true，平台 structuredContent.error_code=INVALID_ARGUMENT，正文却为unsupported。 | 合法gold正常MCP isError=false、HTTP200，仍返回UNSUPPORTED_HISTORY/retryable=false；真正非法ID仍isError=true/HTTP400。布伦特CFD不接期货历史。 |

## 修改文件

| 文件 | 核心逻辑 |
| --- | --- |
| lib/history.ts | 分离历史刷新与质量；兼容旧缓存；统一来源、备注、独立历史转换；保留quote质量；失败源不能被缓存数据源覆盖。 |
| app/mcp/route.ts | 正常业务结果isError=false，真实异常仍isError=true；服务版本1.4.1及工具说明。 |
| app/api/history/route.ts | unsupported正常HTTP200，非法ID仍400。 |
| lib/market.ts | 移除黄金旧错误标记的过时注释；保留合法ID与完整unsupported正文。 |
| scripts/history-quality-cases.mjs | 56组契约场景，含工作进程重启后的真实持久后端抽象与双源失败。 |
| scripts/test-market-data.mjs | MCP/HTTP业务状态与非法ID回归；隔离主源失败后完整真实备用路径检查。 |
| package.json | 服务修订1.4.1，依赖与锁文件不变。 |
| docs/HISTORY_CONTRACT.md、docs/WORK_DEPLOY.md、README.md、CHANGELOG.md | 字段兼容、刷新状态、同次来源比较、复现验收与FRED限制。 |

history_error保留兼容语义；新增history_degraded/history_refresh_status/history_refresh_error及metadata对应字段。普通TTL缓存读取为not_attempted，上游实际取得日线（含报价附带历史）为succeeded。history_requested仅说明是否显式请求历史数组。source_transition继续描述报价换源；history_source_transition单独描述本次报价来源到本段历史来源，same_quote_basis=null。

## 自动化测试

| 检查 | 结果 |
| --- | --- |
| npm test | 通过：56组历史不变量场景及既有行情、解码、单位、重试、日历、盘口、MCP/HTTP集成测试。 |
| npm run test:cache | 通过：实际SQLite迁移、按时间有序覆盖、有限过期清理。 |
| npm run typecheck | 通过。 |
| Sites生产构建 | 通过，源码与归档一一对应。 |
| node scripts/check-public-source.mjs | 通过；公开副本保留无project_id模板，排除凭据/站点身份/数据库/构建产物。 |
| LIVE_FALLBACKS=1 npm test | 隔离模拟历史主源503，真实请求备用源；FRED四项503，NAVER日韩均真实返回22条。 |

### 缓存与来源专项

| 场景 | 结果 |
| --- | --- |
| 标普/道指成功保存后清空内存，双源失败，从持久缓存恢复新鲜历史 | available=true，quality=available，degraded=true，refresh_status=failed；错误含两个源，fetched_at不变，quote_quality不变。 |
| 同一持久缓存跨入下一完整交易日 | count仍非空，quality=stale，refresh_status=failed；未把读取时间当成采集时间。 |
| 普通TTL缓存命中 | refresh_status=not_attempted，无本次刷新错误，degraded=false；不声称上游成功。 |
| 日经盘中缓存刷新失败 | 保持forming；午休、收盘前旧缓存过收盘、假日和周末按原市场日历验证。 |
| 韩国完成日期未核实 | 保持unknown和calendar_verified=false，不套用美日历。 |
| Cboe内联缓存刷新失败 | 历史available，报价可独立degraded；历史刷新错误独立保留。 |
| 报价失败但独立历史成功 | history_quality=available、refresh_status=succeeded，不继承报价刷新错误。 |
| Cboe报价/Yahoo历史，以及新浪报价/独立历史 | cross_provider=true、same_instrument=true；旧同源note被纠正，报价source_transition保留。 |
| 同供应商或供应商未知 | 已知相同false，未知null，不推测。 |
| 黄金/布伦特CFD历史 | count=0、available=false、unsupported；不替换为COMEX/连续期货历史。 |

## FRED真实路径与阻塞

执行时间约2026-11-05 07:25 UTC。仅在测试进程拦截东方财富/Nasdaq历史主源为503；FRED请求、解析、loadQuote、historyState均执行真实代码，内存为空，不使用故障缓存或演示CSV。

| 指标 | 序列 | 真实FRED结果 | 有效记录/数据日期 |
| --- | --- | --- | --- |
| sp500 | SP500 | HTTP503，refresh_status=failed | 0 / 无 |
| dow | DJIA | HTTP503，refresh_status=failed | 0 / 无 |
| nasdaq | NASDAQCOM | HTTP503，refresh_status=failed | 0 / 无 |
| sox | NASDAQSOX | HTTP503，refresh_status=failed | 0 / 无 |

原URL为 https://fred.stlouisfed.org/graph/fredgraph.csv?id=SP500&cosd=2026-09-01&coed=2026-11-05 。增加Accept/User-Agent/Referer、使用官方站旧 /series/SP500/downloaddata/SP500.csv 地址也返回503。响应server=envoy，正文upstream connect error or disconnect/reset before headers，remote reset。证据指向当前请求路径连接失败，无法确定失败究竟发生于哪一网络节点，也不能据此认定序列或参数错误。

四条序列分别对应S&P500、道指、纳斯达克综合和PHLX SOX价格指数，保留原日频点位；NASDAQCOM的原始基期为1971-02-05=100。CSV严格核对序列头、剔除缺失点和非法/未来日期；最后日期落后时标stale，不把发布/读取时间当交易日期。合成CSV只用于另列的确定性解析与回退测试，未作为真实FRED成功。

官方元数据：[SP500](https://fred.stlouisfed.org/series/SP500)、[DJIA](https://fred.stlouisfed.org/series/DJIA)、[NASDAQCOM](https://fred.stlouisfed.org/series/NASDAQCOM)、[NASDAQSOX](https://fred.stlouisfed.org/series/NASDAQSOX)。[标准observations API](https://fred.stlouisfed.org/docs/api/fred/series_observations.html)需要注册API key；本轮未新增凭据或第三方代理。官方HTML可读不代表CSV下载成功。

## 线上真实MCP验收

时间窗口：2026-11-05T07:33:32.366Z 至 2026-11-05T07:35:20.411Z（UTC，北京时间加8小时）。使用本站实际连接的MCP工具，不使用本地示例JSON。全部13项报价available、无degraded报价；默认快照不请求独立历史，允许报价附带的历史真实存在。

| 指标 | 快照报价来源 | 报价交易日 | quote_quality | 默认历史质量 | 历史刷新状态 |
| --- | --- | --- | --- | --- | --- |
| vix | Cboe | 2026-11-04 | available | available | succeeded |
| vxn | Cboe | 2026-11-04 | available | available | succeeded |
| us2y | U.S. Treasury | 2026-11-04 | available | available | succeeded |
| us10y | U.S. Treasury | 2026-11-04 | available | available | succeeded |
| us30y | U.S. Treasury | 2026-11-04 | available | available | succeeded |
| gold | 新浪财经 / 汇通网 | 2026-11-05 | available | unsupported | not_attempted |
| brent | 新浪财经 | 2026-11-05 | available | unsupported | not_attempted |
| sp500 | 新浪财经 | 2026-11-04 | available | not_requested | not_attempted |
| nasdaq | 新浪财经 | 2026-11-04 | available | not_requested | not_attempted |
| dow | 新浪财经 | 2026-11-04 | available | not_requested | not_attempted |
| sox | 新浪财经 | 2026-11-04 | available | not_requested | not_attempted |
| nikkei225 | NAVER Finance | 2026-11-05 | available | not_requested | not_attempted |
| kospi | NAVER Finance | 2026-11-05 | available | not_requested | not_attempted |

### 历史逐项

以下报价来源均是本次历史请求重新取得的来源，不能与前一次快照比较后判为矛盾。例如日经快照NAVER、随后历史调用Yahoo，是独立请求的正常换源。

| 指标 | 本次报价源 → 历史源 | 条数 | 最后日期 | history_quality | 刷新状态 | cross_provider |
| --- | --- | --- | --- | --- | --- | --- |
| vix | Cboe → Cboe | 22 | 2026-11-04 | available | succeeded | false |
| vxn | Cboe → Cboe | 22 | 2026-11-04 | available | succeeded | false |
| us2y | U.S. Treasury → U.S. Treasury | 22 | 2026-11-04 | available | succeeded | false |
| us10y | U.S. Treasury → U.S. Treasury | 22 | 2026-11-04 | available | succeeded | false |
| us30y | U.S. Treasury → U.S. Treasury | 22 | 2026-11-04 | available | succeeded | false |
| gold | — → — | 0 | — | unsupported | not_attempted | — |
| brent | 新浪财经 → — | 0 | — | unsupported | not_attempted | — |
| sp500 | 新浪财经 → 东方财富 | 22 | 2026-11-04 | available | succeeded | true |
| nasdaq | 新浪财经 → Nasdaq | 22 | 2026-11-03 | stale | succeeded | true |
| dow | 新浪财经 → 东方财富 | 22 | 2026-11-04 | available | succeeded | true |
| sox | 新浪财经 → Nasdaq | 22 | 2026-11-03 | stale | succeeded | true |
| nikkei225 | Yahoo Finance → Yahoo Finance | 22 | 2026-11-05 | available | succeeded | false |
| kospi | NAVER Finance → NAVER Finance | 22 | 2026-11-05 | unknown | succeeded | false |

13个历史工具均正常返回isError=false。黄金count=0/available=false/unsupported，未触发平台INVALID_ARGUMENT；布伦特实际instrument_id=brent_sina_cfd、instrument_changed=true，历史为空且unsupported。Nasdaq/SOX报价11月4日、历史11月3日，history_quality=stale而quote_quality=available。

本次标普500/道指主源均恢复并返回11月4日22条，刷新状态succeeded。没有人为破坏生产源以制造缓存降级；工作进程重启、持久缓存和双源失败的验收来自上述隔离测试。线上故障前后状态会随上游可用性变化，不能把一次成功当持续可用保证。

日经测试时已收盘，Asia/Tokyo，11月5日completed/available；盘中forming通过固定时钟回归验证。KOSPI使用Asia/Seoul，11月5日有记录但完成日期无法独立核实，unknown、calendar_verified=false。原日韩日历与forming逻辑保留。

美股market_timezone=America/New_York；新浪source_timezone仍保留Asia/Shanghai，timestamp_timezone=UTC，report_timezone=Asia/Shanghai。未用fetched_at/retrieved_at填充行情as_of。

### 盘口

| 证券 | 报价质量 | 盘口状态 | 买/卖档数 |
| --- | --- | --- | --- |
| sh000001 | available | unsupported | null / null |
| sz159842 | available | provided | 5 / 5 |
| sh518850 | available | provided | 5 / 5 |

### 不变量

线上13项快照及13项历史的记录数/可用性、unavailable不能有有效记录、quote与history质量独立、来源一致性、degraded可追溯、品种隔离、unsupported错误码检查：全部通过，0项违反。空历史未请求状态为not_requested/not_attempted，不误判为unavailable。

补充验证边界：额外直连私有站点HTTP路径的检查收到401 Unauthorized，未验证到应用路由正文，因此不能把它计为线上HTTP200/400验收通过。黄金MCP的真实外层响应已经独立验收为isError=false；HTTP200/400差异由本地路由集成测试通过。未为额外检查更改私有访问保护或Secrets。

## Git与部署

- 公开代码提交：[bdd9fac](https://github.com/hao0527/market-observatory-mcp/commit/bdd9facab7a76faf440a87d3ba2b7c90e2ca85f1)。
- 生产源提交：ece3b6534cec5eb5f135a5964c5d7bdac3e5eb34。
- 现有所有者私有站点版本9已成功部署，MCP可用；部署源码声明服务版本1.4.1，Schema保持1.4。
- 归档SHA256：b4b11de3feb08536530527ddf75bddd84c80dbcc21b8a87210e68ada7e9fd51b。
- 未修改Secrets、访问范围、D1 schema、已有日历覆盖或资产目录。
- 本报告省略原作者部署身份和运行凭据，复现步骤仍以WORK_DEPLOY.md及当前Sites工作流为准。

## 遗留与冻结

FRED真实成功读取仍被当前网络/上游请求路径503/520阻塞，未通过成功验收，暂无可报告的真实FRED历史日期；需要连通性恢复后重跑已有隔离检查。韩国年度日历仍未完整核实，unknown与calendar_verified=false是保留的真实边界。

目前没有必须交由更高推理模型重设计的架构问题。数据层按本轮范围冻结；后续只处理有实证的数据错误、源变更或已核实日历更新，不继续增加功能。上游波动不通过制造available掩盖。

