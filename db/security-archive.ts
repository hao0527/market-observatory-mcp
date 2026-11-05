import type {SecurityArchiveStore,ArchiveFetch,ArchiveSettings,ArchiveJob,ArchiveTask} from '../lib/security-store';
import type {SecurityBar} from '../lib/security-history';

// One bound JSON parameter per bulk insert, below D1's 100-parameter / 2 MB value limits.
// Only final, unadjusted bars enter the stable archive; all adjustment vintages stay in raw fetches.
export const archiveBarUpsert=`INSERT INTO security_history_bars
 (symbol,period,adjust,source,timestamp,session_date,payload,fetched_at,field_rank,fetch_id)
 SELECT json_extract(value,'$.symbol'),json_extract(value,'$.period'),'none',json_extract(value,'$.source'),
 json_extract(value,'$.timestamp'),json_extract(value,'$.session_date'),json_extract(value,'$.payload'),
 json_extract(value,'$.fetched_at'),json_extract(value,'$.field_rank'),json_extract(value,'$.fetch_id')
 FROM json_each(?) WHERE 1
 ON CONFLICT(symbol,period,adjust,source,timestamp) DO UPDATE SET
 payload=excluded.payload,fetched_at=excluded.fetched_at,field_rank=excluded.field_rank,fetch_id=excluded.fetch_id
 WHERE excluded.field_rank>security_history_bars.field_rank OR
 (excluded.field_rank=security_history_bars.field_rank AND excluded.fetched_at>=security_history_bars.fetched_at)`;

export function createSecurityArchive(db?:D1Database):SecurityArchiveStore|null {
 if(!db)return null;
 const all=async<T>(sql:string,...args:any[])=>{const r=await db.prepare(sql).bind(...args).all<T>();return r.results};
 const parse=(r:{payload:string}|null)=>r?JSON.parse(r.payload):null;
 return {
  async readBars(symbol,period,source,start,end){
   const rows=await all<{payload:string;fetch_id:string}>('SELECT payload,fetch_id FROM security_history_bars WHERE symbol=? AND period=? AND adjust=? AND source=? AND session_date BETWEEN ? AND ? ORDER BY timestamp LIMIT 20000',symbol,period,'none',source,start,end);
   const bars=rows.map(r=>({...JSON.parse(r.payload),archive_fetch_id:r.fetch_id})) as SecurityBar[];
   const last=rows.at(-1);const name=last?await db.prepare('SELECT security_name FROM security_history_fetches WHERE id=?').bind(last.fetch_id).first<{security_name:string|null}>():null;
   return {bars,name:name?.security_name??null};
  },
  async saveFetch(f:ArchiveFetch){
   const evidence=JSON.stringify({...f,bars:undefined});
   if(new TextEncoder().encode(evidence).length>1800000)throw Error('ARCHIVE_RAW_TOO_LARGE: raw fetch exceeds bounded D1 row size');
   const existing=await db.prepare('SELECT payload FROM security_history_fetches WHERE id=?').bind(f.id).first<{payload:string}>();
   if(existing&&JSON.parse(existing.payload).ingest_complete===true)return 0;
   await db.prepare('INSERT OR IGNORE INTO security_history_fetches (id,symbol,period,adjust,source,fetched_at,security_name,payload) VALUES (?,?,?,?,?,?,?,?)').bind(f.id,f.symbol,f.period,f.adjust,f.source,f.fetched_at,f.name,evidence).run();
   const bars=f.adjust==='none'?f.bars.filter(b=>b.is_final===true):[];let saved=0;
   let chunk:any[]=[],bytes=0;
   const flush=async()=>{if(!chunk.length)return;const r=await db.prepare(archiveBarUpsert).bind(JSON.stringify(chunk)).run();saved+=r.meta.changes;chunk=[];bytes=0};
   for(const b of bars){const payload=JSON.stringify({...b,archive_fetch_id:undefined});const row={symbol:f.symbol,period:f.period,source:f.source,timestamp:b.timestamp,session_date:b.datetime.slice(0,10),payload,fetched_at:b.fetched_at,field_rank:(b.amount!==null?10:0)+[b.amplitude,b.change_percent,b.change,b.turnover_rate].filter(v=>v!==null).length,fetch_id:f.id};const size=new TextEncoder().encode(JSON.stringify(row)).length;if(chunk.length>=700||bytes+size>750000)await flush();chunk.push(row);bytes+=size;}await flush();await db.prepare("UPDATE security_history_fetches SET payload=json_set(payload,'$.ingest_complete',json('true')) WHERE id=?").bind(f.id).run();return saved;
  },
  async legacy(symbol,period,source){return (await all<{payload:string}>('SELECT payload FROM market_last_success WHERE cache_key LIKE ? ORDER BY fetched_at DESC LIMIT 2',`security-history-v1:${source}:${symbol}:${period}:none:unadjusted:%`)).map(r=>JSON.parse(r.payload))},
  async settings(){return parse(await db.prepare('SELECT payload FROM security_archive_settings WHERE id=?').bind('watchlist').first<{payload:string}>()) as ArchiveSettings|null},
  async saveSettings(s){await db.prepare('INSERT INTO security_archive_settings (id,payload) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').bind('watchlist',JSON.stringify(s)).run()},
  async createJob(job,tasks){
   await db.prepare('INSERT OR IGNORE INTO security_archive_jobs (id,status,created_at,updated_at,lease_until,payload) VALUES (?,?,?,?,?,?)').bind(job.id,job.status,job.created_at,job.updated_at,'',JSON.stringify(job)).run();
   await db.prepare("INSERT OR IGNORE INTO security_archive_tasks (job_id,task_key,status,payload) SELECT ?,json_extract(value,'$.key'),json_extract(value,'$.status'),value FROM json_each(?)").bind(job.id,JSON.stringify(tasks)).run();
  },
  async job(id){return parse(await db.prepare('SELECT payload FROM security_archive_jobs WHERE id=?').bind(id).first<{payload:string}>())},
  async recentJobs(){return (await all<{payload:string}>('SELECT payload FROM security_archive_jobs ORDER BY updated_at DESC LIMIT 8')).map(r=>JSON.parse(r.payload))},
  async tasks(id){return (await all<{payload:string}>('SELECT payload FROM security_archive_tasks WHERE job_id=? ORDER BY task_key',id)).map(r=>JSON.parse(r.payload))},
  async saveTask(id,t){await db.prepare('UPDATE security_archive_tasks SET status=?,payload=? WHERE job_id=? AND task_key=?').bind(t.status,JSON.stringify(t),id,t.key).run()},
  async claim(id,now,until){const r=await db.prepare('UPDATE security_archive_jobs SET lease_until=? WHERE id=? AND lease_until<?').bind(until,id,now).run();return r.meta.changes===1},
  async finish(job){await db.prepare('UPDATE security_archive_jobs SET status=?,updated_at=?,lease_until=?,payload=? WHERE id=?').bind(job.status,job.updated_at,'',JSON.stringify(job),job.id).run()},
  async audit(id){return parse(await db.prepare('SELECT payload FROM security_history_fetches WHERE id=?').bind(id).first<{payload:string}>())},
  async stats(){return {bars:await all('SELECT symbol,period,source,count(*) AS count,min(session_date) AS start_date,max(session_date) AS end_date FROM security_history_bars GROUP BY symbol,period,source'),fetches:await db.prepare('SELECT count(*) AS count FROM security_history_fetches').first()}},
 };
}
