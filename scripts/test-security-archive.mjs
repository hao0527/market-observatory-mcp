// Deterministic transport fixtures + real SQLite migration, persistence and production SQL adapter.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,readFile,writeFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
const dir=await mkdtemp(join(tmpdir(),'security-archive-test-')),originalFetch=fetch,originalNow=Date.now;
let db,checks=0,calls=0;const now='2026-11-05T08:30:00.000Z';
try{
 for(const [file,out] of [['lib/upstream.ts','upstream'],['lib/quote-cache.ts','quote-cache'],['lib/security-calendar.ts','security-calendar'],['lib/security-store.ts','security-store'],['lib/security-history.ts','security-history'],['lib/security-archive.ts','security-archive'],['db/security-archive.ts','database'],['app/api/security-archive/route.ts','archive-api']]){
  let code=ts.transpileModule(await readFile(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
  code=code.replaceAll("'@/lib/security-archive'","'./security-archive'").replaceAll("'@/lib/upstream'","'./upstream'");code=code.replace(/from '(?:\.\/|\.\.\/lib\/)([^']+)'/g,"from './$1.mjs'").replace("'../config/security-watchlist.json'","'./watchlist.mjs'");await writeFile(join(dir,out+'.mjs'),code);
 }
 await writeFile(join(dir,'watchlist.mjs'),'export default '+await readFile('config/security-watchlist.json','utf8'));
 const h=await import(pathToFileURL(join(dir,'security-history.mjs'))),c=await import(pathToFileURL(join(dir,'security-calendar.mjs'))),ctx=await import(pathToFileURL(join(dir,'security-store.mjs'))),a=await import(pathToFileURL(join(dir,'security-archive.mjs'))),cache=await import(pathToFileURL(join(dir,'quote-cache.mjs'))),adapter=await import(pathToFileURL(join(dir,'database.mjs')));
 const api=await import(pathToFileURL(join(dir,'archive-api.mjs')));
 const filename=join(dir,'archive.sqlite');
 function open(){db=new DatabaseSync(filename);return {prepare(sql){const statement=db.prepare(sql);let values=[];const api={bind(...v){values=v;return api},async all(){return {results:statement.all(...values)}},async first(){return statement.get(...values)??null},async run(){return {meta:statement.run(...values)}}};return api}}}
 let binding=open();for(const f of (await readdir('drizzle')).filter(f=>f.endsWith('.sql')).sort())db.exec(await readFile('drizzle/'+f,'utf8'));
 let store=adapter.createSecurityArchive(binding);const run=fn=>ctx.runWithSecurityArchive(store,fn);
 Date.now=()=>Date.parse(now);
 const query={symbol:'sh563360',period:'5m',start_date:'2026-10-01',end_date:'2026-11-05',adjust:'none',refresh:true,limit:200};
 function stamps(period,start=query.start_date,end=query.end_date){const rows=[];for(let d=start;d<=end;d=c.shiftDate(d,1)){if(!c.securityTradingDay(d))continue;for(const m of period==='1d'?[null]:c.minuteEnds(Number(period.slice(0,-1))))rows.push(m===null?d:`${d} ${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`)}return rows}
 function em(symbol,rows,price=10){return {rc:0,data:{code:symbol.slice(2),market:symbol.startsWith('sh')?1:0,name:'fixture-'+symbol,klines:rows.map(d=>`${d},${price},${price+1},${price+2},${price-1},123,123000,2,1,1,0.5`)}}}
 function tx(symbol,period,rows,price=20){return {code:0,data:{[symbol]:{qt:{[symbol]:['51','fixture-'+symbol,symbol.slice(2)]},version:16,[period==='1d'?'day':'m'+period.slice(0,-1)]:rows.map(d=>[d.replaceAll('-','').replace(' ','').replace(':',''),''+price,''+(price+1),''+(price+2),''+(price-1),'123'])}}}}
 const reply=(symbol,period,rows,price)=>new Response(JSON.stringify(em(symbol,rows,price)));
 globalThis.fetch=async()=>{calls++;return reply(query.symbol,'5m',stamps('5m'))};
 let first=await run(()=>h.getSecurityHistory(query));assert.equal(first.pagination.total_count,1008);assert.equal(first.bar_coverage.status,'complete');assert.equal(first.history_refresh_status,'succeeded');assert.equal(first.rejected_count,0);checks++;
 assert.equal((await store.stats()).bars[0].count,1008);assert.equal(db.prepare('SELECT count(*) AS n FROM security_history_fetches').get().n,1);checks++;
 // Reopen actual database, discard instance caches, do not allow a network read.
 db.close();binding=open();store=adapter.createSecurityArchive(binding);cache.clearQuoteMemory();globalThis.fetch=async()=>{throw Error('unexpected upstream on archive pagination')};Date.now=()=>Date.parse(now)+5000;
 const all=[];let cursor,snapshot;do{const r=await run(()=>h.getSecurityHistory({...query,refresh:false,...(cursor?{cursor}:{})}));assert.equal(r.history_refresh_status,'not_attempted');assert.equal(r.cache_status.delivery,'durable_archive');assert.equal(r.fetched_at,now);assert.notEqual(r.retrieved_at,now);assert.equal(r.pagination.snapshot_id,snapshot??r.pagination.snapshot_id);snapshot=r.pagination.snapshot_id;all.push(...r.bars);cursor=r.pagination.next_cursor;}while(cursor);
 assert.equal(all.length,1008);assert.equal(new Set(all.map(b=>b.timestamp)).size,1008);assert(all.every(b=>b.archive_fetch_id));checks++;
 // A failed forced refresh does not turn intact archive records into unavailable or pretend refresh succeeded.
 globalThis.fetch=async()=>new Response('controlled upstream failure',{status:520});const degraded=await run(()=>h.getSecurityHistory(query));assert.equal(degraded.quality,'available');assert.equal(degraded.history_refresh_status,'failed');assert.equal(degraded.degraded,true);assert.equal(degraded.history_available,true);assert.equal(degraded.fetched_at,now);assert.equal(degraded.history_refresh_error.causes[0].http_status,520);checks++;
 // Partial primary MUST request a whole-provider backup. No Eastmoney bars/amounts in Tencent result.
 cache.clearQuoteMemory();const secondary='sz159842';let backup=0;
 globalThis.fetch=async url=>{if(url.includes('gtimg')){backup++;return Response.json(tx(secondary,'5m',stamps('5m')))}return reply(secondary,'5m',stamps('5m','2026-11-05','2026-11-05'))};
 const switched=await run(()=>h.getSecurityHistory({...query,symbol:secondary,limit:500}));assert.equal(backup,1);assert.equal(switched.source,'腾讯证券历史');assert.equal(switched.pagination.total_count,1008);assert.equal(switched.bar_coverage.status,'complete');assert.equal(switched.field_completeness.amount,false);assert.equal(switched.field_completeness.missing_amount_count,1008);assert.equal(switched.quality,'partial');assert(switched.bars.every(b=>b.source==='腾讯证券历史'&&b.open===20&&b.amount===null));checks++;
 // Raw retained window is archived, but bars outside the requested dates are never returned.
 globalThis.fetch=async()=>reply('sh510300','15m',stamps('15m'));cache.clearQuoteMemory();
 const filtered=await run(()=>h.getSecurityHistory({...query,symbol:'sh510300',period:'15m',start_date:'2026-11-05'}));assert.equal(filtered.history_count,16);assert.equal((await store.readBars('sh510300','15m','东方财富',query.start_date,query.end_date)).bars.length,336);checks++;
 // Precise single-session backfill repairs the 79+240 case using only the same provider.
 const two=stamps('1m','2026-11-04','2026-11-05'),partial=[...two.slice(0,79),...two.slice(240)];cache.clearQuoteMemory();
 globalThis.fetch=async url=>url.includes('gtimg')?new Response('',{status:520}):reply('sh518850','1m',partial);
 const incomplete=await run(()=>h.getSecurityHistory({...query,symbol:'sh518850',period:'1m',start_date:'2026-11-04',limit:500}));assert.equal(incomplete.history_count,319);assert.equal(incomplete.bar_coverage.missing_count,161);assert.equal(incomplete.bar_coverage.missing_sessions[0].intervals[0].start,'2026-11-04 10:50');assert.equal(incomplete.bar_coverage.missing_sessions[0].reason,'missing_unverified');checks++;
 globalThis.fetch=async()=>reply('sh518850','1m',two.slice(0,240));await run(()=>h.getSecurityHistory({...query,symbol:'sh518850',period:'1m',start_date:'2026-11-04',end_date:'2026-11-04',limit:500}));cache.clearQuoteMemory();
 globalThis.fetch=async()=>{throw Error('backfilled archive should be complete')};const full=await run(()=>h.getSecurityHistory({...query,symbol:'sh518850',period:'1m',start_date:'2026-11-04',refresh:false,limit:500}));assert.equal(full.history_count,480);assert.equal(full.bar_coverage.status,'complete');checks++;
 // Preserve a higher-quality whole bar and its fetched_at against a later field-poor revision.
 const bar=all[0],base={symbol:query.symbol,period:'5m',adjust:'none',source:bar.source,source_url:'fixture',start_date:query.start_date,end_date:query.end_date,fetched_at:now,name:'fixture',bars:[bar],raw:{fixture:true},attempts:[],rejected:0,rejection_reasons:{},error:null};
 await store.saveFetch({...base,id:'e'.repeat(64),fetched_at:'2026-11-06T08:30:00Z',bars:[{...bar,open:100,close:101,high:102,low:99,amount:null,fetched_at:'2026-11-06T08:30:00Z'}]});const kept=(await store.readBars(query.symbol,'5m',bar.source,query.start_date,query.end_date)).bars[0];assert.equal(kept.open,bar.open);assert.equal(kept.amount,bar.amount);assert.equal(kept.fetched_at,bar.fetched_at);checks++;
 const count=db.prepare('SELECT count(*) n FROM security_history_bars').get().n;await store.saveFetch({...base,id:'f'.repeat(64),adjust:'qfq'});assert.equal(db.prepare('SELECT count(*) n FROM security_history_bars').get().n,count);assert((await store.audit('f'.repeat(64))).raw.fixture);checks++;
 // Durable configuration, bounded jobs, repeated execution and atomic lease.
 await run(()=>a.configureSecurityArchive({symbols:['sh600519'],periods:['1d','5m']}));globalThis.fetch=async url=>{calls++;const k=new URL(url).searchParams.get('klt');return reply('sh600519',k==='101'?'1d':'5m',stamps(k==='101'?'1d':'5m','2026-11-05','2026-11-05'))};cache.clearQuoteMemory();
 const job=await run(()=>a.syncSecurityHistory({start_date:'2026-11-05',end_date:'2026-11-05',max_tasks:1}));assert.equal(job.remaining_queued,1);const done=await run(()=>a.syncSecurityHistory({job_id:job.job_id,max_tasks:2}));assert.equal(done.complete,true);const before=calls;const repeat=await run(()=>a.syncSecurityHistory({job_id:job.job_id}));assert.equal(repeat.processed_this_call,0);assert.equal(calls,before);assert.equal((await run(()=>a.getSecurityArchiveStatus({job_id:job.job_id}))).task_counts.complete,2);checks++;
 assert(await store.claim(job.job_id,now,'2099-01-01T00:00:00Z'));assert.equal(await store.claim(job.job_id,now,'2099-01-01T00:00:00Z'),false);await store.finish(await store.job(job.job_id));checks++;
 // The unattended service API shares the MCP writer and never wraps a business result as an auth/parameter error.
 const http=await run(()=>api.POST(new Request('https://test.local/api/security-archive',{method:'POST',body:JSON.stringify({operation:'sync',arguments:{job_id:job.job_id}})})));assert.equal(http.status,200);assert.equal((await http.json()).complete,true);
 const httpState=await run(()=>api.GET(new Request('https://test.local/api/security-archive?job_id='+job.job_id)));assert.equal((await httpState.json()).task_counts.complete,2);
 const httpBad=await run(()=>api.POST(new Request('https://test.local/api/security-archive',{method:'POST',body:JSON.stringify({operation:'delete'})})));assert.equal(httpBad.status,400);assert.equal((await httpBad.json()).issue.code,'INVALID_ARGUMENT');checks++;
 // Partial/failed task persists a retry deadline, retry after backoff, no fake records or tight retries.
 cache.clearQuoteMemory();globalThis.fetch=async()=>new Response('fixture failure',{status:520});const failed=await run(()=>a.syncSecurityHistory({symbols:['sz000001'],periods:['1d'],start_date:'2026-11-05',end_date:'2026-11-05'}));assert.equal(failed.complete,false);assert.equal(failed.task_counts.failed,1);const retry0=await run(()=>a.syncSecurityHistory({job_id:failed.job_id}));assert.equal(retry0.processed_this_call,0);Date.now=()=>Date.parse(now)+70000;globalThis.fetch=async()=>reply('sz000001','1d',['2026-11-05']);const retry=await run(()=>a.syncSecurityHistory({job_id:failed.job_id}));assert.equal(retry.complete,true);assert.equal((await store.tasks(failed.job_id))[0].attempts,2);checks++;
 // A crash after durable bars were written but before task completion is safe to resume.
 cache.clearQuoteMemory();globalThis.fetch=async()=>reply('sz000002','1d',['2026-11-05']);const realStore=store;let inject=true;
 store={...realStore,async saveTask(id,task){if(inject){inject=false;throw Error('controlled process interruption after bar persistence')}return realStore.saveTask(id,task)}};
 await assert.rejects(run(()=>a.syncSecurityHistory({symbols:['sz000002'],periods:['1d'],start_date:'2026-11-05',end_date:'2026-11-05'})),/interruption/);
 store=realStore;const interrupted=(await store.recentJobs()).find(j=>j.status==='interrupted');assert(interrupted);assert.equal((await store.readBars('sz000002','1d','东方财富','2026-11-05','2026-11-05')).bars.length,1);cache.clearQuoteMemory();globalThis.fetch=async()=>{throw Error('resume should use persisted bars')};
 const resumed=await run(()=>a.syncSecurityHistory({job_id:interrupted.id}));assert.equal(resumed.complete,true);assert.equal((await store.readBars('sz000002','1d','东方财富','2026-11-05','2026-11-05')).bars.length,1);checks++;
 // Unknown calendar and pre-close status never claim successful full archive.
 Date.now=()=>Date.parse('2026-11-05T06:00:00Z');const early=await run(()=>a.syncSecurityHistory({symbols:['bj920002'],periods:['1d'],start_date:'2026-11-05',end_date:'2026-11-05'}));assert.equal(early.task_counts.not_ready,1);assert.equal(early.complete,false);checks++;
 Date.now=()=>Date.parse('2027-01-05T08:30:00Z');const unverified=await run(()=>a.syncSecurityHistory({symbols:['bj920002'],periods:['1d'],start_date:'2027-01-05',end_date:'2027-01-05'}));assert.equal(unverified.task_counts.calendar_unverified,1);assert.equal(unverified.complete,false);checks++;
 await assert.rejects(a.syncSecurityHistory({}),e=>e.issue.code==='ARCHIVE_STORAGE_UNAVAILABLE');await assert.rejects(run(()=>a.configureSecurityArchive({symbols:['563360']})),e=>e.issue.code==='INVALID_ARGUMENT');checks++;
 // Invalid raw rows survive auditing but never enter the archive.
 Date.now=()=>Date.parse(now);cache.clearQuoteMemory();globalThis.fetch=async url=>url.includes('gtimg')?new Response('',{status:520}):Response.json({rc:0,data:{code:'920002',market:0,name:'fixture',klines:['2026-11-05,10,11,12,9,123,123000','2026-11-04,10,11,1,9,123,123000']}});
 const rejected=await run(()=>h.getSecurityHistory({...query,symbol:'bj920002',period:'1d',start_date:'2026-11-04'}));assert.equal(rejected.rejected_count,1);assert.equal(rejected.rejection_reasons.invalid_ohlc,1);const audit=db.prepare("SELECT payload FROM security_history_fetches WHERE symbol='bj920002' AND source='东方财富' AND security_name IS NOT NULL").get();assert.equal(JSON.parse(audit.payload).raw.data.klines.length,2);checks++;
 console.log(`PASS: ${checks} archive scenarios using actual SQLite + production D1 SQL; durable reopen, 1008-bar pagination, original timestamps, 319→480 backfill, source isolation, raw audit, quality protection, jobs/idempotence/lease/backoff, calendar and rejection states`);
}finally{globalThis.fetch=originalFetch;Date.now=originalNow;db?.close();await rm(dir,{recursive:true,force:true})}
