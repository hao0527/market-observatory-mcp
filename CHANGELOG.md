# Changelog

## 1.4.1 — 2026-11-05

- 修复有效缓存与 history_quality=unavailable 矛盾：记录质量由日期 / 完成状态判断，独立返回 history_degraded / history_refresh_status / history_refresh_error。
- 保留原 fetched_at，retrieved_at 为本次交付时间；普通 TTL 缓存命中不宣称上游刷新成功。兼容旧 D1 缓存，无数据库迁移。
- 集中计算同一次响应的 quote_source / history_source / cross_provider / same_instrument，纠正旧备注；历史来源转换不覆盖报价 source_transition，也不宣称跨源报价口径完全相同。
- 黄金 unsupported 改为正常 MCP 结果与 HTTP 200；非法 ID 继续报 INVALID_ARGUMENT。布伦特 CFD 不拼接期货历史。
- 56 组历史契约场景，覆盖持久缓存重启、双源刷新失败、新鲜 / 过期 / forming / unknown、跨源和同源、报价 / 历史故障隔离及工具外层响应。
- 四条 FRED 备用完整路径分别通过合成 CSV 测试；真实隔离测试仍为 HTTP 503，明确保留未通过真实数据成功验收的限制。请求头和旧 CSV 地址测试也未恢复连接。
- 不新增指标、日历覆盖、Secrets 或架构层；Schema 仍为兼容的 1.4，服务修订为 1.4.1。

## 1.4.0 — 2026-11-05

- 历史能力与取得结果分离：报价源历史能力、独立历史能力、实际记录数及可用性分别返回；旧 history_supported 固定为能力别名。
- quote_quality / history_quality 独立，保留 quality 报价兼容语义；空数组不再可用，迟到日线标 stale，未收盘日线标 forming，未知日历标 unknown。
- 区分最近交易日、最后完整收盘日和日线完成状态；使用各市场当地时区，保留韩国未核实日历和临时休市的不确定性。
- 核实 KOSPI 100.KS11 映射，增加经身份及交叉收盘核验的 NAVER 日韩历史备用；保留结构化错误链。
- 明确 market_timezone / timestamp_timezone / report_timezone，保留 source_timezone；布伦特 Catalog 改为中性参考报价并保留品种隔离。
- 四条 FRED 备用路由完成模拟故障验证；本轮真实 CSV 下载返回 503，明确记录不可用。
- 保留黄金 MCP 错误标记和 HTTP 400，同时补全 unsupported 状态字段；指数 / ETF 盘口行为不变。
- 36 组历史契约不变量场景及原有回归、类型与缓存 SQL 检查；部署和真实接口结果见质量修复报告。

## 1.3.0 — 2026-11-05

- 新增日经 225、韩国 KOSPI，全球共 13 项指标；Yahoo 报价及东方财富 / NAVER 独立备用。
- 日本 2026–2027 日历 / 午休；韩国未核实的完整年度休市与特殊时段显式说明。
- 增加时间精度、报价时刻含义、前值日期提供状态，保留无法核实的 null。
- 美股指数在新浪报价下仍可按需读取独立东方财富 / Nasdaq 历史，FRED 备用；历史日期、来源与质量独立标注，不拼接报价、不跨源补算涨跌。
- 布伦特连续期货与 CFD 使用明确品种和合约映射，未核实到期合约留空。
- **兼容变化**：指数 `order_book=null`、`order_book_supported=false`、`order_book_status=unsupported`；股票 / ETF 的真实零挂单保留。
- 前端新增日韩筛选、动态指标数、独立历史来源与有限等待；更新 Work 复现验收和数据契约。
- 市场广度尚未接入，盘前不能将上一交易日广度当作当日实时。

## 1.2.0 — 2026-11-05

- 全球 11 项指标与沪深北股票 / ETF 批量查询。
- 默认精简快照，历史按指标单独读取。
- D1 最近成功缓存、原始时间保留、明确的故障降级及结构化错误。
- 已核实范围内的交易日、提前收盘、DST 与美债发布窗口检查。
- Cboe / Sina 独立备用源，429 不立即重试；日终、CFD、现货与期货口径显式标注。
- 公开导出移除作者部署身份，附 Work / Sites 复现文档和分发检查。

公开代码基于已验证的应用源码状态 `2a8177dd3fddccbd02d2d8bd008f61cf0008edcc`，不包含原部署的 Git 历史、运行数据库或账户信息。
