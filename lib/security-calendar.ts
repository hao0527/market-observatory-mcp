/** Cash equities/ETFs, scheduled mainland sessions only. No inferred emergency closures. */
export const securityCalendarPolicy={
 timezone:'Asia/Shanghai',years:[2026],sessions:['09:30-11:30','13:00-15:00'],
 sources:{sh:'https://www.sse.com.cn/disclosure/announcement/general/c/c_20251222_10802507.shtml',sz:'https://www.szse.cn/disclosure/notice/general/t20251222_618087.html',bj:'https://www.bse.cn/important_news/200027428.html'},
 calendar_scope:'scheduled_only',emergency_closures_verified:false,
};
const closures=[['01-01','01-03'],['02-15','02-23'],['04-04','04-06'],['05-01','05-05'],['06-19','06-21'],['09-25','09-27'],['10-01','10-07']];
export function chinaDate(ms=Date.now()){return new Date(ms+8*3600000).toISOString().slice(0,10)}
export function shiftDate(date:string,days:number){return new Date(Date.parse(date+'T12:00:00Z')+days*86400000).toISOString().slice(0,10)}
export function validDate(s:unknown):s is string{return typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s}
export function securityTradingDay(date:string):boolean|null{
 const weekday=new Date(date+'T12:00:00Z').getUTCDay();if(weekday===0||weekday===6)return false;
 if(!date.startsWith('2026-'))return null;
 return !closures.some(([start,end])=>date.slice(5)>=start&&date.slice(5)<=end);
}
export function minuteEnds(period:number){const result:number[]=[];for(const start of [570,780])for(let end=start+period;end<=start+120;end+=period)result.push(end);return result}
export function sourceTime(raw:string,daily:boolean){
 const pattern=daily?/^\d{4}-\d{2}-\d{2}$/:/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?$/;
 if(!pattern.test(raw)||!validDate(raw.slice(0,10)))return null;
 const iso=daily?raw+'T00:00:00+08:00':raw.replace(' ','T')+(raw.length===16?':00':'')+'+08:00';const ms=Date.parse(iso);
 if(!Number.isFinite(ms)||new Date(ms+8*3600000).toISOString().slice(0,19)!==iso.slice(0,19))return null;
 return ms;
}
export function barEnd(date:string,minute:number){return Date.parse(`${date}T${String(Math.floor(minute/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}:00+08:00`)}
