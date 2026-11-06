import assert from 'node:assert/strict';

// Small deterministic fixtures, not a substitute for LIVE_VOLATILITY or online acceptance.
export async function testVolatility({volatility:v,market,historyQuality,cache,mcp}) {
 const originalFetch=globalThis.fetch,originalNow=Date.now;
 const at='2026-11-06T01:00:00Z';
 let checks=0;
 const check=fn=>{fn();checks++};
 const rows=[
  {rowDateTimestamp:'2026-11-05T00:00:00Z',last_close:'28.18',last_open:'17.14',last_max:'28.36',last_min:'16.70',last_closeRaw:'28.18000030517578'},
  {rowDateTimestamp:'2026-11-04T00:00:00Z',last_close:'16.61',last_open:'19.20',last_max:'19.22',last_min:'16.57'},
  {rowDateTimestamp:'2026-11-03T00:00:00Z',last_close:'20.83',last_open:'20.00',last_max:'21.00',last_min:'19.00'},
 ];
 const state=()=>({indexStore:{instrument:{base:{id:'1096487',type:'index',isCfd:false},name:{symbol:'VIX'},exchange:{exchange:'CBOE'}}},historicalDataStore:{timeFrame:'Daily',historicalData:{data:structuredClone(rows)}}});
 const page=(s=state())=>'<html><script id="__NEXT_DATA__" type="application/json">'+JSON.stringify({props:{pageProps:{state:s,accessToken:'must-not-be-retained'}}})+'</script></html>';
 const csv=(id='vix',latest=false)=>id==='vxn'?'DATE,OPEN,HIGH,LOW,CLOSE\n11/03/2026,25,26,24,26.00\n11/04/2026,25,26,24,25.08\n11/05/2026,30,39,29,38.26':`DATE,OPEN,HIGH,LOW,CLOSE\n11/03/2026,20,21,19,20.83\n11/04/2026,19.20,19.22,16.57,16.61${latest?'\n11/05/2026,17.14,28.36,16.70,28.18':''}`;
 const observation=()=>({symbol:'_VIX',timestamp:'2026-11-06 01:00:00',data:{symbol:'^VIX',security_type:'index',close:28.18,current_price:28.18,prev_day_close:16.61,last_trade_time:'2026-11-05T16:15:01'}});
 const response=(value,status=200)=>typeof value==='string'?new Response(value,{status}):Response.json(value,{status});
 const requests=[];
 const normal=async url=>{
  requests.push(url);
  if(url.includes('finance.yahoo'))return response('rate limited',429);
  if(url.includes('daily_prices/VIX_'))return response(csv());
  if(url.includes('daily_prices/VXN_'))return response(csv('vxn'));
  if(url.includes('investing.com'))return response(page());
  if(url.includes('quotes/_VIX'))return response(observation());
  if(url.includes('fredgraph'))return response('observation_date,VXNCLS\n2026-11-03,26.00\n2026-11-04,25.08\n');
  return response('isolated upstream failure',520);
 };
 const yahoo=(dates,closes,price=999)=>({chart:{result:[{meta:{symbol:'^VIX',regularMarketPrice:price},timestamp:dates.map(d=>Date.parse(d+'T14:30:00-05:00')/1000),indicators:{quote:[{close:closes}]}}]}});
 try {
  Date.now=()=>Date.parse(at);
  const parsed=v.parseInvestingVix(page());
  check(()=>assert.deepEqual(parsed.points.map(p=>p.value),[20.83,16.61,28.18]));
  check(()=>assert(!JSON.stringify(parsed.raw).includes('must-not-be-retained')));
  for(const mutate of [s=>s.indexStore.instrument.base.id='44336',s=>s.indexStore.instrument.base.isCfd=true,s=>s.indexStore.instrument.base.type='futures',s=>s.indexStore.instrument.name.symbol='SPX',s=>s.indexStore.instrument.exchange.exchange='NYSE',s=>s.historicalDataStore.timeFrame='Weekly']){
   const s=state();mutate(s);check(()=>assert.throws(()=>v.parseInvestingVix(page(s)),e=>e.issue.code==='INSTRUMENT_MISMATCH'));
  }
  for(const mutate of [s=>s.historicalDataStore.historicalData.data[0].last_max='1',s=>s.historicalDataStore.historicalData.data[0].rowDateTimestamp='2026-11-05T12:00:00Z',s=>s.historicalDataStore.historicalData.data.push({...rows[0],last_close:'28.00'})]){
   const s=state();mutate(s);check(()=>assert.throws(()=>v.parseInvestingVix(page(s)),e=>e.issue.code==='INVALID_RESPONSE'));
  }
  check(()=>assert.throws(()=>v.parseInvestingVix('<html>not history</html>'),e=>e.issue.code==='INVALID_RESPONSE'));
  check(()=>assert.deepEqual(v.parseYahooDaily(yahoo(['2026-11-04','2026-11-05'],[16.61,28.18]),'vix'),[{date:'2026-11-04',value:16.61},{date:'2026-11-05',value:28.18}]));
  const before='2026-11-05T21:14:00Z',buffer='2026-11-05T21:20:00Z',after='2026-11-05T21:30:00Z';
  for(const time of [before,buffer])check(()=>assert.equal(v.parseYahooDaily(yahoo(['2026-11-04','2026-11-05'],[16.61,999]),'vix',Date.parse(time)).at(-1).date,'2026-11-04'));
  check(()=>assert.equal(v.parseYahooDaily(yahoo(['2026-11-04','2026-11-05'],[16.61,28.18]),'vix',Date.parse(after)).at(-1).date,'2026-11-05'));
  // 09:00 Beijing across winter/summer, weekends, holiday and unverified special close.
  for(const [time,expected] of [[at,'2026-11-05'],['2026-07-09T01:00:00Z','2026-07-08'],['2026-11-09T01:00:00Z','2026-11-06'],['2026-11-27T01:00:00Z','2026-11-25'],[before,'2026-11-04'],['2026-11-05T21:15:00Z','2026-11-05']])check(()=>assert.equal(v.volatilitySession(Date.parse(time)).expected_last_completed_date,expected));
  check(()=>assert.equal(v.volatilitySession(Date.parse('2026-11-27T18:30:00Z')).calendar_verified,false));
  check(()=>assert.equal(v.volatilitySession(Date.parse('2030-11-06T01:00:00Z')).expected_last_completed_date,null));
  const previous={date:'2026-11-04',value:16.61};
  check(()=>assert.equal(v.validateCloseObservation(observation(),'vix','2026-11-05',28.18,previous).status,'matched_official_close_window'));
  const zoned=observation();zoned.data.last_trade_time='2026-11-05T15:15:01.239000-06:00';
  check(()=>assert.equal(v.validateCloseObservation(zoned,'vix','2026-11-05',28.18,previous).status,'matched_official_close_window'));
  check(()=>assert.equal(v.validateCloseObservation(zoned,'vix','2026-11-05',28.18,previous).observation_as_of,'2026-11-05T21:15:01.239Z'));
  for(const mutate of [o=>o.data.last_trade_time='2026-11-05T15:59:00',o=>o.data.last_trade_time='2026-11-04T16:15:01',o=>o.data.prev_day_close=20,o=>o.data.current_price=30,o=>o.symbol='_VX',o=>o.data.security_type='future']){
   const o=observation();mutate(o);check(()=>assert.equal(v.validateCloseObservation(o,'vix','2026-11-05',28.18,previous).status,'not_confirmed'));
  }
  globalThis.fetch=normal;cache.clearQuoteMemory();
  const result=await market.marketHistory('vix',true);
  check(()=>assert.deepEqual([result.value,result.market_date,result.previous_close,result.previous_date],[28.18,'2026-11-05',16.61,'2026-11-04']));
  check(()=>assert(Math.abs(result.change_percent-69.65683323299218)<1e-9));
  check(()=>assert.equal(result.source,'Investing.com'));
  check(()=>assert.equal(result.data_type,'provider_daily_index_close'));
  check(()=>assert.equal(result.daily_close_validation.official_daily_file_confirmed,false));
  check(()=>assert.equal(result.daily_close_validation.official_close_window_confirmed,true));
  check(()=>assert.equal(result.daily_close_validation.independent_latest_daily_confirmed,false));
  check(()=>assert(result.daily_close_validation.comparisons.some(c=>c.role==='previous_close'&&c.source==='Cboe'&&c.match)));
  check(()=>assert.equal(result.history_quality,'available'));
  check(()=>assert.equal(result.quote_quality,'available'));
  check(()=>assert.equal(result.history_source,result.quote_source));
  check(()=>assert.deepEqual(result.history,parsed.points));
  check(()=>assert.equal(result.history_count,3));
  check(()=>assert.equal(result.history_refresh_status,'succeeded'));
  check(()=>assert.equal(result.fallback_used,true));
  check(()=>assert.equal(result.primary_error.http_status,429));
  check(()=>assert.equal(result.as_of,null));
  check(()=>assert.equal(result.history_metadata.bar_status,'completed'));
  check(()=>assert.equal(result.history_metadata.daily_close_validation.official_daily_file_confirmed,false));
  check(()=>assert.equal(requests.filter(u=>u.includes('finance.yahoo')).length,1));
  // Current D1 cache remains usable on total refresh failure without becoming fresh upstream.
  const saved=new Map(),backend={read:async key=>saved.get(key)??null,write:async record=>saved.set(record.key,record)};
  cache.clearQuoteMemory();await cache.runWithQuoteCache(backend,()=>market.marketHistory('vix',true));
  const originalStamp=saved.get('global-daily-close-v1:vix').payload.fetched_at;
  cache.clearQuoteMemory();globalThis.fetch=async()=>response('isolated error',520);Date.now=()=>Date.parse(at)+120000;
  const cached=await cache.runWithQuoteCache(backend,()=>market.marketHistory('vix',true));
  check(()=>assert.equal(cached.history_quality,'available'));
  check(()=>assert.equal(cached.history_degraded,true));
  check(()=>assert.equal(cached.history_refresh_status,'failed'));
  check(()=>assert.equal(cached.history_fetched_at,originalStamp));
  check(()=>assert.notEqual(cached.history_retrieved_at,originalStamp));
  Date.now=()=>Date.parse('2026-11-07T01:00:00Z');cache.clearQuoteMemory();
  const older=await cache.runWithQuoteCache(backend,()=>market.marketHistory('vix',true));
  check(()=>assert.equal(older.history_quality,'stale'));
  check(()=>assert.equal(older.quote_quality,'stale'));
  check(()=>assert.equal(older.history_available,true));
  // Legacy intraday payloads cannot be promoted to official daily closes.
  Date.now=()=>Date.parse(at);cache.clearQuoteMemory();
  const legacy={key:'global:vix',payload:{value:999,market_date:'2026-11-05',as_of:'2026-11-05T20:00:00Z',source:'Yahoo Finance',fetched_at:at},data_time:'2026-11-05T20:00:00Z',fetched_at:at,expires_at:'2026-11-19T01:00:00Z'};
  const legacyOnly={read:async key=>key==='global:vix'?legacy:null,write:async()=>{}};
  const noLegacy=await cache.runWithQuoteCache(legacyOnly,()=>market.marketHistory('vix',true));
  check(()=>assert.equal(noLegacy.value,null));
  check(()=>assert.equal(noLegacy.history_available,false));
  // HTTP 200 with an old daily file must not stop the independent daily attempt.
  globalThis.fetch=async url=>url.includes('investing.com')?response(page({...state(),historicalDataStore:{timeFrame:'Daily',historicalData:{data:rows.slice(1)}}})):normal(url);
  cache.clearQuoteMemory();const stale=await market.marketHistory('vix',true);
  check(()=>assert.equal(stale.market_date,'2026-11-04'));
  check(()=>assert.equal(stale.history_quality,'stale'));
  check(()=>assert.equal(stale.quote_quality,'stale'));
  check(()=>assert.equal(stale.source,'Cboe'));
  check(()=>assert(stale.source_attempts.some(a=>a.source==='Investing.com'&&a.status==='succeeded')));
  // Failure of the independent provider also preserves explicit stale/error metadata.
  globalThis.fetch=async url=>url.includes('investing.com')?response('blocked',503):normal(url);
  cache.clearQuoteMemory();const blocked=await market.marketHistory('vix',true);
  check(()=>assert.equal(blocked.quote_quality,'stale'));
  check(()=>assert.equal(blocked.source_attempts.find(a=>a.source==='Investing.com').error.http_status,503));
  // Same-date conflicts cannot be advertised as fully verified.
  globalThis.fetch=async url=>url.includes('finance.yahoo')?response(yahoo(['2026-11-04','2026-11-05'],[16.61,28.00])):normal(url);
  cache.clearQuoteMemory();const conflict=await market.marketHistory('vix',true);
  check(()=>assert.equal(conflict.daily_close_validation.status,'conflict'));
  check(()=>assert.equal(conflict.quote_quality,'partial'));
  check(()=>assert.equal(conflict.history_quality,'available')); // Date freshness is separate from cross-source validation.
  check(()=>assert(conflict.warnings.includes('DAILY_CLOSE_CONFLICT')));
  const onlyLast={...state(),historicalDataStore:{timeFrame:'Daily',historicalData:{data:[rows[0]]}}};
  globalThis.fetch=async url=>url.includes('investing.com')?response(page(onlyLast)):normal(url);
  const missingPrevious=await v.volatilityDaily('vix');
  check(()=>assert.equal(missingPrevious.previous_close,null));
  check(()=>assert.equal(missingPrevious.change_percent,null));
  check(()=>assert.equal(missingPrevious.quality,'partial'));
  check(()=>assert.equal(missingPrevious.history.length,1));
  globalThis.fetch=async url=>url.includes('daily_prices/VIX_')?response(csv('vix',true)):normal(url);
  const official=await v.volatilityDaily('vix');
  check(()=>assert.equal(official.source,'Cboe'));
  check(()=>assert.equal(official.daily_close_validation.official_daily_file_confirmed,true));
  check(()=>assert.equal(official.daily_close_validation.independent_latest_daily_confirmed,true));
  check(()=>assert.equal(official.data_type,'official_daily_index_close'));
  // Snapshot consistency is diagnostic, with no mutation of quotes or dates.
  const mismatched=[{id:'vix',value:16.61,market_date:'2026-11-04'},{id:'vxn',value:38.26,market_date:'2026-11-05'}],copy=structuredClone(mismatched);
  check(()=>assert.equal(v.volatilityDateConsistency(mismatched).status,'date_mismatch'));
  check(()=>assert.deepEqual(mismatched,copy));
  check(()=>assert.equal(v.volatilityDateConsistency([{...mismatched[0],market_date:'2026-11-05'},mismatched[1]]).status,'aligned_latest_completed'));
  check(()=>assert.equal(v.volatilityDateConsistency([mismatched[0]]).status,'unavailable'));
  globalThis.fetch=normal;cache.clearQuoteMemory();const snapshot=await market.snapshot({refresh:true});
  check(()=>assert.equal(snapshot.metrics.length,13));
  check(()=>assert.equal(snapshot.volatility_date_consistency.status,'aligned_latest_completed'));
  const catalog=await mcp.callMarketTool('get_market_catalog');
  check(()=>assert.equal(catalog.volatility_contract.investing_vix.is_cfd,false));
  const request=new Request('https://test.local/mcp',{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'get_market_history',arguments:{id:'vix',refresh:true}}})});
  const tool=(await (await mcp.POST(request)).json()).result;
  check(()=>assert.equal(tool.isError,false));
  check(()=>assert.equal(JSON.parse(tool.content[0].text).market_date,'2026-11-05'));
  // A late, older refreshed file must not evict a more recent validated D1 record.
  cache.clearQuoteMemory();const store=new Map(),persist={read:async key=>store.get(key)??null,write:async record=>store.set(record.key,record)};
  await cache.runWithQuoteCache(persist,()=>market.marketHistory('vix',true));cache.clearQuoteMemory();
  globalThis.fetch=async url=>url.includes('investing.com')?response('failed',503):normal(url);
  const kept=await cache.runWithQuoteCache(persist,()=>market.marketHistory('vix',true));
  check(()=>assert.equal(kept.market_date,'2026-11-05'));
  check(()=>assert.equal(kept.history_degraded,true));
  check(()=>assert.equal(kept.history_refresh_error.code,'INCOMPLETE_HISTORY_REFRESH'));
  console.log(`PASS: ${checks} volatility daily-close scenarios; stale-200 fallback, non-CFD identity, completed-only Yahoo, independent dates/previous close, official file vs observation, conflicts, 09:00/DST/holidays, durable failure/legacy isolation, VIX/VXN consistency and MCP adapter`);
 } finally {globalThis.fetch=originalFetch;Date.now=originalNow;cache.clearQuoteMemory()}
}
