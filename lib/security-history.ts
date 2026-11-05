import {fetchJson,DataError,dataIssue,type DataIssue} from './upstream';
import {loadQuote} from './quote-cache';
import {securityArchiveStore,archiveId,preferSecurityBar} from './security-store';
import {chinaDate,shiftDate,validDate,securityTradingDay,minuteEnds,sourceTime,barEnd,securityCalendarPolicy} from './security-calendar';

export type SecurityPeriod='1m'|'5m'|'15m'|'30m'|'60m'|'1d';
export type SecurityAdjust='none'|'qfq'|'hfq';
export interface SecurityHistoryRequest {symbol:string;period?:SecurityPeriod;start_date:string;end_date:string;adjust?:SecurityAdjust;refresh?:boolean;include_raw?:boolean;limit?:number;cursor?:string}
export interface SecurityBar {timestamp:number;datetime:string;source_datetime:string;time_precision:'date'|'minute'|'second';open:number;high:number;low:number;close:number;volume:number;amount:number|null;amplitude:number|null;change_percent:number|null;change:number|null;turnover_rate:number|null;bar_end:string;is_final:boolean|null;fetched_at:string;source:string;raw_volume?:string|null;raw_amount?:string|null;raw_units?:{volume:string;amount:string|null};archive_fetch_id?:string}
type Query=Required<Omit<SecurityHistoryRequest,'cursor'>>&{cursor?:string};
type Quality='available'|'partial'|'stale'|'unavailable'|'unsupported';
export interface SecurityHistoryResult {schema_version:string;symbol:string;security_name:string|null;period:SecurityPeriod;adjust:SecurityAdjust;requested_start_date:string;requested_end_date:string;actual_start_date:string|null;actual_end_date:string|null;history_count:number;history_available:boolean;source:string;source_timezone:string;fetched_at:string|null;retrieved_at:string;quality:Quality;degraded:boolean;cache_hit:boolean;warnings:string[];bars:SecurityBar[];[key:string]:unknown}
const source='东方财富',endpoint='https://push2his.eastmoney.com/api/qt/stock/kline/get';
type Provider='eastmoney'|'tencent';
const providerName=(p:Provider)=>p==='eastmoney'?source:'腾讯证券历史';
const periods:Record<SecurityPeriod,number>={'1m':1,'5m':5,'15m':15,'30m':30,'60m':60,'1d':101};
const adjusts:Record<SecurityAdjust,number>={none:0,qfq:1,hfq:2};
export const securityHistoryInfo={tool:'get_security_history',source,endpoint,backup_source:'腾讯证券历史',request_profile:{public_client_parameter:'ut',reference:'https://github.com/akfamily/akshare/blob/main/akshare/fund/fund_etf_em.py',intraday_window_end_marker:'20500000',row_limit:'client_enforced_10000'},range_retry:{max_requests_per_segment:2,segmentation:'bounded whole-range read; exact per-session archive backfill',timeout_ms:6500,backup_timeout_ms:4500,window_beg:'0',end:'daily requested end; intraday supplier upper-bound marker; strict local date filtering',max_rows:10000,no_retry_http_statuses:[401,403,429],no_window_retry_error_codes:['ADJUSTMENT_EPOCH_CHANGED'],evidence:'source_requests.fetch_attempt_metadata records the original successful fetch, including prior failures; current failed refresh attempts are in refresh_error.request_attempts'},fallback_policy:'Try whole-range backup for partial or failed primary; select a single provider, never cross-provider stitch; amount null is field incompleteness, separate from bar coverage',periods:Object.keys(periods),adjustments:Object.keys(adjusts),one_minute_adjustments:['none'],markets:['sh','sz','bj'],default_limit:200,max_limit:500,max_calendar_days:{daily:366,intraday:62},timezone:'Asia/Shanghai',units:{price:'CNY',volume:'lots (100 shares/units)',amount:'CNY'},calendar:securityCalendarPolicy,notes:['按需读取同一供应商原始K线，不合成其他周期，不跨源或复权基准拼接。','1分钟接口实测会忽略历史范围并只返回近期窗口，严格在本地筛选请求日期，范围不足标partial；1分钟复权未核实，返回unsupported。','日K timestamp为交易日期在当地零点的规范化键，不是实际成交或收盘时间；分钟timestamp为供应商K线结束标签。','缺少预期K线的原因可能是停牌、未上市、无成交或源缺失，不自行归因；不补造记录。','前/后复权按供应商fqt获取；调整数据按读取日隔离缓存，未取得可核实的因子版本，不跨读取日拼接。','分钟历史不保证覆盖任意日期；返回范围、覆盖和分页信息必须一起读取。']};
function invalid(message:string):never{throw new DataError({code:'INVALID_ARGUMENT',message,retryable:false})}
function fail(code:string,message:string,retryable=false):never{throw new DataError({code,message,retryable,source})}
function dates(start:string,end:string){const result:string[]=[];for(let d=start;d<=end;d=shiftDate(d,1))result.push(d);return result}
export function validateSecurityHistory(input:unknown):Query{
 if(!input||typeof input!=='object'||Array.isArray(input))invalid('参数必须是对象');const p=input as Record<string,unknown>;
 const allowed=['symbol','period','start_date','end_date','adjust','refresh','include_raw','limit','cursor'];if(Object.keys(p).some(k=>!allowed.includes(k)))invalid('包含未知参数');
 if(typeof p.symbol!=='string'||!/^(sh|sz|bj)\d{6}$/i.test(p.symbol))invalid('symbol必须带sh/sz/bj前缀及六位代码');
 const symbol=p.symbol.toLowerCase(),code=symbol.slice(2),exchange=symbol.slice(0,2);
 if(exchange==='bj'&&!/^(?:4|8|92)/.test(code)||exchange==='sh'&&!/^(?:5|60|68)/.test(code)||exchange==='sz'&&!/^(?:00[0-4]|30[01]|1[56])/.test(code))invalid('代码前缀与已支持的股票/场内基金交易所映射不符，不支持指数、债券或港美股');
 const period=p.period??'1d',adjust=p.adjust??'none';if(typeof period!=='string'||!Object.hasOwn(periods,period))invalid('period只支持1m/5m/15m/30m/60m/1d');if(typeof adjust!=='string'||!Object.hasOwn(adjusts,adjust))invalid('adjust只支持none/qfq/hfq');
 if(!validDate(p.start_date)||!validDate(p.end_date)||p.start_date>p.end_date)invalid('日期必须为有效YYYY-MM-DD且start_date不晚于end_date');
 const days=(Date.parse(p.end_date)-Date.parse(p.start_date))/86400000+1;if(days>(period==='1d'?366:62))invalid('单次日K最多366个日历日，分钟K最多62个日历日，请拆分请求');
 for(const k of ['refresh','include_raw'])if(p[k]!==undefined&&typeof p[k]!=='boolean')invalid(k+'必须是boolean');
 const limit=p.limit??200;if(!Number.isInteger(limit)||Number(limit)<1||Number(limit)>500)invalid('limit必须为1–500整数');
 if(p.cursor!==undefined&&(typeof p.cursor!=='string'||p.cursor.length>1600))invalid('cursor格式无效');
 return {symbol,period:period as SecurityPeriod,adjust:adjust as SecurityAdjust,start_date:p.start_date,end_date:p.end_date,refresh:p.refresh===true,include_raw:p.include_raw===true,limit:Number(limit),cursor:p.cursor as string|undefined};
}
function number(raw:unknown){if(typeof raw!=='string'||!/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw.trim()))return null;const n=Number(raw);return Number.isFinite(n)?n:null}
export function parseSecurityKlines(data:any,q:Query,fetchedAt:string,options:{sourceName?:string;allowMissingAmount?:boolean}={}){
 const source=options.sourceName??'东方财富';
 const d=data?.data,market=q.symbol.startsWith('sh')?1:0;
 if(data?.rc!==0)fail('UPSTREAM_RESPONSE','东方财富未返回成功业务状态');
 if(d===null)fail('EMPTY_HISTORY','上游没有历史记录，无法据此判断证券不存在、停牌或历史范围不足');
 if(d?.code!==q.symbol.slice(2)||d?.market!==market||typeof d.name!=='string'||!d.name||!Array.isArray(d.klines))fail('INSTRUMENT_MISMATCH','历史证券代码、市场或字段结构不匹配');
 const daily=q.period==='1d',step=periods[q.period],slots=new Set(minuteEnds(step)),map=new Map<number,SecurityBar>(),warnings:string[]=[];let rejected=0,duplicates=0;const rejectionReasons:Record<string,number>={};const reject=(reason:string)=>{rejected++;rejectionReasons[reason]=(rejectionReasons[reason]??0)+1};
 for(const line of d.klines){
  if(typeof line!=='string'){reject('invalid_row_type');continue;}const f=line.split(','),raw=f[0],ms=sourceTime(raw,daily),v=f.slice(1,11).map(number);
  const [open,close,high,low,volume,amount,amplitude,changePercent,change,turnover]=v;
  const minute=daily?(/^(?:sh68|sz30)/.test(q.symbol)?930:900):Number(raw.slice(11,13))*60+Number(raw.slice(14,16));
  const reason=ms===null?'invalid_timestamp':f.length<7?'missing_fields':[open,close,high,low,volume].some(x=>x===null)||(!options.allowMissingAmount&&amount===null)?'invalid_numeric_field':high!<Math.max(open!,close!,low!)||low!>Math.min(open!,close!,high!)?'invalid_ohlc':volume!<0||(amount!==null&&amount<0)||(q.adjust==='none'&&low!<=0)?'invalid_value':raw.slice(0,10)>chinaDate(Date.parse(fetchedAt))?'future_session':!daily&&(!slots.has(minute)||(raw.length===19&&raw.slice(17)!=='00'))?'outside_session_grid':securityTradingDay(raw.slice(0,10))===false?'non_trading_day':null;
  if(reason){reject(reason);continue;}
  const end=barEnd(raw.slice(0,10),minute),fetched=Date.parse(fetchedAt),unknownPostClose=daily&&minute===900&&fetched>=end&&fetched<barEnd(raw.slice(0,10),930);
  if(!daily&&end-step*60000>fetched+120000){reject('future_bar');continue;}
  const bar:SecurityBar={timestamp:ms!/1000,datetime:raw,source_datetime:raw,time_precision:daily?'date':raw.length===19?'second':'minute',open:open!,high:high!,low:low!,close:close!,volume:volume!,amount,amplitude:amplitude??null,change_percent:changePercent??null,change:change??null,turnover_rate:turnover??null,bar_end:new Date(end).toISOString(),is_final:securityTradingDay(raw.slice(0,10))===null||unknownPostClose?null:end<=fetched,fetched_at:fetchedAt,source,raw_volume:f[5]??null,raw_amount:f[6]||null,raw_units:{volume:'lots (100 shares/units)',amount:options.allowMissingAmount?null:'CNY'}};
  const old=map.get(bar.timestamp);if(old){duplicates++;if(JSON.stringify(old)!==JSON.stringify(bar))fail('CONFLICTING_BARS','同一供应商响应中同一时间出现冲突K线，不混合取值');}else map.set(bar.timestamp,bar);
 }
 if(rejected)warnings.push(`INVALID_ROWS_REJECTED:${rejected}`);if(duplicates)warnings.push(`IDENTICAL_DUPLICATES_REMOVED:${duplicates}`);
 if(d.klines.length>=10000)warnings.push('UPSTREAM_ROW_LIMIT_REACHED');
 return {name:d.name,bars:[...map.values()].sort((a,b)=>a.timestamp-b.timestamp),warnings,rejected,rejection_reasons:rejectionReasons};
}
export function parseTencentSecurityHistory(data:any,q:Query,fetchedAt:string){
 const d=data?.data?.[q.symbol],qt=d?.qt?.[q.symbol],source='腾讯证券历史';
 const error=(code:string,message:string):never=>{throw new DataError({code,message,retryable:false,source})};
 if(data?.code!==0||!d)error('UPSTREAM_RESPONSE','腾讯历史业务状态或证券节点无效');
 if(!Array.isArray(qt)||qt[2]!==q.symbol.slice(2)||typeof qt[1]!=='string')error('INSTRUMENT_MISMATCH','腾讯历史证券标识不能可靠核实');
 const daily=q.period==='1d';if(!daily&&q.adjust!=='none')error('UNVERIFIED_ADJUSTMENT','腾讯分钟复权未核实，不以不复权数据替代');
 const key=daily?(q.adjust==='none'?'day':q.adjust+'day'):'m'+periods[q.period];
 if(!Array.isArray(d[key]))error(q.adjust!=='none'?'UNVERIFIED_ADJUSTMENT':'EMPTY_HISTORY',q.adjust!=='none'?'腾讯未返回明确的请求复权序列，不将day数组当作已复权':'腾讯未返回请求周期的历史数组');
 const original=new Map<string,string>();const klines=d[key].map((r:any)=>{
  if(!Array.isArray(r)||r.length<6)return '';
  const raw=String(r[0]),stamp=daily?raw:/^\d{12}$/.test(raw)?`${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)} ${raw.slice(8,10)}:${raw.slice(10,12)}`:'';original.set(stamp,raw);
  // Canonical parser input. Tencent does not provide bar amount; an empty field remains null.
  return [stamp,r[1],r[2],r[3],r[4],r[5],'','','','',''].join(',');
 });
 const parsed=parseSecurityKlines({rc:0,data:{code:qt[2],market:q.symbol.startsWith('sh')?1:0,name:qt[1],klines}},q,fetchedAt,{sourceName:source,allowMissingAmount:true});
 parsed.bars=parsed.bars.map(b=>({...b,source_datetime:original.get(b.datetime)??b.source_datetime}));
 parsed.warnings.push('AMOUNT_NOT_PROVIDED: 腾讯逐根成交额缺失，返回null，不用收盘价乘成交量估算');
 return {...parsed,provider_series:key,provider_version:d.version??null};
}
function blocks(q:Query,end:string,_provider:Provider){
 // One bounded whole interval, then at most one retained-window retry. Per-day backfill jobs
 // target only failed sessions; do not multiply identical window requests for every week.
 return dates(q.start_date,end).some(d=>securityTradingDay(d)!==false)?[{start:q.start_date,end}]:[];
}
async function archiveResponse(q:Query,source:string,url:string,start:string,end:string,fetchedAt:string,parsed:any,raw:any,attempts:any[],error:DataIssue|null=null){
 const store=securityArchiveStore();if(!store)return null;
 const id=await archiveId([source,q.symbol,q.period,q.adjust,url,fetchedAt,raw,error]);
 try{const saved=await store.saveFetch({id,symbol:q.symbol,period:q.period,adjust:q.adjust,source,source_url:url,start_date:start,end_date:end,fetched_at:fetchedAt,name:parsed?.name??null,bars:parsed?.bars??[],raw,attempts,rejected:parsed?.rejected??0,rejection_reasons:parsed?.rejection_reasons??{},error});return {fetch_id:id,rows_written:saved,status:'persisted'};}
 catch(e){return {fetch_id:id,rows_written:0,status:'failed',error:String(e).slice(0,300)}}
}
export function acceptSecurityReplacement(previous:any,next:any){
 if(previous.symbol!==next.symbol||previous.period!==next.period||previous.adjust!==next.adjust||previous.adjustment_epoch!==next.adjustment_epoch||previous.source!==next.source)return false;
 const incoming=new Map(next.bars.map((b:SecurityBar)=>[b.timestamp,b]));
 return previous.bars.every((b:SecurityBar)=>{const n=incoming.get(b.timestamp) as SecurityBar|undefined;return !!n&&(b.is_final!==true||n.is_final===true)});
}
function requestUrl(q:Query,start:string,end:string,provider:Provider,window=false){
 if(provider==='tencent')return q.period==='1d'?'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param='+[q.symbol,'day',start,end,640,q.adjust==='none'?'':q.adjust].join(','):'https://ifzq.gtimg.cn/appstock/app/kline/mkline?param='+[q.symbol,'m'+periods[q.period],'',1023].join(',');
 const daily=q.period==='1d',secid=(q.symbol.startsWith('sh')?'1.':'0.')+q.symbol.slice(2);
 // Public history client parameter; not an account token or a configured Secret.
 // Keep the supplier's protocol marker out of market dates and filter before caching.
 const fields={fields1:'f1,f2,f3,f4,f5,f6',fields2:'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61'+(daily?',f116':''),ut:'7eea3edcaed734bea9cbfc24409ed989',klt:String(periods[q.period]),fqt:String(adjusts[q.adjust])};
 const range={beg:window?'0':start.replaceAll('-',''),end:window&&!daily?'20500000':end.replaceAll('-','')};
 const params=daily?{...fields,...range,secid}:{...fields,secid,...range};
 return endpoint+'?'+new URLSearchParams(params).toString().replaceAll('%2C',',');
}
async function getBlock(q:Query,b:{start:string;end:string},now:number,provider:Provider,cacheProbe=false){
 const source=providerName(provider);
 const today=chinaDate(now),end=b.end>today?today:b.end,epoch=q.adjust==='none'?'unadjusted':today;
 const key=['security-history-v1',source,q.symbol,q.period,q.adjust,epoch,b.start,b.end].join(':');
 const ttl=b.end>=today?(q.period==='1d'?60000:15000):q.adjust==='none'?6*3600000:3600000;
 return loadQuote(key,async()=>{
  const attempts:NonNullable<DataIssue['request_attempts']>=[];
  const strategies=provider==='eastmoney'?['requested_range','provider_window']:['requested_range'];
  for(const strategy of strategies){
   if(attempts.length)await new Promise(r=>setTimeout(r,300));
   const url=requestUrl(q,b.start,end,provider,strategy==='provider_window'),attemptedAt=new Date(Date.now()).toISOString();
   try{
    const response=await fetchJson(url,{attempts:1,timeoutMs:provider==='eastmoney'?6500:4500,captureErrorBody:true,headers:{'User-Agent':'Mozilla/5.0',Referer:provider==='eastmoney'?'https://quote.eastmoney.com/':'https://gu.qq.com/'}});
    const fetchedAt=new Date(Date.now()).toISOString();if(q.adjust!=='none'&&chinaDate(Date.parse(fetchedAt))!==epoch)fail('ADJUSTMENT_EPOCH_CHANGED','跨越读取日，无法核实同一复权基准，请重新请求',true);let parsed:ReturnType<typeof parseSecurityKlines>;
    try{if(provider==='eastmoney'&&response.data?.data?.klines?.length>10000)fail('UPSTREAM_ROW_LIMIT_EXCEEDED','上游超过请求的10000行边界，拒绝保存不受限响应');parsed=provider==='eastmoney'?parseSecurityKlines(response.data,q,fetchedAt):parseTencentSecurityHistory(response.data,q,fetchedAt)}catch(error){await archiveResponse(q,source,url,b.start,end,fetchedAt,null,response.data,attempts,dataIssue(error));throw new DataError({...dataIssue(error),source,source_url:url,...(q.include_raw?{raw_response:response.data}:{})})}
    const persistence=await archiveResponse(q,source,url,b.start,end,fetchedAt,parsed,response.data,[...attempts,{strategy,source_url:url,status:'succeeded',attempted_at:attemptedAt,fetched_at:fetchedAt,transport_attempts:response.attempts}]);
    const bars=parsed.bars.filter(p=>p.datetime.slice(0,10)>=b.start&&p.datetime.slice(0,10)<=end);
    if(!bars.length){const observed=parsed.bars.length?`；供应商实际返回${parsed.bars[0].datetime}至${parsed.bars.at(-1)!.datetime}`:'';throw new DataError({code:parsed.bars.length?'HISTORY_RANGE_UNAVAILABLE':'EMPTY_HISTORY',message:'请求范围内没有有效历史记录'+observed,retryable:false,source,source_url:url,...(q.include_raw?{raw_response:response.data}:{})});}
    attempts.push({strategy,source_url:url,status:'succeeded',attempted_at:attemptedAt,fetched_at:fetchedAt,transport_attempts:response.attempts});
    // Whole validated response from one supplier and adjustment epoch; filter before cache/return.
    return {value:bars.length,market_date:bars.at(-1)!.datetime.slice(0,10),as_of:null,symbol:q.symbol,period:q.period,adjust:q.adjust,adjustment_epoch:epoch,source,source_url:url,fetch_strategy:strategy,fetch_attempt_metadata:attempts,name:parsed.name,bars,warnings:[...parsed.warnings,...(persistence?.status==='failed'?['ARCHIVE_WRITE_FAILED:'+persistence.error]:[])],rejected:parsed.rejected,rejection_reasons:parsed.rejection_reasons,archive:persistence,fetched_at:fetchedAt,raw:response.data,provider_series:(parsed as any).provider_series??('fqt='+adjusts[q.adjust]),provider_version:(parsed as any).provider_version??null,observed_start:parsed.bars[0]?.datetime,observed_end:parsed.bars.at(-1)?.datetime};
   }catch(error){
    const issue={...dataIssue(error),source,source_url:dataIssue(error).source_url??url};attempts.push({strategy,source_url:url,status:'failed',attempted_at:attemptedAt,error:issue});
    await archiveResponse(q,source,url,b.start,end,new Date().toISOString(),null,(issue as any).raw_response??null,attempts,issue);
    if(provider==='eastmoney'&&strategy==='requested_range'&&issue.retryable&&issue.http_status!==429&&issue.code!=='ADJUSTMENT_EPOCH_CHANGED')continue;
    // Keep the original range failure authoritative; a limited window cannot prove range unsupported.
    throw new DataError({...attempts[0].error!,request_attempts:attempts});
   }
  }
  throw new DataError({code:'UNAVAILABLE_HISTORY',message:'没有可用的历史请求策略',retryable:false,source});
 },{refresh:q.refresh,ttlMs:ttl,cacheOnly:cacheProbe?'fresh':!!q.cursor&&!q.refresh,cacheFresh:(p,age)=>{
  if(age<ttl)return true;
  const start=b.start<q.start_date?q.start_date:b.start,stop=end>q.end_date?q.end_date:end;
  const bars=(p.bars as SecurityBar[]).filter(x=>x.datetime.slice(0,10)>=start&&x.datetime.slice(0,10)<=stop);
  const closed=stop<today||stop===today&&now>=barEnd(today,935);
  return closed&&age<(q.adjust==='none'?6*3600000:3600000)&&bars.length>0&&bars.every(x=>x.is_final===true)&&securityCoverage({...q,start_date:start,end_date:stop},bars,now).range_complete===true;
 },acceptReplacement:acceptSecurityReplacement});
}
export function securityCoverage(q:Query,bars:SecurityBar[],now:number){
 const end=q.end_date>chinaDate(now)?chinaDate(now):q.end_date,keys=new Set(bars.map(b=>b.datetime.slice(0,q.period==='1d'?10:16))),missing:{date:string;missing_count:number;reason:string;missing_labels:string[];intervals:{start:string;end:string;count:number}[]}[]=[];let expected=0,calendarVerified=true;
 for(const d of dates(q.start_date,end)){
  const trading=securityTradingDay(d);if(trading===null){calendarVerified=false;continue;}if(!trading)continue;
  const labels=q.period==='1d'?[d]:minuteEnds(periods[q.period]).filter(m=>barEnd(d,m)<=now).map(m=>`${d} ${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`);
  // Daily bar is only expected once the session has started, and may still be forming.
  if(q.period==='1d'&&barEnd(d,570)>now)continue;expected+=labels.length;
  const absent=labels.filter(k=>!keys.has(k));const intervals:{start:string;end:string;count:number}[]=[];for(const label of absent){const last=intervals.at(-1),consecutive=last&&(q.period==='1d'?false:(sourceTime(label,false)! - sourceTime(last.end,false)!)===periods[q.period]*60000);if(consecutive){last.end=label;last.count++}else intervals.push({start:label,end:label,count:1})}if(absent.length)missing.push({date:d,missing_count:absent.length,reason:'missing_unverified',missing_labels:absent,intervals});
 }
 return {calendar_verified:calendarVerified,range_complete:calendarVerified?missing.length===0&&q.end_date<=chinaDate(now):null,expected_count:calendarVerified?expected:null,missing_count:calendarVerified?missing.reduce((n,x)=>n+x.missing_count,0):null,missing_sessions:missing,non_trading_dates:dates(q.start_date,end).filter(d=>securityTradingDay(d)===false),suspension_verified:false,listing_boundary_verified:false,provider_retention_verified:false,emergency_closures_verified:false};
}
async function fingerprint(q:Query,bars:SecurityBar[]){const values=[q.symbol,q.period,q.adjust,q.start_date,q.end_date,bars.map(b=>[b.timestamp,b.datetime,b.open,b.high,b.low,b.close,b.volume,b.amount,b.amplitude,b.change_percent,b.change,b.turnover_rate,b.bar_end,b.is_final,b.source])];const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(values)));return [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('')}
function cursorDecode(s:string){try{const p=JSON.parse(atob(s.replaceAll('-','+').replaceAll('_','/')));if(![1,2].includes(p.v)||(p.provider!==undefined&&!['eastmoney','tencent'].includes(p.provider))||!Number.isInteger(p.offset)||p.offset<1||typeof p.fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(p.fingerprint))invalid('cursor无效');return p;}catch{invalid('cursor无效')}}
async function readSecurityHistory(q:Query,provider:Provider,cacheProbe=false):Promise<SecurityHistoryResult>{
 const source=providerName(provider),cursor=q.cursor?cursorDecode(q.cursor):null,now=Date.now(),today=chinaDate(now),end=q.end_date>today?today:q.end_date;
 const base:SecurityHistoryResult={schema_version:'1.5',symbol:q.symbol,security_name:null,period:q.period,adjust:q.adjust,requested_start_date:q.start_date,requested_end_date:q.end_date,actual_start_date:null,actual_end_date:null,history_count:0,history_available:false,source,source_timezone:'Asia/Shanghai',market_timezone:'Asia/Shanghai',timestamp_timezone:'UTC',report_timezone:'Asia/Shanghai',fetched_at:null,retrieved_at:new Date(now).toISOString(),quality:'unavailable',degraded:false,cache_hit:false,history_refresh_status:'not_attempted',history_refresh_error:null,history_error:null,bars:[],warnings:[],units:securityHistoryInfo.units,timestamp_unit:'unix_seconds',timestamp_semantics:q.period==='1d'?'session_date_at_local_midnight_not_trade_time':'provider_bar_end_label',finality_basis:'scheduled_session_end_and_original_fetched_at_not_exchange_confirmation',source_transition:null,adjustment_basis:q.adjust==='none'?{kind:'unadjusted'}:{kind:provider==='eastmoney'?'provider_fqt':'provider_named_series',source,requested_adjust:q.adjust,fqt:provider==='eastmoney'?adjusts[q.adjust]:null,retrieval_epoch:today,factor_version:null,verified_factor_version:false,vintage:'current_provider_revision_at_fetch',point_in_time_supported:false},pagination:{limit:q.limit,has_more:false,next_cursor:null,total_count:0},source_requests:[]};
 if(q.period==='1m'&&q.adjust!=='none')return {...base,quality:'unsupported',history_error:{code:'UNVERIFIED_ADJUSTMENT',message:'1分钟复权口径未可靠核实，不将接受fqt参数等同于正确复权',retryable:false,source},warnings:['1分钟只开放none，不降级或忽略adjust。']};
 if(end<q.start_date)return {...base,quality:'unsupported',history_error:{code:'FUTURE_RANGE',message:'请求范围完全位于未来',retryable:false,source}};
 const work=blocks(q,end,provider),loaded:any[]=[],errors:DataIssue[]=[],requests:any[]=[];
 const store=securityArchiveStore();let archiveComplete=false;
 if(store&&q.adjust==='none'){
  try{
   // Import previous successful raw responses without changing their original fetched_at.
   if(!cursor)for(const old of await store.legacy(q.symbol,q.period,source))if(old.raw){try{const p=provider==='eastmoney'?parseSecurityKlines(old.raw,q,old.fetched_at):parseTencentSecurityHistory(old.raw,q,old.fetched_at);await archiveResponse(q,source,old.source_url,q.start_date,end,old.fetched_at,p,old.raw,old.fetch_attempt_metadata??[])}catch{/* Legacy parsing cannot invent records. */}}
   const archived=await store.readBars(q.symbol,q.period,source,q.start_date,end);
   if(archived.bars.length){archiveComplete=securityCoverage(q,archived.bars,now).range_complete===true;loaded.push({name:archived.name,bars:archived.bars,fetched_at:archived.bars.map(b=>b.fetched_at).sort()[0],delivery:'durable_archive',degraded:false,warnings:[],rejected:0});requests.push({source,start_date:q.start_date,end_date:end,delivery:'durable_archive',refresh_status:'not_attempted',fetched_at:loaded[0].fetched_at,retrieved_at:new Date(now).toISOString()});}
  }catch(e){requests.push({source,delivery:'durable_archive',refresh_status:'not_attempted',archive_error:String(e).slice(0,300)})}
 }
 const archiveOnly=cursor?.v===2||!q.refresh&&archiveComplete;

 for(let i=0;!archiveOnly&&i<work.length;i+=2)await Promise.all(work.slice(i,i+2).map(async block=>{
  try{const h=await getBlock(q,block,now,provider,cacheProbe);loaded.push(h);requests.push({source,provider_series:h.provider_series,provider_version:h.provider_version,archive:h.archive,adjust:h.adjust,adjustment_epoch:h.adjustment_epoch,start_date:block.start,end_date:block.end,source_url:h.source_url,fetch_strategy:h.fetch_strategy??'requested_range',fetch_attempt_metadata:h.fetch_attempt_metadata??null,delivery:h.delivery,degraded:h.degraded,cache_backend:h.cache_backend,cache_warning:h.cache_warning,fetched_at:h.fetched_at,retrieved_at:h.retrieved_at,refresh_status:h.degraded?'failed':h.delivery==='upstream'?'succeeded':'not_attempted',refresh_error:h.upstream_error??null,observed_start:h.observed_start,observed_end:h.observed_end});}
  catch(e){const issue={...dataIssue(e),source,source_url:dataIssue(e).source_url??requestUrl(q,block.start,block.end,provider)};errors.push(issue);requests.push({source,start_date:block.start,end_date:block.end,refresh_status:issue.code==='CURSOR_CACHE_MISS'?'not_attempted':'failed',refresh_error:issue.code==='CURSOR_CACHE_MISS'?null:issue,...(issue.code==='CURSOR_CACHE_MISS'?{cache_error:issue}:{})});}
 }));
 const warnings=loaded.flatMap(h=>h.warnings??[]),names=new Set(loaded.map(h=>h.name));if(names.size>1){warnings.push('SECURITY_NAME_CHANGED_WITHIN_RESPONSE');}
 const map=new Map<number,SecurityBar>();for(const h of loaded)for(const b of h.bars as SecurityBar[])if(b.datetime.slice(0,10)>=q.start_date&&b.datetime.slice(0,10)<=end){const prior=map.get(b.timestamp);map.set(b.timestamp,prior?preferSecurityBar(prior,b):b);}
 const all=[...map.values()].sort((a,b)=>a.timestamp-b.timestamp),coverage=securityCoverage(q,all,now),degraded=loaded.some(h=>h.degraded)||loaded.some(h=>h.delivery==='durable_archive')&&errors.some(e=>e.code!=='CURSOR_CACHE_MISS'),refreshErrors=[...errors.filter(e=>e.code!=='CURSOR_CACHE_MISS'),...loaded.filter(h=>h.degraded).map(h=>h.upstream_error).filter(Boolean)];
 const refreshError=refreshErrors.length?{code:'HISTORY_REFRESH_INCOMPLETE',message:'部分或全部历史段刷新失败，详见causes及source_requests',retryable:refreshErrors.some(e=>e.retryable),source,causes:refreshErrors}:null;
 if(!coverage.calendar_verified)warnings.push('CALENDAR_UNVERIFIED: outside verified 2026 scheduled calendar');
 if(coverage.missing_count)warnings.push('EXPECTED_BARS_MISSING: reason not independently verified');if(q.end_date>today)warnings.push('FUTURE_END_DATE_CLAMPED');
 if(q.period==='1m')warnings.push('ONE_MINUTE_RETENTION_LIMIT: provider may ignore historical beg/end; records strictly filtered');
 const stale=all.some(b=>b.is_final===false&&Date.parse(b.bar_end)<now&&Date.parse(b.fetched_at)<Date.parse(b.bar_end)||q.period==='1d'&&b.is_final===null&&securityTradingDay(b.datetime.slice(0,10))===true&&now>barEnd(b.datetime.slice(0,10),930)&&Date.parse(b.fetched_at)<barEnd(b.datetime.slice(0,10),930));
 const forming=all.some(b=>b.is_final===false),unknownFinal=all.some(b=>b.is_final===null);if(forming)warnings.push('CONTAINS_UNFINISHED_BARS');if(unknownFinal)warnings.push('BAR_FINALITY_UNVERIFIED');
 const fetched=all.map(b=>b.fetched_at).sort(),data={...base,security_name:loaded[0]?.name??null,fetched_at:fetched[0]??null,fetched_at_semantics:'oldest successful fetch among returned segments; each bar/segment retains its own fetched_at',latest_fetched_at:fetched.at(-1)??null,retrieved_at:new Date(Date.now()).toISOString(),degraded,cache_hit:loaded.length>0&&loaded.every(h=>h.delivery!=='upstream'),upstream_refresh_attempted:requests.some(r=>['succeeded','failed'].includes(r.refresh_status)),history_refresh_status:requests.some(r=>r.refresh_status==='failed')?'failed':loaded.some(h=>h.delivery==='upstream')?'succeeded':'not_attempted',history_refresh_error:refreshError,history_error:refreshError,source_requests:requests.sort((a,b)=>(a.start_date??'').localeCompare(b.start_date??'')),coverage,bar_coverage:{...coverage,received_count:all.length,status:coverage.range_complete===true?'complete':coverage.calendar_verified?'partial':'unknown'},field_completeness:{ohlcv:true,amount:all.every(b=>b.amount!==null),missing_amount_count:all.filter(b=>b.amount===null).length},rejected_count:loaded.reduce((n,h)=>n+(h.rejected??0),0),rejection_reasons:loaded.reduce((m,h)=>{for(const [k,v] of Object.entries(h.rejection_reasons??{}))m[k]=(m[k]??0)+Number(v);return m},{} as Record<string,number>),cache_status:{delivery:loaded.some(h=>h.delivery==='durable_archive')?(loaded.some(h=>h.delivery==='upstream')?'archive_plus_upstream':'durable_archive'):loaded.some(h=>h.delivery==='upstream')?'upstream':loaded.length?'last_success_cache':'none',complete:coverage.range_complete,expired:stale},warnings:[...new Set(warnings)],contains_forming:forming,stale};
 if(!all.length)return {...data,refresh_status:data.history_refresh_status,source_quality:'unavailable',quality:errors.some(e=>['HISTORY_RANGE_UNAVAILABLE','UNVERIFIED_ADJUSTMENT'].includes(e.code))?'unsupported':'unavailable',history_error:errors.some(e=>e.code==='CURSOR_CACHE_MISS')?{code:'CURSOR_EXPIRED',message:'分页成功缓存已不可用，请从第一页读取',retryable:true,source}:refreshError??{code:work.length?'EMPTY_HISTORY':'NO_TRADING_SESSIONS',message:work.length?'请求范围没有有效记录；不推测停牌、上市边界或供应商保留范围':'请求范围没有已排定交易时段，未请求上游',retryable:false,source}};
 const digest=await fingerprint(q,all);if(cursor&&cursor.fingerprint!==digest)return {...data,quality:'unavailable',history_error:{code:'CURSOR_EXPIRED',message:'数据已刷新或查询口径改变，请从第一页重新读取',retryable:true,source}};
 const offset=cursor?.offset??0;if(offset>=all.length)invalid('cursor位置超出数据范围');const page=all.slice(offset,offset+q.limit),hasMore=offset+page.length<all.length;
 const next=hasMore?btoa(JSON.stringify({v:store&&q.adjust==='none'&&all.every(b=>b.is_final===true)&&!loaded.some(h=>h.archive?.status==='failed')?2:1,provider,offset:offset+page.length,fingerprint:digest})).replaceAll('+','-').replaceAll('/','_').replaceAll('=',''):null;
 const quality:Quality=stale?'stale':coverage.range_complete!==true||loaded.some(h=>h.rejected>0)||forming||unknownFinal||all.some(b=>b.amount===null)?'partial':'available';
 return {...data,refresh_status:data.history_refresh_status,source_quality:degraded?'degraded':requests.some(r=>r.refresh_status==='failed')?'recovered':all.some(b=>b.amount===null)?'partial_fields':'available',quality,history_count:page.length,history_available:page.length>0,bars:page,actual_start_date:page[0].datetime.slice(0,10),actual_end_date:page.at(-1)!.datetime.slice(0,10),available_start_date:all[0].datetime.slice(0,10),available_end_date:all.at(-1)!.datetime.slice(0,10),actual_start_datetime:page[0].datetime,actual_end_datetime:page.at(-1)!.datetime,pagination:{limit:q.limit,offset,has_more:hasMore,next_cursor:next,total_count:all.length,snapshot_id:digest},...(q.include_raw?{raw_responses:loaded.filter(h=>h.raw!==undefined).map(h=>({source_url:h.source_url,fetched_at:h.fetched_at,response:h.raw})),archive_fetch_ids:[...new Set(all.map(b=>b.archive_fetch_id).filter(Boolean))]}:{})};
}

/** A provider change replaces the whole response; no cross-provider bar or field stitching. */
async function resolveSecurityHistory(input:SecurityHistoryRequest|unknown):Promise<SecurityHistoryResult>{
 const q=validateSecurityHistory(input),cursor=q.cursor?cursorDecode(q.cursor):null;
 if(cursor){const provider:Provider=cursor.provider??'eastmoney';const result=await readSecurityHistory(q,provider);return {...result,fallback_used:provider==='tencent',primary_refresh_status:'not_attempted',...(provider==='tencent'?{source_transition:{from:source,to:providerName(provider),same_instrument:true,same_adjustment_basis:q.adjust==='none'?true:null,reason:'cursor_provider',note:'分页沿用原提供方；本次未重新请求主源'}}:{})};}
 if(!q.refresh){for(const provider of ['eastmoney','tencent'] as Provider[]){const cached=await readSecurityHistory(q,provider,true);if(cached.history_available&&(cached.coverage as any)?.range_complete===true&&!cached.stale&&!cached.contains_forming)return {...cached,fallback_used:provider==='tencent',primary_refresh_status:'not_attempted',...(provider==='tencent'?{source_transition:{from:source,to:providerName(provider),same_instrument:true,same_adjustment_basis:q.adjust==='none'?true:null,reason:'cached_provider',note:'完整且处于正常TTL的独立提供方缓存；本次未请求主源'}}:{})};}}
 const primary=await readSecurityHistory(q,'eastmoney'),issue=primary.history_error as DataIssue|null;
 const eligible=issue&&(issue.retryable||issue.causes?.some(e=>['EMPTY_HISTORY','HISTORY_RANGE_UNAVAILABLE'].includes(e.code)));
 if((primary.history_available&&(primary.coverage as any)?.range_complete===true&&!primary.stale)||!eligible&&!(primary.history_available&&(primary.coverage as any)?.range_complete!==true))return {...primary,fallback_used:false,primary_refresh_status:primary.history_refresh_status};
 const backup=await readSecurityHistory(q,'tencent');
 const score=(r:SecurityHistoryResult)=>Number((r.coverage as any)?.range_complete===true)*100000+Number((r.pagination as any)?.total_count??0)*10+Number((r.field_completeness as any)?.amount===true);
 if(primary.history_available&&score(primary)>=score(backup))return {...primary,fallback_used:false,primary_refresh_status:primary.history_refresh_status,source_requests:[...(primary.source_requests as any[]),...(backup.source_requests as any[])],backup_candidate:{source:backup.source,count:(backup.pagination as any)?.total_count??0,coverage:backup.coverage,quality:backup.quality,refresh_status:backup.history_refresh_status,error:backup.history_error,selected:false},warnings:[...primary.warnings,'BACKUP_WHOLE_RANGE_ATTEMPTED: 主源更完整，未拼接独立备用数据']};
 const cachedAfterFailure=backup.history_available&&backup.cache_hit&&primary.history_refresh_status==='failed';
 const combinedError=!backup.history_available||cachedAfterFailure?{code:backup.history_available?'HISTORY_REFRESH_INCOMPLETE':'ALL_HISTORY_SOURCES_FAILED',message:backup.history_available?'本次刷新失败，交付独立提供方成功缓存；见causes及source_requests':'主源和独立备用源均未取得请求历史；见causes及source_requests',retryable:!!issue?.retryable||(backup.history_error as DataIssue|null)?.retryable===true,causes:[issue!,backup.history_error as DataIssue].filter(Boolean)}:backup.history_refresh_error;
 return {...backup,quality:backup.history_available?backup.quality:primary.quality==='unsupported'&&backup.quality==='unsupported'?'unsupported':'unavailable',fallback_used:true,primary_refresh_status:primary.history_refresh_status,primary_refresh_error:primary.history_refresh_error??issue,history_error:combinedError,history_refresh_error:combinedError,history_refresh_status:cachedAfterFailure||!backup.history_available?'failed':backup.history_refresh_status,upstream_refresh_attempted:primary.upstream_refresh_attempted===true||backup.upstream_refresh_attempted===true,degraded:backup.degraded||!!cachedAfterFailure,source_requests:[...(primary.source_requests as any[]),...(backup.source_requests as any[])],warnings:[...backup.warnings,'FALLBACK_PROVIDER_USED: 整段历史改用独立来源，不跨源拼接'],source_transition:{from:source,to:backup.source,same_instrument:true,same_adjustment_basis:q.adjust==='none'?true:null,reason:primary.history_available?'primary_partial':'primary_unavailable',primary_error:issue,note:'同一证券不代表供应商复权基准一致；整段替换，缺失成交额不补算'}};
}

/** Compatibility aliases always describe the selected result, including cached fallback. */
export async function getSecurityHistory(input:SecurityHistoryRequest|unknown):Promise<SecurityHistoryResult>{
 const r=await resolveSecurityHistory(input);
 return {...r,refresh_status:r.history_refresh_status,source_quality:r.degraded?'degraded':r.source_quality??r.quality,cache_status:{...(r.cache_status as Record<string,unknown>??{}),degraded:r.degraded},field_completeness:r.history_available?r.field_completeness:{ohlcv:null,amount:null,missing_amount_count:0}};
}
