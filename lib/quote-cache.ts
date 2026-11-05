import {AsyncLocalStorage} from 'node:async_hooks';
import {dataIssue,DataError} from './upstream';
export type SavedQuote={key:string;payload:any;data_time:string;fetched_at:string;expires_at:string};
export interface QuoteCacheBackend{read(key:string):Promise<SavedQuote|null>;write(record:SavedQuote):Promise<void>}
const context=new AsyncLocalStorage<QuoteCacheBackend|null>();
export function runWithQuoteCache<T>(backend:QuoteCacheBackend|null,fn:()=>T){return context.run(backend,fn)}
const memory=new Map<string,SavedQuote>();
const pending=new Map<string,Promise<any>>();
const retention=14*86400000;
export function clearQuoteMemory(){memory.clear();pending.clear()}
function newer(a:SavedQuote|null,b:SavedQuote|null){if(!a)return b;if(!b)return a;return a.data_time>b.data_time?a:a.data_time<b.data_time?b:a.fetched_at>=b.fetched_at?a:b}
function remember(record:SavedQuote){const previous=memory.get(record.key);if(previous&&newer(previous,record)===previous)return;
  if(record.key.startsWith('security-history-v1:')&&!memory.has(record.key)){const keys=[...memory.keys()].filter(k=>k.startsWith('security-history-v1:'));if(keys.length>=16)memory.delete(keys[0]);}
  if(memory.size>=1024)memory.delete(memory.keys().next().value!);memory.set(record.key,record)}
function validSaved(record:SavedQuote|null){return record&&Date.parse(record.expires_at)>Date.now()?record:null}
function presented(record:SavedQuote,delivery:string,degraded=false,error?:unknown){return {...record.payload,delivery,degraded,cache_backend:context.getStore()?'durable':'memory',last_success_at:record.fetched_at,retrieved_at:new Date().toISOString(),...(error?{upstream_error:dataIssue(error)}:{})}}
export async function loadQuote(key:string,loader:()=>Promise<any>,options:{refresh?:boolean;ttlMs?:number;acceptReplacement?:(previous:any,next:any)=>boolean}={}) {
  const backend=context.getStore();
  const existing=validSaved(memory.get(key)??null);
  if(!options.refresh&&existing&&Date.now()-Date.parse(existing.fetched_at)<(options.ttlMs??60000))return presented(existing,'memory_cache');
  if(pending.has(key))return pending.get(key)!;
  const work=(async()=>{
    let durable:SavedQuote|null=null;let storageIssue:string|undefined;
    if(backend){try{durable=validSaved(await backend.read(key))}catch{storageIssue='持久缓存读取失败'}}
    const last=newer(existing,durable);
    if(!options.refresh&&last&&Date.now()-Date.parse(last.fetched_at)<(options.ttlMs??60000)){remember(last);return {...presented(last,durable===last?'durable_cache':'memory_cache'),...(storageIssue?{cache_warning:storageIssue}:{})}}
    try{
      const payload=await loader();
      if(last&&options.acceptReplacement&&!options.acceptReplacement(last.payload,payload))throw new DataError({code:'INCOMPLETE_HISTORY_REFRESH',message:'本次历史刷新比缓存缺少已取得的记录，保留更完整缓存',retryable:true,source:payload.source,source_url:payload.source_url});
      if(!Number.isFinite(payload.value)||payload.value<=0)throw new DataError({code:'INVALID_RESPONSE',message:'上游缺少有效最新值',retryable:false});
      const record:SavedQuote={key,payload,data_time:payload.as_of||payload.market_date||payload.fetched_at,fetched_at:payload.fetched_at||new Date().toISOString(),expires_at:new Date(Date.now()+retention).toISOString()};
      // Invalid/future timestamps must not replace the most recent good record.
      const time=payload.as_of?Date.parse(payload.as_of):Date.parse((payload.market_date??'')+'T00:00:00Z');
      if(!Number.isFinite(time)||time>Date.now()+300000)return {...payload,delivery:'upstream',degraded:false,retrieved_at:new Date().toISOString(),cache_warning:'时间戳无效，未保存为成功数据'};
      remember(record);
      if(backend){try{await backend.write(record)}catch{storageIssue='持久缓存保存失败，当前数据仍可用'}}
      return {...presented(record,'upstream'),...(storageIssue?{cache_warning:storageIssue}:{})};
    }catch(error){
      const issue=dataIssue(error);
      if(last&&issue.code!=='NO_QUOTE'&&issue.code!=='INVALID_ARGUMENT')return {...presented(last,durable===last?'durable_cache':'memory_cache',true,error),...(storageIssue?{cache_warning:storageIssue}:{})};
      throw error;
    }
  })();
  pending.set(key,work);try{return await work}finally{pending.delete(key)}
}
