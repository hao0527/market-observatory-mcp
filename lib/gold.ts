import {quoteTime} from './tencent';
import {fetchText,fetchJson,dataIssue} from './upstream';

export const goldSources = {
  primary: 'https://hq.sinajs.cn/list=hf_XAU',
  reference: 'https://finance.sina.com.cn/futures/quotes/XAU.shtml',
  fallback: 'https://api.gold-api.com/price/XAU',
};

function positive(raw: string | undefined): number | null {
  if (!raw || !/^\d+(?:\.\d+)?$/.test(raw.trim())) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function parseSinaGold(text: string) {
  const raw = text.match(/\bhq_str_hf_XAU="([^"\r\n]*)"\s*;/)?.[1];
  const fields = raw?.split(',');
  if (!fields || fields.length < 14 || !/伦敦金|现货黄金/.test(fields[13])) throw Error('新浪伦敦金响应不完整或品种不符');
  const value = positive(fields[0]);
  const previous = positive(fields[7]);
  const date = fields[12];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}:\d{2}$/.test(fields[6])) throw Error('新浪伦敦金日期/时间无效');
  const asOf = quoteTime((date + fields[6]).replace(/[-:]/g,''));
  if (value === null || !asOf) throw Error('新浪伦敦金缺少有效报价或时间戳');
  const age = Date.now() - Date.parse(asOf);
  if (age < -300000 || age > 96 * 3600000) throw Error('新浪伦敦金时间异常或超过96小时未更新');
  return {
    name: '现货黄金（伦敦金 CFD）', symbol: 'hf_XAU',
    value, as_of: asOf, market_date: date, source_timezone: 'Asia/Shanghai',
    previous_close: previous, previous_close_label: '供应商昨结参考价', previous_date: null,
    previous_date_note: '上游未提供昨结参考价对应的日期，不推测为自然日昨天',
    change: previous !== null ? value - previous : null,
    change_percent: previous !== null ? (value / previous - 1) * 100 : null,
    change_unit: 'absolute_and_percent', change_basis: 'same_provider_previous_settlement_reference',
    change_reference: {value: previous, kind: 'provider_previous_settlement', label: '新浪伦敦金昨结参考价', date: null, source_url: goldSources.primary},
    change_note: previous !== null ? '现价与昨结参考价均取自新浪同一响应，不与Gold API或黄金期货混算' : '上游昨结参考价缺失，日变化留空',
    open: positive(fields[8]), high: positive(fields[4]), low: positive(fields[5]),
    bid: positive(fields[2]), ask: positive(fields[3]), history: [],
    source: '新浪财经 / 汇通网', source_url: goldSources.primary, source_page: goldSources.reference,
    data_type: 'spot_cfd_quote', delay: '供应商伦敦金现货CFD报价，可能延迟；非交易所授权实时现货指数',
    contract_note: '新浪将XAU标注为伦敦金（现货黄金）CFD；非COMEX黄金期货、非LBMA定盘价。日变化以供应商昨结参考价为基准。',
    raw_fields: fields, instrument_id:'gold_london_cfd', quote_kind:'spot_cfd', instrument_changed:false,
  };
}

export function parseGoldApi(q: any, primaryError: string) {
  if (!Number.isFinite(q.price) || q.price <= 0 || typeof q.updatedAt !== 'string' || !Number.isFinite(Date.parse(q.updatedAt))) throw Error('Gold API 报价字段异常');
  if (q.symbol !== 'XAU' || (q.currency && q.currency !== 'USD')) throw Error('Gold API 品种或币种不符');
  return {
    name: '现货黄金', symbol: 'XAU', value: q.price, as_of: q.updatedAt,
    market_date: q.updatedAt.slice(0,10), source_timezone: 'UTC',
    previous_close: null, previous_close_label: '前收盘价（不可用）', previous_date: null,
    change: null, change_percent: null, change_unit: 'absolute_and_percent', change_basis: null,
    history: [], source: 'Gold API', source_url: goldSources.fallback, data_type: 'spot_quote',
    delay: '供应商最新报价；未经交易所实时授权核验',
    change_note: '主源不可用，降级到Gold API；此源未提供同源前值，日变化留空，禁止与新浪昨结混算',
    fallback_used: true, fallback_reason: primaryError, instrument_id:'gold_spot_indicative', quote_kind:'spot_indicative', instrument_changed:true,
    source_transition:{from:'sina_london_cfd',to:'gold_api_spot',same_instrument:false,same_change_basis:false},
  };
}

export async function goldQuote() {
  let primaryError:string;
  try {
    const r=await fetchText(goldSources.primary,{headers:{Referer:goldSources.reference},encoding:'gb18030',timeoutMs:3500});
    return {...parseSinaGold(r.text),fallback_used:false,fetch_attempts:r.attempts};
  }catch(error){primaryError=JSON.stringify(dataIssue(error,goldSources.primary))}
  const r=await fetchJson(goldSources.fallback,{timeoutMs:3500});
  return {...parseGoldApi(r.data,primaryError),fetch_attempts:r.attempts};
}
