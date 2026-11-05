import {asianIndices,fredSeries,independentIndexHistory} from './index-sources';
import {backupQuote} from './backup-sources';
import {historyFreshness,historyTradingDay} from './freshness';
import {marketTimezone} from './time-metadata';
import {loadQuote} from './quote-cache';
import {DataError,dataIssue} from './upstream';

export const historyContract={
 history_supported:'Deprecated capability alias: quote_source_history_supported===true OR independent_history_supported; never indicates request success.',
 history_available:'This response obtained valid nonempty records (history_count>0), including explicitly marked cached records. The compact snapshot may omit the array.',
 history_quality:'Independent history state: available, stale, unavailable, unsupported, forming, unknown, not_requested. Never use quality/quote_quality as history quality.',
 quote_source_history_supported:'The current quote provider has an implemented same-instrument history adapter; this may use a separate endpoint and does not indicate records were retrieved.',
 quote_quality:'Quote quality. Legacy quality remains its alias; history state never changes it.',
 expected_date:'Legacy history freshness alias of expected_last_completed_date; latest_session_date is distinct.',
};
export function historyCapabilities(metric:any){
 let quote:boolean|null=metric.quote_source_history_supported??null;
 if(quote===null){
  if(metric.kind==='treasury'||['Yahoo Finance','U.S. Treasury','Cboe'].includes(metric.source)||(asianIndices[metric.id]&&['NAVER Finance','东方财富'].includes(metric.source)))quote=true;
  else if(metric.source||metric.id==='gold')quote=false;
 }
 const sameInstrument=metric.instrument_changed!==true&&(!metric.instrument_id||metric.instrument_id===metric.id);
 const independent=sameInstrument&&Boolean(fredSeries[metric.id]||asianIndices[metric.id]||metric.id==='vix'||metric.id==='vxn');
 return {quote_source_history_supported:quote,independent_history_supported:independent,history_supported:quote===true||independent};
}
function records(metric:any){
 const timezone=marketTimezone(metric),today=new Intl.DateTimeFormat('en-CA',{timeZone:timezone??'UTC',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(Date.now()));
 const map=new Map<string,number>();
 for(const p of Array.isArray(metric.history)?metric.history:[]){
  if(typeof p?.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(p.date)||!Number.isFinite(p.value)||p.value<=0||p.date>today)continue;
  const stamp=Date.parse(p.date+'T00:00:00Z');
  if(!Number.isFinite(stamp)||new Date(stamp).toISOString().slice(0,10)!==p.date||historyTradingDay(p.date,timezone,metric.kind)===false)continue;
  map.set(p.date,p.value);
 }
 return [...map].sort(([a],[b])=>a.localeCompare(b)).map(([date,value])=>({date,value}));
}
function emptyError(){return {code:'EMPTY_HISTORY',message:'历史源没有返回有效的非空记录',retryable:false}}
/** Central presentation also normalizes legacy cache payloads without changing quote arithmetic. */
export function historyState(metric:any,requested=false){
 const capabilities=historyCapabilities(metric),points=capabilities.history_supported?records(metric):[],count=points.length;
 const old=metric.history_metadata??{};
 const ownSource=old.source??metric.source??null;
 const last=points.at(-1)?.date??null;
 const context={market_timezone:marketTimezone(metric),market_date:last,fetched_at:old.fetched_at??metric.fetched_at,data_type:old.data_type??metric.data_type,bar_observed_at:old.bar_observed_at??(!old.source?metric.as_of:null),provider_session:old.provider_session??metric.provider_session,market_status:old.market_status??metric.market_status,quote_market_date:old.quote_market_date??metric.market_date,quote_previous_date:old.quote_previous_date??metric.previous_date};
 const calculated=historyFreshness(context,metric.kind);
 const fresh=capabilities.history_supported?calculated:{...calculated,bar_status:'unsupported',status:'unsupported',reason:'当前品种没有已实现的可比历史通道'};
 const degraded=old.degraded??(count>0&&metric.degraded===true);
 let error=metric.history_error??old.upstream_error??(count>0&&metric.degraded?metric.upstream_error:null)??null;
 let quality:string;
 if(!capabilities.history_supported)quality='unsupported';
 else if(!count)quality=requested||error?'unavailable':'not_requested';
 else if(fresh.stale)quality='stale';
 else if(degraded)quality='unavailable'; // A failed refresh may still deliver explicitly marked cached records.
 else if(fresh.bar_status==='forming')quality='forming';
 else if(fresh.status==='latest_completed_session')quality='available';
 else quality='unknown';
 if(quality==='unsupported')error={code:'UNSUPPORTED_HISTORY',message:metric.id==='gold'?'黄金当前来源不提供可比历史，不以期货替代':'当前报价品种不支持可比历史，禁止拼接不同品种',retryable:false};
 else if(quality==='unavailable'&&!error)error=emptyError();
 if(error&&!error.source_url&&old.source_url)error={...error,source:ownSource,source_url:old.source_url};
 const metadata={...old,source:count?ownSource:old.source??null,source_url:old.source_url??(count?metric.source_url:null)??null,instrument_id:old.instrument_id??metric.instrument_id??metric.id,source_timezone:old.source_timezone??(count?metric.source_timezone:null)??null,market_timezone:context.market_timezone,timestamp_timezone:'UTC',report_timezone:'Asia/Shanghai',market_date:last,as_of:null,time_precision:count>0?'date':'unknown',fetched_at:old.fetched_at??(count?metric.fetched_at:null)??null,retrieved_at:new Date().toISOString(),quality,stale:fresh.stale,freshness:fresh,bar_status:count?fresh.bar_status:quality==='unsupported'?'unsupported':'none',latest_session_date:fresh.latest_session_date,expected_last_completed_date:fresh.expected_last_completed_date,calendar_verified:fresh.calendar_verified,frequency:capabilities.history_supported?'daily':null,unit:metric.unit,degraded:degraded===true};
 const quoteQuality=metric.quote_quality??metric.quality??null;
 return {...metric,...capabilities,quality:quoteQuality,quote_quality:quoteQuality,history:points,history_requested:requested,history_count:count,history_available:count>0,history_quality:quality,history_stale:fresh.stale,history_error:error,history_metadata:metadata,history_freshness:fresh,history_market_date:last,history_source:metadata.source,history_fetched_at:metadata.fetched_at,history_retrieved_at:metadata.retrieved_at,latest_session_date:fresh.latest_session_date,expected_last_completed_date:fresh.expected_last_completed_date,bar_status:metadata.bar_status};
}
export async function resolveHistory(metric:any,refresh:boolean){
 const capabilities=historyCapabilities(metric);
 if(!capabilities.history_supported)return historyState({...metric,history:[]},true);
 const inline=records(metric);
 if(inline.length)return historyState({...metric,history:inline,history_metadata:{source:metric.source,source_url:metric.source_url,instrument_id:metric.instrument_id,market_date:inline.at(-1)?.date,source_timezone:metric.source_timezone,fetched_at:metric.fetched_at,retrieved_at:metric.retrieved_at,degraded:metric.degraded,upstream_error:metric.degraded?metric.upstream_error:null,bar_observed_at:metric.as_of,same_instrument:true,cross_provider:false,note:'历史与报价同源；历史质量按日线日期和完成状态单独计算'}},true);
 if(!capabilities.independent_history_supported)return historyState({...metric,history:[],history_error:metric.upstream_error??emptyError()},true);
 try{
  const h=await loadQuote('index-history:'+metric.id,async()=>{
   if(metric.id==='vix'||metric.id==='vxn'){const data=await backupQuote(metric.id,{code:'HISTORY_SOURCE',message:'独立历史读取',retryable:false});return {...data,history_source:data.source,history_source_url:data.source_url,history_series:metric.id.toUpperCase(),fetched_at:new Date().toISOString()}}
   return independentIndexHistory(metric.id);
  },{refresh,ttlMs:300000});
  if(h.instrument_id!==metric.id)throw new DataError({code:'INSTRUMENT_MISMATCH',message:'历史与当前报价不是已核实的同一品种',retryable:false,source_url:h.history_source_url});
  const metadata={source:h.history_source,source_url:h.history_source_url,series:h.history_series,instrument_id:h.instrument_id,source_timezone:h.source_timezone,market_date:h.market_date,fetched_at:h.fetched_at,retrieved_at:h.retrieved_at,delivery:h.delivery,cache_backend:h.cache_backend,cache_warning:h.cache_warning,degraded:h.degraded,upstream_error:h.upstream_error,primary_error:h.history_primary_error,source_attempts:h.history_source_attempts,publication_note:h.publication_note,market_status:h.market_status,quote_market_date:h.quote_market_date,provider_session:h.provider_session,data_type:h.data_type,same_instrument:true,cross_provider:metric.source!==h.history_source,note:'整段历史来自此来源；不追加最新报价，不改变其昨收、参考日期和日变化'};
  return historyState({...metric,history:h.history,history_metadata:metadata,history_error:h.degraded?h.upstream_error:null,raw_history_fields:h.raw_history_fields},true);
 }catch(error){return historyState({...metric,history:[],history_error:dataIssue(error),history_metadata:{source:null,source_url:null,source_attempts:(dataIssue(error).causes??[dataIssue(error)]).map(e=>({source:e.source,status:'failed',source_url:e.source_url,error:e}))}},true)}
}
