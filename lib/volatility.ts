import {fetchJson,fetchText,DataError,dataIssue} from './upstream';
import {parseCboeHistory} from './backup-sources';
import {parseFredHistory} from './index-sources';
import {historySession,historyTradingDay} from './freshness';

type Id='vix'|'vxn';
type Point={date:string;value:number};
type Candidate={provider:string;channel:string;source_url:string;points:Point[];official:boolean;fetched_at:string;raw:unknown;[key:string]:unknown};
const NY='America/New_York';
export const volatilityContract={
 sources:['Yahoo completed daily bars','Cboe daily CSV','Investing.com non-CFD CBOE VIX daily (1096487)','FRED VXNCLS (VXN only; subject to publication lag)'],
 investing_vix:{url:'https://www.investing.com/indices/volatility-s-p-500-historical-data?cid=1096487',instrument_id:'1096487',symbol:'VIX',type:'index',is_cfd:false,exchange:'CBOE',rejected_default_cfd_id:'44336'},
 selection:'Newest completed session first, official daily CSV preferred on equal dates. Return one complete provider series; never stitch current observations into history.',
 validation:'Compare overlapping dated daily closes and the exact prior session; Cboe close-window observation is corroboration only, never a historical row.',
 finality:'Regular VIX dissemination ends 16:15 America/New_York. Non-official daily rows accepted after a conservative 16:30 confirmation buffer. Special early-close precision is not invented.',
 official_methodology:'https://cdn.cboe.com/api/global/us_indices/governance/VIX_Methodology.pdf',
 availability:'09:00 Asia/Shanghai is the verification target, not an upstream publication guarantee. Missing latest completed session remains stale.',
};
function invalid(message:string):never{throw new DataError({code:'INVALID_RESPONSE',message,retryable:false})}
function num(v:unknown){if(typeof v==='number')return Number.isFinite(v)?v:null;if(typeof v!=='string'||!/^\d+(?:\.\d+)?$/.test(v))return null;return Number(v)}
function local(now:number){const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:NY,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(now)).map(p=>[p.type,p.value]));return {date:`${p.year}-${p.month}-${p.day}`,minute:Number(p.hour)*60+Number(p.minute)}}
/** Date calendar is shared; the volatility closing boundary is separate from stock 16:00. */
export function volatilitySession(now=Date.now()){
 const here=local(now),s=historySession({market_timezone:NY},'equity',now),open=historyTradingDay(here.date,NY,'equity');
 if(!s.calendar_verified||open===null)return {...s,expected_last_completed_date:null,calendar_verified:false};
 const prior=historySession({market_timezone:NY},'equity',now-(here.minute-540)*60000).expected_last_completed_date;
 const special=open&&s.close_minute!==960;
 const uncertainSpecial=special&&here.minute>=s.close_minute!&&here.minute<975;
 return {...s,expected_last_completed_date:uncertainSpecial?null:open&&here.minute>=975?here.date:open?prior:s.expected_last_completed_date,calendar_verified:!uncertainSpecial,close_minute:special?null:975,close_note:special?'特别收盘的精确时刻未核实；过常规收盘上界后确认交易日期':'Cboe常规指数收盘16:15 ET；非官方日线额外等待15分钟确认',session_status:uncertainSpecial?'unknown_special_close':s.session_status};
}
function clean(points:Point[],now:number,official=false){
 const s=volatilitySession(now),here=local(now),map=new Map<string,number>();
 for(const p of points){
  const ms=Date.parse(p.date+'T00:00:00Z');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(p.date)||!Number.isFinite(ms)||new Date(ms).toISOString().slice(0,10)!==p.date||!Number.isFinite(p.value)||p.value<=0)continue;
  if(p.date>here.date||historyTradingDay(p.date,NY,'equity')===false)continue;
  if(s.expected_last_completed_date&&p.date>s.expected_last_completed_date)continue;
  // A dated row on a chart is not final merely because it exists intraday.
  if(p.date===here.date&&(!s.expected_last_completed_date||!official&&here.minute<990))continue;
  const old=map.get(p.date);if(old!==undefined&&Math.abs(old-p.value)>.005)invalid('同一来源同一交易日存在冲突收盘值');map.set(p.date,p.value);
 }
 const result=[...map].sort(([a],[b])=>a.localeCompare(b)).slice(-22).map(([date,value])=>({date,value}));
 if(!result.length)throw new DataError({code:'NO_COMPLETED_DAILY_CLOSE',message:'来源未提供已完成交易日的有效日线，不以盘中价替代',retryable:true});return result;
}
export function parseInvestingVix(html:string,now=Date.now()){
 const match=html.match(/<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);if(!match)invalid('独立日线源缺少结构化历史数据');
 let state:any;try{state=JSON.parse(match[1]).props.pageProps.state}catch{invalid('独立日线源JSON结构无效')}
 const d=state.indexStore?.instrument,b=d?.base,name=d?.name,exchange=d?.exchange,history=state.historicalDataStore;
 if(String(b?.id)!=='1096487'||b.type!=='index'||b.isCfd!==false||name?.symbol!=='VIX'||exchange?.exchange!=='CBOE'||history?.timeFrame!=='Daily'||!Array.isArray(history?.historicalData?.data))throw new DataError({code:'INSTRUMENT_MISMATCH',message:'拒绝CFD、错误指数或非日线数据；仅允许已核实1096487非CFD CBOE VIX',retryable:false});
 const rows=history.historicalData.data;
 const points=rows.map((r:any)=>{
  if(typeof r.rowDateTimestamp!=='string'||!/^\d{4}-\d{2}-\d{2}T00:00:00(?:\.000)?Z$/.test(r.rowDateTimestamp))invalid('独立日线日期格式不明确');
  const close=num(r.last_close),open=num(r.last_open),high=num(r.last_max),low=num(r.last_min);
  if(close===null||open===null||high===null||low===null||low<=0||high<Math.max(open,close,low)||low>Math.min(open,close,high))invalid('独立日线OHLC校验失败');
  return {date:r.rowDateTimestamp.slice(0,10),value:close};
 });
 // Preserve only original market-data fields, never page session/access tokens or unrelated content.
 return {points:clean(points,now),raw:{identity:{base:b,name,exchange},timeFrame:'Daily',rows:rows.slice(0,24)}};
}
export function parseYahooDaily(data:any,id:Id,now=Date.now()){
 const r=data?.chart?.result?.[0];if(r?.meta?.symbol!=='^'+id.toUpperCase()||!Array.isArray(r.timestamp)||!Array.isArray(r.indicators?.quote?.[0]?.close))invalid('Yahoo日线证券标识或字段不符');
 const points=r.timestamp.map((t:number,i:number)=>({date:Number.isFinite(t)?local(t*1000).date:'',value:r.indicators.quote[0].close[i]}));
 return clean(points,now); // Deliberately never use meta.regularMarketPrice.
}
export function validateCloseObservation(raw:any,id:Id,date:string,value:number,previous:Point|null,now=Date.now()){
 const d=raw?.data,stamp=d?.last_trade_time,session=volatilitySession(now);
 const hasOffset=typeof stamp==='string'&&/T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(stamp);
 const parsed=hasOffset?Date.parse(stamp):NaN;
 const here=Number.isFinite(parsed)?local(parsed):null;
 const checks={
  identity:raw?.symbol==='_'+id.toUpperCase()&&d?.symbol==='^'+id.toUpperCase()&&d.security_type==='index',
  close_window:session.close_minute===975&&(here?here.minute>=975&&here.minute<=976:typeof stamp==='string'&&new RegExp('^'+date+'T16:(?:15|16):[0-5][0-9]$').test(stamp)),
  date:(here?.date??(typeof stamp==='string'?stamp.slice(0,10):null))===date&&date===session.expected_last_completed_date,
  close:Math.abs((num(d?.close)??NaN)-value)<=.005&&Math.abs((num(d?.current_price)??NaN)-value)<=.005,
  previous_close:!previous||Math.abs((num(d?.prev_day_close)??NaN)-previous.value)<=.005,
 };
 const valid=Object.values(checks).every(Boolean);
 return {status:valid?'matched_official_close_window':'not_confirmed',checks,eligible_as_history:false,source:'Cboe',source_url:`https://cdn.cboe.com/api/global/delayed_quotes/quotes/_${id.toUpperCase()}.json`,market_date:here?.date??(typeof stamp==='string'?stamp.slice(0,10):null),provider_time:stamp??null,observation_as_of:here?new Date(parsed).toISOString():null,time_basis:hasOffset?'Publisher offset retained and normalized to America/New_York for close-window comparison':'Offsetless publisher last_trade_time compared with documented ET regular close; no fabricated ISO timestamp',close:num(d?.close),previous_close:num(d?.prev_day_close),raw:valid?{symbol:raw.symbol,security_type:d.security_type,close:d.close,prev_day_close:d.prev_day_close,last_trade_time:stamp}:null};
}
export function selectVolatility(candidates:Candidate[],id:Id,now=Date.now()){
 if(!candidates.length)throw new DataError({code:'ALL_DAILY_CLOSE_SOURCES_FAILED',message:'未取得可验证的指数日线',retryable:true});
 const ranked=[...candidates].sort((a,b)=>b.points.at(-1)!.date.localeCompare(a.points.at(-1)!.date)||Number(b.official)-Number(a.official)||Number(a.provider==='FRED')-Number(b.provider==='FRED'));
 const chosen=ranked[0],last=chosen.points.at(-1)!,priorDate=historySession({market_timezone:NY},'equity',Date.parse(last.date+'T12:00:00Z')).expected_last_completed_date,previous=chosen.points.find(p=>p.date===priorDate)??null;
 const comparisons:any[]=[];
 for(const other of ranked.slice(1))for(const date of [last.date,previous?.date].filter(Boolean) as string[]){const a=chosen.points.find(p=>p.date===date),b=other.points.find(p=>p.date===date);if(a&&b)comparisons.push({date,role:date===last.date?'latest_close':'previous_close',source:other.provider,source_url:other.source_url,value:b.value,selected_value:a.value,match:Math.abs(a.value-b.value)<=.005,independent_provider:other.provider!==chosen.provider});}
 const conflict=comparisons.some(c=>!c.match);
 return {chosen,last,previous,comparisons,conflict};
}
export async function volatilityDaily(id:Id,skipYahoo=false){
 const upper=id.toUpperCase(),now=Date.now(),attempts:any[]=[],candidates:Candidate[]=[];
 const run=async(provider:string,channel:string,url:string,loader:()=>Promise<{points:Point[];raw:unknown}>,official=false)=>{
  const attempted_at=new Date(Date.now()).toISOString();try{const p=await loader(),fetched_at=new Date(Date.now()).toISOString();candidates.push({provider,channel,source_url:url,official,fetched_at,...p});attempts.push({source:provider,channel,source_url:url,status:'succeeded',market_date:p.points.at(-1)?.date,value:p.points.at(-1)?.value,fetched_at,attempted_at});}catch(e){attempts.push({source:provider,channel,source_url:url,status:'failed',error:{...dataIssue(e),source:provider,source_url:url},attempted_at})}
 };
 const yahoo=`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent('^'+upper)}?interval=1d&range=1mo`,cboe=`https://cdn.cboe.com/api/global/us_indices/daily_prices/${upper}_History.csv`;
 const independent=id==='vix'?volatilityContract.investing_vix.url:`https://fred.stlouisfed.org/graph/fredgraph.csv?id=VXNCLS&cosd=${new Date(now-65*86400000).toISOString().slice(0,10)}`;
 await Promise.all([
  ...(!skipYahoo?[run('Yahoo Finance','daily_chart',yahoo,async()=>{const d=(await fetchJson(yahoo,{attempts:1,timeoutMs:6500})).data;return {points:parseYahooDaily(d,id,now),raw:{symbol:upper,rows:d.chart.result[0].timestamp.map((t:number,i:number)=>({timestamp:t,close:d.chart.result[0].indicators.quote[0].close[i]})).slice(-24)}}})]:[]),
  run('Cboe','daily_csv',cboe,async()=>{const d=parseCboeHistory((await fetchText(cboe,{attempts:1,timeoutMs:12000})).text,id);return {points:clean(d.history,now,true),raw:d.history}},true),
  run(id==='vix'?'Investing.com':'FRED',id==='vix'?'non_cfd_index_daily':'VXNCLS',independent,async()=>{const d=await fetchText(independent,{attempts:1,timeoutMs:12000,headers:{'User-Agent':'Mozilla/5.0'}});return id==='vix'?parseInvestingVix(d.text,now):{points:clean(parseFredHistory(d.text,'VXNCLS'),now),raw:d.text}}),
 ]);
 if(!candidates.length)throw new DataError({code:'ALL_DAILY_CLOSE_SOURCES_FAILED',message:'全部日终来源失败；不以盘中报价、CFD或期货代替',retryable:attempts.some(a=>a.error?.retryable),causes:attempts.map(a=>a.error).filter(Boolean)});
 const selected=selectVolatility(candidates,id,now),{chosen,last,previous,comparisons,conflict}=selected;
 let observation:any=null;
 if(!chosen.official&&(!comparisons.some(c=>c.role==='latest_close'&&c.source==='Cboe'&&c.match)||conflict)){
  const url=`https://cdn.cboe.com/api/global/delayed_quotes/quotes/_${upper}.json`;
  try{const raw=(await fetchJson(url,{attempts:1,timeoutMs:8000})).data;observation=validateCloseObservation(raw,id,last.date,last.value,previous,now);attempts.push({source:'Cboe',channel:'close_window_validation_only',source_url:url,status:'succeeded',validation:observation.status})}catch(e){observation={status:'unavailable',error:{...dataIssue(e),source:'Cboe',source_url:url}};attempts.push({source:'Cboe',channel:'close_window_validation_only',source_url:url,status:'failed',error:observation.error})}
 }
 const expected=volatilitySession(now),officialDaily=candidates.some(c=>c.official&&c.points.some(p=>p.date===last.date&&Math.abs(p.value-last.value)<=.005));
 const confirmed=officialDaily||observation?.status==='matched_official_close_window';
 const independentLatest=comparisons.some(c=>c.role==='latest_close'&&c.independent_provider&&c.match);
 return {value:last.value,market_date:last.date,as_of:null,source_timezone:NY,market_timezone:NY,previous_close:previous?.value??null,previous_date:previous?.date??null,change:previous?last.value-previous.value:null,change_percent:previous?(last.value/previous.value-1)*100:null,change_unit:'absolute_and_percent',change_basis:'same_provider_previous_daily_close',change_reference:{kind:'previous_daily_close',value:previous?.value??null,date:previous?.date??null},history:chosen.points,history_supported:true,quote_source_history_supported:true,source:chosen.provider,source_url:chosen.source_url,data_type:chosen.official?'official_daily_index_close':'provider_daily_index_close',quote_kind:'daily_index_close',instrument_id:id,instrument_changed:false,fallback_used:chosen.provider!=='Yahoo Finance',primary_error:attempts.find(a=>a.source==='Yahoo Finance'&&a.error)?.error??null,source_transition:{from:'Yahoo Finance',to:chosen.provider,same_instrument:true,same_change_basis:true,frequency_changed:false,reason:'newest_completed_daily_series'},daily_close_contract_version:1,daily_close_expected_date:expected.expected_last_completed_date,daily_close_calendar_verified:expected.calendar_verified,daily_close_validation:{status:conflict?'conflict':confirmed?'official_publisher_confirmed':'provider_daily_only',official_daily_file_confirmed:officialDaily,official_close_window_confirmed:observation?.status==='matched_official_close_window',independent_latest_daily_confirmed:independentLatest,latest_daily_provider_count:new Set(candidates.filter(c=>c.points.at(-1)?.date===last.date).map(c=>c.provider)).size,comparisons,observation,official_file_pending:!officialDaily},source_attempts:attempts,quality:conflict||!confirmed||!previous||!expected.calendar_verified?'partial':undefined,warnings:[...(conflict?['DAILY_CLOSE_CONFLICT']:[]),...(!officialDaily?['OFFICIAL_DAILY_FILE_NOT_YET_CONFIRMED: source is explicitly identified redistribution; close-window observation is validation only']:[]),...(!previous?['PREVIOUS_SESSION_MISSING: no daily change inferred from another source']:[])],fetched_at:chosen.fetched_at,delay:'已完成交易日的指数日线；不是盘中报价或VIX期货/结算值',raw_history_fields:{source:chosen.provider,channel:chosen.channel,raw:chosen.raw}};
}
export function qualifyVolatility(q:any){
 const session=volatilitySession(),date=q.market_date,expected=session.expected_last_completed_date,stale=!!expected&&typeof date==='string'&&date<expected,unverified=q.daily_close_validation?.status==='conflict'||q.quality==='partial';
 return {...q,daily_close_expected_date:expected,daily_close_calendar_verified:session.calendar_verified,stale,quality:stale?'stale':q.degraded?'degraded':unverified||!session.calendar_verified?'partial':'available',freshness:{...q.freshness,market_timezone:NY,expected_date:expected,expected_last_completed_date:expected,stale,status:stale?'stale':session.calendar_verified?'latest_completed_session':'unknown',reason:stale?'缺少上一已完成美股交易日的VIX/VXN日线':session.close_note??session.reason},...(stale?{stale_note:'最新完整交易日缺失，返回旧日线并明确标stale'}:{})};
}
export function volatilityDateConsistency(metrics:any[]){const v=metrics.find(m=>m.id==='vix'),n=metrics.find(m=>m.id==='vxn'),expected=volatilitySession().expected_last_completed_date;const available=!!v?.value&&!!n?.value,aligned=available&&v.market_date===n.market_date;return {status:!available?'unavailable':!aligned?'date_mismatch':!expected?'unknown':v.market_date===expected?'aligned_latest_completed':'aligned_stale',consistent:available?aligned:null,vix_date:v?.market_date??null,vxn_date:n?.market_date??null,expected_last_completed_date:expected,note:'只比较两个独立指标的交易日期，不改写其数值、来源、历史或质量。'};}
