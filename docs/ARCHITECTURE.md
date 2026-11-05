# 每日资产观测站

Owner-private Sites dashboard and stateless MCP. Collects and decodes market data; analysis stays with the calling AI. No API keys or background crawler. Publication does not change existing automations.

## API and MCP

- `get_market_snapshot({refresh:true})`: current values only by default. Optional `include_history` / `include_raw` are additive compatibility flags.
- `get_market_history({id:"sp500",refresh:true})`: loads only that metric. Roughly one month of provider daily closes, or 22 Treasury daily values. Current-session bars may still be forming. Gold history is explicitly unsupported.
- `get_security_quotes({symbols:["sz159842","sh518850"],refresh:true,include_raw:false})`: Tencent quotes for 1–30 explicit sh/sz/bj six-digit codes. GB18030 decoding, no eval. Prices, previous close, changes, five-level book; volume in lots and turnover in ten-thousand CNY. Missing symbols are separate errors. ETF market price is not NAV.
- `get_market_catalog({})`: instrument definitions, freshness calendar coverage and cache policy.

HTTP routes: `/api/snapshot`, `/api/history?id=sp500`, `/api/quotes?symbols=sz159842,sh518850`. Use `refresh=1` to bypass the normal TTL. Web APIs use the private Sites boundary; the private plugin authenticates MCP requests.

## Resilience and timestamps

Normal quote TTL: 60 seconds globally, 5 seconds for securities. D1 `market_last_success` retains one latest successful payload per metric/security for up to 14 days; bounded in-memory caching accelerates requests. This is a last-success cache, not a daily historical archive. Expired rows are removed in bounded batches. Writes cannot replace newer quote times with older ones.

Transient network errors, timeouts and HTTP 5xx get at most two attempts; HTTP 429 switches to an independent provider without immediate retries or trying Yahoo's alternate hostname; Yahoo may then try its secondary hostname. Treasury gets a longer per-attempt timeout. Parser errors and ordinary 4xx are not retried. When upstream fails, a valid last-success record returns `degraded=true`, `quality=degraded`, `upstream_error` and `delivery=durable_cache|memory_cache`. It keeps the original quote time and `fetched_at`. `retrieved_at` is this request's delivery time, including cache hits. `refresh=true` still permits an explicitly degraded response if all attempts fail. No cached record means a per-item unavailable result.

`cache_backend=durable` means the request has the D1 backend; `cache_warning` reports cache read/write failures without hiding usable upstream data. A successful fetch is not a real-time exchange entitlement. Source errors do not discard unrelated metrics.

## Freshness and provenance

US equities use NYSE's published 2026–2028 full holidays and early close dates, converted with `America/New_York` for DST. There is a 15-minute opening grace, a 20-minute intraday delay threshold, and closing-time checks. The Treasury publication policy uses the verified 2026 SIFMA calendar; 18:30 New York time is a conservative application check threshold, NOT an official publication SLA. Outside calendar coverage, status is `unknown`, not an invented holiday schedule. Emergency closures are not inferred.

Treasury's methodological observation time is approximately 15:30 each business day; the CSV supplies a date, not an exact quote timestamp, so `as_of` stays null. Gold/Brent use weekly-session and quote-age hints only, with explicit uncertainty about provider holidays and daily maintenance. Tencent marketStat is used when recent; no individual halt is inferred from market-wide status.

Calendar sources checked 2026-11-05:
- https://www.nyse.com/trade/hours-calendars
- https://www.sifma.org/resources/general/holiday-schedule
- https://home.treasury.gov/policy-issues/financing-the-government/interest-rate-statistics

## Sources and instrument boundaries

Treasury official daily par yields: 2/10/30 years; differences in bp. Yahoo public chart endpoint: VIX/VXN/BZ=F/GSPC/IXIC/DJI/SOX; may delay, throttle or change. BZ=F is a near-month continuous futures quote, not spot or official settlement; rollover can affect comparisons.

Gold prefers Sina/Huitong `hf_XAU`, a London gold spot CFD quote (USD/troy oz). Its current price and prior settlement reference are taken from the SAME response. `previous_close_label`, `change_basis` and `change_reference.kind` preserve this distinction. Baseline date is absent upstream and stays null. Source page: https://finance.sina.com.cn/futures/quotes/XAU.shtml . This is not COMEX futures or LBMA fixing.

If Sina fails, Gold API XAU spot is a fallback with `instrument_id=gold_spot_indicative`, `instrument_changed=true`, and `source_transition.same_instrument=false`. Changes remain null. Never combine Gold API's current price with Sina's previous reference or concatenate these instruments into one historical series.

## Validation

`node scripts/test-market-data.mjs` covers parsing, units, quote arithmetic, invalid/missing values, partial failures, bounded retries, original timestamps during durable fallback, retention, holiday/DST/early-close cases, Treasury publication windows, compact projections and targeted history. `LIVE_DATA=1` additionally checks real quotes. `python scripts/test-cache-sql.py` checks the actual migration/upsert SQL. Run TypeScript and Sites production build before deployment.

## Independent fallback sources

When Yahoo is unavailable, VIX/VXN use Cboe's official daily CSV (daily closes, never labelled intraday). SP500/Nasdaq/Dow/SOX use Sina quotes for the same indices; timestamps are provider update times, not tick times. Sina quotes have no daily history; get_market_history reads independent Eastmoney/Nasdaq histories with FRED backup and separate history_metadata. See DATA_CONTRACT.md for v1.3 Asian indices, precision, calendar coverage and null index order books. Failures are structured and source transitions stay explicit.

Brent can fall back to Sina `hf_OIL`, labelled as a CFD backup with `instrument_id=brent_sina_cfd` and `instrument_changed=true`; no exact match to the Yahoo futures contract is asserted. Its changes use the same response's prior settlement reference; no cross-provider price arithmetic. The caller must not concatenate these different contracts into one history.

Source references: https://www.cboe.com/tradable-products/vix/vix-historical-data , https://finance.sina.com.cn/stock/usstock/sector.shtml , and the `source_url` on each result.
