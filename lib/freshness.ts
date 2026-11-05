/** Scheduled calendars; emergency closures are intentionally not inferred. */
export const calendarPolicy={
  checked_on:'2026-11-05',
  equities:{years:[2026,2027,2028],source:'https://www.nyse.com/trade/hours-calendars'},
  treasury:{years:[2026],source:'https://www.sifma.org/resources/general/holiday-schedule',publication_check:'18:30 America/New_York (conservative application threshold, not an official release SLA)'},
  limitations:['不推测临时休市；日历覆盖之外返回unknown。','美债18:30检查线为应用保守阈值，非官方发布时间承诺。','黄金与布油仅按周末及报价年龄提示，未验证交易商/ICE节假日日历。','沪深北优先采用腾讯marketStat；个股停牌不可从市场状态推定。'],
};
const equityHolidays:Record<string,string[]>={
 '2026':['01-01','01-19','02-16','04-03','05-25','06-19','07-03','09-07','11-26','12-25'],
 '2027':['01-01','01-18','02-15','03-26','05-31','06-18','07-05','09-06','11-25','12-24'],
 '2028':['01-17','02-21','04-14','05-29','06-19','07-04','09-04','11-23','12-25'],
};
const treasuryHolidays:Record<string,string[]>={'2026':['01-01','01-19','02-16','05-25','06-19','07-03','09-07','10-12','11-11','11-26','12-25']};
const earlyCloses=new Set(['2026-11-27','2026-12-24','2027-11-26','2028-07-03','2028-11-24']);
function local(ms:number,tz:string){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(ms));const p=Object.fromEntries(parts.map(v=>[v.type,v.value]));return {date:`${p.year}-${p.month}-${p.day}`,minute:Number(p.hour)*60+Number(p.minute)}}
function previousDate(date:string){return new Date(Date.parse(date+'T12:00:00Z')-86400000).toISOString().slice(0,10)}
function trading(date:string,holidays:Record<string,string[]>):boolean|null{const days=holidays[date.slice(0,4)];if(!days)return null;const dow=new Date(date+'T12:00:00Z').getUTCDay();return dow!==0&&dow!==6&&!days.includes(date.slice(5))}
function priorSession(date:string,holidays:Record<string,string[]>):string|null {let d=previousDate(date);for(let i=0;i<12;i++,d=previousDate(d)){const open=trading(d,holidays);if(open===null)return null;if(open)return d}return null}
export function freshness(q:any,kind:'equity'|'treasury'|'commodity'|'security',now=Date.now()) {
 const asOf=q.as_of?Date.parse(q.as_of):null;
 const age=asOf!==null&&Number.isFinite(asOf)?Math.round((now-asOf)/1000):null;
 if(asOf!==null&&(!Number.isFinite(asOf)||age! < -120))return {status:'invalid_time',expected_date:null,reason:'行情时间无效或明显在未来',stale:false,age_seconds:age};
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
 const dailyIndex=q.data_type==='official_daily_index_close';
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
