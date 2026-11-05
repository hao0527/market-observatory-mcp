# 股票 / ETF 历史K线（Schema 1.5）

独立工具 `get_security_history`，与最新报价/盘口、全球快照和全球历史分开。数据仅来自东方财富，经核实后整理原始字段，不生成技术指标，不合成其他周期或换源混拼。

## 参数

| 参数 | 默认 / 限制 |
| --- | --- |
| symbol | 必填，sh/sz/bj加六位数字，如sh563360。只接受已支持的A股/场内基金代码空间；实际核验响应code和market。 |
| period | 默认1d；支持1m/5m/15m/30m/60m/1d。 |
| start_date、end_date | 必填有效YYYY-MM-DD，闭区间；日K最多366个日历日，分钟K最多62个日历日。 |
| adjust | 默认none；qfq/hfq按供应商fqt=1/2获取。1分钟复权未验证，返回unsupported，不忽略参数。 |
| refresh | 默认false；true跳过普通TTL，失败仍可返回明确标注的最近成功缓存。 |
| include_raw | 默认false；true附带原始成功响应；已接收但无法解析/没有范围内记录时，错误中也尽可能保留raw_response。 |
| limit | 默认200，1–500；限制返回页条数，不限制上游完整性检查。 |
| cursor | 上一页pagination.next_cursor，其余查询口径保持一致。 |

```json
{"symbol":"sh563360","period":"5m","start_date":"2026-10-01","end_date":"2026-11-05","adjust":"none","refresh":true,"include_raw":false,"limit":200}
```

## 输出

返回schema_version、symbol、security_name、period、adjust、requested_start_date/end_date、actual_start_date/end_date、actual_start_datetime/end_datetime、available_start_date/end_date、history_count、history_available、source/source_timezone/market_timezone/timestamp_timezone/report_timezone、fetched_at、latest_fetched_at、retrieved_at、quality、degraded、cache_hit、warnings、bars、coverage、pagination、source_requests及history_refresh_status/error。

- actual_*是当前返回页范围；available_*是本次成功获取且位于请求范围内的整段数据范围。
- history_count为当前页条数；pagination.total_count为本次所有成功段的匹配记录数，不包含缺失记录。
- bars按timestamp升序；不存在的K线不补零、不向前填充。相同source+symbol+period+adjust+timestamp只出现一次。
- 每根保留timestamp（Unix秒）、datetime/source_datetime（原始日期/分钟/秒字符串）、time_precision、open/high/low/close、volume、amount、amplitude、change_percent、change、turnover_rate、bar_end、is_final、fetched_at及source。
- 价格人民币元，volume为手（100股/基金份额），amount为人民币元。东方财富f56/f57本身已是手/元，不再乘100或10000。腾讯报价的成交额单位仍为万元，未改变旧工具单位。
- 日K只有日期，timestamp规范化到该日期上海当地零点，是日期键，不是实际成交时间。分钟timestamp为供应商K线结束标签。完整原始时间保留，不拿读取时间当行情时间。
- is_final依据已核实时段与原始成功fetched_at判断：尚未到结束边界为false；日历年份未核实时为null。缓存中尚未完成的记录不会因时钟越过边界自动变成最终K线。科创板/创业板股票日线保守等待盘后定价交易结束（15:30）；常规竞价结束边界为15:00；普通股票/ETF在15:00–15:30内因未逐只核实扩展盘后业务及供应商日线汇总边界，保守返回is_final=null，避免提前宣称完整日线。分钟覆盖仅核验常规竞价时段，若供应商额外返回时段外记录则保留原始响应并标记异常/partial，不冒充完整扩展时段。该判断不是交易所确认，不能排除供应商后续订正。

## 数据源、覆盖和质量

沪市secid=1.CODE；深市、北交所secid=0.CODE，并核对实际返回code/market/name。北交所与深市虽共用market=0，输入代码空间仍分别校验，不允许自动替换证券代码。

周期映射：1m/5m/15m/30m/60m/1d对应klt=1/5/15/30/60/101；复权none/qfq/hfq对应fqt=0/1/2。请求fields2=f51至f61，依次为时间、开、收、高、低、量、额、振幅、涨跌幅、涨跌额、换手率。OHLC与单位逐项核验，拒绝错误身份、非法日期、非有限数、负量额、异常OHLC；重复冲突不拼接。

1分钟实测可能忽略beg/end并只返回近期窗口。必须本地严格筛选，不会把11月数据回答成10月历史。覆盖不足为partial；完全不相交为unsupported/HISTORY_RANGE_UNAVAILABLE。其他周期没有数据时保留EMPTY_HISTORY及原因不确定性，不能仅凭空响应认定不存在或停牌。供应商范围是实测结果，不承诺固定天数或永久可用。

quality：有数据且排定时段覆盖完整为available；缺段、缺记录、无已核实日历或含未完成K线为partial；交付的原未完成缓存已越过结束边界为stale；没有记录为unavailable；未验证复权或完全不支持的范围为unsupported。缺少排定K线可能是停牌、未上市、无成交或源缺失，coverage.missing_sessions的原因保持unknown，suspension_verified=false。

history_refresh_status独立为succeeded/failed/not_attempted。degraded=true仅表示刷新失败后交付旧成功数据，不强行把有效历史标为unavailable。source_requests保留每段原fetched_at、delivery、缓存后端、刷新错误和供应商观察到的范围。顶层fetched_at为成功段最早读取时间，latest_fetched_at为最晚读取时间，每根与每段保留各自时间；retrieved_at为本次返回时间。

2026年沪深北现金交易日历根据各自官方公告核实，午休不生成K线；其他年份calendar_verified=false，不以普通工作日推定开市。临时休市未核实，emergency_closures_verified=false。

## 缓存、增量与分页

复用现有D1 market_last_success和有限内存缓存，无新数据库schema；证券历史内存最多16块，避免扩大原报价缓存的内存占用。日K按自然季度，5/15/30/60分钟按自然周缓存；相邻/重叠日期请求复用已有块，仅获取缺少或过期的块。1分钟使用请求范围缓存，不建立完整分钟归档。请求最多三段并发，每段最多两次，429不立即重试。

当前段日K TTL60秒、分钟TTL15秒；已结束不复权段TTL6小时；已结束复权段TTL1小时。沿用最长14天最近成功故障缓存，不承诺永久历史存储。正在形成的记录不长期当作完整数据缓存。

adjust、source和证券标识在缓存键中隔离；前/后复权额外按读取日隔离。没有取得可验证的复权因子版本，factor_version=null、verified_factor_version=false，不跨读取日合并；读取跨越日期时拒绝混合。不能把“已经收盘”理解为前复权价格永远不变。

可选acceptReplacement钩子只由本工具使用；若刷新丢失旧记录或把已完成记录降为未完成，拒绝覆盖并返回更完整缓存与INCOMPLETE_HISTORY_REFRESH。旧报价和全球历史的缓存行为保持原样。

分页游标绑定完整数据指纹（含查询、价格、量额、时间和完成状态），同一次数据版本内升序翻页。源数据或覆盖改变返回CURSOR_EXPIRED，应从第一页重新读，不混用两版数据。服务端上游分段与面向ChatGPT的返回分页是两个独立限制。

## 验证

```bash
npm test
npm run test:cache
npm run typecheck
node scripts/test-security-history-live.mjs
```

真实脚本不模拟上游、不改生产配置，默认sh563360、最近36个日历日，可用SECURITY_HISTORY_START/END设置日期，SECURITY_HISTORY_REPORT指定本地完整结果文件。输出每项真实状态，不能用“脚本通过”替代每项available/完整覆盖。

2026-11-05验收范围2026-10-01至2026-11-05：日21根、5分钟1008根、15分钟336根、30分钟168根、60分钟84根；1分钟仅11月5日240根，对整段范围为partial。沪深北股票及深市ETF另有真实样本。日K与腾讯价格、成交量/额对账；不同分钟周期汇总量额存在小幅源差异，保留原值，不人工改为日线合计。

官方日历来源：[上交所](https://www.sse.com.cn/disclosure/announcement/general/c/c_20251222_10802507.shtml)、[深交所](https://www.szse.cn/disclosure/notice/general/t20251222_618087.html)、[北交所](https://www.bse.cn/important_news/200027428.html)。[上海交易时段](https://www.sse.com.cn/lawandrules/sselawsrules2025/trade/universal/c/c_20260424_10816492.shtml)。参数使用也与公开实现[AKShare fund_etf_em.py](https://github.com/akfamily/akshare/blob/main/akshare/fund/fund_etf_em.py)对照，实际支持仍以本轮源请求验收为准。

盘后业务核实依据：[深交所2026年技术准备通知](https://investor.szse.cn/marketServices/technicalservice/notice/t20260424_620199.html)，其扩展品种安排不等于每只证券的启用时间已经核实，因此上述窗口明确保留不确定性。
