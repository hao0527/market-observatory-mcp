import {snapshot, catalog, marketHistory} from '@/lib/market';
import {getSecurityQuotes, securityQueryInfo} from '@/lib/tencent';
import {calendarPolicy} from '@/lib/freshness';
import {historyContract} from '@/lib/history';
import {dataIssue} from '@/lib/upstream';
import {volatilityContract} from '@/lib/volatility';
import {getSecurityHistory,securityHistoryInfo} from '@/lib/security-history';
import {configureSecurityArchive,syncSecurityHistory,getSecurityArchiveStatus,securityArchiveInfo} from '@/lib/security-archive';

export const mcpTools = [
  {
    name:'sync_security_history',description:'将观察列表或指定沪深北股票/ETF的不复权历史K线归档到现有D1。按交易日建可恢复任务；每次最多处理2项，返回job_id和remaining_queued，继续用job_id执行。只写已完成有效K线，保留原始来源/采集时间/失败/缺失，缺字段与缺K线分别表达，不跨源拼接。盘后15:35以后才采当日；未知日历不猜测。重复执行幂等；retry_missing遵循持久化指数退避，force_refresh创建独立新作业。归档complete不代表供应商提供amount。只采集数据。',
    inputSchema:{type:'object',properties:{job_id:{type:'string'},symbols:{type:'array',items:{type:'string'},minItems:1,maxItems:30},periods:{type:'array',items:{type:'string',enum:['1m','5m','15m','30m','60m','1d']}},start_date:{type:'string'},end_date:{type:'string'},max_tasks:{type:'integer',minimum:1,maximum:2,default:1},retry_missing:{type:'boolean',default:true},force_refresh:{type:'boolean',default:false}},additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true},
  },
  {
    name:'configure_security_archive',description:'持久化每日证券历史归档的观察列表、周期和启用状态。仅配置数据采集；不改调度时间，不删除已有历史。证券名称以实际供应商为准，sz159842为券商ETF银华。',
    inputSchema:{type:'object',properties:{symbols:{type:'array',items:{type:'string'},minItems:1,maxItems:30},periods:{type:'array',items:{type:'string',enum:['1m','5m','15m','30m','60m','1d']}},enabled:{type:'boolean'}},additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true},
  },
  {
    name:'get_security_archive_status',description:'读取D1采集开关（不等于调度器启用）、持久化覆盖及近期作业；backfill从全部未完成任务发现已到期补采，next_retry_at仅为允许重试时间；提供job_id读取逐日任务、缺失区间、失败与重试时间，提供fetch_id审计原始响应。所有成功采集时间保持原值，retrieved_at表示本次读取。',
    inputSchema:{type:'object',properties:{job_id:{type:'string'},fetch_id:{type:'string'}},additionalProperties:false},annotations:{readOnlyHint:true},
  },
  {
    name:'get_security_history',
    description:'按带交易所前缀代码读取沪深北股票/ETF历史K线。支持1d及1/5/15/30/60分钟；1分钟仅不复权，窗口受限，必须读取quality、coverage与实际日期。东方财富区间查询发生可重试故障时，同源最多重试一次保留窗口并严格筛选日期；主源不完整或不可用时尝试腾讯完整区间并选较完整的单一来源，不混拼来源/复权批次；腾讯缺少逐根成交额时amount=null且quality=partial。价格人民币元，volume手，amount人民币元。日K timestamp是当地日期零点键，分钟timestamp是K线结束标签；原始时间保留。未完成K线is_final=false、未知null。默认升序每页200条，用next_cursor翻页；refresh=false时分页只读绑定提供方的持久归档/成功缓存，不重新请求上游；数据变化可令cursor过期。include_raw附原始响应。只返回行情，不计算指标和信号。',
    inputSchema:{type:'object',properties:{symbol:{type:'string',pattern:'^(sh|sz|bj)[0-9]{6}$',description:'如sh563360、sz159842、sh600519、sz000001、bj920002'},period:{type:'string',enum:['1m','5m','15m','30m','60m','1d'],default:'1d'},start_date:{type:'string',pattern:'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'},end_date:{type:'string',pattern:'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'},adjust:{type:'string',enum:['none','qfq','hfq'],default:'none',description:'1分钟仅none；其他周期按供应商fqt获取'},refresh:{type:'boolean',default:false},include_raw:{type:'boolean',default:false},limit:{type:'integer',minimum:1,maximum:500,default:200},cursor:{type:'string',description:'上次响应next_cursor，查询口径保持一致'}},required:['symbol','start_date','end_date'],additionalProperties:false},annotations:{readOnlyHint:true},
  },
  {
    name: 'get_market_snapshot',
    description: '获取全球资产最新可得数据：VIX/VXN，美债2/10/30年，黄金现货报价，布伦特近月期货、美股四指数、日经225和韩国KOSPI。含来源、交易日期、时间戳、延迟、前值与日变化。黄金主源为新浪伦敦金现货CFD，涨跌与同源昨结参考价比较；备用Gold API无前值则留空并标记instrument_changed。默认精简返回无历史；degraded为故障时的旧成功数据，不能作为新报价。不可把延迟或日终数据称为实时。',
    inputSchema: {type:'object',properties:{refresh:{type:'boolean',description:'跳过正常缓存，失败仍可返回带degraded标记的最近成功数据'},include_history:{type:'boolean',description:'默认false；历史建议用get_market_history单独请求'},include_raw:{type:'boolean',description:'默认false；可附带黄金原始字段用于对账'}},additionalProperties:false},
    annotations: {readOnlyHint: true},
  },
  {
    name: 'get_market_history',
    description: '获取某指标最近约一个月的可得日线收盘；美债为官方日终收益率。黄金现货当前来源无历史，明确返回不支持；美股报价切换新浪时按需读取独立东方财富/Nasdaq日线，FRED备用，日韩可用东方财富/NAVER独立历史；逐项标注history_metadata的来源、日期、质量，不与报价拼接；能力字段history_supported仅表示支持路径；实际记录看history_available/history_count，历史质量独立看history_quality；刷新结果看history_refresh_status/history_refresh_error，缓存失败不改变记录质量；来源比较以同一响应的quote_source/history_source为准，不能用quote_quality/quality替代。',
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
    schema_version:'1.5', snapshot_contract:{fetched_at:'Compatibility alias of latest_fetched_at; never bundle generation time',oldest_fetched_at:'Oldest successful metric fetch in the bundle',latest_fetched_at:'Latest successful metric fetch in the bundle',generated_at:'Bundle assembly time',retrieved_at:'This response delivery time',coverage:'Mutually exclusive quote quality counts; by_quality is exhaustive; partial/unknown/other are explicit'},catalog, volatility_contract:volatilityContract, history_contract:historyContract, backup_sources:{volatility:'Cboe日线；VIX可用Investing非CFD CBOE指数日线，逐日交叉核验；Cboe收盘观测只作验证，不拼入历史；VXN有FRED VXNCLS备用，发布滞后仍标stale',us_indices:'新浪同一指数报价；历史按需使用独立东方财富/Nasdaq序列，FRED备用',asian_indices:'Yahoo指数；东方财富 / NAVER同一指数备用报价；东方财富/NAVER独立历史',brent:'新浪CFD备用报价，instrument_changed=true；不可拼接相同合约历史'}, security_quotes:securityQueryInfo, security_history:securityHistoryInfo, security_archive:securityArchiveInfo, freshness_policy:calendarPolicy, cache_policy:{normal_ttl_seconds:60,security_ttl_seconds:5,last_success_retention_days:14,storage:'D1 durable + bounded memory',degraded:'上游失败时返回最近成功数据，保留原fetched_at和行情时间；retrieved_at为本次返回时间'},
    gold: {primary:'新浪财经/汇通网伦敦金现货CFD', change_basis:'同源昨结参考价', fallback:'Gold API现货；无同源前值则不计算涨跌', previous_date:'上游未提供，不推测'},
    notes:['quality为quote_quality兼容别名；历史状态必须读取history_quality。','布伦特主源为BZ=F近月连续期货，备用为新浪CFD，二者不是已核实同一合约；美债为官方日终par yield。','全球指标历史沿用近期窗口；证券历史由get_security_history按区间获取；sync_security_history只归档可配置观察列表，不是全市场采集。','缺失/过期项必须在分析中明示，不能补造数值。'],
  };
  if (name === 'get_security_quotes') return getSecurityQuotes(args.symbols, args.refresh === true, args.include_raw === true);
  if (name === 'configure_security_archive') return configureSecurityArchive(args);
  if (name === 'sync_security_history') return syncSecurityHistory(args);
  if (name === 'get_security_archive_status') return getSecurityArchiveStatus(args);
  if (name === 'get_security_history') return getSecurityHistory(args);
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
  else if (method === 'initialize') result = {protocolVersion:params?.protocolVersion || '2026-07-28', serverInfo:{name:'asset-observatory', version:'1.6.4'}, capabilities:{tools:{}}};
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
