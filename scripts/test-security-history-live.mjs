// Real upstream integration checks. No mocks, credentials, or production configuration changes.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
const dir=await mkdtemp(join(tmpdir(),'security-history-live-'));
const results=[];
try{
 for(const name of ['upstream','quote-cache','security-calendar','security-store','security-history']){
  let code=ts.transpileModule(await readFile('lib/'+name+'.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
  code=code.replace(/from '(\.\/[^']+)'/g,"from '$1.mjs'");await writeFile(join(dir,name+'.mjs'),code);
 }
 const {getSecurityHistory}=await import(pathToFileURL(join(dir,'security-history.mjs')));
 const {chinaDate,shiftDate}=await import(pathToFileURL(join(dir,'security-calendar.mjs')));
 const end=process.env.SECURITY_HISTORY_END??chinaDate(),start=process.env.SECURITY_HISTORY_START??shiftDate(end,-35);
 const base={symbol:'sh563360',start_date:start,end_date:end,adjust:'none',refresh:true,limit:500};
 async function check(label,query){
  const started=new Date().toISOString(),r=await getSecurityHistory({...base,...query});
  assert.equal(r.history_available,r.history_count>0);assert.equal(r.history_count,r.bars.length);
  assert.equal(new Set(r.bars.map(b=>b.timestamp)).size,r.bars.length);
  assert.deepEqual([...r.bars].sort((a,b)=>a.timestamp-b.timestamp),r.bars);
  for(const b of r.bars){assert(b.high>=Math.max(b.open,b.close,b.low));assert(b.low<=Math.min(b.open,b.close,b.high));assert(b.datetime.slice(0,10)>=r.requested_start_date&&b.datetime.slice(0,10)<=r.requested_end_date);assert(b.volume>=0&&b.amount>=0)}
  results.push({label,started,result:r});
  console.log(JSON.stringify({label,quality:r.quality,count:r.history_count,total:r.pagination.total_count,start:r.available_start_date,end:r.available_end_date,first:r.bars[0],last:r.bars.at(-1),coverage_complete:r.coverage?.range_complete,missing:r.coverage?.missing_count,refresh:r.history_refresh_status,degraded:r.degraded,cache_hit:r.cache_hit,errors:r.history_error?.causes?.map(e=>({code:e.code,status:e.http_status}))??r.history_error?.code}));
  return r;
 }
 for(const period of ['1d','5m','15m','1m','30m','60m'])await check(period,{period});
 const first=results.find(x=>x.label==='5m').result;let last=first,all=[...first.bars],page=1;
 while(last.history_available&&last.pagination.next_cursor&&page<5){const next=await check('cursor_page'+(++page),{period:'5m',limit:500,cursor:last.pagination.next_cursor,refresh:false});assert(next.history_available,'Immediate pagination must retain its successful snapshot');assert(last.bars.at(-1).timestamp<next.bars[0].timestamp);all.push(...next.bars);last=next;}
 if(last.history_available&&!last.pagination.has_more){assert.equal(all.length,last.pagination.total_count);assert.equal(new Set(all.map(b=>b.timestamp)).size,all.length);}
 // Identical query, no forced refresh: verifies normal-cache behavior separately from source availability.
 await check('cache_read',{period:'60m',refresh:false,limit:5});
 for(const period of ['1d','5m','15m','30m','60m'])for(const adjust of ['qfq','hfq'])await check(period+'_'+adjust,{period,adjust,limit:5});
 for(const symbol of ['sz159842','sz000001','sh600519','bj920002'])await check('mapping_'+symbol,{symbol,period:'1d',limit:5});
 await check('one_minute_past_range',{period:'1m',end_date:shiftDate(end,-5),limit:5});
 await check('one_minute_qfq_unsupported',{period:'1m',adjust:'qfq'});
 for(const adjust of ['none','qfq','hfq'])await check('stock_adjust_'+adjust,{symbol:'sh600519',period:'1d',start_date:end.slice(0,4)+'-06-01',adjust,limit:500});
 await check('one_minute_single_day',{period:'1m',start_date:end,end_date:end,limit:500,include_raw:true});
 await check('two_trading_days',{period:'5m',start_date:start.slice(0,8)+'08',end_date:start.slice(0,8)+'09',limit:500});
 const summary={executed_at:new Date().toISOString(),source:'real upstream; no simulated records',requested:{start,end},results};
 if(process.env.SECURITY_HISTORY_REPORT)await writeFile(process.env.SECURITY_HISTORY_REPORT,JSON.stringify(summary));
 console.log('PASS: real-source response invariants; per-query availability and coverage are reported, never asserted into success');
}finally{await rm(dir,{recursive:true,force:true})}
