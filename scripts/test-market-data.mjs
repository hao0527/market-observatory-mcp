// Test financial wire-format failures and MCP contracts without relying on a live market.
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
const dir = await mkdtemp(join(tmpdir(), 'asset-data-test-'));
const realFetch = globalThis.fetch;
const realNow = Date.now;
try {
  for (const [input, output, imports] of [
    ['lib/upstream.ts','upstream.mjs',{}],
    ['lib/quote-cache.ts','quote-cache.mjs',{'./upstream':'./upstream.mjs'}],
    ['lib/freshness.ts','freshness.mjs',{}],
    ['lib/tencent.ts', 'tencent.mjs', {'./upstream':'./upstream.mjs','./quote-cache':'./quote-cache.mjs','./freshness':'./freshness.mjs'}],
    ['lib/gold.ts', 'gold.mjs', {'./tencent':'./tencent.mjs','./upstream':'./upstream.mjs'}],
    ['lib/backup-sources.ts','backup-sources.mjs',{'./upstream':'./upstream.mjs','./tencent':'./tencent.mjs'}],
    ['lib/market.ts', 'market.mjs', {'./backup-sources':'./backup-sources.mjs','./gold':'./gold.mjs','./upstream':'./upstream.mjs','./quote-cache':'./quote-cache.mjs','./freshness':'./freshness.mjs'}],
    ['app/mcp/route.ts', 'mcp.mjs', {'@/lib/market':'./market.mjs','@/lib/tencent':'./tencent.mjs','@/lib/freshness':'./freshness.mjs','@/lib/upstream':'./upstream.mjs'}],
  ]) {
    let code = ts.transpileModule(await readFile(input, 'utf8'), {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
    for (const [from,to] of Object.entries(imports)) code = code.replaceAll(`'${from}'`, `'${to}'`).replaceAll(`"${from}"`, `"${to}"`);
    await writeFile(join(dir,output), code);
  }
  const tencent = await import(pathToFileURL(join(dir,'tencent.mjs')));
  const gold = await import(pathToFileURL(join(dir,'gold.mjs')));
  const cache = await import(pathToFileURL(join(dir,'quote-cache.mjs')));
  const freshness = await import(pathToFileURL(join(dir,'freshness.mjs')));
  const backups=await import(pathToFileURL(join(dir,'backup-sources.mjs')));
  const market = await import(pathToFileURL(join(dir,'market.mjs')));
  const upstream = await import(pathToFileURL(join(dir,'upstream.mjs')));
  const mcp = await import(pathToFileURL(join(dir,'mcp.mjs')));
  const fields = Array(90).fill('');
  Object.assign(fields, {0:'51',1:'ETF test',2:'159842',3:'0.972',4:'0.974',5:'0.969',6:'193222',9:'0.971',10:'4150',19:'0.972',20:'22075',30:'20261105094830',31:'-0.002',32:'-0.21',33:'0.975',34:'0.967',37:'1877',38:'0.24'});
  const q = tencent.parseTencentQuote('sz159842',fields,'2026-11-05T01:48:35Z');
  assert.equal(q.as_of,'2026-11-05T01:48:30.000Z');
  assert.equal(q.quality,'available');
  assert(Math.abs(q.change + 0.002) < 1e-9);
  assert(Math.abs(q.change_percent - ((0.972 / 0.974 - 1) * 100)) < 1e-9);
  assert.equal(q.order_book.bids[0].price,0.971);
  assert.equal(q.order_book.asks[0].volume_lots,22075);
  assert.equal(q.volume_lots,193222);
  assert.equal(q.turnover_wan_cny,1877);
  assert.equal(q.previous_date,null); // Never invent yesterday's trading date.
  assert.equal(q.is_realtime,null); // Fetch success is not an exchange latency guarantee.
  assert.equal(tencent.quoteTime('20260230094830'),null);
  assert.equal(tencent.quoteTime('20261105254830'),null);
  assert.throws(()=>tencent.parseTencentQuote('sh518850',fields,'2026-11-05T01:48:35Z'),/不匹配/);
  assert.throws(()=>tencent.parseTencentQuote('sz159842',[],''),/不完整/);
  for (const bad of ['', '0', 'NaN']) {
    const missing = [...fields];missing[3] = bad;
    const result = tencent.parseTencentQuote('sz159842',missing,'2026-11-05T01:48:35Z');
    assert.equal(result.value,null);assert.equal(result.change,null);assert.equal(result.quality,'partial');
  }
  const missingPrevious = [...fields];missingPrevious[4]='';
  assert.equal(tencent.parseTencentQuote('sz159842',missingPrevious,'2026-11-05T01:48:35Z').change_percent,null);
  const stale = tencent.parseTencentQuote('sz159842',fields,'2026-11-05T02:00:00Z',{state:'trading',as_of:'2026-11-05T02:00:00Z'});
  assert.equal(stale.quality,'stale');
  const noClock = [...fields];noClock[30]='';
  assert.equal(tencent.parseTencentQuote('sz159842',noClock,'2026-11-05T01:48:35Z').quality,'partial');
  for (const bad of [[],['159842'],['https://example.com/'],['sh600519&x=1'],Array(31).fill('sz159842')]) assert.throws(()=>tencent.validateSymbols(bad));
  assert.deepEqual(tencent.validateSymbols(['SZ159842','sz159842','sh518850']),['sz159842','sh518850']);
  const wire = `v_sz159842="${fields.join('~')}";\nv_pv_none_match="1";`;
  assert.equal(tencent.extractTencentRecords(wire).size,1);
  // Never execute quote JavaScript: only recognized assignment records are parsed.
  globalThis.quoteInjectionExecuted = false;
  tencent.extractTencentRecords(wire + ';globalThis.quoteInjectionExecuted=true;');
  assert.equal(globalThis.quoteInjectionExecuted,false);
  delete globalThis.quoteInjectionExecuted;

  Date.now = () => Date.parse('2026-11-05T01:48:35Z');
  const goldWire = 'var hq_str_hf_XAU="4127.15,4060.010,4127.15,4127.50,4129.21,4057.76,09:48:00,4060.01,4064.10,0,0,0,2026-11-05,伦敦金（现货黄金）";';
  const g = gold.parseSinaGold(goldWire);
  assert.equal(g.previous_close,4060.01);
  assert(Math.abs(g.change-67.14)<1e-8);
  assert(Math.abs(g.change_percent-((4127.15/4060.01-1)*100))<1e-8);
  assert.equal(g.as_of,'2026-11-05T01:48:00.000Z');
  assert.equal(g.data_type,'spot_cfd_quote');
  assert.equal(g.change_basis,'same_provider_previous_settlement_reference');
  assert.equal(g.previous_date,null);
  assert.equal(gold.parseSinaGold(goldWire.replace(',4060.01,',',0,')).change,null);
  assert.throws(()=>gold.parseSinaGold(goldWire.replace('2026-11-05','2026-10-01')),/时间/);
  assert.throws(()=>gold.parseSinaGold(goldWire.replace('伦敦金（现货黄金）','COMEX Gold')),/品种/);
  const fallback = gold.parseGoldApi({price:4110,symbol:'XAU',currency:'USD',updatedAt:'2026-11-05T01:48:00Z'},'Sina unavailable');
  assert.equal(fallback.value,4110);assert.equal(fallback.previous_close,null);assert.equal(fallback.change_percent,null);assert.equal(fallback.fallback_used,true);
  assert.throws(()=>gold.parseGoldApi({price:4110,symbol:'XAG',updatedAt:'2026-11-05T01:48:00Z'},''),/品种/);

  let calls = 0;
  globalThis.fetch = async () => {calls++;return new Response(wire)};
  const partial = await tencent.getSecurityQuotes(['sz159842','sh999999'],true,true);
  assert.equal(partial.quotes[0].value,0.972);assert.equal(partial.quotes[0].raw.fields[1],'ETF test');
  assert.equal(partial.quotes[1].quality,'unavailable');assert.equal(partial.coverage.available,1);
  const cached = await tencent.getSecurityQuotes(['sz159842','sh999999'],false,true);
  assert.equal(cached.quotes[0].delivery,'memory_cache');assert.equal(cached.quotes[1].quality,'unavailable');assert.equal(calls,2);
  assert.equal((await tencent.getSecurityQuotes(['sz159842'],false)).cache_hit,true);
  await tencent.getSecurityQuotes(['sz159842','sh999999'],true,true);assert.equal(calls,3);
  globalThis.fetch = async url => url.includes('sinajs') ? new Response('unavailable',{status:503}) : Response.json({price:4110,symbol:'XAU',currency:'USD',updatedAt:'2026-11-05T01:48:00Z'});
  assert.equal((await gold.goldQuote()).previous_close,null);

  // Cache survives a fresh worker via a supplied durable backend; never retimestamp old data.
  cache.clearQuoteMemory();
  const saved=new Map();
  const backend={read:async key=>saved.get(key)||null,write:async record=>{saved.set(record.key,record)}};
  const sourceTime='2026-11-05T01:48:30Z',successTime='2026-11-05T01:48:35Z';
  const loader=async()=>({value:10,as_of:sourceTime,market_date:'2026-11-05',fetched_at:successTime});
  await cache.runWithQuoteCache(backend,()=>cache.loadQuote('durable-test',loader,{refresh:true}));
  assert(saved.has('durable-test'));
  cache.clearQuoteMemory();
  const fail=async()=>{throw new upstream.DataError({code:'UPSTREAM_NETWORK',message:'offline',retryable:true})};
  const degraded=await cache.runWithQuoteCache(backend,()=>cache.loadQuote('durable-test',fail,{refresh:true}));
  assert.equal(degraded.delivery,'durable_cache');assert.equal(degraded.degraded,true);
  assert.equal(degraded.as_of,sourceTime);assert.equal(degraded.fetched_at,successTime);assert.equal(degraded.upstream_error.code,'UPSTREAM_NETWORK');
  Date.now=()=>Date.parse('2026-12-01T01:00:00Z');cache.clearQuoteMemory();
  await assert.rejects(cache.runWithQuoteCache(backend,()=>cache.loadQuote('durable-test',fail,{refresh:true})));
  Date.now=()=>Date.parse('2026-11-05T01:48:35Z');
  cache.clearQuoteMemory();
  await assert.rejects(cache.loadQuote('empty-failure',fail,{refresh:true}));
  await assert.rejects(cache.runWithQuoteCache(backend,()=>cache.loadQuote('durable-test',async()=>{throw new upstream.DataError({code:'NO_QUOTE',message:'missing',retryable:false})},{refresh:true})),/missing/);
  let retryCalls=0;
  globalThis.fetch=async()=>{retryCalls++;return retryCalls===1?new Response('',{status:503}):new Response('ok')};
  assert.equal((await upstream.fetchText('https://test.local/')).attempts,2);
  retryCalls=0;globalThis.fetch=async()=>{retryCalls++;return new Response('',{status:404})};
  await assert.rejects(upstream.fetchText('https://test.local/'));assert.equal(retryCalls,1);
  retryCalls=0;globalThis.fetch=async()=>{retryCalls++;return new Response('',{status:429,headers:{'Retry-After':'60'}})};
  await assert.rejects(upstream.fetchText('https://test.local/'),e=>e.issue.retry_after_seconds===60);assert.equal(retryCalls,1);

  const eq=(day,as_of,now)=>freshness.freshness({market_date:day,as_of},'equity',Date.parse(now));
  assert.equal(eq('2026-11-04','2026-11-04T21:00:00Z','2026-11-05T01:00:00Z').stale,false);
  assert.equal(eq('2026-11-03','2026-11-03T21:00:00Z','2026-11-05T01:00:00Z').stale,true);
  assert.equal(eq('2026-07-02','2026-07-02T20:00:00Z','2026-07-03T16:00:00Z').stale,false); // Independence holiday.
  assert.equal(eq('2026-11-27','2026-11-27T18:00:00Z','2026-11-29T12:00:00Z').stale,false); // Early close + weekend.
  assert.equal(eq('2026-11-27','2026-11-27T15:00:00Z','2026-11-29T12:00:00Z').stale,true);
  assert.equal(eq('2026-11-05','2026-11-05T14:31:00Z','2026-11-05T15:10:00Z').stale,true); // Old intraday quote.
  assert.equal(eq('2026-07-02','2026-07-02T20:00:00Z','2026-07-06T13:35:00Z').status,'awaiting_update'); // DST + first minutes.
  assert.equal(eq('2030-11-04','2030-11-04T21:00:00Z','2030-11-05T01:00:00Z').status,'unknown');
  const treasury=(date,now)=>freshness.freshness({market_date:date,as_of:null},'treasury',Date.parse(now));
  assert.equal(treasury('2026-11-04','2026-11-05T20:00:00Z').status,'awaiting_publication');
  assert.equal(treasury('2026-11-04','2026-11-06T01:00:00Z').stale,true);
  assert.equal(treasury('2026-11-10','2026-11-12T01:00:00Z').stale,false); // Veterans Day distinct from stocks.
  assert.equal(treasury('2027-11-10','2027-11-12T01:00:00Z').status,'unknown');
  assert.equal(freshness.freshness({as_of:'2026-11-05T01:00:00Z'},'commodity',Date.parse('2026-11-05T02:00:00Z')).status,'suspect_stale');
  assert.deepEqual(market.treasuryHistory('Date,"2 Yr"\n\n11/04/2026,4.58\n11/03/2026,N/A\nnot-a-date,4.4','2 Yr'),[{date:'2026-11-04',value:4.58}]);

  // One-metric history must not fetch other providers. Compact snapshots exclude raw/history by default.
  cache.clearQuoteMemory();let requested=[];
  globalThis.fetch=async url=>{
    requested.push(url);
    const symbol=decodeURIComponent(url.match(/chart\/([^?]+)/)?.[1]||'');
    return Response.json({chart:{result:[{meta:{symbol,regularMarketTime:Date.parse('2026-11-04T21:00:00Z')/1000,regularMarketPrice:105,exchangeTimezoneName:'America/New_York'},timestamp:[Date.parse('2026-11-03T21:00:00Z')/1000,Date.parse('2026-11-04T21:00:00Z')/1000],indicators:{quote:[{close:[100,105]}]}}]}});
  };
  const one=await market.marketHistory('sp500',true);assert.equal(requested.length,1);assert.equal(one.history.length,2);assert(requested[0].includes('GSPC'));
  const compact=market.presentMetric({...one,raw_fields:['secret-wire']});assert(!('history'in compact));assert(!('raw_fields'in compact));
  assert.equal(market.presentMetric(one,true).history.length,2);
  const partialFailure=await market.snapshot({refresh:true});assert.equal(partialFailure.metrics.length,11);assert(!partialFailure.metrics.some(m=>'history'in m));
  const cboe=backups.parseCboeHistory('DATE,OPEN,HIGH,LOW,CLOSE\n11/03/2026,21,22,20,20.83\n11/04/2026,19,20,16,16.61','vix');
  assert.equal(cboe.value,16.61);assert.equal(cboe.previous_close,20.83);assert.equal(cboe.as_of,null);
  assert.equal(freshness.freshness(cboe,'equity',Date.parse('2026-11-05T16:00:00Z')).stale,false); // Daily fallback is not expected to update intraday.
  const gb=Array(30).fill('');Object.assign(gb,{0:'标普500指数',1:'7688.6201',3:'2026-11-05 05:51:25',26:'7568.9199'});
  const sinaIndex=backups.parseSinaBackup('var hq_str_gb_$inx="'+gb.join(',')+'";','sp500');
  assert.equal(sinaIndex.market_date,'2026-11-04');assert.equal(sinaIndex.as_of,'2026-11-04T21:51:25.000Z');assert.equal(sinaIndex.instrument_changed,false);assert.equal(sinaIndex.previous_close,7568.9199);
  const oil=backups.parseSinaBackup('var hq_str_hf_OIL="94.355,,94.300,94.320,94.760,93.440,09:48:00,94.620,94.620,0,2,2,2026-11-05,布伦特原油,16257";','brent');
  assert.equal(oil.instrument_changed,true);assert.equal(oil.quote_kind,'commodity_cfd');assert.equal(oil.previous_close,94.62);assert.equal(oil.history_supported,false);
  assert.throws(()=>backups.parseSinaBackup('var hq_str_gb_$inx="'+gb.join(',').replace('标普500指数','unrelated')+'";','sp500'),/品种/);
  const request = (method,params) => new Request('https://test.local/mcp',{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
  const listed = await (await mcp.POST(request('tools/list'))).json();
  assert(listed.result.tools.some(tool=>tool.name==='get_security_quotes'));
  const invalid = await (await mcp.POST(request('tools/call',{name:'get_security_quotes',arguments:{symbols:['159842']}}))).json();
  assert.equal(invalid.result.isError,true);
  const history = await (await mcp.POST(request('tools/call',{name:'get_market_history',arguments:{id:'gold'}}))).json();
  assert.equal(history.result.isError,true);
  const discover = await (await mcp.POST(request('server/discover'))).json();
  assert.deepEqual(discover.result.supportedVersions,['2026-07-28']);
  console.log('PASS: quote arithmetic, field units, GBK record parsing, missing/zero prices, timestamps, stale quotes, symbol validation, partial failures, cache/refresh, gold baseline/fallback, MCP contracts');
  console.log('PASS: durable fallback with original timestamps, retry bounds, US sessions/holidays/DST/early close, Treasury publishing window, compact snapshots, isolated history, partial source failure');
  if (process.env.LIVE_DATA === '1') {
    cache.clearQuoteMemory();
    globalThis.fetch = realFetch;Date.now = realNow;
    const [quotes, goldQuote] = await Promise.all([tencent.getSecurityQuotes(['sz159842','sh518850','sh600519','bj920002','sh999999'],true,true),gold.goldQuote()]);
    console.log(JSON.stringify({live_securities:quotes.quotes.map(q=>({symbol:q.symbol,name:q.name,value:q.value,previous_close:q.previous_close,change_percent:q.change_percent,quality:q.quality,as_of:q.as_of})),gold:{name:goldQuote.name,value:goldQuote.value,previous_close:goldQuote.previous_close,change:goldQuote.change,change_percent:goldQuote.change_percent,as_of:goldQuote.as_of,basis:goldQuote.change_basis,fallback_used:goldQuote.fallback_used}},null,2));
    assert.equal(quotes.coverage.available,4);
    assert.equal(quotes.quotes.at(-1).quality,'unavailable');
    assert(!quotes.quotes[0].name.includes('\ufffd'));
    assert.equal(goldQuote.fallback_used,false);
    assert(goldQuote.previous_close > 0);
  }
} finally {
  globalThis.fetch = realFetch;Date.now = realNow;
  await rm(dir,{recursive:true,force:true});
}
