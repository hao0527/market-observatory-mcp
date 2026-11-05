/** Scheduled calendars; emergency closures are intentionally not inferred. */
export const calendarPolicy={
  checked_on:'2026-11-05',
  equities:{years:[2026,2027,2028],source:'https://www.nyse.com/trade/hours-calendars'},
  treasury:{years:[2026],source:'https://www.sifma.org/resources/general/holiday-schedule',publication_check:'18:30 America/New_York (conservative application threshold, not an official release SLA)'},
  japan:{years:[2026,2027],timezone:'Asia/Tokyo',sessions:['09:00-11:30','12:30-15:30'],source:'https://www.jpx.co.jp/english/corporate/about-jpx/calendar/'},
  korea:{years:[],timezone:'Asia/Seoul',regular_hours:'09:00-15:30',calendar_verified:false,source:'https://global.krx.co.kr/contents/GLB/06/0602/0602010201/GLB0602010201T1.jsp',note:'未完整核实年度休市及特别开市时刻；仅确认同日报价年龄，不以工作日推定开市'},
  limitations:['不推测临时休市；日历覆盖之外返回unknown。','美债18:30检查线为应用保守阈值，非官方发布时间承诺。','黄金与布油仅按周末及报价年龄提示，未验证交易商/ICE节假日日历。','沪深北优先采用腾讯marketStat；个股停牌不可从市场状态推定。'],
};
const equityHolidays:Record<string,string[]>={
 '2026':['01-01','01-19','02-16','04-03','05-25','06-19','07-03','09-07','11-26','12-25'],
 '2027':['01-01','01-18','02-15','03-26','05-31','06-18','07-05','09-06','11-25','12-24'],
 '2028':['01-17','02-21','04-14','05-29','06-19','07-04','09-04','11-23','12-25'],
};
const treasuryHolidays:Record<string,string[]>={'2026':['01-01','01-19','02-16','05-25','06-19','07-03','09-07','10-12','11-11','11-26','12-25']};
const earlyCloses=new Set(['2026-11-27','2026-12-24','2027-11-26','2028-07-03','2028-11-24']);
const japanHolidays:Record<string,string[]>={
 '2026':['01-01','01-02','01-03','01-12','02-11','02-23','03-20','04-29','05-03','05-04','05-05','05-06','07-20','08-11','09-21','09-22','09-23','10-12','11-03','11-23','12-31'],
 '2027':['01-01','01-02','01-03','01-11','02-11','02-23','03-21','03-22','04-29','05-03','05-04','05-05','07-19','08-11','09-20','09-23','10-11','11-03','11-23','12-31'],
};
function local(ms:number,tz:string){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(ms));const p=Object.fromEntries(parts.map(v=>[v.type,v.value]));return {date:`${p.year}-${p.month}-${p.day}`,minute:Number(p.hour)*60+Number(p.minute)}}
function previousDate(date:string){return new Date(Date.parse(date+'T12:00:00Z')-86400000).toISOString().slice(0,10)}
function trading(date:string,holidays:Record<string,string[]>):boolean|null{const days=holidays[date.slice(0,4)];if(!days)return null;const dow=new Date(date+'T12:00:00Z').getUTCDay();return dow!==0&&dow!==6&&!days.includes(date.slice(5))}
function priorSession(date:string,holidays:Record<string,string[]>):string|null {let d=previousDate(date);for(let i=0;i<12;i++,d=previousDate(d)){const open=trading(d,holidays);if(open===null)return null;if(open)return d}return null}
export function freshness(q:any,kind:'equity'|'asian_equity'|'treasury'|'commodity'|'security',now=Date.now()) {
 const asOf=q.as_of?Date.parse(q.as_of):null;
 const age=asOf!==null&&Number.isFinite(asOf)?Math.round((now-asOf)/1000):null;
 if(asOf!==null&&(!Number.isFinite(asOf)||age! < -120))return {status:'invalid_time',expected_date:null,reason:'行情时间无效或明显在未来',stale:false,age_seconds:age};
 if(kind==='asian_equity'){
   const tz=q.market_timezone||q.source_timezone,here=local(now,tz),day=q.market_date;
   if(typeof day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(day)||day>here.date)return {status:'invalid_time',expected_date:null,reason:'日韩指数交易日期无效或在未来',stale:false,age_seconds:age};
   if(tz==='Asia/Seoul'){
     const sameDay=day===here.date,old=sameDay&&age!==null&&here.minute>=540&&here.minute<930&&age>1200;
     return {status:old?'suspect_stale':sameDay&&age!==null&&age<=1200?'recent_quote':'unknown',expected_date:null,market_timezone:tz,calendar_verified:false,reason:old?'韩国同日报价超过20分钟；需核对特别交易时段':sameDay&&age!==null&&age<=1200?'已取得同日近期报价；韩国年度休市及特别时段未完整核实':'韩国完整日历未核实，不推定休市、开市或上一交易日',stale:old,age_seconds:age};
   }
   if(tz!=='Asia/Tokyo')return {status:'unknown',expected_date:null,reason:'未支持的日韩市场时区',stale:false,age_seconds:age};
   if(q.data_type==='provider_daily_index_bar'){
     const open=trading(here.date,japanHolidays),expected=open&&here.minute>=945?here.date:priorSession(here.date,japanHolidays);
     if(open===null||!expected)return {status:'unknown',expected_date:null,reason:'日本日线超出已核实日历',stale:false,age_seconds:age};
     const old=day<expected;return {status:old?'stale':day===here.date&&here.minute<945?'forming_daily_bar':'latest_session',expected_date:expected,reason:old?'历史日线早于应有交易日':'日线仅提供日期；当日K线可能未完成',stale:old,age_seconds:age};
   }
   const open=trading(here.date,japanHolidays);if(open===null)return {status:'unknown',expected_date:null,reason:'日本年份超出已核实日历',stale:false,age_seconds:age};
   const session=open&&((here.minute>=540&&here.minute<690)||(here.minute>=750&&here.minute<945));
   const lunch=open&&here.minute>=690&&here.minute<750;
   const expected=open&&here.minute>=540?here.date:priorSession(here.date,japanHolidays);
   if(!expected)return {status:'unknown',expected_date:null,reason:'日本前一交易日超出已核实日历',stale:false,age_seconds:age};
   if(open&&here.minute>=540&&here.minute<555&&day<here.date)return {status:'awaiting_update',expected_date:expected,reason:'日本开盘15分钟宽限期',stale:false,age_seconds:age};
   let old=day<expected;
   if(session&&age!==null&&age>1200&&here.minute>=555&&!(here.minute>=750&&here.minute<765))old=true;
   if(asOf!==null&&day===expected&&(!open||here.minute>=945||here.minute<540||lunch)){
     const quote=local(asOf,tz),cutoff=lunch?670:910;if(quote.date===expected&&quote.minute<cutoff)old=true;
   }
   return {status:old?'stale':lunch?'lunch_break':session?'current':'latest_session',expected_date:expected,market_timezone:tz,calendar_verified:true,reason:old?'日本报价早于应有交易日或时段阈值':lunch?'日本午间休市，保留上午最后报价':'按JPX现金市场日历、午休及时段判断；不推定临时休市',stale:old,age_seconds:age};
 }
 if(kind==='security'){
   const market=q.market_status;const recent=market?.as_of&&Math.abs(now-Date.parse(market.as_of))<300000;
   const state=recent?market.state:'unknown';
   if(age===null)return {status:'unknown',expected_date:null,reason:'缺少报价时间',stale:false,age_seconds:null};
   const old=age>96*3600||(state==='trading'&&age>300);
   return {status:old?'stale':state==='trading'?'current':state==='unknown'?'unknown':'latest_session',expected_date:null,reason:old?'交易中报价超过5分钟或已超过96小时':state==='unknown'?'市场状态未知，不能确认时效':'依据供应商市场状态；不代表个股未停牌',stale:old,age_seconds:Math.max(0,age)};
 }
 if(kind==='commodity'){
   if(age===null)return {status:'unknown',expected_date:null,reason:'缺少报价时间',stale:false,age_seconds:null};
   const ny=local(now,'America/New_York');const dow=new Date(ny.date+'T12:00:00Z').getUTCDay();
   const weekend=(dow===5&&ny.minute>=17*60)||dow===6||(dow===0&&ny.minute<18*60);
   const threshold=weekend?96*3600:30*60;
   const old=age>threshold;
   return {status:old?'suspect_stale':weekend?'latest_session':'recent_quote',expected_date:null,reason:old?'报价较旧，需核对供应商休市/每日维护':weekend?'周末沿用最近报价；未验证节假日日历':'仅确认报价年龄，不推定交易所实时授权',stale:old,age_seconds:Math.max(0,age)};
 }
 const ny=local(now,'America/New_York');const holidays=kind==='equity'?equityHolidays:treasuryHolidays;
 const isOpenDay=trading(ny.date,holidays);
 if(isOpenDay===null)return {status:'unknown',expected_date:null,reason:'当前年份超出已核实日历范围',stale:false,age_seconds:age};
 const close=earlyCloses.has(ny.date)?13*60:16*60;
 const dailyIndex=['official_daily_index_close','provider_daily_index_close'].includes(q.data_type);
 const inSession=kind==='equity'&&!dailyIndex&&isOpenDay&&ny.minute>=570&&ny.minute<close+15;
 const due=kind==='treasury'||dailyIndex?isOpenDay&&ny.minute>=18*60+30:isOpenDay&&ny.minute>=close+15;
 const expected=(inSession||due)?ny.date:priorSession(ny.date,holidays);
 if(!expected)return {status:'unknown',expected_date:null,reason:'前一交易日超出已核实日历范围',stale:false,age_seconds:age};
 const day=q.market_date;
 if(typeof day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(day)||day>ny.date)return {status:'invalid_time',expected_date:expected,reason:'数据日期无效或在未来',stale:false,age_seconds:age};
 if(inSession&&ny.minute<585&&day<ny.date)return {status:'awaiting_update',expected_date:ny.date,reason:'开盘15分钟宽限期',stale:false,age_seconds:age};
 let old=day<expected;
 if(inSession&&age!==null&&age>20*60)old=true;
 if(kind==='equity'&&!inSession&&day===expected&&asOf!==null){const quoteLocal=local(asOf,'America/New_York');const expectedClose=earlyCloses.has(expected)?13*60:16*60;if(quoteLocal.date===expected&&quoteLocal.minute<expectedClose-20)old=true;}
 return {status:old?'stale':inSession?'current':(kind==='treasury'||dailyIndex)&&!due&&isOpenDay&&day<ny.date?'awaiting_publication':'latest_session',expected_date:expected,reason:old?'数据早于应有交易日或盘中延迟超阈值':kind==='treasury'?'日终发布口径；18:30为应用检查阈值':'按已核实美股日历及提前收盘判断',stale:old,age_seconds:age===null?null:Math.max(0,age)};
}
export function qualifyQuote(q:any,kind:Parameters<typeof freshness>[1]){
 const f=freshness(q,kind);const invalid=f.status==='invalid_time'||!Number.isFinite(q.value);
 return {...q,freshness:f,stale:f.stale,quality:q.degraded?'degraded':invalid||q.quality==='partial'?'partial':f.stale?'stale':'available',...(q.degraded?{stale_note:'上游失败，返回最近成功数据；原报价时间未变'}:f.stale?{stale_note:f.reason}:{})};
}

/** History dates describe sessions, independently of the current quote's age. */
export function historyTradingDay(date:string,timezone:string|null,kind:string):boolean|null{
 if(kind==='commodity')return null;
 const dow=new Date(date+'T12:00:00Z').getUTCDay();
 if(timezone==='Asia/Seoul')return dow===0||dow===6?false:null;
 if(timezone==='Asia/Tokyo')return trading(date,japanHolidays);
 if(timezone==='America/New_York')return trading(date,kind==='treasury'?treasuryHolidays:equityHolidays);
 return null;
}
export function historySession(q:any,kind:string,now=Date.now()){
 const timezone=q.market_timezone??null;
 const unknown=(reason:string,extra:any={})=>({market_timezone:timezone,latest_session_date:null,expected_last_completed_date:null,calendar_verified:false,calendar_scope:'scheduled_only',emergency_closures_verified:false,session_status:'unknown',close_minute:null,reason,...extra});
 if(kind==='commodity')return unknown('商品合约的交易及结算日历未核实');
 if(!timezone||!['America/New_York','Asia/Tokyo','Asia/Seoul'].includes(timezone))return unknown('没有已核实的该品种交易日历');
 const here=local(now,timezone);
 const status=q.market_status;
 const observed=Date.parse(status?.observed_at??status?.as_of??'');
 const recent=Number.isFinite(observed)&&now-observed>=-120000&&now-observed<=300000;
 const state=recent?String(status.state).toUpperCase():'';
 if(['SUSPENDED','HALTED','EMERGENCY_CLOSED'].includes(state))return unknown('供应商报告暂停或临时休市，无法推定完整收盘日',{session_status:'suspended'});
 if(timezone==='Asia/Seoul'){
  // No invented Korean annual calendar, year-opening or exam-day hours.
  const p=q.provider_session,start=p?.start*1000,end=p?.end*1000;
  const verifiedPeriod=Number.isFinite(start)&&Number.isFinite(end)&&end>start&&local(start,timezone).date===here.date&&local(end,timezone).date===here.date&&q.quote_market_date===here.date;
  if(verifiedPeriod&&now>=start)return unknown('韩国年度日历未核实；本日时段采用供应商明确的时间边界',{latest_session_date:here.date,expected_last_completed_date:now>=end?here.date:q.quote_previous_date??null,session_status:now<end?'provider_open':'provider_closed',close_minute:local(end,timezone).minute,session_date:here.date,expectation_basis:'provider_session'});
  if(state==='OPEN'&&q.quote_market_date===here.date)return unknown('供应商确认韩国当日开市；完整前一交易日与特殊收盘时刻未知',{latest_session_date:here.date,session_status:'provider_open',session_date:here.date,expectation_basis:'provider_market_status'});
  return unknown('韩国年度休市及特别时段未完整核实，无法推定完整交易日',{session_status:state==='CLOSE'||state==='CLOSED'?'provider_closed':'unknown'});
 }
 const holidays=timezone==='Asia/Tokyo'?japanHolidays:kind==='treasury'?treasuryHolidays:equityHolidays;
 const open=trading(here.date,holidays),prior=priorSession(here.date,holidays);
 if(open===null||!prior)return unknown('日期超出已核实日历范围');
 const start=timezone==='Asia/Tokyo'?540:570;
 const close=timezone==='Asia/Tokyo'?930:kind==='treasury'?1110:earlyCloses.has(here.date)?780:960;
 const lunch=timezone==='Asia/Tokyo'&&open&&here.minute>=690&&here.minute<750;
 const scheduledOpen=open&&here.minute>=start&&here.minute<close&&!lunch;
 if(scheduledOpen&&(state==='CLOSE'||state==='CLOSED'))return unknown('供应商状态与常规开市时段冲突，可能临时休市或特别安排');
 return {market_timezone:timezone,latest_session_date:open&&here.minute>=start?here.date:prior,expected_last_completed_date:open&&here.minute>=close?here.date:prior,calendar_verified:true,calendar_scope:'scheduled_only',emergency_closures_verified:false,session_date:here.date,session_status:!open?'scheduled_closed':here.minute<start?'preopen':lunch?'lunch_break':here.minute<close?'scheduled_open':'scheduled_closed',close_minute:close,reason:kind==='treasury'?'按已核实美债日历及18:30应用发布检查线':'完整日线按市场当地收盘时刻判断；午休不结束当日日线'};
}
export function historyFreshness(q:any,kind:string,now=Date.now()){
 const session=historySession(q,kind,now),day=q.market_date;
 const base={...session,expected_date:session.expected_last_completed_date,expected_date_semantics:'alias_of_expected_last_completed_date',bar_status:'unknown',stale:false,status:'unknown'};
 if(!day)return {...base,bar_status:'none',reason:'本次没有有效历史记录'};
 const expected=session.expected_last_completed_date,latest=session.latest_session_date;
 const knownDay=historyTradingDay(day,session.market_timezone,kind);
 if(knownDay===false)return {...base,reason:'历史最新日期不是已核实的交易日'};
 if(expected&&day<expected)return {...base,status:'stale',bar_status:'completed',stale:true,reason:'历史日期落后于应有完整收盘日'};
 if(!session.market_timezone)return base;
 const here=local(now,session.market_timezone);
 if(day>here.date)return {...base,status:'invalid_time',reason:'历史日期在未来'};
 if(kind==='treasury'&&q.data_type==='official_daily_par_yield'&&day===here.date)return {...base,status:'latest_completed_session',bar_status:'completed',reason:'官方当日日终收益率已公布；18:30仅为保守应用检查线，不把已公布值标为形成中的K线'};
 if(latest&&day===latest&&(!expected||day>expected))return {...base,status:'forming_daily_bar',bar_status:'forming',reason:'当前交易日尚未取得完整收盘K线；午休仍为当日日线'};
 if(expected&&day===expected){
  const fetched=Date.parse(q.fetched_at??'');
  const sampled=Number.isFinite(fetched)?local(fetched,session.market_timezone):null;
  const observed=Date.parse(q.bar_observed_at??'');const observedLocal=Number.isFinite(observed)?local(observed,session.market_timezone):null;
  const incomplete=q.data_type!=='official_daily_par_yield'&&session.close_minute!==null&&((sampled!==null&&sampled.date===day&&sampled.minute<session.close_minute)||(observedLocal!==null&&observedLocal.date===day&&observedLocal.minute<session.close_minute));
  if(incomplete)return {...base,status:'stale',bar_status:'forming',stale:true,reason:'缓存中的当日K线采集于收盘前，尚未取得完整收盘K线'};
  return {...base,status:'latest_completed_session',bar_status:'completed',reason:'历史日期符合应有完整收盘日'};
 }
 return {...base,reason:session.reason};
}
