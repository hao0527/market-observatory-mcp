import {backupQuote,fetchSinaBatch} from './backup-sources';
import {goldQuote} from './gold';
import {fetchText,fetchJson,dataIssue,DataError} from './upstream';
import {loadQuote} from './quote-cache';
import {qualifyQuote} from './freshness';
export const catalog=[
 {id:'vix',name:'VIX',group:'波动率',symbol:'^VIX',unit:'点',kind:'equity'},
 {id:'vxn',name:'VXN',group:'波动率',symbol:'^VXN',unit:'点',kind:'equity'},
 {id:'us2y',name:'美债 2 年期',group:'美债收益率',symbol:'2 Yr',unit:'%',kind:'treasury'},
 {id:'us10y',name:'美债 10 年期',group:'美债收益率',symbol:'10 Yr',unit:'%',kind:'treasury'},
 {id:'us30y',name:'美债 30 年期',group:'美债收益率',symbol:'30 Yr',unit:'%',kind:'treasury'},
 {id:'gold',name:'黄金参考报价',group:'商品',symbol:'hf_XAU',unit:'美元/盎司',kind:'commodity',primary_instrument:'gold_london_cfd',fallback_instrument:'gold_spot_indicative'},
 {id:'brent',name:'布伦特原油期货',group:'商品',symbol:'BZ=F',unit:'美元/桶',kind:'commodity',fallback_instrument:'brent_sina_cfd'},
 {id:'sp500',name:'标普 500',group:'美股指数',symbol:'^GSPC',unit:'点',kind:'equity'},
 {id:'nasdaq',name:'纳斯达克综合',group:'美股指数',symbol:'^IXIC',unit:'点',kind:'equity'},
 {id:'dow',name:'道琼斯',group:'美股指数',symbol:'^DJI',unit:'点',kind:'equity'},
 {id:'sox',name:'费城半导体',group:'美股指数',symbol:'^SOX',unit:'点',kind:'equity'},
] as const;
type Metric=typeof catalog[number];
export type SnapshotOptions={refresh?:boolean;include_history?:boolean;include_raw?:boolean};
function dateIn(seconds:number,tz:string){return new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(seconds*1000))}
export function csvRows(text:string){return text.replace(/^\uFEFF/,'').trim().split(/\r?\n/).filter(Boolean).map(line=>[...line.matchAll(/(?:^|,)("(?:[^"]|"")*"|[^,]*)/g)].map(m=>m[1].replace(/^"|"$/g,'').replaceAll('""','"')))}
export function treasuryHistory(text:string,symbol:string){
 const rows=csvRows(text);const col=rows[0]?.indexOf(symbol)??-1;if(col<0)throw new DataError({code:'INVALID_RESPONSE',message:'收益率列缺失',retryable:false});
 const dates=new Map<string,number>();
 for(const row of rows.slice(1)){
  const match=row[0]?.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);if(!match||!row[col]?.trim()||row[col]==='N/A')continue;
  const date=`${match[3]}-${match[1].padStart(2,'0')}-${match[2].padStart(2,'0')}`;const stamp=Date.parse(date+'T00:00:00Z');
  const value=Number(row[col]);if(Number.isFinite(stamp)&&new Date(stamp).toISOString().slice(0,10)===date&&Number.isFinite(value)&&value>0)dates.set(date,value);
 }
 return [...dates].sort(([a],[b])=>a.localeCompare(b)).map(([date,value])=>({date,value}));
}
export function yahooQuote(data:any,expectedSymbol?:string){
 const r=data.chart?.result?.[0];if(!r)throw new DataError({code:'INVALID_RESPONSE',message:data.chart?.error?.description||'行情为空',retryable:false});
 const m=r.meta;if(expectedSymbol&&m?.symbol!==expectedSymbol)throw new DataError({code:'INVALID_RESPONSE',message:'上游证券代码不匹配',retryable:false});
 const time=m.regularMarketTime,value=m.regularMarketPrice;
 if(!Number.isFinite(value)||value<=0||!Number.isFinite(time)||time*1000>Date.now()+120000)throw new DataError({code:'INVALID_RESPONSE',message:'缺少有效报价或时间戳',retryable:false});
 const tz=m.exchangeTimezoneName||'America/New_York',day=dateIn(time,tz);
 const points=new Map<string,number>();
 (r.timestamp||[]).forEach((t:number,i:number)=>{const close=r.indicators?.quote?.[0]?.close?.[i];if(Number.isFinite(t)&&Number.isFinite(close)&&close>0&&t<=time)points.set(dateIn(t,tz),close)});
 const history=[...points].sort(([a],[b])=>a.localeCompare(b)).map(([date,value])=>({date,value}));
 const prior=history.filter(p=>p.date<day).at(-1),previous=prior?.value??null;
 return {value,as_of:new Date(time*1000).toISOString(),market_date:day,source_timezone:tz,previous_close:previous,previous_date:prior?.date??null,change:previous===null?null:value-previous,change_percent:previous?((value/previous)-1)*100:null,change_unit:'absolute_and_percent',change_basis:'same_provider_previous_close',change_reference:{kind:'previous_close',value:previous,date:prior?.date??null},history,exchange:m.fullExchangeName??null};
}
function treasuryUrl(year:number){return `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${year}/all?type=daily_treasury_yield_curve&page&_format=csv`}
async function treasuryText(){
 const year=new Date().getUTCFullYear(),url=treasuryUrl(year);const r=await fetchText(url,{timeoutMs:10000});let text=r.text;
 if(treasuryHistory(text,'2 Yr').length<2){const previous=await fetchText(treasuryUrl(year-1),{timeoutMs:10000});text+='\n'+previous.text.split(/\r?\n/).slice(1).join('\n')}
 return {text,url,attempts:r.attempts};
}
function metricLoader(item:Metric,sharedTreasury:()=>Promise<Awaited<ReturnType<typeof treasuryText>>>,sinaShared?:()=>Promise<string>) {
 return async()=>{
  let result:any;
  if(item.kind==='treasury'){
   const t=await sharedTreasury(),history=treasuryHistory(t.text,item.symbol),last=history.at(-1),previous=history.at(-2);if(!last)throw new DataError({code:'INVALID_RESPONSE',message:'无有效收益率',retryable:false,source_url:t.url});
   result={value:last.value,as_of:null,market_date:last.date,source_timezone:'America/New_York',previous_close:previous?.value??null,previous_date:previous?.date??null,change:previous?(last.value-previous.value)*100:null,change_percent:null,change_unit:'bp',change_basis:'same_provider_previous_daily_yield',change_reference:{kind:'previous_daily_yield',value:previous?.value??null,date:previous?.date??null},history:history.slice(-22),source:'U.S. Treasury',source_url:t.url,data_type:'official_daily_par_yield',quote_kind:'daily_par_yield',instrument_id:item.id,delay:'日终公布；非盘中成交收益率',fetch_attempts:t.attempts};
  }else if(item.id==='gold')result=await goldQuote();
  else{
   let url=`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(item.symbol)}?interval=1d&range=1mo`;let q:any,parsed:any,fallback=false;
   try{
    try{q=await fetchJson(url);parsed=yahooQuote(q.data,item.symbol)}catch(error){if(dataIssue(error).http_status===429)throw error;url=url.replace('query1.','query2.');q=await fetchJson(url,{attempts:1});parsed=yahooQuote(q.data,item.symbol);fallback=true}
    result={...parsed,source:'Yahoo Finance',source_url:url,data_type:item.id==='brent'?'front_month_futures_quote':'index_quote',quote_kind:item.id==='brent'?'continuous_front_month_futures':'index',instrument_id:item.id,delay:'可能延迟；不承诺交易所实时行情',fetch_attempts:q.attempts,endpoint_fallback:fallback,...(item.id==='brent'?{contract_note:'BZ=F近月连续报价，非官方结算价；换月可能影响涨跌比较'}:{})};
   }catch(error){result=await backupQuote(item.id,dataIssue(error),sinaShared)}
  }
  return {...item,...result,fetched_at:new Date().toISOString()};
 };
}
export function presentMetric(metric:any,includeHistory=false,includeRaw=false){
 const result={...metric,history_available:metric.id!=='gold'&&metric.history_supported!==false};
 if(!includeHistory)delete result.history;
 if(!includeRaw)delete result.raw_fields;
 return result;
}
async function getMetric(item:Metric,refresh:boolean,shared:()=>Promise<Awaited<ReturnType<typeof treasuryText>>>,sinaShared?:()=>Promise<string>){
 try{return qualifyQuote(await loadQuote('global:'+item.id,metricLoader(item,shared,sinaShared),{refresh}),item.kind)}
 catch(error){const issue=dataIssue(error);return {...item,value:null,change:null,change_percent:null,quality:'unavailable',error:issue.message,upstream_error:issue,fetched_at:null,retrieved_at:new Date().toISOString(),history:[],stale:false}}
}
export async function snapshot(input:boolean|SnapshotOptions=false){
 const options:SnapshotOptions=typeof input==='boolean'?{refresh:input}:input;
 let treasury:ReturnType<typeof treasuryText>|undefined;const shared=()=>treasury??=treasuryText();
 let sina:Promise<string>|undefined;const sinaShared=()=>sina??=fetchSinaBatch();
 const metrics=await Promise.all(catalog.map(item=>getMetric(item,options.refresh===true,shared,sinaShared)));
 return {schema_version:'1.2',retrieved_at:new Date().toISOString(),fetched_at:new Date().toISOString(),cache_hit:metrics.every(m=>'delivery'in m&&m.delivery!=='upstream'),report_timezone:'Asia/Shanghai',metrics:metrics.map(m=>presentMetric(m,options.include_history,options.include_raw)),coverage:{available:metrics.filter(m=>m.quality==='available').length,degraded:metrics.filter(m=>m.quality==='degraded').length,stale:metrics.filter(m=>m.quality==='stale').length,unavailable:metrics.filter(m=>m.quality==='unavailable').length,total:catalog.length},notes:['逐项fetched_at为上游成功读取时间；retrieved_at为本次工具返回时间。','degraded表示上游失败后返回最近成功数据，不能当作新报价。','默认不附带历史及原始字段；历史通过get_market_history按需读取。','黄金及布油备用源instrument_changed=true时不可拼接为同一品种/合约历史；VIX/VXN备用源为日终值。']};
}
export async function marketHistory(id:string,refresh=false){
 const item=catalog.find(m=>m.id===id);if(!item)throw new DataError({code:'INVALID_ARGUMENT',message:'未知指标',retryable:false});
 if(item.id==='gold')throw new DataError({code:'UNSUPPORTED_HISTORY',message:'黄金当前来源不提供可比历史，不以黄金期货替代',retryable:false});
 let treasury:ReturnType<typeof treasuryText>|undefined;const metric=await getMetric(item,refresh,()=>treasury??=treasuryText());
 if(metric.quality==='unavailable')throw new DataError((metric as any).upstream_error);
 return {...presentMetric(metric,true),schema_version:'1.2',history_basis:(metric as any).history_supported===false?null:item.kind==='treasury'?'official_daily_par_yield':'provider_daily_close',history_note:(metric as any).history_supported===false?'当前备用源未提供日线历史，不与其他品种拼接':'最新交易日的日线可能尚未收盘；不承诺任意历史区间'};
}
