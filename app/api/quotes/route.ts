import {getSecurityQuotes} from '@/lib/tencent';
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  try {
    const symbols = (params.get('symbols') ?? '').split(',');
    return Response.json(await getSecurityQuotes(symbols, params.get('refresh') === '1'), {headers: {'Cache-Control':'no-store'}});
  } catch (error) {
    return Response.json({error: String(error)}, {status: 400, headers: {'Cache-Control':'no-store'}});
  }
}
