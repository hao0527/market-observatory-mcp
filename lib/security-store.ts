import {AsyncLocalStorage} from 'node:async_hooks';
import type {SecurityBar,SecurityPeriod} from './security-history';
import type {DataIssue} from './upstream';

export interface ArchiveSettings {enabled:boolean;symbols:string[];periods:SecurityPeriod[];adjust:'none';timezone:'Asia/Shanghai';updated_at?:string}
export interface ArchiveFetch {
 id:string;symbol:string;period:string;adjust:string;source:string;source_url:string;
 start_date:string;end_date:string;fetched_at:string;name:string|null;bars:SecurityBar[];
 raw:unknown;attempts:unknown;rejected:number;rejection_reasons:Record<string,number>;error:DataIssue|null;
}
export interface ArchiveTask {key:string;symbol:string;period:SecurityPeriod;date:string;status:string;attempts:number;next_retry_at:string|null;[key:string]:unknown}
export interface ArchiveJob {id:string;status:string;created_at:string;updated_at:string;request:Record<string,unknown>;[key:string]:unknown}
export interface SecurityArchiveStore {
 readBars(symbol:string,period:string,source:string,start:string,end:string):Promise<{bars:SecurityBar[];name:string|null}>;
 saveFetch(fetch:ArchiveFetch):Promise<number>;
 legacy(symbol:string,period:string,source:string):Promise<any[]>;
 settings():Promise<ArchiveSettings|null>;saveSettings(settings:ArchiveSettings):Promise<void>;
 createJob(job:ArchiveJob,tasks:ArchiveTask[]):Promise<void>;
 job(id:string):Promise<ArchiveJob|null>;recentJobs():Promise<ArchiveJob[]>;
 tasks(id:string):Promise<ArchiveTask[]>;saveTask(id:string,task:ArchiveTask):Promise<void>;
 claim(id:string,now:string,until:string):Promise<boolean>;finish(job:ArchiveJob):Promise<void>;
 audit(id:string):Promise<unknown>;stats():Promise<unknown>;
}
const context=new AsyncLocalStorage<SecurityArchiveStore|null>();
export function runWithSecurityArchive<T>(store:SecurityArchiveStore|null,fn:()=>T){return context.run(store,fn)}
export function securityArchiveStore(){return context.getStore()??null}
export async function archiveId(value:unknown){const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)));return [...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,'0')).join('')}
/** Pick a whole bar, never mix price fields or suppliers. Corrections remain in raw fetch evidence. */
export function preferSecurityBar(a:SecurityBar,b:SecurityBar){
 if(a.source!==b.source)throw Error('Cross-provider archive merge forbidden');
 const score=(v:SecurityBar)=>(v.is_final===true?100:0)+(v.amount!==null?10:0)+[v.amplitude,v.change_percent,v.change,v.turnover_rate].filter(x=>x!==null).length;
 return score(b)>score(a)||score(b)===score(a)&&b.fetched_at>a.fetched_at?b:a;
}
