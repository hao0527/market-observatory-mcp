export type DataIssue = {code:string; message:string; retryable:boolean; source?:string; source_url?:string; http_status?:number;retry_after_seconds?:number;causes?:DataIssue[]};
export class DataError extends Error {
  constructor(public issue:DataIssue){super(issue.message);this.name='DataError'}
}
export function dataIssue(error:unknown, sourceUrl?:string):DataIssue {
  if(error instanceof DataError)return error.issue;
  const e=error as Error;
  const timeout=e?.name==='TimeoutError'||e?.name==='AbortError';
  return {code:timeout?'UPSTREAM_TIMEOUT':'INVALID_RESPONSE',message:e?.message||String(error),retryable:timeout,...(sourceUrl?{source_url:sourceUrl}:{})};
}
export async function fetchText(url:string, options:{headers?:Record<string,string>;encoding?:string;timeoutMs?:number;attempts?:number}={}) {
  const attempts=Math.min(2,Math.max(1,options.attempts??2));
  let last:DataIssue|undefined;
  for(let attempt=1;attempt<=attempts;attempt++){
    try {
      const r=await fetch(url,{headers:options.headers,signal:AbortSignal.timeout(options.timeoutMs??4500)});
      if(!r.ok){
        const retryable=r.status===429||r.status>=500;
        // Avoid leaving an unused stream open before the next attempt.
        const retryAfter=r.headers.get('Retry-After');const seconds=retryAfter?Number(retryAfter):NaN;
        await r.body?.cancel();
        throw new DataError({code:'UPSTREAM_HTTP',message:`上游 HTTP ${r.status}`,retryable,http_status:r.status,source_url:url,...(Number.isFinite(seconds)?{retry_after_seconds:seconds}:{})});
      }
      return {text:new TextDecoder(options.encoding??'utf-8').decode(await r.arrayBuffer()),attempts:attempt,url};
    }catch(error){
      if(error instanceof DataError)last=error.issue;
      else {const e=error as Error;last={code:e?.name==='TimeoutError'||e?.name==='AbortError'?'UPSTREAM_TIMEOUT':'UPSTREAM_NETWORK',message:e?.message||String(error),retryable:true,source_url:url};}
      if(last.http_status===429||!last.retryable||attempt===attempts)throw new DataError(last);
      await new Promise(resolve=>setTimeout(resolve,120));
    }
  }
  throw new DataError(last!);
}
export async function fetchJson(url:string,options:Parameters<typeof fetchText>[1]={}) {
  const r=await fetchText(url,options);
  try{return {data:JSON.parse(r.text),attempts:r.attempts,url,text:r.text}}catch{throw new DataError({code:'INVALID_RESPONSE',message:'上游未返回有效JSON',retryable:false,source_url:url})}
}
