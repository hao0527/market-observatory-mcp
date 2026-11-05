import {snapshot} from '@/lib/market';
export async function GET(request:Request){const p=new URL(request.url).searchParams;return Response.json(await snapshot({refresh:p.get('refresh')==='1',include_history:p.get('include_history')==='1',include_raw:p.get('include_raw')==='1'}),{headers:{'Cache-Control':'no-store'}})}
