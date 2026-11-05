import defaults from '../config/security-watchlist.json';
import {getSecurityHistory,validateSecurityHistory,type SecurityPeriod} from './security-history';
import {chinaDate,shiftDate,validDate,securityTradingDay,barEnd} from './security-calendar';
import {securityArchiveStore,archiveId,type ArchiveSettings,type ArchiveTask,type ArchiveJob} from './security-store';
import {DataError,dataIssue} from './upstream';

export const securityArchiveInfo={storage:'existing D1; separate non-expiring archive tables',adjust:'none',final_bars_only:true,raw_fetches_preserved:true,default_watchlist:defaults.symbols,default_periods:defaults.periods,automatic_time:'16:05 Asia/Shanghai; saved task status is separate from archive readiness',calendar_years:[2026],calendar_scope:'scheduled_only; unverified emergency closure, listing and suspension stay unknown',tools:['configure_security_archive','sync_security_history','get_security_archive_status'],batch_limit:2,max_job_tasks:400,retry:'per-session, exponential 60s..6h; durable next_retry_at; no tight retry loop',source_policy:'whole-provider query response; no cross-provider bar/field stitching',adjustment_policy:'qfq/hfq raw vintages preserved but not merged into stable archive; factor/version unknown',retention:'no automatic archive deletion; storage capacity must be monitored'};
const invalid=(message:string):never=>{throw new DataError({code:'INVALID_ARGUMENT',message,retryable:false})};
function object(input:unknown,allowed:string[]){if(!input||typeof input!=='object'||Array.isArray(input))invalid('参数必须为对象');const p=input as Record<string,any>;if(Object.keys(p).some(k=>!allowed.includes(k)))invalid('包含未知参数');return p}
function store(){const s=securityArchiveStore();if(!s)throw new DataError({code:'ARCHIVE_STORAGE_UNAVAILABLE',message:'D1归档存储未绑定；不以内存冒充持久化',retryable:true});return s}
function symbols(value:unknown){if(!Array.isArray(value)||!value.length||value.length>30)invalid('symbols须为1–30个代码');return [...new Set((value as unknown[]).map(symbol=>validateSecurityHistory({symbol,start_date:'2026-11-05',end_date:'2026-11-05'}).symbol))]}
function periods(value:unknown):SecurityPeriod[]{if(!Array.isArray(value)||!value.length||value.length>6||value.some(p=>!['1m','5m','15m','30m','60m','1d'].includes(p)))invalid('periods必须是支持的K线周期');return [...new Set(value as SecurityPeriod[])]}
function bool(p:Record<string,any>,key:string){if(p[key]!==undefined&&typeof p[key]!=='boolean')invalid(key+'必须为boolean')}
export async function configureSecurityArchive(input:unknown={}){
 const p=object(input,['symbols','periods','enabled']);bool(p,'enabled');const s=store(),old=await s.settings()??defaults as ArchiveSettings;
 const next:ArchiveSettings={...old,...(p.symbols!==undefined?{symbols:symbols(p.symbols)}:{}),...(p.periods!==undefined?{periods:periods(p.periods)}:{}),...(p.enabled!==undefined?{enabled:p.enabled}:{}),adjust:'none',timezone:'Asia/Shanghai',updated_at:new Date().toISOString()};
 await s.saveSettings(next);return {schema_version:'1.5',settings:await s.settings(),persisted:true,schedule_modified:false};
}
function summary(tasks:ArchiveTask[]){return tasks.reduce((m,t)=>{m[t.status]=(m[t.status]??0)+1;return m},{} as Record<string,number>)}
function jobStatus(tasks:ArchiveTask[]){return tasks.every(t=>['complete','non_trading_day'].includes(t.status))?'complete':tasks.some(t=>t.status==='queued')?'running':tasks.some(t=>t.status==='partial')?'partial':'pending_backfill'}
export async function getSecurityArchiveStatus(input:unknown={}){
 const p=object(input,['job_id','fetch_id']);for(const key of ['job_id','fetch_id'])if(p[key]!==undefined&&(typeof p[key]!=='string'||!/^[a-f0-9]{64}$/.test(p[key])))invalid(key+'必须为64位标识');
 const s=store(),job=p.job_id?await s.job(p.job_id):null,tasks=job?await s.tasks(job.id):[];
 return {schema_version:'1.5',retrieved_at:new Date().toISOString(),storage:'D1',settings:await s.settings()??defaults,contract:securityArchiveInfo,...(p.job_id?{job,tasks,task_counts:summary(tasks)}:{recent_jobs:await s.recentJobs(),archive:await s.stats()}),...(p.fetch_id?{fetch:await s.audit(p.fetch_id)}:{})};
}
export async function syncSecurityHistory(input:unknown={}){
 const p=object(input,['job_id','symbols','periods','start_date','end_date','max_tasks','retry_missing','force_refresh']);for(const key of ['retry_missing','force_refresh'])bool(p,key);
 const max=p.max_tasks??1;if(!Number.isInteger(max)||max<1||max>2)invalid('max_tasks须为1–2');
 const s=store(),settings=await s.settings()??defaults as ArchiveSettings;if(!settings.enabled)return {schema_version:'1.5',status:'disabled',storage:'D1',upstream_requested:false};
 let job:ArchiveJob|null=null;
 if(p.job_id!==undefined){if(typeof p.job_id!=='string'||!/^[a-f0-9]{64}$/.test(p.job_id))invalid('job_id无效');if(['symbols','periods','start_date','end_date','force_refresh'].some(k=>p[k]!==undefined))invalid('恢复job_id时不得修改任务范围');job=await s.job(p.job_id);if(!job)invalid('job_id不存在');}
 else {
  const end=p.end_date??chinaDate(),start=p.start_date??end;
  if(!validDate(start)||!validDate(end)||start>end||end>chinaDate())invalid('归档日期须有效、非未来且开始不晚于结束');
  const list=p.symbols===undefined?settings.symbols:symbols(p.symbols),ps=p.periods===undefined?settings.periods:periods(p.periods);
  const days=(Date.parse(end)-Date.parse(start))/86400000+1;if(days>62||days*list.length*ps.length>400)invalid('任务最多62个日历日且400项，请分批归档');
  const request={symbols:list,periods:ps,start_date:start,end_date:end,adjust:'none',force_refresh:p.force_refresh===true};const id=await archiveId(['security-archive-v1',request,...(p.force_refresh?[crypto.randomUUID()]:[])]),now=new Date().toISOString();
  job={id,status:'running',request,created_at:now,updated_at:now};const tasks:ArchiveTask[]=[];
  for(let d=start;d<=end;d=shiftDate(d,1))for(const symbol of list)for(const period of ps)tasks.push({key:[d,symbol,period].join(':'),symbol,period,date:d,status:securityTradingDay(d)===false?'non_trading_day':'queued',attempts:0,next_retry_at:null});
  await s.createJob(job,tasks);job=await s.job(id);
 }
 if(!job)throw Error('Archive job persistence failed');
 const now=Date.now();if(!await s.claim(job.id,new Date(now).toISOString(),new Date(now+90000).toISOString()))return {schema_version:'1.5',status:'busy',job_id:job.id,retry_after_seconds:90,storage:'D1'};
 let processed=0;
 try{
  const tasks=await s.tasks(job.id);
  for(const task of tasks){
   if(processed>=max)break;if(['complete','non_trading_day'].includes(task.status))continue;
   if(task.status!=='queued'&&(p.retry_missing===false||task.next_retry_at&&Date.parse(task.next_retry_at)>Date.now()))continue;
   // Close + conservative 30-minute postmarket margin, and never invent an unknown calendar.
   processed++;const verified=securityTradingDay(task.date);if(verified===null){task.status='calendar_unverified';task.next_retry_at=null;task.reason='missing_unverified';await s.saveTask(job.id,task);continue;}
   if(Date.now()<barEnd(task.date,935)){task.status='not_ready';task.next_retry_at=new Date(barEnd(task.date,935)).toISOString();await s.saveTask(job.id,task);continue;}
   task.attempts++;task.last_attempt_at=new Date().toISOString();
   try{
    const r=await getSecurityHistory({symbol:task.symbol,period:task.period,start_date:task.date,end_date:task.date,adjust:'none',refresh:task.attempts>1||job.request.force_refresh===true,limit:500});
    const coverage=r.bar_coverage as any;const persisted=await s.readBars(task.symbol,task.period,r.source,task.date,task.date);
    const finalCount=persisted.bars.length,complete=coverage?.range_complete===true&&r.bars.every(b=>b.is_final===true)&&finalCount===(r.pagination as any)?.total_count;
    task.status=complete?'complete':finalCount?'partial':'failed';task.source=r.source;task.received_count=(r.pagination as any)?.total_count??0;task.persisted_count=finalCount;task.bar_coverage=coverage;task.field_completeness=r.field_completeness;task.source_quality=r.source_quality;task.cache_status=r.cache_status;task.refresh_status=r.history_refresh_status;task.degraded=r.degraded;task.refresh_error=r.history_refresh_error;task.source_requests=r.source_requests;task.rejected_count=r.rejected_count;task.warnings=r.warnings;
    task.reason=complete?null:r.history_refresh_status==='failed'?'upstream_failed':'missing_unverified';task.error=r.history_error;task.fetched_at=r.fetched_at;task.retrieved_at=r.retrieved_at;
   }catch(e){task.status='failed';task.error=dataIssue(e);task.reason='upstream_failed'}
   task.next_retry_at=task.status==='complete'?null:new Date(Date.now()+Math.min(21600000,60000*2**Math.min(9,task.attempts-1))).toISOString();
   await s.saveTask(job.id,task);
  }
  const final=await s.tasks(job.id);job={...job,status:jobStatus(final),updated_at:new Date().toISOString(),task_counts:summary(final)};await s.finish(job);
  return {schema_version:'1.5',storage:'D1',job_id:job.id,status:job.status,processed_this_call:processed,task_counts:summary(final),remaining_queued:final.filter(t=>t.status==='queued').length,next_retry_at:final.map(t=>t.next_retry_at).filter(Boolean).sort()[0]??null,complete:job.status==='complete',tasks:final.filter(t=>t.last_attempt_at&&Date.parse(String(t.last_attempt_at))>=now),readback_tool:'get_security_archive_status',note:'complete表示已持久化的K线覆盖完整；amount缺失单独见field_completeness。失败或缺失保留待补采，不生成K线。'};
 }catch(e){await s.finish({...job,status:'interrupted',updated_at:new Date().toISOString(),error:dataIssue(e)});throw e}
}
