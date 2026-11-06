import assert from 'node:assert/strict';

export async function testSnapshotMetadata({market,cache}) {
 const OriginalDate=Date,originalFetch=fetch;
 let clock=OriginalDate.parse('2026-11-06T08:00:00Z'),checks=0;
 const check=fn=>{fn();checks++};
 class FixedDate extends OriginalDate {constructor(...args){if(args.length)super(...args);else super(clock)}static now(){return clock}}
 try {
  globalThis.Date=FixedDate;
  const at='2026-11-06T08:00:00.000Z';
  const sample=[{quality:'available',fetched_at:'2026-11-06T07:00:00Z'},{quality:'partial',fetched_at:'2026-11-06T07:30:00+00:00'},{quality:'degraded',fetched_at:'2026-11-06T06:00:00Z'},{quality:'stale',fetched_at:null},{quality:'unavailable',fetched_at:'invalid'},{quality:'unknown'},{quality:'future_quality'},{quality:null}];
  const copy=structuredClone(sample),s=market.snapshotMetadata(sample,at);
  check(()=>assert.equal(s.fetched_at,'2026-11-06T07:30:00.000Z'));
  check(()=>assert.equal(s.oldest_fetched_at,'2026-11-06T06:00:00.000Z'));
  check(()=>assert.equal(s.latest_fetched_at,s.fetched_at));
  check(()=>assert.equal(s.generated_at,at));
  check(()=>assert.equal(s.retrieved_at,at));
  check(()=>assert.deepEqual(sample,copy));
  check(()=>assert.deepEqual([s.coverage.available,s.coverage.partial,s.coverage.degraded,s.coverage.stale,s.coverage.unavailable,s.coverage.unknown,s.coverage.other],[1,1,1,1,1,2,1]));
  check(()=>assert.equal(Object.values(s.coverage.by_quality).reduce((a,b)=>a+b,0),sample.length));
  check(()=>assert.equal(s.coverage.by_quality.future_quality,1));
  check(()=>assert.equal(market.snapshotMetadata([{quality:'unavailable',fetched_at:null}],at).fetched_at,null));
  check(()=>assert.equal(market.snapshotMetadata([],at).coverage.total,0));
  // Exercise actual snapshot + durable cache, not just the aggregation helper.
  const saved=new Map(),backend={read:async key=>saved.get(key)??null,write:async record=>saved.set(record.key,record)};
  for(const [i,item] of market.catalog.entries()){
   const vol=['vix','vxn'].includes(item.id),date=item.kind==='asian_equity'||item.kind==='commodity'?'2026-11-06':'2026-11-05';
   const fetched_at=new Date(clock-10000-i*1000).toISOString();
   const payload={...item,value:100,market_date:date,as_of:item.kind==='treasury'||vol?null:item.kind==='equity'?'2026-11-05T21:00:00Z':'2026-11-06T07:59:58Z',source_timezone:item.market_timezone??'America/New_York',source:vol?'Cboe':item.kind==='treasury'?'U.S. Treasury':'fixture',source_url:'https://example.test/fixture',instrument_id:item.id,history:[],fetched_at,...(vol?{daily_close_contract_version:1,daily_close_validation:{status:'official_publisher_confirmed'},quote_kind:'daily_index_close',data_type:'official_daily_index_close'}:{})};
   const key=vol?'global-daily-close-v1:'+item.id:'global:'+item.id;saved.set(key,{key,payload,data_time:payload.as_of??date,fetched_at,expires_at:'2026-11-20T00:00:00Z'});
  }
  let requests=0;globalThis.fetch=async()=>{requests++;return new Response('controlled failure',{status:503})};
  cache.clearQuoteMemory();const first=await cache.runWithQuoteCache(backend,()=>market.snapshot({refresh:false}));
  clock+=1000;cache.clearQuoteMemory();const second=await cache.runWithQuoteCache(backend,()=>market.snapshot({refresh:false}));
  check(()=>assert.equal(requests,0));
  check(()=>assert.equal(second.cache_hit,true));
  check(()=>assert(second.metrics.every(m=>m.delivery==='durable_cache')));
  check(()=>assert.deepEqual(second.metrics.map(m=>m.fetched_at),first.metrics.map(m=>m.fetched_at)));
  check(()=>assert.equal(second.fetched_at,first.fetched_at));
  check(()=>assert.equal(second.oldest_fetched_at,first.oldest_fetched_at));
  check(()=>assert.notEqual(second.retrieved_at,first.retrieved_at));
  check(()=>assert.notEqual(second.generated_at,first.generated_at));
  check(()=>assert.match(second.fetched_at_semantics,/Compatibility alias/));
  // A full refresh failure changes delivery, never successful-fetch timestamps.
  clock+=1000;cache.clearQuoteMemory();const failed=await cache.runWithQuoteCache(backend,()=>market.snapshot({refresh:true}));
  check(()=>assert(failed.metrics.every(m=>m.degraded===true)));
  check(()=>assert.equal(failed.fetched_at,first.fetched_at));
  check(()=>assert.equal(failed.oldest_fetched_at,first.oldest_fetched_at));
  check(()=>assert.equal(failed.coverage.degraded,13));
  check(()=>assert.equal(failed.coverage.total,Object.values(failed.coverage.by_quality).reduce((a,b)=>a+b,0)));
  // One genuine new fixture response among twelve degraded caches has its own age.
  globalThis.fetch=async url=>url.includes('api.gold-api.com')?Response.json({price:4100,symbol:'XAU',currency:'USD',updatedAt:'2026-11-06T08:00:02Z'}):new Response('controlled failure',{status:503});
  cache.clearQuoteMemory();const mixed=await cache.runWithQuoteCache(backend,()=>market.snapshot({refresh:true}));
  const newest=mixed.metrics.find(m=>m.id==='gold');
  check(()=>assert.equal(newest.delivery,'upstream'));
  check(()=>assert.equal(mixed.latest_fetched_at,newest.fetched_at));
  check(()=>assert.equal(mixed.oldest_fetched_at,first.oldest_fetched_at));
  check(()=>assert(mixed.metrics.filter(m=>m.id!=='gold').every(m=>m.fetched_at===first.metrics.find(old=>old.id===m.id).fetched_at)));
  check(()=>assert.equal(mixed.coverage.available,1));
  check(()=>assert.equal(mixed.coverage.degraded,12));
  // With no valid records, do not manufacture a successful fetch from the read clock.
  cache.clearQuoteMemory();globalThis.fetch=async()=>new Response('controlled failure',{status:503});
  const empty=await market.snapshot({refresh:true});
  check(()=>assert.equal(empty.fetched_at,null));
  check(()=>assert.equal(empty.oldest_fetched_at,null));
  check(()=>assert.equal(empty.latest_fetched_at,null));
  check(()=>assert.equal(empty.coverage.unavailable,13));
  console.log(`PASS: ${checks} snapshot timestamp/coverage scenarios; durable cache, partial refresh, all-source failure, empty data, mixed ages, partial/unknown/future states and compatibility alias`);
 } finally {globalThis.Date=OriginalDate;globalThis.fetch=originalFetch;cache.clearQuoteMemory()}
}
