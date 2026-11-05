# 数据接口

v1.4 的历史字段以 [HISTORY_CONTRACT.md](HISTORY_CONTRACT.md) 为准，保留以下来源及品种说明。

本项目只负责采集、解码、规范字段和说明质量。投资分析由调用方完成。

## 日韩指数

- `nikkei225`：日经 225，Yahoo `^N225`，备用东方财富 `100.N225`、NAVER `.N225`，点，`Asia/Tokyo`。
- `kospi`：韩国综合股价指数 KOSPI，Yahoo `^KS11`，备用东方财富 `100.KS11`、NAVER `KOSPI`，点，`Asia/Seoul`。不是 KOSPI 200 或 KOSDAQ。
- 日本现金市场常规时段 09:00–11:30、12:30–15:30；韩国常规时段 09:00–15:30。当地时区均为 UTC+9，北京时间通常 08:00 开盘。不能据此认定所有工作日都正常交易。
- 日本使用 JPX 已核实的 2026–2027 休市日及午休；超出覆盖返回 unknown。韩国完整年度休市及特别开市时刻尚未核实；同日近时报价可标 recent_quote，否则说明未知，不伪造交易日历。
- 9:00 盘前分析应引用当日早盘及实际 `as_of`，休市时明确引用最近一日。延迟、日终和降级数据不能称为实时。

官方时段和日历：
- https://www.jpx.co.jp/english/equities/trading/domestic/01.html
- https://www.jpx.co.jp/english/corporate/about-jpx/calendar/
- https://global.krx.co.kr/contents/GLB/06/0602/0602010201/GLB0602010201T1.jsp

东方财富采用单指数接口独立请求，失败再读 NAVER。NAVER 保留带 +09:00 偏移的 localTradedAt、供应商延迟分钟与可得市场状态；前收由同响应最新值减日涨跌反推时单独标注，参考日期仍留空。

## 时间字段

| 字段 | 含义 |
| --- | --- |
| `market_date` | 数据所属市场日期 |
| `as_of` | 上游提供的报价或更新时间；仅有日终日期时为 null |
| `time_precision` | second / date / unknown，不用收盘时刻补造精确时间 |
| `as_of_note` | 时间含义或缺失原因 |
| `previous_date` | 同源前值对应日期；无法核实时为 null |
| `previous_date_status` | provided / not_provided |
| `previous_date_note` | 日期来源或未提供说明 |
| `fetched_at` | 最近成功读取上游的时间 |
| `retrieved_at` | 本次返回时间，缓存命中也更新 |

参考值日期不能从自然日倒推，也不从独立历史源借用来装饰另一供应商的昨收或昨结值。

## 独立历史

最新快照默认无历史。`get_market_history` 和显式 `include_history=true` 按需读取：

| 指标 | 最新报价备用源 | 独立历史主源 | 历史备用源 |
| --- | --- | --- | --- |
| sp500 | 新浪 | 东方财富 100.SPX | FRED SP500 |
| dow | 新浪 | 东方财富 100.DJIA | FRED DJIA |
| nasdaq | 新浪 | Nasdaq COMP（综合指数） | FRED NASDAQCOM |
| sox | 新浪 | Nasdaq SOX | FRED NASDAQSOX |
| nikkei225 | 东方财富 | 东方财富 100.N225 | 无 |
| kospi | 东方财富 | 东方财富 100.KS11 | 无 |

Yahoo 原始响应已有可用历史时保留同源历史。备用历史整段来自一个来源，不拼接当前报价，不改变当前报价的昨收、参考日期和涨跌。即使最新报价全部失败，独立历史仍可读取。

`history_metadata` 单独给出 source、source_url、series、market_date、fetched_at、retrieved_at、quality、degraded、freshness。历史更新可能落后最新报价；调用方必须看历史自己的日期及质量。当日 K 线可能未完成。失败返回 `history_available=false`、`history_quality=unavailable`、`history_error`；`history_supported` 为能力别名，不会删除其他可用字段。

独立历史采用最长 65 个自然日请求并保留最近 22 个有效观测，缓存 5 分钟，故障时保留原成功时间。FRED 下载端可能返回 503，其备用能力不等于每次都可连接。Nasdaq COMP 与 NDX（纳斯达克 100）严格分开。

FRED 序列元数据：
- https://fred.stlouisfed.org/series/SP500
- https://fred.stlouisfed.org/series/DJIA
- https://fred.stlouisfed.org/series/NASDAQCOM
- https://fred.stlouisfed.org/series/NASDAQSOX

## 布伦特品种

| 来源 | instrument_id | quote_kind | 合约映射 |
| --- | --- | --- | --- |
| Yahoo BZ=F | brent_front_month_continuous | continuous_front_month_futures | 近月连续期货，非固定到期合约 |
| 新浪 hf_OIL | brent_sina_cfd | commodity_cfd | 供应商 CFD，未验证与 BZ=F 同一合约 |

备用 CFD 显式 `instrument_changed=true`、`source_transition.same_instrument=false`。未核实的 `contract_code` / `contract_expiry` 留空，不能靠中文名推定合约。禁止把 CFD 拼入期货历史。

## 盘口兼容变化

v1.3 中指数的 `order_book=null`、`order_book_supported=false`、`order_book_status=unsupported`。前端应先检查对象再读取 bids / asks。股票 / ETF 的有效盘口仍是五档，真实 0 挂单保留；未知类别标 unverified。

## 暂未接入的市场广度

沪深上涨、下跌、平盘家数与成交额属于后续范围。需要统一证券覆盖（是否含北交所、ETF、停牌）、同一观察时间和单位，不能把不同时间的指数成分统计相加当两市全市场。北京时间 09:00 尚未产生当日 A 股常规交易广度，盘前应明确引用上一交易日。
