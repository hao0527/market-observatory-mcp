import assert from 'node:assert/strict';

export async function testHistoryQuality({market,historyQuality:history,indexSources,cache,freshness,timeMeta}) {
 const originalFetch=globalThis.fetch,originalNow=Date.now;
 const at='2026-11-05T05:24:00Z';
 let checks=0;
 function valid(h){
  checks++;assert.equal(h.history_available,h.history_count>0);assert.equal(h.history_count,h.history?.length??h.history_count);
  assert.equal(h.history_supported,h.quote_source_history_supported===true||h.independent_history_supported);
  assert.equal(h.quality,h.quote_quality);assert.equal(h.history_quality,h.history_metadata.quality);
  assert.equal(h.history_metadata.market_date,h.history_market_date);
 }
 const quote=(id,extra={})=>({...market.catalog.find(m=>m.id===id),source:'新浪财经',instrument_id:id,value:105,previous_close:100,previous_date:null,change:5,change_percent:5,quality:'available',as_of:'2026-11-04T21:00:00Z',market_date:'2026-11-04',source_timezone:'Asia/Shanghai',fetched_at:at,retrieved_at:at,history:[],history_supported:false,...extra});
 const observed=(id,dates,extra={})=>quote(id,{history:dates.map((date,i)=>({date,value:100+i})),history_metadata:{source:'FRED',source_url:'https://example.test/history',instrument_id:id,source_timezone:'America/New_York',fetched_at:at,retrieved_at:at,...extra}});
 try {
  Date.now=()=>Date.parse(at);
  for(const id of ['sp500','nasdaq','dow','sox','nikkei225','kospi']){
   const h=market.presentMetric(quote(id));valid(h);
   assert.equal(h.quote_source_history_supported,false);assert.equal(h.independent_history_supported,true);assert.equal(h.history_supported,true);
   assert.equal(h.history_available,false);assert.equal(h.history_quality,'not_requested');assert(!('history'in h));
  }
  const naverCapability=history.historyState(quote('nikkei225',{source:'NAVER Finance'}));valid(naverCapability);assert.equal(naverCapability.quote_source_history_supported,true);assert.equal(naverCapability.history_available,false);
  for(const id of ['nasdaq','sox']){
   const h=history.historyState(observed(id,['2026-11-02','2026-11-03']),true);valid(h);
   assert.equal(h.quote_quality,'available');assert.equal(h.history_quality,'stale');assert.equal(h.history_stale,true);
   assert.equal(h.history_metadata.expected_last_completed_date,'2026-11-04');
   assert.equal(h.previous_close,100);assert.equal(h.change_percent,5);
  }
  const complete=history.historyState(observed('sp500',['2026-11-03','2026-11-04']),true);valid(complete);assert.equal(complete.history_quality,'available');
  const failed=history.historyState(quote('kospi',{history_error:{code:'UPSTREAM_HTTP',http_status:520,retryable:true,source_url:'https://example.test/KS11'}}),true);valid(failed);
  assert.equal(failed.history_available,false);assert.equal(failed.history_quality,'unavailable');assert.equal(failed.history_supported,true);assert.equal(failed.history_error.http_status,520);
  const badRows=history.historyState(quote('sp500',{history:[{date:'2026-02-30',value:100},{date:'2026-11-07',value:100},{date:'2026-11-04',value:NaN}]}),true);valid(badRows);assert.equal(badRows.history_count,0);
  const unsupported=await market.marketHistory('gold',true);valid(unsupported);assert.equal(unsupported.history_quality,'unsupported');assert.equal(unsupported.history_error.code,'UNSUPPORTED_HISTORY');assert.equal(unsupported.history_metadata.time_precision,'unknown');assert.equal(unsupported.history_freshness.bar_status,'unsupported');assert.equal(unsupported.history_metadata.frequency,null);
  const oil=history.historyState(quote('brent',{source:'新浪财经',instrument_id:'brent_sina_cfd',instrument_changed:true,quote_kind:'commodity_cfd',history:[{date:'2026-11-04',value:90}]}),true);valid(oil);assert.equal(oil.history_count,0);assert.equal(oil.history_supported,false);assert.equal(oil.history_quality,'unsupported');
  // Data quality is independent in both directions.
  const noQuote=history.historyState({...observed('sp500',['2026-11-04']),quality:'unavailable',value:null},true);valid(noQuote);assert.equal(noQuote.history_quality,'available');assert.equal(noQuote.quote_quality,'unavailable');

  const tokyo=observed('nikkei225',['2026-11-04','2026-11-05'],{source:'东方财富',source_timezone:'Asia/Tokyo',fetched_at:at});
  let jp=history.historyState(tokyo,true);valid(jp);assert.equal(jp.history_quality,'forming');assert.equal(jp.bar_status,'forming');
  assert.equal(jp.latest_session_date,'2026-11-05');assert.equal(jp.expected_last_completed_date,'2026-11-04');assert.equal(jp.history_freshness.expected_date_semantics,'alias_of_expected_last_completed_date');
  Date.now=()=>Date.parse('2026-11-05T03:00:00Z');jp=history.historyState({...tokyo,history_metadata:{...tokyo.history_metadata,fetched_at:'2026-11-05T03:00:00Z'}},true);valid(jp);assert.equal(jp.history_quality,'forming');assert.equal(jp.history_freshness.session_status,'lunch_break');
  Date.now=()=>Date.parse('2026-11-05T06:40:00Z');jp=history.historyState(tokyo,true);valid(jp);assert.equal(jp.history_quality,'stale');assert.equal(jp.bar_status,'forming'); // Do not relabel an old intraday cache as a final close.
  jp=history.historyState({...tokyo,history_metadata:{...tokyo.history_metadata,fetched_at:'2026-11-05T06:40:00Z'}},true);valid(jp);assert.equal(jp.history_quality,'available');assert.equal(jp.bar_status,'completed');
  Date.now=()=>Date.parse('2026-05-06T05:24:00Z');jp=history.historyState(observed('nikkei225',['2026-05-01'],{source_timezone:'Asia/Tokyo',fetched_at:'2026-05-06T05:24:00Z'}),true);valid(jp);assert.equal(jp.expected_last_completed_date,'2026-05-01');assert.equal(jp.history_quality,'available'); // JP Golden Week, not US May 5.
  Date.now=()=>Date.parse('2026-11-07T05:24:00Z');const weekend=history.historyState(observed('nikkei225',['2026-11-06'],{fetched_at:'2026-11-07T05:24:00Z'}),true);valid(weekend);assert.equal(weekend.history_quality,'available');assert.equal(weekend.expected_last_completed_date,'2026-11-06');
  Date.now=()=>Date.parse('2026-11-03T05:24:00Z');const koreanHolidayDifference=history.historyState(observed('kospi',['2026-11-03'],{market_status:{state:'OPEN',observed_at:'2026-11-03T05:24:00Z'},quote_market_date:'2026-11-03',fetched_at:'2026-11-03T05:24:00Z'}),true);valid(koreanHolidayDifference);assert.equal(koreanHolidayDifference.history_quality,'forming'); // JP Culture Day is not copied to KR.
  Date.now=()=>Date.parse('2026-11-27T18:10:00Z');const earlyClose=history.historyState(observed('sp500',['2026-11-27'],{fetched_at:'2026-11-27T18:10:00Z'}),true);valid(earlyClose);assert.equal(earlyClose.expected_last_completed_date,'2026-11-27');assert.equal(earlyClose.history_quality,'available');
  Date.now=()=>Date.parse(at);
  const kr=history.historyState(observed('kospi',['2026-11-04','2026-11-05'],{source:'NAVER Finance',source_timezone:'Asia/Seoul',market_status:{state:'OPEN',observed_at:at},quote_market_date:'2026-11-05'}),true);valid(kr);assert.equal(kr.history_quality,'forming');assert.equal(kr.expected_last_completed_date,null);assert.equal(kr.history_metadata.calendar_verified,false);
  const krUnknown=history.historyState(observed('kospi',['2026-11-04'],{source_timezone:'Asia/Seoul'}),true);valid(krUnknown);assert.equal(krUnknown.history_quality,'unknown');assert.equal(krUnknown.latest_session_date,null);assert.equal(krUnknown.history_metadata.calendar_verified,false);
  const suspended=history.historyState(observed('nikkei225',['2026-11-04'],{market_status:{state:'SUSPENDED',observed_at:at}}),true);valid(suspended);assert.equal(suspended.history_quality,'unknown');assert.equal(suspended.expected_last_completed_date,null);
  Date.now=()=>Date.parse('2030-11-05T05:24:00Z');const future=history.historyState(observed('nikkei225',['2030-11-04'],{fetched_at:'2030-11-05T05:24:00Z'}),true);valid(future);assert.equal(future.history_quality,'unknown');
  const tz=timeMeta.temporalMetadata(quote('nasdaq'));assert.equal(tz.market_timezone,'America/New_York');assert.equal(tz.source_timezone,'Asia/Shanghai');assert.equal(tz.timestamp_timezone,'UTC');assert.equal(tz.report_timezone,'Asia/Shanghai');

  // Execute all four real fallback code paths with synthetic main-source failures, never touching production.
  Date.now=()=>Date.parse(at);cache.clearQuoteMemory();let fredRequests=[];
  globalThis.fetch=async url=>{
   if(url.includes('fredgraph')){const series=new URL(url).searchParams.get('id');fredRequests.push(series);return new Response(`observation_date,${series}\n2026-11-02,99\n2026-11-03,100\n`)}
   return new Response('',{status:503});
  };
  for(const id of ['sp500','nasdaq','dow','sox']){
   const h=await history.resolveHistory(quote(id),true);valid(h);assert.equal(h.history_source,'FRED');assert.equal(h.history_quality,'stale');assert.equal(h.history_metadata.series,indexSources.fredSeries[id]);assert.equal(h.history_metadata.source_attempts[0].status,'failed');
  }
  assert.deepEqual(fredRequests.sort(),['DJIA','NASDAQCOM','NASDAQSOX','SP500']);
  globalThis.fetch=async()=>new Response('observation_date,NASDAQ100\n2026-11-04,100');
  await assert.rejects(indexSources.fredIndexHistory('nasdaq'),e=>e.issue.source==='FRED'&&e.issue.code==='INVALID_RESPONSE');

  // Actual KS11 route, all-source HTTP 520 failure, and capability vs result consistency.
  cache.clearQuoteMemory();globalThis.fetch=async()=>new Response('',{status:520});
  const kospi=await market.marketHistory('kospi',true);valid(kospi);assert.equal(kospi.history_count,0);assert.equal(kospi.history_quality,'unavailable');assert.equal(kospi.independent_history_supported,true);assert.equal(kospi.history_error.http_status,520);assert(kospi.history_error.causes.some(c=>c.source_url.includes('100.KS11')));
  // An unavailable source can deliver prior records only with explicit error/degraded flags.
  cache.clearQuoteMemory();globalThis.fetch=async()=>Response.json({data:{code:'SPX',market:100,name:'标普500',klines:['2026-11-04,100,101']}});
  const lastGood=await history.resolveHistory(quote('sp500'),true);valid(lastGood);
  globalThis.fetch=async()=>new Response('',{status:503});
  const degraded=await history.resolveHistory(quote('sp500'),true);valid(degraded);assert.equal(degraded.history_available,true);assert.equal(degraded.history_quality,'unavailable');assert.equal(degraded.history_metadata.degraded,true);assert.equal(degraded.history_fetched_at,lastGood.history_fetched_at);assert.equal(degraded.quote_quality,'available');assert.equal(degraded.history_error.http_status,503);

  Date.now=()=>Date.parse('2026-11-05T21:00:00Z');const treasuryPublished=history.historyState({...observed('us2y',['2026-11-05'],{fetched_at:'2026-11-05T21:00:00Z',data_type:'official_daily_par_yield'}),source:'U.S. Treasury',data_type:'official_daily_par_yield'},true);valid(treasuryPublished);assert.equal(treasuryPublished.history_quality,'available');
  const commodity=history.historyState(quote('brent',{source:'Yahoo Finance',quote_kind:'continuous_front_month_futures',instrument_id:'brent_front_month_continuous',market_timezone:'America/New_York',history:[{date:'2026-11-04',value:90}]}),true);valid(commodity);assert.equal(commodity.history_quality,'unknown');assert.equal(commodity.history_available,true);
  // NAVER history mapping is verified against provider identity; no data substitution.
  const priceRows=[{localTradedAt:'2026-11-04',closePrice:'2,600.00'},{localTradedAt:'2026-11-03',closePrice:'2,590.00'}];
  assert.deepEqual(indexSources.parseNaverHistory(priceRows,'kospi'),[{date:'2026-11-03',value:2590},{date:'2026-11-04',value:2600}]);
  assert.throws(()=>indexSources.parseNaverHistory([{worldIndexSymbol:'.N225',localTradedAt:'2026-11-04',closePrice:'10,000'}],'kospi'),/不匹配/);
  assert.throws(()=>indexSources.parseNaverHistory([{worldIndexSymbol:'NDX',stockExchangeType:{zoneId:'Asia/Tokyo'},localTradedAt:'2026-11-04T15:45:00+09:00',closePrice:'1,000'}],'nikkei225'),/不匹配/);
  console.log(`PASS: ${checks} history contract invariant scenarios; capability/result separation, quote/history isolation, stale/forming/unsupported/520, regional calendars, timezone meanings, four FRED fallback routes and cached-history failure`);
 } finally {globalThis.fetch=originalFetch;Date.now=originalNow;cache.clearQuoteMemory()}
}
