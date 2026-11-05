import {temporalMetadata} from './time-metadata';
import {fetchText,DataError,dataIssue} from './upstream';
import {loadQuote} from './quote-cache';
import {qualifyQuote} from './freshness';
/** Tencent's public quote wire format is GBK and must never be evaluated as JavaScript. */
export const securityQueryInfo = {
  tool: 'get_security_quotes',
  markets: ['sh', 'sz', 'bj'],
  examples: ['sz159842', 'sh518850', 'sh600519', 'sz000001', 'bj920002'],
  max_symbols: 30,
  cache_seconds: 5,
  source: '腾讯证券行情',
  endpoint: 'https://qt.gtimg.cn/q=',
  notes: [
    '必须带交易所前缀。000001等纯数字代码存在歧义，不自动猜测。支持沪深北股票和ETF；不支持港美股及不同字段格式。',
    '返回供应商最新报价，不能保证交易所授权实时性。休市或停牌时可能返回最后报价。',
    '成交量和盘口数量单位为手；成交额为万元人民币。日变化对比上游昨收，前收日期未提供时不推测。',
    '股票分红除权、ETF分红等可能影响涨跌口径；价格未复权，ETF市价不等于基金净值。',
    '公共接口没有稳定性承诺。未知/失败代码逐项报错；原始字段可选返回。',
  ],
};

export function validateSymbols(input: unknown): string[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > 30) {
    throw new DataError({code:'INVALID_ARGUMENT',message:'symbols 必须为1–30个带交易所前缀的代码，例如 ["sz159842", "sh518850"]',retryable:false});
  }
  const symbols = input.map((s: unknown) => {
    if (typeof s !== 'string' || !/^(sh|sz|bj)\d{6}$/i.test(s.trim())) {
      throw new DataError({code:'INVALID_ARGUMENT',message:'代码格式错误：必须使用 sh/sz/bj + 六位数字，例如 sz159842；不接受URL或纯数字代码',retryable:false});
    }
    return s.trim().toLowerCase();
  });
  return [...new Set(symbols)];
}

function num(s: string | undefined): number | null {
  if (s === undefined || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(s.trim())) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function quoteTime(raw: string | undefined): string | null {
  if (!raw || !/^\d{14}$/.test(raw)) return null;
  const iso = `${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}T${raw.slice(8,10)}:${raw.slice(10,12)}:${raw.slice(12,14)}+08:00`;
  const ms = Date.parse(iso);
  // Date.parse normalizes impossible dates (e.g. Feb 30). Reject instead.
  if (!Number.isFinite(ms) || new Date(ms + 8 * 3600000).toISOString().slice(0,19) !== iso.slice(0,19)) return null;
  return new Date(ms).toISOString();
}

export function extractTencentRecords(text: string): Map<string, string[]> {
  const records = new Map<string, string[]>();
  for (const match of text.matchAll(/\bv_((?:sh|sz|bj)\d{6})="([^"\r\n]*)"\s*;/g)) {
    records.set(match[1], match[2].split('~'));
  }
  return records;
}

export function parseTencentQuote(symbol: string, fields: string[], fetchedAt: string, marketStatus: any = null) {
  if (fields.length < 35 || !fields[1] || fields[2] !== symbol.slice(2)) {
    throw Error('上游响应不完整或证券代码不匹配');
  }
  const valueRaw = num(fields[3]);
  const value = valueRaw !== null && valueRaw > 0 ? valueRaw : null;
  const previousRaw = num(fields[4]);
  const previous = previousRaw !== null && previousRaw > 0 ? previousRaw : null;
  const asOf = quoteTime(fields[30]);
  const change = value !== null && previous !== null ? value - previous : null;
  const changePercent = change !== null ? change / previous! * 100 : null;
  const age = asOf ? Math.round((Date.parse(fetchedAt) - Date.parse(asOf)) / 1000) : null;
  const timeValid = age !== null && age >= -60;
  const marketObservationRecent = marketStatus?.as_of && Math.abs(Date.parse(fetchedAt) - Date.parse(marketStatus.as_of)) < 300000;
  const stale = timeValid && (age! > 96 * 3600 || (marketObservationRecent && marketStatus?.state === 'trading' && age! > 300));
  const quality = stale ? 'stale' : value === null || !timeValid || previous === null ? 'partial' : 'available';
  const instrumentCode = fields[61]?.trim() || null;
  const assetType = instrumentCode === 'ETF' ? 'etf' : instrumentCode === 'ZS' ? 'index' : instrumentCode?.startsWith('GP') ? 'stock' : 'unknown';
  const bids = Array.from({length: 5}, (_, i) => ({level: i + 1, price: num(fields[9 + 2 * i]), volume_lots: num(fields[10 + 2 * i])}));
  const asks = Array.from({length: 5}, (_, i) => ({level: i + 1, price: num(fields[19 + 2 * i]), volume_lots: num(fields[20 + 2 * i])}));
  const warnings: string[] = [];
  if (value === null) warnings.push('无有效最新成交价，可能未成交或停牌；不以昨收替代最新价');
  if (!timeValid) warnings.push('缺少有效行情时间或时间在未来，不可认定为实时');
  if (stale) warnings.push('行情时间较旧；请核对休市、停牌或上游延迟');
  if (previous === null) warnings.push('昨收无效，日变化留空');
  return {
    symbol, code: fields[2], name: fields[1], exchange: symbol.slice(0,2),
    currency: 'CNY', unit: assetType === 'index' ? '点' : '元', asset_type: assetType, provider_instrument_type: instrumentCode, value, previous_close: previous, previous_date: null,
    previous_date_note: '接口仅提供昨收值，未提供对应交易日期',
    change, change_percent: changePercent, change_unit: 'absolute_and_percent',
    provider_change: num(fields[31]), provider_change_percent: num(fields[32]),
    open: num(fields[5]), high: num(fields[33]), low: num(fields[34]),
    volume_lots: num(fields[6]), turnover_wan_cny: num(fields[37]), turnover_rate_percent: num(fields[38]),
    order_book: assetType==='index'?null:{volume_unit:'手',bids,asks}, order_book_supported:assetType==='index'?false:assetType==='unknown'?null:true, order_book_status:assetType==='index'?'unsupported':assetType==='unknown'?'unverified':'provided',
    as_of: asOf, as_of_local: asOf ? fields[30].replace(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/, '$1-$2-$3 $4:$5:$6') : null,
    market_date: asOf ? fields[30].slice(0,8).replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3') : null,
    source_timezone: 'Asia/Shanghai', fetched_at: fetchedAt,
    age_seconds: age !== null && timeValid ? Math.max(0,age) : age, stale: Boolean(stale), quality, warnings,
    market_status: marketStatus, is_realtime: null,
    source: securityQueryInfo.source, source_url: `${securityQueryInfo.endpoint}${symbol}`,
    data_type: 'unadjusted_security_quote',
    delay: '供应商最新行情，不承诺无延迟；休市或停牌可能沿用最后报价',
    change_basis: 'same_provider_previous_close',
    change_reference:{kind:'previous_close',value:previous,date:null}, instrument_id:symbol,quote_kind:assetType,raw_fields:fields,
  };
}

function parseMarketStatus(text: string) {
  const raw = text.match(/\bv_marketStat="([^"\r\n]*)"\s*;/)?.[1];
  if (!raw) return {} as Record<string, any>;
  const parts = raw.split('|');
  const stamp = quoteTime(parts[0].replace(/[- :]/g, ''));
  const result: Record<string, any> = {};
  for (const [market, label] of [['sh','SH'],['sz','SZ'],['bj','BJ']]) {
    const report = parts.find(p => p.startsWith(label + '_'));
    if (!report) continue;
    result[market] = {raw: report, as_of: stamp, source_timezone: 'Asia/Shanghai', state: report.includes('交易中') ? 'trading' : report.includes('午间休市') ? 'lunch_break' : 'closed_or_preopen', note: '市场级状态，不代表个股未停牌'};
  }
  return result;
}

export async function getSecurityQuotes(input:unknown,refresh=false,includeRaw=false) {
 const symbols=validateSymbols(input),url=`${securityQueryInfo.endpoint}${symbols.join(',')},marketStat`;
 let wire:Promise<{records:Map<string,string[]>;markets:Record<string,any>;at:string;attempts:number}>|undefined;
 const fetchBatch=()=>wire??=(async()=>{const r=await fetchText(url,{headers:{Referer:'https://gu.qq.com/'},encoding:'gb18030'});return {records:extractTencentRecords(r.text),markets:parseMarketStatus(r.text),at:new Date().toISOString(),attempts:r.attempts}})();
 const quotes=await Promise.all(symbols.map(async symbol=>{
  try{
   const data=await loadQuote('security:'+symbol,async()=>{
    const batch=await fetchBatch(),fields=batch.records.get(symbol);
    if(!fields)throw new DataError({code:'NO_QUOTE',message:'上游未返回该代码，可能不存在或暂未覆盖',retryable:false,source_url:`${securityQueryInfo.endpoint}${symbol}`});
    return {...parseTencentQuote(symbol,fields,batch.at,batch.markets[symbol.slice(0,2)]??null),fetch_attempts:batch.attempts};
   },{refresh,ttlMs:5000});
   const quote=temporalMetadata(qualifyQuote(data,'security'));
   if(quote.asset_type==='index'){quote.order_book=null;quote.order_book_supported=false;quote.order_book_status='unsupported'}
   if(includeRaw)quote.raw={encoding:'GB18030',delimiter:'~',fields:quote.raw_fields};
   delete quote.raw_fields;return quote;
  }catch(error){const issue=dataIssue(error);return {symbol,value:null,quality:'unavailable',error:issue.message,upstream_error:issue,fetched_at:null,retrieved_at:new Date().toISOString(),source:securityQueryInfo.source,source_url:`${securityQueryInfo.endpoint}${symbol}`}}
 }));
 const at=new Date().toISOString();
 return {schema_version:'1.4',fetched_at:at,retrieved_at:at,cache_hit:quotes.every(q=>q.delivery&&q.delivery!=='upstream'),report_timezone:'Asia/Shanghai',quotes,coverage:{available:quotes.filter(q=>q.quality==='available').length,degraded:quotes.filter(q=>q.quality==='degraded').length,unavailable:quotes.filter(q=>q.quality==='unavailable').length,total:quotes.length},notes:[...securityQueryInfo.notes,'每条fetched_at为上游成功读取时间；degraded表示上游失败后返回最近成功数据。']};
}
