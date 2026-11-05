# 股票及ETF历史K线交付与验收（1.5.0）

> 此文记录1.5.0当时的开发端与部署检查，不代表当前Worker可用性。当前请阅读[1.5.1第二轮修复及ChatGPT原生MCP验收](SECURITY_HISTORY_REPAIR_REPORT.md)，其中区分实际上游读取、缓存、范围限制和复权失败；已完成原生新工具线上调用。

2026-11-05。已在现有所有者私有站点部署版本10，Schema 1.5、服务1.5.0。新增独立get_security_history，不把历史混入报价工具，不新增分析、指标、评分或买卖建议。**当前会话未完成新工具的原生线上调用验收，限制详见下文。**

## 代码与文件

| 文件 / 位置 | 功能 |
| --- | --- |
| [lib/security-history.ts:7](../lib/security-history.ts#L7) | 请求、K线及返回TypeScript类型。 |
| [lib/security-history.ts:19](../lib/security-history.ts#L19) | 参数、代码空间、周期、复权、日期、分页校验；拒绝指数/债券代码误当股票。 |
| [lib/security-history.ts:34](../lib/security-history.ts#L34) | 身份、OHLC、时间、成交量额校验，原始时间保留，重复/冲突检测及finality。 |
| [lib/security-history.ts:64](../lib/security-history.ts#L64) | 更完整缓存替换保护；季度/周分段、复权读取日隔离、原始响应保存。 |
| [lib/security-history.ts:84](../lib/security-history.ts#L84) | 排定时段覆盖、缺记录与原因未知标注。 |
| [lib/security-history.ts:97](../lib/security-history.ts#L97) | 独立入口、质量/刷新状态/缓存元数据、数据指纹游标和返回分页。 |
| lib/security-calendar.ts | 2026年沪深北各自官方排定日历、午休和分钟标签；覆盖之外unknown，不捏造停牌或临时休市。 |
| lib/quote-cache.ts | 可选替换检查及最多16个证券历史内存块；旧调用不启用新替换策略。复用现有D1表，无迁移。 |
| app/mcp/route.ts | 第五个MCP工具注册、参数schema、Catalog与版本更新。 |
| lib/market.ts、lib/tencent.ts | 仅更新返回Schema标识；原有业务计算保持原样。 |
| scripts/security-history-cases.mjs、scripts/test-market-data.mjs | 新增68个证券历史场景，保留原56个历史契约及既有回归。 |
| scripts/test-security-history-live.mjs | 真实上游集成检查，不模拟主源、不修改生产配置。 |
| package.json、README.md、CHANGELOG.md、docs/WORK_DEPLOY.md、docs/SECURITY_HISTORY.md | 版本、契约、复现和验收说明。 |

## 实际参数与结构

```json
{"symbol":"sh563360","period":"5m","start_date":"2026-10-01","end_date":"2026-11-05","adjust":"none","refresh":true,"include_raw":false,"limit":200}
```

symbol/start_date/end_date必填；period默认1d，adjust默认none，refresh/include_raw默认false。limit默认200，最多500；cursor取上一页pagination.next_cursor。日K单次最多366个日历日，分钟最多62个日历日，这是本服务请求边界，**不等于供应商保证的历史保留范围**。

返回bars（升序）及schema_version、symbol、security_name、period、adjust、请求/实际日期、available_start/end_date、history_count、history_available、source及时区、fetched_at/latest_fetched_at/retrieved_at、quality/degraded/cache_hit/warnings、coverage、pagination和source_requests，以及独立history_refresh_status/error。

每根含timestamp、datetime/source_datetime、time_precision、open/high/low/close、volume/amount、amplitude/change_percent/change/turnover_rate、bar_end、is_final、fetched_at与source。价格人民币元、成交量手、成交额人民币元。日timestamp是上海当地日期零点的规范化键，不是实际收盘时间；分钟timestamp是供应商结束标签。原始秒/分钟/日期字符串保留。

history_count仅当前页；pagination.total_count为全部成功获取的匹配记录数。actual_*是当前页范围，available_*是本次成功段的整体范围。游标绑定数据指纹；覆盖或数值变化返回CURSOR_EXPIRED，从第一页重新读取。

## 实际支持的周期和历史范围

测试请求2026-10-01至2026-11-05。2026年国庆10月1–7日排定休市，首次应有记录为10月8日，共21个交易日。

| 周期 | 实际取得完整段 | 总根数 | 复权 |
| --- | --- | --- | --- |
| 1d | 2026-10-08至2026-11-05 | 21 | none/qfq/hfq均实际读取成功 |
| 5m | 同上 | 1008 | none/qfq/hfq均实际读取成功 |
| 15m | 同上 | 336 | none/qfq/hfq均实际读取成功 |
| 30m | 同上 | 168 | none/qfq/hfq均实际读取成功 |
| 60m | 同上 | 84 | none/qfq/hfq均实际读取成功 |
| 1m | 仅2026-11-05，09:31至15:00 | 240 | 仅none；整月查询partial，单日查询available |

日K另验证茅台2026-06-01至11月5日107根，三种复权均可读取。分钟没有声称支持任意长区间：曾请求563360的2026年1月5分钟样本时返回空，不从空数组推测最大范围或停牌。1分钟旧范围请求实际返回当日窗口，本地严格过滤后unsupported/HISTORY_RANGE_UNAVAILABLE，绝不把11月记录作为10月历史。1分钟qfq/hfq即便上游接受参数也未可靠验证，正常返回unsupported/UNVERIFIED_ADJUSTMENT。

## 真实源集成检查

执行于2026-11-05T08:49:41.088Z（UTC，北京时间加8小时）。以下30项均使用真实上游记录；合成数据仅出现在另列的单元测试中。

| 场景 | quality | 当前页条数 | 全段条数 | 可得开始 | 可得结束 | 刷新状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 1d | available | 21 | 21 | 2026-10-08 | 2026-11-05 | succeeded |
| 5m | available | 500 | 1008 | 2026-10-08 | 2026-11-05 | succeeded |
| 15m | available | 336 | 336 | 2026-10-08 | 2026-11-05 | succeeded |
| 1m | partial | 240 | 240 | 2026-11-05 | 2026-11-05 | succeeded |
| 30m | available | 168 | 168 | 2026-10-08 | 2026-11-05 | succeeded |
| 60m | available | 84 | 84 | 2026-10-08 | 2026-11-05 | succeeded |
| cache_read | available | 5 | 84 | 2026-10-08 | 2026-11-05 | not_attempted |
| 1d_qfq | available | 5 | 21 | 2026-10-08 | 2026-11-05 | succeeded |
| 1d_hfq | available | 5 | 21 | 2026-10-08 | 2026-11-05 | succeeded |
| 5m_qfq | available | 5 | 1008 | 2026-10-08 | 2026-11-05 | succeeded |
| 5m_hfq | available | 5 | 1008 | 2026-10-08 | 2026-11-05 | succeeded |
| 15m_qfq | available | 5 | 336 | 2026-10-08 | 2026-11-05 | succeeded |
| 15m_hfq | available | 5 | 336 | 2026-10-08 | 2026-11-05 | succeeded |
| 30m_qfq | available | 5 | 168 | 2026-10-08 | 2026-11-05 | succeeded |
| 30m_hfq | available | 5 | 168 | 2026-10-08 | 2026-11-05 | succeeded |
| 60m_qfq | available | 5 | 84 | 2026-10-08 | 2026-11-05 | succeeded |
| 60m_hfq | available | 5 | 84 | 2026-10-08 | 2026-11-05 | succeeded |
| mapping_sz159842 | available | 5 | 21 | 2026-10-08 | 2026-11-05 | succeeded |
| mapping_sz000001 | available | 5 | 21 | 2026-10-08 | 2026-11-05 | succeeded |
| mapping_sh600519 | available | 5 | 21 | 2026-10-08 | 2026-11-05 | succeeded |
| mapping_bj920002 | available | 5 | 21 | 2026-10-08 | 2026-11-05 | succeeded |
| one_minute_past_range | unsupported | 0 | 0 | — | — | failed |
| one_minute_qfq_unsupported | unsupported | 0 | 0 | — | — | not_attempted |
| stock_adjust_none | available | 107 | 107 | 2026-06-01 | 2026-11-05 | succeeded |
| stock_adjust_qfq | available | 107 | 107 | 2026-06-01 | 2026-11-05 | succeeded |
| stock_adjust_hfq | available | 107 | 107 | 2026-06-01 | 2026-11-05 | succeeded |
| cursor_page2 | available | 500 | 1008 | 2026-10-08 | 2026-11-05 | succeeded |
| cursor_page3 | available | 8 | 1008 | 2026-10-08 | 2026-11-05 | not_attempted |
| one_minute_single_day | available | 240 | 240 | 2026-11-05 | 2026-11-05 | succeeded |
| two_trading_days | available | 96 | 96 | 2026-10-08 | 2026-10-09 | succeeded |

5分钟分页实际读到500+500+8=1008根，升序、无重复、无交叠，未把第一页500条当作全量。10月8–9日另读取96根5分钟K线。缓存读取cache_hit=true、history_refresh_status=not_attempted；refresh=true确实触发上游。非法代码、空数组、520、分段失败、覆盖变动及陈旧未完成缓存由隔离回归验证，未为测试破坏生产源。

沪深北真实映射：sh563360→1.563360、sz159842→0.159842、sz000001→0.000001、sh600519→1.600519、bj920002→0.920002，均检查code、market和名称。北交所样本为万达轴承。

## 单位、复权与差异

563360的11月5日日K：open=1.118、high=1.144、low=1.116、close=1.133、volume=60507820手、amount=6860477170元。线上腾讯最新价1.133、volume_lots=60507820；腾讯成交额686048万元，换算6860480000元，与历史相差2830元，在腾讯万元取整显示精度内。未改变旧报价工具万元单位。

直接原始源响应汇总11月5日：1分钟量额与日K一致；5/30分钟成交量为60508731手，比日K多911手；15/60分钟为60508730手，比日K多910手。上述5/15/30/60分钟成交额均为6860580382元，比日K多103212元。原因未独立核实，保留供应商原值，不调整凑平，也不宣称跨周期完全可对账。

茅台复权对照（2026-06-01收盘）：none=1309.60、qfq=1281.58、hfq=8045.29；11月5日none/qfq=1452.00、hfq=8901.64。使用fqt=0/1/2原始响应，不在MCP内自行计算复权因子。ETF样本三种价格相等本身不能证明复权实现，因此另用茅台不同历史价格验证路径。量额保留实际交易字段，不随复权价格自行缩放。

## 缓存与质量

现有D1 market_last_success表，无新增schema。季度日K、自然周分钟K各自缓存，跨相邻查询复用分段，仅补缺少/过期段。1分钟是有限窗口查询缓存，不是完整归档。最长14天最近成功故障回退，不承诺永久保存所有完成K线；前/后复权按读取日隔离，不跨未知因子版本拼接。

68个新测试覆盖持久后端重启后恢复、新鲜缓存在失败时仍available、少记录刷新拒绝覆盖、原fetched_at不变、正常缓存not_attempted、partially failed请求返回partial、未完成缓存越过结束后stale且不自动is_final=true、未知日历/盘后边界null、价格/量额/身份/重复/冲突和分页游标。

日K与分钟的完成状态根据已核实排定时段及原成功读取时间判断，不是交易所确认。科创/创业板按15:30保守完成；其他证券15:00–15:30未逐只核实扩展盘后业务时保留null，避免提前宣称完整日线。分钟仅核验常规竞价时段，不假装覆盖完整盘后业务。2026年以外年度日历、停牌、上市边界和临时休市均保留不确定性，不填造K线。

## 测试与部署

- npm test：通过，新增68个证券历史场景、原56个历史契约场景及既有行情/协议/单位/时间/缓存回归。
- npm run typecheck：通过。
- npm run test:cache：通过，实际SQLite迁移、有序覆盖及过期清理。
- 真实源集成脚本：30项有记录/有限范围/不支持状态均如实记录；所有返回记录的OHLC、时间、排序、唯一性及请求范围检查通过。
- 生产构建：通过。发布到原所有者私有站点版本10，MCP已启用，访问范围及Secrets未改变。
- 公开源码分发检查：通过；公开模板不包含作者站点身份、凭据、数据库或构建产物。
- 公开代码提交：[9d5b306](https://github.com/hao0527/market-observatory-mcp/commit/9d5b306e232fa994b4c6a7551309d7d94509bf35)。
- 实际部署源提交：3d5762a523854cdd29d9fa8d1e9d7acbd6001a2e。
- 发布归档SHA256：3250342c68a1fccc2446d5bc126d06eaafc8985cb35d0f633205903c8a5ac52e。

## ChatGPT线上验收与明确限制

已通过原生连接工具验证：get_market_catalog返回Schema1.5及security_history定义；13项全球报价全部available；sh563360/sz159842报价正常，指数盘口unsupported、ETF盘口provided；黄金宏观历史正常unsupported；纳斯达克11月3日历史stale；标普500实际从故障缓存交付22根11月4日历史，degraded=true且history_quality=available，报价质量仍available。

**尚未完成：当前ChatGPT会话直接调用新增get_security_history。** 发布后当前会话工具列表仍未刷新；平台提示插件already_installed。使用平台提供的服务访问方式直连/mcp tools/list返回401 Unauthorized，因此没有把直连记为新工具线上调用成功。源集成测试和本地MCP路由测试不能替代这项验收。未为验收更改访问保护、Secrets或生产主源。

新会话可使用以下实际工具调用完成剩余验收：

```text
调用我的“每日资产观测站”MCP工具get_security_history：
{"symbol":"sh563360","period":"5m","start_date":"2026-10-01","end_date":"2026-11-05","adjust":"none","refresh":true,"include_raw":false,"limit":5}
核对quality、history_count、pagination.total_count、coverage、source_requests和下一页游标。
再分别查1d、15m、1m，并确认1分钟整月仅有近期记录时为partial，不把部分数据称为完整历史。
如果新工具仍未出现，先刷新该插件连接或工具列表，不要用get_security_quotes冒充历史。
```

## 未解决事项

1. 新工具原生线上调用受当前会话工具目录未更新阻塞，仍待上述验收；不能声称全部交付验收完成。
2. 东方财富在部分请求中会超时/503/520，有限重试及最近成功缓存缓解，不保证持续可用；本轮未接入未经验证的备用源。
3. 1分钟仅证实近期窗口，复权未可靠核实；没有完整分钟档案或任意长历史承诺。
4. 跨周期汇总量额的上述小幅差异保留原值，原因未核实。
5. 复权因子版本、全市场上市/停牌表、2026年以外日历及临时休市未覆盖，不以推测补全。
6. FRED既有连通性限制不属于本轮范围，未改动或宣称修复。
