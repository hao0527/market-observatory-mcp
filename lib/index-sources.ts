import {fetchJson,fetchText,DataError,dataIssue} from './upstream';
export const asianIndices:Record<string,{code:string;name:RegExp;timezone:string}>={
 nikkei225:{code:'N225',name:/日经225|日經225/,timezone:'Asia/Tokyo'},
 kospi:{code:'KS11',name:/韩国KOSPI|韓國KOSPI/,timezone:'Asia/Seoul'},
};
export const fredSeries:Record<string,string>={sp500:'SP500',nasdaq:'NASDAQCOM',dow:'DJIA',sox:'NASDAQSOX'};
const historyIndices:Record<string,{code:string;name:RegExp;timezone:string}>={...asianIndices,sp500:{code:'SPX',name:/标普500|標普500/,timezone:'America/New_York'},dow:{code:'DJIA',name:/道琼斯|道瓊斯/,timezone:'America/New_York'}};
const nasdaqHistorySymbols:Record<string,string>={nasdaq:'COMP',sox:'SOX'};
function issue(message:string){return new DataError({code:'INVALID_RESPONSE',message,retryable:false})}
function dateIn(ms:number,tz:string){return new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(ms))}
function number(raw:unknown){if(typeof raw==='number')return Number.isFinite(raw)?raw:null;if(typeof raw!=='string'||!/^[-+]?\d+(?:\.\d+)?$/.test(raw))return null;return Number(raw)}
export async function fetchAsianBatch(){
 const entries=await Promise.all(Object.keys(asianIndices).map(async id=>{
  try{
   const response=(await fetchJson(asianQuoteUrl(id),{attempts:1,headers:{Referer:'https://quote.eastmoney.com/','User-Agent':'Mozilla/5.0'}})).data;
   parseAsianIndex({quotes:{[id]:{response}}},id);return [id,{response}];
  }catch(eastmoneyError){
   try{const naver=(await fetchJson(naverQuoteUrl(id),{attempts:1,timeoutMs:7000,headers:{Referer:'https://m.stock.naver.com/','User-Agent':'Mozilla/5.0'}})).data;return [id,{naver,eastmoney_error:dataIssue(eastmoneyError)}]}catch(error){return [id,{error}]}
  }
 }));
 return {quotes:Object.fromEntries(entries)};
}
function asianQuoteUrl(id:string){return `https://push2.eastmoney.com/api/qt/stock/get?secid=100.${asianIndices[id].code}&fltt=2&fields=f57,f58,f43,f60,f86,f170,f169`}
function naverQuoteUrl(id:string){return id==='nikkei225'?'https://api.stock.naver.com/index/.N225/basic':'https://m.stock.naver.com/api/index/KOSPI/basic'}
export function parseNaverIndex(d:any,id:string){
 const spec=asianIndices[id],symbol=id==='nikkei225'?'.N225':'KOSPI';
 if(!spec||d?.stockEndType!=='index'||d.reutersCode!==symbol||d.stockExchangeType?.zoneId!==spec.timezone)throw issue('NAVER指数代码或时区不匹配');
 const value=number(String(d.closePrice??'').replaceAll(',','')),change=number(String(d.compareToPreviousClosePrice??'').replaceAll(',',''));
 const rawTime=d.localTradedAt,ms=typeof rawTime==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/.test(rawTime)?Date.parse(rawTime):NaN;
 if(value===null||value<=0||!Number.isFinite(ms)||new Date(ms+9*3600000).toISOString().slice(0,19)!==rawTime.slice(0,19)||ms>Date.now()+120000)throw issue('NAVER报价或当地时间无效');
 const previous=change!==null&&value-change>0?value-change:null;
 return {value,as_of:new Date(ms).toISOString(),as_of_label:'供应商localTradedAt（市场当地带UTC偏移时间）',market_date:dateIn(ms,spec.timezone),source_timezone:spec.timezone,market_timezone:spec.timezone,previous_close:previous,previous_date:null,previous_close_label:'同响应最新值减供应商日涨跌得到的昨收',change:previous===null?null:change,change_percent:previous===null?null:(value/previous-1)*100,provider_change_percent:number(d.fluctuationsRatio),change_unit:'absolute_and_percent',change_basis:'same_provider_reported_change',change_reference:{kind:'same_response_previous_close_derived',value:previous,date:null},source:'NAVER Finance',source_url:naverQuoteUrl(id),provider_symbol:symbol,provider_delay_minutes:d.delayTime??d.stockExchangeType.delayTime??null,market_status:d.marketStatus?{state:d.marketStatus,source:'NAVER',observed_at:new Date().toISOString()}:null,data_type:'index_quote',quote_kind:'index',instrument_id:id,instrument_changed:false,history:[],history_supported:false,delay:'供应商指数；日经通常延迟15分钟，实际延迟见provider_delay_minutes和as_of',raw_fields:d,source_transition:{from:'Yahoo Finance',to:'NAVER',same_instrument:true,same_change_basis:true}};
}
export function parseAsianIndex(data:any,id:string){
 const spec=asianIndices[id];if(!spec)throw issue('未知日韩指数');
 const single=data?.quotes?.[id];if(single?.error)throw single.error;
 if(single?.naver)return {...parseNaverIndex(single.naver,id),backup_error:single.eastmoney_error};
 const raw=single?.response?.data;
 if(single)data={data:{diff:raw?[{f12:raw.f57,f13:100,f14:raw.f58,f2:raw.f43,f18:raw.f60,f124:raw.f86}]:[]}};
 const rows=Array.isArray(data?.data?.diff)?data.data.diff:Object.values(data?.data?.diff??{});
 const q:any=rows.find((q:any)=>q.f12===spec.code&&q.f13===100);
 if(!q||!spec.name.test(q.f14??''))throw issue('日韩指数代码或名称不匹配');
 const value=number(q.f2),previous=number(q.f18),time=number(q.f124);
 if(value===null||value<=0||time===null||time<=0||time*1000>Date.now()+120000)throw issue('日韩指数报价或时间无效');
 const prev=previous!==null&&previous>0?previous:null;
 return {value,as_of:new Date(time*1000).toISOString(),as_of_label:'供应商行情更新时间，非逐笔成交时间',market_date:dateIn(time*1000,spec.timezone),source_timezone:spec.timezone,market_timezone:spec.timezone,previous_close:prev,previous_date:null,change:prev===null?null:value-prev,change_percent:prev===null?null:(value/prev-1)*100,change_unit:'absolute_and_percent',change_basis:'same_provider_previous_close',change_reference:{kind:'previous_close',value:prev,date:null},source:'东方财富',source_url:asianQuoteUrl(id),provider_symbol:'100.'+spec.code,data_type:'index_quote',quote_kind:'index',instrument_id:id,instrument_changed:false,history:[],history_supported:false,delay:'供应商最新可得指数，可能延迟，不承诺授权实时性',raw_fields:raw??q,source_transition:{from:'Yahoo Finance',to:'Eastmoney',same_instrument:true,same_change_basis:true}};
}
function validPoints(points:{date:string;value:number}[],today:string){
 const map=new Map<string,number>();
 for(const p of points){const ms=Date.parse(p.date+'T00:00:00Z');if(/^\d{4}-\d{2}-\d{2}$/.test(p.date)&&Number.isFinite(ms)&&new Date(ms).toISOString().slice(0,10)===p.date&&p.date<=today&&Number.isFinite(p.value)&&p.value>0)map.set(p.date,p.value)}
 const result=[...map].sort(([a],[b])=>a.localeCompare(b)).slice(-22).map(([date,value])=>({date,value}));
 if(!result.length)throw issue('独立历史源无有效日期或收盘值');return result;
}
export function parseFredHistory(text:string,series:string){
 const rows=text.replace(/^\uFEFF/,'').trim().split(/\r?\n/).map(line=>line.split(','));
 if(!['observation_date','DATE'].includes(rows[0]?.[0])||rows[0]?.[1]!==series)throw issue('FRED历史序列不匹配');
 return validPoints(rows.slice(1).map(r=>({date:r[0],value:number(r[1])??NaN})),dateIn(Date.now(),'America/New_York'));
}
export function parseAsianHistory(data:any,id:string){
 const spec=historyIndices[id],d=data?.data;
 if(!spec||d?.code!==spec.code||d?.market!==100||!spec.name.test(d?.name??''))throw issue('日韩历史指数映射不匹配');
 return validPoints((d.klines??[]).map((line:string)=>{const f=line.split(',');return {date:f[0],value:number(f[2])??NaN}}),dateIn(Date.now(),spec.timezone));
}
export function parseNasdaqHistory(data:any,id:string){
 if(data?.status?.rCode!==200||data?.data?.symbol!==nasdaqHistorySymbols[id])throw issue('Nasdaq历史指数代码不匹配');
 return validPoints((data.data.tradesTable?.rows??[]).map((r:any)=>{const m=r.date?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);return {date:m?`${m[3]}-${m[1]}-${m[2]}`:'',value:number(String(r.close??'').replaceAll(',',''))??NaN}}),dateIn(Date.now(),'America/New_York'));
}
export function parseNaverHistory(data:any,id:string){
 const spec=asianIndices[id];if(!spec||!Array.isArray(data))throw issue('NAVER历史格式或指数映射错误');
 const points=data.map((row:any)=>{
  if(id==='nikkei225'&&(row.worldIndexSymbol!=='.N225'||row.stockExchangeType?.zoneId!=='Asia/Tokyo'))throw issue('NAVER日经历史证券代码或时区不匹配');
  if(id==='kospi'&&((row.itemCode&&row.itemCode!=='KOSPI')||(row.reutersCode&&row.reutersCode!=='KOSPI')||(row.worldIndexSymbol&&row.worldIndexSymbol!=='KOSPI')||(row.stockExchangeType?.zoneId&&row.stockExchangeType.zoneId!=='Asia/Seoul')))throw issue('NAVER韩国历史证券代码或时区不匹配');
  const stamp=row.localTradedAt;
  const date=typeof stamp==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(stamp)?stamp:typeof stamp==='string'&&/^\d{4}-\d{2}-\d{2}T.*\+09:00$/.test(stamp)&&Number.isFinite(Date.parse(stamp))?dateIn(Date.parse(stamp),spec.timezone):'';
  return {date,value:number(String(row.closePrice??'').replaceAll(',',''))??NaN};
 });
 return validPoints(points,dateIn(Date.now(),spec.timezone));
}
function range(){const now=Date.now();return {from:new Date(now-65*86400000).toISOString().slice(0,10),to:new Date(now).toISOString().slice(0,10)}}
function historyPayload(id:string,points:any[],source:string,url:string,series:string,extra:any={}){
 return {value:points.at(-1).value,as_of:null,market_date:points.at(-1).date,fetched_at:new Date().toISOString(),data_type:asianIndices[id]?'provider_daily_index_bar':'provider_daily_index_close',history:points,history_source:source,history_source_url:url,history_series:series,source_timezone:asianIndices[id]?.timezone??'America/New_York',market_timezone:asianIndices[id]?.timezone??'America/New_York',instrument_id:id,...extra};
}
export async function fredIndexHistory(id:string){
 const series=fredSeries[id];if(!series)throw issue('没有匹配的FRED序列');
 const {from,to}=range(),url=`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${series}&cosd=${from}&coed=${to}`;
 try{
  const r=await fetchText(url,{attempts:1,timeoutMs:7000});
  return historyPayload(id,parseFredHistory(r.text,series),'FRED',url,series,{raw_history_fields:r.text,publication_note:'FRED为日度指数转发源，可能发布滞后；日期落后仍标stale，不视为实时'});
 }catch(error){throw new DataError({...dataIssue(error),source:'FRED',source_url:url})}
}
export async function independentIndexHistory(id:string){
 const series=fredSeries[id],asia=asianIndices[id];if(!series&&!asia)throw issue('无独立历史映射');
 const {from,to}=range(),spec=historyIndices[id],symbol=nasdaqHistorySymbols[id];
 const primarySource=symbol?'Nasdaq':'东方财富';
 const url=symbol?`https://api.nasdaq.com/api/quote/${symbol}/historical?assetclass=index&fromdate=${from}&todate=${to}&limit=60`:`https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=100.${spec.code}&klt=101&fqt=0&beg=${from.replaceAll('-','')}&end=${to.replaceAll('-','')}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53`;
 let primaryError;
 try{
  const data=(await fetchJson(url,{attempts:1,timeoutMs:7000,headers:{'User-Agent':'Mozilla/5.0',Referer:symbol?'https://www.nasdaq.com/':'https://quote.eastmoney.com/'}})).data;
  const points=symbol?parseNasdaqHistory(data,id):parseAsianHistory(data,id);
  return historyPayload(id,points,primarySource,url,symbol??'100.'+spec.code,{raw_history_fields:data,history_source_attempts:[{source:primarySource,status:'success',source_url:url}]});
 }catch(error){primaryError={...dataIssue(error),source:primarySource,source_url:url}}
 try{
  let result:any;
  if(series)result=await fredIndexHistory(id);
  else{
   const url=id==='nikkei225'?'https://api.stock.naver.com/index/.N225/price?pageSize=60&page=1':'https://m.stock.naver.com/api/index/KOSPI/price?pageSize=60&page=1';
   try{
    const [prices,basic]=await Promise.all([fetchJson(url,{attempts:1,timeoutMs:7000,headers:{Referer:'https://m.stock.naver.com/','User-Agent':'Mozilla/5.0'}}),fetchJson(naverQuoteUrl(id),{attempts:1,timeoutMs:7000,headers:{Referer:'https://m.stock.naver.com/','User-Agent':'Mozilla/5.0'}})]);
    const verified=parseNaverIndex(basic.data,id); // Verify instrument + timezone against this provider's basic endpoint.
    result=historyPayload(id,parseNaverHistory(prices.data,id),'NAVER Finance',url,id==='nikkei225'?'.N225':'KOSPI',{market_status:verified.market_status,quote_market_date:verified.market_date,raw_history_fields:{prices:prices.data,basic:basic.data}});
   }catch(error){throw new DataError({...dataIssue(error),source:'NAVER Finance',source_url:url})}
  }
  return {...result,history_primary_error:primaryError,history_source_attempts:[{source:primarySource,status:'failed',error:primaryError},{source:result.history_source,status:'success',source_url:result.history_source_url}]};
 }catch(error){const last=dataIssue(error);throw new DataError({...last,causes:[primaryError,last]})}
}
