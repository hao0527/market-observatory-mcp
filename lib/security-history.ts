import {fetchJson,DataError,dataIssue,type DataIssue} from './upstream';
import {loadQuote} from './quote-cache';
import {chinaDate,shiftDate,validDate,securityTradingDay,minuteEnds,sourceTime,barEnd,securityCalendarPolicy} from './security-calendar';

export type SecurityPeriod='1m'|'5m'|'15m'|'30m'|'60m'|'1d';
export type SecurityAdjust='none'|'qfq'|'hfq';
export interface SecurityHistoryRequest {symbol:string;period?:SecurityPeriod;start_date:string;end_date:string;adjust?:SecurityAdjust;refresh?:boolean;include_raw?:boolean;limit?:number;cursor?:string}
export interface SecurityBar {timestamp:number;datetime:string;source_datetime:string;time_precision:'date'|'minute'|'second';open:number;high:number;low:number;close:number;volume:number;amount:number;amplitude:number|null;change_percent:number|null;change:number|null;turnover_rate:number|null;bar_end:string;is_final:boolean|null;fetched_at:string;source:string}
type Query=Required<Omit<SecurityHistoryRequest,'cursor'>>&{cursor?:string};
type Quality='available'|'partial'|'stale'|'unavailable'|'unsupported';
export interface SecurityHistoryResult {schema_version:string;symbol:string;security_name:string|null;period:SecurityPeriod;adjust:SecurityAdjust;requested_start_date:string;requested_end_date:string;actual_start_date:string|null;actual_end_date:string|null;history_count:number;history_available:boolean;source:string;source_timezone:string;fetched_at:string|null;retrieved_at:string;quality:Quality;degraded:boolean;cache_hit:boolean;warnings:string[];bars:SecurityBar[];[key:string]:unknown}
const source='东方财富',endpoint='https://push2his.eastmoney.com/api/qt/stock/kline/get';
const periods:Record<SecurityPeriod,number>={'1m':1,'5m':5,'15m':15,'30m':30,'60m':60,'1d':101};
const adjusts:Record<SecurityAdjust,number>={none:0,qfq:1,hfq:2};
export const securityHistoryInfo={tool:'get_security_history',source,endpoint,periods:Object.keys(periods),adjustments:Object.keys(adjusts),one_minute_adjustments:['none'],markets:['sh','sz','bj'],default_limit:200,max_limit:500,max_calendar_days:{daily:366,intraday:62},timezone:'Asia/Shanghai',units:{price:'CNY',volume:'lots (100 shares/units)',amount:'CNY'},calendar:securityCalendarPolicy,notes:['按需读取同一供应商原始K线，不合成其他周期，不跨源或复权基准拼接。','1分钟接口实测会忽略历史范围并只返回近期窗口，严格在本地筛选请求日期，范围不足标partial；1分钟复权未核实，返回unsupported。','日K timestamp为交易日期在当地零点的规范化键，不是实际成交或收盘时间；分钟timestamp为供应商K线结束标签。','缺少预期K线的原因可能是停牌、未上市、无成交或源缺失，不自行归因；不补造记录。','前/后复权按供应商fqt获取；调整数据按读取日隔离缓存，未取得可核实的因子版本，不跨读取日拼接。','分钟历史不保证覆盖任意日期；返回范围、覆盖和分页信息必须一起读取。']};
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
export function parseSecurityKlines(data:any,q:Query,fetchedAt:string){
 const d=data?.data,market=q.symbol.startsWith('sh')?1:0;
 if(data?.rc!==0)fail('UPSTREAM_RESPONSE','东方财富未返回成功业务状态');
 if(d===null)fail('EMPTY_HISTORY','上游没有历史记录，无法据此判断证券不存在、停牌或历史范围不足');
 if(d?.code!==q.symbol.slice(2)||d?.market!==market||typeof d.name!=='string'||!d.name||!Array.isArray(d.klines))fail('INSTRUMENT_MISMATCH','历史证券代码、市场或字段结构不匹配');
 const daily=q.period==='1d',step=periods[q.period],slots=new Set(minuteEnds(step)),map=new Map<number,SecurityBar>(),warnings:string[]=[];let rejected=0,duplicates=0;
 for(const line of d.klines){
  if(typeof line!=='string'){rejected++;continue;}const f=line.split(','),raw=f[0],ms=sourceTime(raw,daily),v=f.slice(1,11).map(number);
  const [open,close,high,low,volume,amount,amplitude,changePercent,change,turnover]=v;
  const minute=daily?(/^(?:sh68|sz30)/.test(q.symbol)?930:900):Number(raw.slice(11,13))*60+Number(raw.slice(14,16));
  if(ms===null||f.length<7||[open,close,high,low,volume,amount].some(x=>x===null)||high!<Math.max(open!,close!,low!)||low!>Math.min(open!,close!,high!)||volume!<0||amount!<0||(q.adjust==='none'&&low!<=0)||raw.slice(0,10)>chinaDate(Date.parse(fetchedAt))||(!daily&&(!slots.has(minute)||(raw.length===19&&raw.slice(17)!=='00')))||securityTradingDay(raw.slice(0,10))===false){rejected++;continue;}
  const end=barEnd(raw.slice(0,10),minute),fetched=Date.parse(fetchedAt),unknownPostClose=daily&&minute===900&&fetched>=end&&fetched<barEnd(raw.slice(0,10),930);
  if(!daily&&end-step*60000>fetched+120000){rejected++;continue;}
  const bar:SecurityBar={timestamp:ms/1000,datetime:raw,source_datetime:raw,time_precision:daily?'date':raw.length===19?'second':'minute',open:open!,high:high!,low:low!,close:close!,volume:volume!,amount:amount!,amplitude:amplitude??null,change_percent:changePercent??null,change:change??null,turnover_rate:turnover??null,bar_end:new Date(end).toISOString(),is_final:securityTradingDay(raw.slice(0,10))===null||unknownPostClose?null:end<=fetched,fetched_at:fetchedAt,source};
  const old=map.get(bar.timestamp);if(old){duplicates++;if(JSON.stringify(old)!==JSON.stringify(bar))fail('CONFLICTING_BARS','同一供应商响应中同一时间出现冲突K线，不混合取值');}else map.set(bar.timestamp,bar);
 }
 if(rejected)warnings.push(`INVALID_ROWS_REJECTED:${rejected}`);if(duplicates)warnings.push(`IDENTICAL_DUPLICATES_REMOVED:${duplicates}`);
 if(d.klines.length>=10000)warnings.push('UPSTREAM_ROW_LIMIT_REACHED');
 return {name:d.name,bars:[...map.values()].sort((a,b)=>a.timestamp-b.timestamp),warnings,rejected};
}
function blocks(q:Query,end:string){
 if(q.period==='1m')return [{start:q.start_date,end}];
 const result:{start:string;end:string}[]=[];for(let d=q.start_date;d<=end;){
  const quarter=Math.floor((Number(d.slice(5,7))-1)/3)*3;
  const start=q.period==='1d'?`${d.slice(0,4)}-${String(quarter+1).padStart(2,'0')}-01`:shiftDate(d,-((new Date(d+'T12:00:00Z').getUTCDay()+6)%7));
  const stop=q.period==='1d'?shiftDate(new Date(Date.UTC(Number(start.slice(0,4)),quarter+3,1)).toISOString().slice(0,10),-1):shiftDate(start,6);
  const intersectStart=start<q.start_date?q.start_date:start,intersectEnd=stop>end?end:stop;
  if(dates(intersectStart,intersectEnd).some(day=>securityTradingDay(day)!==false))result.push({start,end:stop});d=shiftDate(stop,1);
 }return result;
}
export function acceptSecurityReplacement(previous:any,next:any){
 if(previous.symbol!==next.symbol||previous.period!==next.period||previous.adjust!==next.adjust||previous.adjustment_epoch!==next.adjustment_epoch||previous.source!==next.source)return false;
 const incoming=new Map(next.bars.map((b:SecurityBar)=>[b.timestamp,b]));
 return previous.bars.every((b:SecurityBar)=>{const n=incoming.get(b.timestamp) as SecurityBar|undefined;return !!n&&(b.is_final!==true||n.is_final===true)});
}
function requestUrl(q:Query,start:string,end:string){return endpoint+'?'+new URLSearchParams({secid:(q.symbol.startsWith('sh')?'1.':'0.')+q.symbol.slice(2),klt:String(periods[q.period]),fqt:String(adjusts[q.adjust]),beg:start.replaceAll('-',''),end:end.replaceAll('-',''),lmt:'10000',fields1:'f1,f2,f3,f4,f5,f6',fields2:'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61'})}
async function getBlock(q:Query,b:{start:string;end:string},now:number){
 const today=chinaDate(now),end=b.end>today?today:b.end,epoch=q.adjust==='none'?'unadjusted':today;
 const url=requestUrl(q,b.start,end),key=['security-history-v1',source,q.symbol,q.period,q.adjust,epoch,b.start,b.end].join(':');
 const ttl=b.end>=today?(q.period==='1d'?60000:15000):q.adjust==='none'?6*3600000:3600000;
 return loadQuote(key,async()=>{
  const response=await fetchJson(url,{attempts:2,timeoutMs:6500,headers:{'User-Agent':'Mozilla/5.0',Referer:'https://quote.eastmoney.com/'}});
  const fetchedAt=new Date(Date.now()).toISOString();if(q.adjust!=='none'&&chinaDate(Date.parse(fetchedAt))!==epoch)fail('ADJUSTMENT_EPOCH_CHANGED','跨越读取日，无法核实同一复权基准，请重新请求',true);let parsed:ReturnType<typeof parseSecurityKlines>;
  try{parsed=parseSecurityKlines(response.data,q,fetchedAt)}catch(error){throw new DataError({...dataIssue(error),source_url:url,...(q.include_raw?{raw_response:response.data}:{})})}
  const bars=parsed.bars.filter(p=>p.datetime.slice(0,10)>=b.start&&p.datetime.slice(0,10)<=end);
  if(!bars.length){const observed=parsed.bars.length?`；供应商实际返回${parsed.bars[0].datetime}至${parsed.bars.at(-1)!.datetime}`:'';throw new DataError({code:parsed.bars.length?'HISTORY_RANGE_UNAVAILABLE':'EMPTY_HISTORY',message:'请求范围内没有有效历史记录'+observed,retryable:false,source,source_url:url,...(q.include_raw?{raw_response:response.data}:{})});}
  // Positive count is an internal cache-validity carrier, never returned as a security price.
  return {value:bars.length,market_date:bars.at(-1)!.datetime.slice(0,10),as_of:null,symbol:q.symbol,period:q.period,adjust:q.adjust,adjustment_epoch:epoch,source,source_url:url,name:parsed.name,bars,warnings:parsed.warnings,rejected:parsed.rejected,fetched_at:fetchedAt,raw:response.data,observed_start:parsed.bars[0]?.datetime,observed_end:parsed.bars.at(-1)?.datetime};
 },{refresh:q.refresh,ttlMs:ttl,acceptReplacement:acceptSecurityReplacement});
}
export function securityCoverage(q:Query,bars:SecurityBar[],now:number){
 const end=q.end_date>chinaDate(now)?chinaDate(now):q.end_date,keys=new Set(bars.map(b=>b.datetime.slice(0,q.period==='1d'?10:16))),missing:{date:string;missing_count:number;reason:string}[]=[];let expected=0,calendarVerified=true;
 for(const d of dates(q.start_date,end)){
  const trading=securityTradingDay(d);if(trading===null){calendarVerified=false;continue;}if(!trading)continue;
  const labels=q.period==='1d'?[d]:minuteEnds(periods[q.period]).filter(m=>barEnd(d,m)<=now).map(m=>`${d} ${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`);
  // Daily bar is only expected once the session has started, and may still be forming.
  if(q.period==='1d'&&barEnd(d,570)>now)continue;expected+=labels.length;
  const count=labels.filter(k=>!keys.has(k)).length;if(count)missing.push({date:d,missing_count:count,reason:'unknown: suspension, no trade, listing boundary, retention or missing upstream data not independently verified'});
 }
 return {calendar_verified:calendarVerified,range_complete:calendarVerified?missing.length===0&&q.end_date<=chinaDate(now):null,expected_count:calendarVerified?expected:null,missing_count:calendarVerified?missing.reduce((n,x)=>n+x.missing_count,0):null,missing_sessions:missing,non_trading_dates:dates(q.start_date,end).filter(d=>securityTradingDay(d)===false),suspension_verified:false,emergency_closures_verified:false};
}
async function fingerprint(q:Query,bars:SecurityBar[]){const values=[q.symbol,q.period,q.adjust,q.start_date,q.end_date,bars.map(({fetched_at,...bar})=>bar)];const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(values)));return [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('')}
function cursorDecode(s:string){try{const p=JSON.parse(atob(s.replaceAll('-','+').replaceAll('_','/')));if(p.v!==1||!Number.isInteger(p.offset)||p.offset<1||typeof p.fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(p.fingerprint))invalid('cursor无效');return p;}catch{invalid('cursor无效')}}
export async function getSecurityHistory(input:SecurityHistoryRequest|unknown):Promise<SecurityHistoryResult>{
 const q=validateSecurityHistory(input),cursor=q.cursor?cursorDecode(q.cursor):null,now=Date.now(),today=chinaDate(now),end=q.end_date>today?today:q.end_date;
 const base:SecurityHistoryResult={schema_version:'1.5',symbol:q.symbol,security_name:null,period:q.period,adjust:q.adjust,requested_start_date:q.start_date,requested_end_date:q.end_date,actual_start_date:null,actual_end_date:null,history_count:0,history_available:false,source,source_timezone:'Asia/Shanghai',market_timezone:'Asia/Shanghai',timestamp_timezone:'UTC',report_timezone:'Asia/Shanghai',fetched_at:null,retrieved_at:new Date(now).toISOString(),quality:'unavailable',degraded:false,cache_hit:false,history_refresh_status:'not_attempted',history_refresh_error:null,history_error:null,bars:[],warnings:[],units:securityHistoryInfo.units,timestamp_unit:'unix_seconds',timestamp_semantics:q.period==='1d'?'session_date_at_local_midnight_not_trade_time':'provider_bar_end_label',finality_basis:'scheduled_session_end_and_original_fetched_at_not_exchange_confirmation',source_transition:null,adjustment_basis:q.adjust==='none'?{kind:'unadjusted'}:{kind:'provider_fqt',fqt:adjusts[q.adjust],retrieval_epoch:today,factor_version:null,verified_factor_version:false},pagination:{limit:q.limit,has_more:false,next_cursor:null,total_count:0},source_requests:[]};
 if(q.period==='1m'&&q.adjust!=='none')return {...base,quality:'unsupported',history_error:{code:'UNVERIFIED_ADJUSTMENT',message:'1分钟复权口径未可靠核实，不将接受fqt参数等同于正确复权',retryable:false,source},warnings:['1分钟只开放none，不降级或忽略adjust。']};
 if(end<q.start_date)return {...base,quality:'unsupported',history_error:{code:'FUTURE_RANGE',message:'请求范围完全位于未来',retryable:false,source}};
 const work=blocks(q,end),loaded:any[]=[],errors:DataIssue[]=[],requests:any[]=[];
 for(let i=0;i<work.length;i+=3)await Promise.all(work.slice(i,i+3).map(async block=>{
  try{const h=await getBlock(q,block,now);loaded.push(h);requests.push({start_date:block.start,end_date:block.end,source_url:h.source_url,delivery:h.delivery,degraded:h.degraded,cache_backend:h.cache_backend,cache_warning:h.cache_warning,fetched_at:h.fetched_at,retrieved_at:h.retrieved_at,refresh_status:h.degraded?'failed':h.delivery==='upstream'?'succeeded':'not_attempted',refresh_error:h.upstream_error??null,observed_start:h.observed_start,observed_end:h.observed_end});}
  catch(e){const issue={...dataIssue(e),source,source_url:dataIssue(e).source_url??requestUrl(q,block.start,block.end)};errors.push(issue);requests.push({start_date:block.start,end_date:block.end,refresh_status:'failed',refresh_error:issue});}
 }));
 const warnings=loaded.flatMap(h=>h.warnings??[]),names=new Set(loaded.map(h=>h.name));if(names.size>1){warnings.push('SECURITY_NAME_CHANGED_WITHIN_RESPONSE');}
 const map=new Map<number,SecurityBar>();for(const h of loaded)for(const b of h.bars as SecurityBar[])if(b.datetime.slice(0,10)>=q.start_date&&b.datetime.slice(0,10)<=end){const prior=map.get(b.timestamp);if(prior&&JSON.stringify(prior)!==JSON.stringify(b))return {...base,history_error:{code:'CONFLICTING_BARS',message:'分段存在冲突，不拼接',retryable:false,source},source_requests:requests};map.set(b.timestamp,b);}
 const all=[...map.values()].sort((a,b)=>a.timestamp-b.timestamp),coverage=securityCoverage(q,all,now),degraded=loaded.some(h=>h.degraded),refreshErrors=[...errors,...loaded.filter(h=>h.degraded).map(h=>h.upstream_error).filter(Boolean)];
 const refreshError=refreshErrors.length?{code:'HISTORY_REFRESH_INCOMPLETE',message:'部分或全部历史段刷新失败，详见causes及source_requests',retryable:refreshErrors.some(e=>e.retryable),source,causes:refreshErrors}:null;
 if(!coverage.calendar_verified)warnings.push('CALENDAR_UNVERIFIED: outside verified 2026 scheduled calendar');
 if(coverage.missing_count)warnings.push('EXPECTED_BARS_MISSING: reason not independently verified');if(q.end_date>today)warnings.push('FUTURE_END_DATE_CLAMPED');
 if(q.period==='1m')warnings.push('ONE_MINUTE_RETENTION_LIMIT: provider may ignore historical beg/end; records strictly filtered');
 const stale=all.some(b=>b.is_final===false&&Date.parse(b.bar_end)<now&&Date.parse(b.fetched_at)<Date.parse(b.bar_end)||q.period==='1d'&&b.is_final===null&&securityTradingDay(b.datetime.slice(0,10))===true&&now>barEnd(b.datetime.slice(0,10),930)&&Date.parse(b.fetched_at)<barEnd(b.datetime.slice(0,10),930));
 const forming=all.some(b=>b.is_final===false),unknownFinal=all.some(b=>b.is_final===null);if(forming)warnings.push('CONTAINS_UNFINISHED_BARS');if(unknownFinal)warnings.push('BAR_FINALITY_UNVERIFIED');
 const fetched=loaded.map(h=>h.fetched_at).sort(),data={...base,security_name:loaded[0]?.name??null,fetched_at:fetched[0]??null,fetched_at_semantics:'oldest successful fetch among returned segments; each bar/segment retains its own fetched_at',latest_fetched_at:fetched.at(-1)??null,retrieved_at:new Date(Date.now()).toISOString(),degraded,cache_hit:loaded.length>0&&loaded.every(h=>h.delivery!=='upstream'),history_refresh_status:refreshError?'failed':loaded.some(h=>h.delivery==='upstream')?'succeeded':'not_attempted',history_refresh_error:refreshError,history_error:refreshError,source_requests:requests.sort((a,b)=>a.start_date.localeCompare(b.start_date)),coverage,warnings:[...new Set(warnings)],contains_forming:forming,stale};
 if(!all.length)return {...data,quality:errors.some(e=>e.code==='HISTORY_RANGE_UNAVAILABLE')?'unsupported':'unavailable',history_error:refreshError??{code:work.length?'EMPTY_HISTORY':'NO_TRADING_SESSIONS',message:work.length?'请求范围没有有效记录；不推测停牌、上市边界或供应商保留范围':'请求范围没有已排定交易时段，未请求上游',retryable:false,source}};
 const digest=await fingerprint(q,all);if(cursor&&cursor.fingerprint!==digest)return {...data,quality:'unavailable',history_error:{code:'CURSOR_EXPIRED',message:'数据已刷新或查询口径改变，请从第一页重新读取',retryable:true,source}};
 const offset=cursor?.offset??0;if(offset>=all.length)invalid('cursor位置超出数据范围');const page=all.slice(offset,offset+q.limit),hasMore=offset+page.length<all.length;
 const next=hasMore?btoa(JSON.stringify({v:1,offset:offset+page.length,fingerprint:digest})).replaceAll('+','-').replaceAll('/','_').replaceAll('=',''):null;
 const quality:Quality=stale?'stale':errors.length||coverage.range_complete!==true||loaded.some(h=>h.rejected>0)||forming||unknownFinal?'partial':'available';
 return {...data,quality,history_count:page.length,history_available:page.length>0,bars:page,actual_start_date:page[0].datetime.slice(0,10),actual_end_date:page.at(-1)!.datetime.slice(0,10),available_start_date:all[0].datetime.slice(0,10),available_end_date:all.at(-1)!.datetime.slice(0,10),actual_start_datetime:page[0].datetime,actual_end_datetime:page.at(-1)!.datetime,pagination:{limit:q.limit,offset,has_more:hasMore,next_cursor:next,total_count:all.length,snapshot_id:digest},...(q.include_raw?{raw_responses:loaded.map(h=>({source_url:h.source_url,fetched_at:h.fetched_at,response:h.raw}))}:{})};
}
