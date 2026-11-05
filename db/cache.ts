import type {QuoteCacheBackend,SavedQuote} from '../lib/quote-cache';
let lastCleanup=0;
export function createQuoteCache(db?:D1Database):QuoteCacheBackend|null {
  if(!db)return null;
  return {
    async read(key){
      const row=await db.prepare('SELECT cache_key,payload,data_time,fetched_at,expires_at FROM market_last_success WHERE cache_key = ? AND expires_at > ?').bind(key,new Date().toISOString()).first<{cache_key:string;payload:string;data_time:string;fetched_at:string;expires_at:string}>();
      if(!row)return null;
      return {key:row.cache_key,payload:JSON.parse(row.payload),data_time:row.data_time,fetched_at:row.fetched_at,expires_at:row.expires_at};
    },
    async write(record:SavedQuote){
      await db.prepare('INSERT INTO market_last_success (cache_key,payload,data_time,fetched_at,expires_at) VALUES (?,?,?,?,?) ON CONFLICT(cache_key) DO UPDATE SET payload=excluded.payload,data_time=excluded.data_time,fetched_at=excluded.fetched_at,expires_at=excluded.expires_at WHERE excluded.data_time > market_last_success.data_time OR (excluded.data_time = market_last_success.data_time AND excluded.fetched_at >= market_last_success.fetched_at)').bind(record.key,JSON.stringify(record.payload),record.data_time,record.fetched_at,record.expires_at).run();
      if(Date.now()-lastCleanup>3600000){lastCleanup=Date.now();await db.prepare('DELETE FROM market_last_success WHERE cache_key IN (SELECT cache_key FROM market_last_success WHERE expires_at < ? LIMIT 100)').bind(new Date().toISOString()).run()}
    },
  };
}
