import {configureSecurityArchive,syncSecurityHistory,getSecurityArchiveStatus} from '@/lib/security-archive';
import {dataIssue,DataError} from '@/lib/upstream';

// Shared market-data updater on the confirmed owner-private Site. Sites dispatch
// authenticates visitors/service access. /mcp separately requires resource.invoke OAuth.
// This API uses the identical archive operations, without impersonating a visitor.
const errorResponse=(error:unknown)=>{const issue=dataIssue(error);return Response.json({issue},{status:issue.code==='INVALID_ARGUMENT'?400:503,headers:{'Cache-Control':'no-store'}})};
export async function GET(req:Request){try{return Response.json(await getSecurityArchiveStatus(Object.fromEntries(new URL(req.url).searchParams)),{headers:{'Cache-Control':'no-store'}})}catch(e){return errorResponse(e)}}
export async function POST(req:Request){
 try{
  let body:any;try{body=await req.json()}catch{throw new DataError({code:'INVALID_ARGUMENT',message:'请求须为有效JSON',retryable:false})}
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['operation','arguments'].includes(k))||!['sync','configure'].includes(body.operation))throw new DataError({code:'INVALID_ARGUMENT',message:'operation仅支持sync/configure，参数置于arguments',retryable:false});
  const result=body.operation==='sync'?await syncSecurityHistory(body.arguments??{}):await configureSecurityArchive(body.arguments??{});
  return Response.json(result,{headers:{'Cache-Control':'no-store'}});
 }catch(e){return errorResponse(e)}
}
