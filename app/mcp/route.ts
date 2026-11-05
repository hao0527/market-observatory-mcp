import {snapshot, catalog, marketHistory} from '@/lib/market';
import {getSecurityQuotes, securityQueryInfo} from '@/lib/tencent';
import {calendarPolicy} from '@/lib/freshness';
import {dataIssue} from '@/lib/upstream';

export const mcpTools = [
  {
    name: 'get_market_snapshot',
    description: '获取全球资产最新可得数据：VIX/VXN，美债2/10/30年，黄金现货报价，布伦特近月期货、美股四指数、日经225和韩国KOSPI。含来源、交易日期、时间戳、延迟、前值与日变化。黄金主源为新浪伦敦金现货CFD，涨跌与同源昨结参考价比较；备用Gold API无前值则留空并标记instrument_changed。默认精简返回无历史；degraded为故障时的旧成功数据，不能作为新报价。不可把延迟或日终数据称为实时。',
    inputSchema: {type:'object',properties:{refresh:{type:'boolean',description:'跳过正常缓存，失败仍可返回带degraded标记的最近成功数据'},include_history:{type:'boolean',description:'默认false；历史建议用get_market_history单独请求'},include_raw:{type:'boolean',description:'默认false；可附带黄金原始字段用于对账'}},additionalProperties:false},
    annotations: {readOnlyHint: true},
  },
  {
    name: 'get_market_history',
    description: '获取某指标最近约一个月的可得日线收盘；美债为官方日终收益率。黄金现货当前来源无历史，明确返回不支持；美股报价切换新浪时按需读取独立东方财富/Nasdaq日线，FRED备用，日韩可用东方财富独立历史；逐项标注history_metadata的来源、日期、质量，不与报价拼接；失败标注history_supported=false。',
    inputSchema: {type:'object',properties:{id:{type:'string',enum:catalog.map(m=>m.id)},refresh:{type:'boolean',description:'只刷新指定指标'}},required:['id'],additionalProperties:false},
    annotations: {readOnlyHint:true},
  },
  {
    name: 'get_market_catalog', description: '获取全球指标及指定股票/ETF查询的定义、示例、来源和数据口径。',
    inputSchema: {type:'object', properties:{}, additionalProperties:false}, annotations:{readOnlyHint:true},
  },
  {
    name: 'get_security_quotes',
    description: '通过腾讯qt.gtimg.cn按指定代码获取沪深北股票/ETF最新行情，支持批量1–30只。必须用带交易所前缀的代码，如sz159842、sh518850、sh600519、bj920002。返回最新价、昨收、涨跌额/幅、开高低、成交量(手)、成交额(万元)、五档盘口（指数不支持时为null）、行情与读取时间、市场状态和质量标记。休市/停牌可能是最后报价，不能保证无延迟；ETF市价不是基金净值。',
    inputSchema: {
      type:'object', properties:{
        symbols:{type:'array', items:{type:'string', pattern:'^(sh|sz|bj)[0-9]{6}$'}, minItems:1, maxItems:30, description:'如 ["sz159842", "sh518850"]。必须带交易所前缀，不接受纯数字和URL。'},
        refresh:{type:'boolean', description:'true跳过5秒实例缓存，向腾讯重新请求'},
        include_raw:{type:'boolean', description:'附带解码后的原始字段数组，供对账。默认false'},
      }, required:['symbols'], additionalProperties:false,
    }, annotations:{readOnlyHint:true},
  },
];

export async function callMarketTool(name: string, args: any = {}) {
  if (name === 'get_market_snapshot') return snapshot({refresh:args.refresh===true,include_history:args.include_history===true,include_raw:args.include_raw===true});
  if (name === 'get_market_catalog') return {
    schema_version:'1.3', catalog, backup_sources:{volatility:'Cboe官方日终值（非盘中）',us_indices:'新浪同一指数报价；历史按需使用独立东方财富/Nasdaq序列，FRED备用',asian_indices:'Yahoo指数；东方财富 / NAVER同一指数备用报价；东方财富独立历史',brent:'新浪CFD备用报价，instrument_changed=true；不可拼接相同合约历史'}, security_quotes:securityQueryInfo, freshness_policy:calendarPolicy, cache_policy:{normal_ttl_seconds:60,security_ttl_seconds:5,last_success_retention_days:14,storage:'D1 durable + bounded memory',degraded:'上游失败时返回最近成功数据，保留原fetched_at和行情时间；retrieved_at为本次返回时间'},
    gold: {primary:'新浪财经/汇通网伦敦金现货CFD', change_basis:'同源昨结参考价', fallback:'Gold API现货；无同源前值则不计算涨跌', previous_date:'上游未提供，不推测'},
    notes:['美债为官方日终par yield；布伦特为BZ=F近月期货。','日线历史随请求取得，不提供任意历史区间和持久化快照。','缺失/过期项必须在分析中明示，不能补造数值。'],
  };
  if (name === 'get_security_quotes') return getSecurityQuotes(args.symbols, args.refresh === true, args.include_raw === true);
  if(name==='get_market_history')return marketHistory(args.id,args.refresh===true);
  throw Error('Unknown tool');
}

export async function POST(req: Request) {
  let rpc: any;
  try {rpc = await req.json()} catch {return Response.json({jsonrpc:'2.0', id:null, error:{code:-32700, message:'Parse error'}}, {status:400})}
  if (!rpc || typeof rpc !== 'object' || Array.isArray(rpc) || rpc.jsonrpc !== '2.0' || typeof rpc.method !== 'string') return Response.json({jsonrpc:'2.0', id:null, error:{code:-32600, message:'Invalid Request'}}, {status:400});
  const {id, method, params} = rpc;
  if (id === undefined) return new Response(null, {status:202});
  let result: any;
  if (method === 'server/discover') result = {supportedVersions:['2026-07-28'], capabilities:{tools:{}}};
  else if (method === 'initialize') result = {protocolVersion:params?.protocolVersion || '2026-07-28', serverInfo:{name:'asset-observatory', version:'1.3.0'}, capabilities:{tools:{}}};
  else if (method === 'ping') result = {};
  else if (method === 'tools/list') result = {tools:mcpTools};
  else if (method === 'tools/call') {
    try {
      const data = await callMarketTool(params?.name, params?.arguments ?? {});
      result = {content:[{type:'text', text:JSON.stringify(data)}], isError:false};
    } catch (error) {
      result = {content:[{type:'text', text:JSON.stringify({error:dataIssue(error)})}], isError:true};
    }
  } else return Response.json({jsonrpc:'2.0', id, error:{code:-32601, message:'Method not found'}});
  return Response.json({jsonrpc:'2.0', id, result}, {headers:{'Cache-Control':'no-store'}});
}
