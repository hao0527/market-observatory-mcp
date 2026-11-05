// Live records only. Optional isolation replaces only the original range request with an explicit error.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
const dir=await mkdtemp(join(tmpdir(),'security-recovery-live-')),realFetch=globalThis.fetch;
const isolated=process.env.SECURITY_RECOVERY_ISOLATED==='1';
const mode=isolated?'isolated range error; window and backup data are real':'all upstream requests real';
const results=[];
try{
 for(const name of ['upstream','quote-cache','security-calendar','security-store','security-history']){
  let code=ts.transpileModule(await readFile('lib/'+name+'.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
  code=code.replace(/from '(\.\/[^']+)'/g,"from '$1.mjs'");await writeFile(join(dir,name+'.mjs'),code);
 }
 const {getSecurityHistory}=await import(pathToFileURL(join(dir,'security-history.mjs')));
 if(isolated)globalThis.fetch=(url,options)=>new URL(url).hostname==='push2his.eastmoney.com'&&new URL(url).searchParams.get('beg')!=='0'
  ?Promise.resolve(new Response('ISOLATED_RANGE_FAILURE: test fixture, not a production upstream response',{status:520})):realFetch(url,options);
 const end=process.env.SECURITY_HISTORY_END??'2026-11-05';
 for(const [symbol,period,adjust] of [['sh563360','1d','qfq'],['sh563360','1d','hfq'],['sz159842','1d','qfq'],['sh563360','5m','qfq'],['sh563360','15m','hfq'],['sh600519','1d','hfq']]){
  const r=await getSecurityHistory({symbol,period,adjust,start_date:period==='1d'?'2026-10-01':'2026-11-03',end_date:end,refresh:true,limit:500});
  assert.equal(r.history_available,r.history_count>0);assert.equal(r.history_count,r.bars.length);
  for(const [i,b]of r.bars.entries()){
   assert(i===0||b.timestamp>r.bars[i-1].timestamp);assert(b.high>=Math.max(b.open,b.close,b.low));assert(b.low<=Math.min(b.open,b.close,b.high));
   assert(Number.isFinite(b.volume)&&b.volume>=0);assert(b.amount===null||Number.isFinite(b.amount)&&b.amount>=0);
   assert(b.datetime.slice(0,10)>=r.requested_start_date&&b.datetime.slice(0,10)<=r.requested_end_date);assert.equal(b.source,r.source);
  }
  const evidence={mode,symbol,period,adjust,quality:r.quality,count:r.history_count,total:r.pagination.total_count,source:r.source,cache_hit:r.cache_hit,degraded:r.degraded,refresh_status:r.history_refresh_status,coverage:r.coverage,actual_start:r.actual_start_datetime,actual_end:r.actual_end_datetime,fetched_at:r.fetched_at,retrieved_at:r.retrieved_at,source_requests:r.source_requests,error:r.history_error};
  results.push(evidence);console.log(JSON.stringify(evidence));
 }
 const fresh=results.filter(r=>r.count>0&&!r.cache_hit&&r.refresh_status==='succeeded');
 const recovered=fresh.filter(r=>r.source==='东方财富'&&r.source_requests.some(s=>s.fetch_strategy==='provider_window'&&s.fetch_attempt_metadata?.some(a=>a.status==='succeeded')));
 console.log(JSON.stringify({mode,queries:results.length,fresh_data_queries:fresh.length,real_window_recoveries:recovered.length,failed_queries:results.filter(r=>r.count===0).length,all_returned_bar_invariants:true}));
 if(process.env.SECURITY_RECOVERY_REPORT)await writeFile(process.env.SECURITY_RECOVERY_REPORT,JSON.stringify({mode,results},null,2));
 if(isolated&&!recovered.length){console.error('NOT VERIFIED: no real provider-window recovery succeeded');process.exitCode=2;}
}finally{globalThis.fetch=realFetch;await rm(dir,{recursive:true,force:true})}
