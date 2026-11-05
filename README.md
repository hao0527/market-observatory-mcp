# 每日资产观测站 · Market Observatory MCP

一个可以通过 **ChatGPT Work + Sites** 部署到自己账号的资产监测仪表盘和 MCP 数据服务。项目负责获取、必要解码、规范字段和说明数据质量，市场分析交给调用它的 AI。

无需在本地电脑持续运行采集程序，也不需要在源码中填写行情 API 密钥。公共行情接口可能延迟、限流或变更，本项目不承诺交易所授权实时行情。

## 在 GPT Work 中复现

1. 在支持 Work 的 ChatGPT 账号中启用 **Sites**。
2. 新建 Work 会话，复制下方提示词。
3. 完成部署后，在自己的账号中启用 Sites 为该站点生成的个人 MCP 插件。
4. 在分析会话或具备对应工具权限的定时任务中调用它。

```text
使用 Sites，基于公开仓库 https://github.com/hao0527/market-observatory-mcp
为我创建并部署一个属于我自己的新私有站点和 MCP。

先读取仓库中的 AGENTS.md、README.md、docs/WORK_DEPLOY.md，以及当前已安装的 Sites 技能。
复用仓库源码，不要重新生成一个外观相似但没有真实数据接口的页面。

公开版 .openai/hosting.json 故意没有 project_id：只创建一次新 Sites 项目，
将平台实际返回的新 ID 写入当前工作目录。保留 d1="DB"、r2=null、capabilities=["mcp"]。
不要复用作者的站点、数据库、插件或任何凭据；站点默认仅我可访问。

按当前 Sites 工作流完成环境配置、依赖安装、测试、构建、源码提交和私有发布。
不要在已有源码目录运行会覆盖源码的空项目初始化流程。
运行 npm test、npm run test:cache、npm run typecheck，并验证真实读取。

发布后检查 MCP 目录、全球快照、指定证券查询和按需历史查询。
数据缺失、限流、日终值、缓存降级及 CFD 换源都要如实说明，不要补造数据。
最终给我站点地址、MCP 插件接入方法和实际验收结果。
```

**详细部署说明：[`docs/WORK_DEPLOY.md`](docs/WORK_DEPLOY.md)**。其中区分平台自动处理的步骤、AI 应执行的检查以及需要使用读者自己账号的授权。

> GitHub 仓库公开不等于部署后的站点公开。每个复现者应获得自己的 Sites 项目、D1 缓存和个人插件。

## 能获取什么

| 范围 | 指标 / 内容 |
| --- | --- |
| 波动率 | VIX、VXN |
| 美债 | 官方日终 2 年、10 年、30 年期 par yield，变化单位 bp |
| 商品 | 黄金参考报价、布伦特原油参考报价；明确区分现货 CFD、期货及供应商昨结参考价 |
| 美股指数 | 标普 500、纳斯达克综合、道琼斯、费城半导体 |
| 日韩指数 | 日经 225、韩国 KOSPI，当日早盘与市场时区 / 时效提示 |
| 指定证券 | 沪深北股票 / ETF，最新价、昨收、涨跌额与幅度、开高低、成交量额、五档盘口（指数不支持时为 null） |
| 近期历史 | 按指标单独读取；来源不支持历史时明确标注 |

## MCP 工具

| 工具 | 示例参数 | 用途 |
| --- | --- | --- |
| `get_market_catalog` | `{}` | 指标、来源、日历覆盖和缓存策略 |
| `get_market_snapshot` | `{"refresh":true}` | 默认只返回最新快照，不附带历史点 |
| `get_security_quotes` | `{"symbols":["sz159842","sh518850"],"refresh":true}` | 最多批量 30 个带交易所前缀的代码 |
| `get_security_history` | `{"symbol":"sh563360","period":"5m","start_date":"2026-10-01","end_date":"2026-11-05","adjust":"none","limit":200}` | 股票/ETF历史K线，独立来源、覆盖与分页 |
| `get_market_history` | `{"id":"vix","refresh":true}` | 只获取指定指标的历史 |

快照可选 `include_history` / `include_raw`；证券查询可选 `include_raw`。`refresh=true` 跳过正常缓存，但上游失败时仍可能返回明确标为 `degraded` 的最近成功数据。

可在分析会话中这样提问：

```text
先调用我的“每日资产观测站”MCP，获取全球市场快照和 sh518850、sz159842 的最新行情。
核对 source、market_date、as_of、fetched_at、retrieved_at、quality 和 source_transition。
遇到日终、过期、缓存降级、换源或缺失项时明确说明，再进行分析。
```

## 如何理解数据质量

- `time_precision` / `as_of_note` / `previous_date_status`：明确时间精度与参考日期缺失原因，不推测上游未提供的日期。
- `history_metadata`：独立说明历史来源、日期、质量与降级，不借历史前值补算当前涨跌。
- `as_of`：供应商提供的行情 / 更新时间；只有日期的数据不会补造精确时刻。
- `fetched_at`：该条数据上一次成功从上游读取的时间。
- `retrieved_at`：本次接口返回时间，缓存命中也会变化。
- `quality=degraded`：上游失败后返回旧成功数据，**不能当作刚更新的报价**。
- `freshness`：交易时段 / 日历与时效提示；已核实范围之外返回 `unknown`。
- `instrument_changed=true`：备用源改变了品种口径，不能直接拼接为相同合约的历史。

黄金优先为新浪 / 汇通网伦敦金现货 CFD；Gold API 备用源没有同源前值，日变化留空。布油的新浪备用源为 CFD，区别于 Yahoo 的近月连续期货。VIX / VXN 的 Cboe 备用源是官方日终值。

## 技术与运行

- TypeScript、React、Vinext、Cloudflare Workers。
- Sites 承担私有访问、部署和 MCP 个人插件接入。
- D1 保存最长 14 天的每项最近成功数据；这是故障缓存，**不是每日历史归档**。
- 有限重试；遇到 HTTP 429 不立即重复请求或轮换 Yahoo 域名规避限流，改用独立备用源。
- 不实现投资评分、自动交易或交易账号连接。

```bash
# 安装应优先交由 Work 当前 Sites 工作流处理
npm test
npm run test:cache
npm run typecheck
node scripts/check-public-source.mjs
```

独立本地安装与调试见部署文档。Node.js 要求见 `package.json`，当前依赖管理固定为 pnpm 11.25.0；缓存 SQL 测试需要 Python 3。

13 项全球指标。日韩报价优先 Yahoo，东方财富 / NAVER 提供同指数备用；日本已核实 2026–2027 日历及午休，韩国完整年度休市 / 特别时段尚未核实，明确返回不确定性。美股报价切换新浪后，按需历史可使用东方财富 / Nasdaq，FRED 备用。

## 历史状态（Schema v1.5，服务 1.5.1）

`quality` 保留为报价质量；历史必须单独读取 `history_quality`。`history_supported` 是支持路径的兼容能力别名，实际数据只看 `history_available` 和 `history_count`。空数组、失败或未请求不能被标为实际有历史。

历史记录质量与刷新结果分别返回：`history_quality` 按记录日期判断；`history_refresh_status` / `history_refresh_error` 描述本次刷新；`history_degraded=true` 表示故障缓存，不能据此断定历史不可用。来源比较以同一次响应的 `quote_source` / `history_source` 为准。黄金历史正常返回 unsupported。

详细字段、业务状态、日韩日期和 FRED 限制见 [历史数据契约](docs/HISTORY_CONTRACT.md)。

## 文档与许可

- [Work / Sites 复现、部署与验收](docs/WORK_DEPLOY.md)
- [数据源、缓存、时效与技术细节](docs/ARCHITECTURE.md)
- [v1.3 数据契约、日韩时段与历史映射](docs/DATA_CONTRACT.md)
- [版本说明](CHANGELOG.md)
- [第三方声明](THIRD_PARTY_NOTICES.md)
- [MIT License](LICENSE)

软件许可不替代数据供应商的条款或行情授权。仓库不包含个人账号凭据、作者站点身份、运行数据库或采集结果。

- [第二轮质量修复与线上验收报告](docs/QUALITY_REPAIR_REPORT.md)
- [第三轮历史质量、来源与备用源验收报告](docs/ROUND3_QUALITY_REPORT.md)

证券历史独立读取：支持日K及1/5/15/30/60分钟；1分钟仅开放不复权且近期窗口有限。`history_count`为当前页条数，完整已取得条数看`pagination.total_count`，覆盖完整性看`coverage`。`next_cursor`翻页，默认200条、最多500条。具体字段、复权缓存、已核实日历与限制见[证券历史契约](docs/SECURITY_HISTORY.md)。

- [证券历史K线实现与真实验收报告](docs/SECURITY_HISTORY_REPORT.md)

1.5.1修复：证券历史优先东方财富、整段腾讯备用；备用缺少逐根成交额则amount=null、quality=partial。分页默认只读绑定提供方的成功缓存，不重新请求上游；复权序列未核实不冒充成功。主源错误保留真实HTTP状态及有限正文。详见证券历史契约。

- [证券历史第二轮修复及ChatGPT线上MCP验收（1.5.1）](docs/SECURITY_HISTORY_REPAIR_REPORT.md)：含逐证券/周期结果、复权失败、上游新取与缓存的区分。
