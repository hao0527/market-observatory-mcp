import {fetchText,DataError} from './upstream';
import {quoteTime} from './tencent';
export const sinaSymbols:Record<string,string>={sp500:'gb_$inx',nasdaq:'gb_$ixic',dow:'gb_$dji',sox:'gb_sox',brent:'hf_OIL'};
export async function fetchSinaBatch(symbols=Object.values(sinaSymbols)){
 const url='https://hq.sinajs.cn/list='+symbols.join(',');
 const r=await fetchText(url,{headers:{Referer:'https://finance.sina.com.cn/'},encoding:'gb18030'});return r.text;
}
function n(raw:string|undefined){if(!raw||!/^[-+]?\d+(?:\.\d+)?$/.test(raw))return null;const v=Number(raw);return Number.isFinite(v)?v:null}
function nyDate(ms:number){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(ms))}
export function parseSinaBackup(text:string,id:string){
 const symbol=sinaSymbols[id];if(!symbol)throw Error('不支持的备用指标');
 const escaped=symbol.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const raw=text.match(new RegExp('hq_str_'+escaped+'="([^"\\r\\n]*)"\\s*;'))?.[1];
 const f=raw?.split(',');if(!f||f.length<14)throw new DataError({code:'INVALID_RESPONSE',message:'新浪备用行情字段缺失',retryable:false});
 const oil=id==='brent';
 const expected:Record<string,RegExp>={sp500:/标普|标准普尔/,nasdaq:/纳斯达克/,dow:/道琼/,sox:/半导体/,brent:/布伦特/};
 if(!expected[id].test(f[oil?13:0]))throw new DataError({code:'INVALID_RESPONSE',message:'备用行情品种名称不匹配',retryable:false});
 const value=n(f[oil?0:1]),previous=n(f[oil?7:26]);
 const stamp=oil?(f[12]+f[6]).replace(/[-:]/g,''):f[3]?.replace(/[- :]/g,'');
 const asOf=quoteTime(stamp);
 if(value===null||value<=0||!asOf||Date.parse(asOf)>Date.now()+120000)throw new DataError({code:'INVALID_RESPONSE',message:'备用行情缺少有效数值或时间',retryable:false});
 const prev=previous!==null&&previous>0?previous:null;
 return {value,previous_close:prev,previous_date:null,previous_close_label:oil?'供应商昨结参考价':'供应商昨收',as_of:asOf,as_of_label:'供应商更新时间，非逐笔成交时间',market_date:oil?f[12]:nyDate(Date.parse(asOf)),source_timezone:'Asia/Shanghai',change:prev!==null?value-prev:null,change_percent:prev!==null?(value/prev-1)*100:null,change_unit:'absolute_and_percent',change_basis:oil?'same_provider_previous_settlement_reference':'same_provider_previous_close',change_reference:{kind:oil?'previous_settlement_reference':'previous_close',value:prev,date:null},history:[],history_supported:false,raw_fields:f,source:'新浪财经',source_url:'https://hq.sinajs.cn/list='+symbol,data_type:oil?'commodity_cfd_quote':'index_quote',quote_kind:oil?'commodity_cfd':'index',instrument_id:oil?'brent_sina_cfd':id,instrument_changed:oil,source_transition:{from:'Yahoo Finance',to:'Sina',same_instrument:!oil,same_change_basis:!oil},delay:'备用供应商报价，可能延迟；更新时间不等于成交时间',...(oil?{name:'布伦特原油（CFD备用报价）',contract_note:'新浪布伦特CFD报价与Yahoo BZ=F不是已验证相同合约；换源已标注instrument_changed，禁止拼接为同一合约历史。'}:{})};
}
export function parseCboeHistory(text:string,id:string){
 const rows=text.trim().split(/\r?\n/).filter(Boolean).map(s=>s.split(','));
 const close=rows[0]?.indexOf('CLOSE');if(close<0||rows[0]?.[0]!=='DATE')throw new DataError({code:'INVALID_RESPONSE',message:'Cboe日线格式错误',retryable:false});
 const points=new Map<string,number>();
 for(const r of rows.slice(1)){const m=r[0]?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);const v=n(r[close]);if(!m||v===null||v<=0)continue;const date=`${m[3]}-${m[1]}-${m[2]}`;const ms=Date.parse(date+'T00:00:00Z');if(Number.isFinite(ms)&&new Date(ms).toISOString().slice(0,10)===date)points.set(date,v)}
 const history=[...points].sort(([a],[b])=>a.localeCompare(b)).slice(-22).map(([date,value])=>({date,value}));const last=history.at(-1),previous=history.at(-2);
 if(!last)throw new DataError({code:'INVALID_RESPONSE',message:'Cboe无可用日终值',retryable:false});
 return {value:last.value,market_date:last.date,as_of:null,source_timezone:'America/New_York',previous_close:previous?.value??null,previous_date:previous?.date??null,change:previous?last.value-previous.value:null,change_percent:previous?(last.value/previous.value-1)*100:null,change_unit:'absolute_and_percent',change_basis:'same_provider_previous_daily_close',change_reference:{kind:'previous_daily_close',value:previous?.value??null,date:previous?.date??null},history,history_supported:true,source:'Cboe',source_url:`https://cdn.cboe.com/api/global/us_indices/daily_prices/${id.toUpperCase()}_History.csv`,data_type:'official_daily_index_close',quote_kind:'daily_index_close',instrument_id:id,instrument_changed:false,source_transition:{from:'Yahoo Finance',to:'Cboe daily closes',same_instrument:true,same_change_basis:true,frequency_changed:true},delay:'官方日终收盘数据，不是盘中报价'};
}
export async function backupQuote(id:string,error:any,sinaShared?:()=>Promise<string>){
 let result:any;
 if(id==='vix'||id==='vxn'){const url=`https://cdn.cboe.com/api/global/us_indices/daily_prices/${id.toUpperCase()}_History.csv`;result=parseCboeHistory((await fetchText(url,{timeoutMs:7000})).text,id)}
 else{const text=await(sinaShared?sinaShared():fetchSinaBatch([sinaSymbols[id]]));result=parseSinaBackup(text,id)}
 return {...result,fallback_used:true,primary_error:error};
}
