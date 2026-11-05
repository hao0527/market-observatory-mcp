import {marketHistory} from '@/lib/market';
import {dataIssue} from '@/lib/upstream';
export async function GET(req:Request){const p=new URL(req.url).searchParams;try{return Response.json(await marketHistory(p.get('id')||'',p.get('refresh')==='1'),{headers:{'Cache-Control':'no-store'}})}catch(e){const issue=dataIssue(e);return Response.json({error:issue.message,issue},{status:issue.code==='INVALID_ARGUMENT'||issue.code==='UNSUPPORTED_HISTORY'?400:502,headers:{'Cache-Control':'no-store'}})}}
