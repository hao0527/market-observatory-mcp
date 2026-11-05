import {sqliteTable,text,index,integer,primaryKey} from 'drizzle-orm/sqlite-core';
export const marketLastSuccess=sqliteTable('market_last_success',{
  cacheKey:text('cache_key').primaryKey(),
  payload:text('payload').notNull(),
  dataTime:text('data_time').notNull(),
  fetchedAt:text('fetched_at').notNull(),
  expiresAt:text('expires_at').notNull(),
},table=>[index('market_cache_expiry_idx').on(table.expiresAt)]);

export const securityHistoryBars=sqliteTable('security_history_bars',{
 symbol:text('symbol').notNull(),period:text('period').notNull(),adjust:text('adjust').notNull(),source:text('source').notNull(),timestamp:integer('timestamp').notNull(),sessionDate:text('session_date').notNull(),payload:text('payload').notNull(),fetchedAt:text('fetched_at').notNull(),fieldRank:integer('field_rank').notNull(),fetchId:text('fetch_id').notNull(),
},t=>[primaryKey({columns:[t.symbol,t.period,t.adjust,t.source,t.timestamp]}),index('security_bars_range_idx').on(t.symbol,t.period,t.adjust,t.source,t.sessionDate)]);
export const securityHistoryFetches=sqliteTable('security_history_fetches',{
 id:text('id').primaryKey(),symbol:text('symbol').notNull(),period:text('period').notNull(),adjust:text('adjust').notNull(),source:text('source').notNull(),fetchedAt:text('fetched_at').notNull(),securityName:text('security_name'),payload:text('payload').notNull(),
});
export const securityArchiveSettings=sqliteTable('security_archive_settings',{id:text('id').primaryKey(),payload:text('payload').notNull()});
export const securityArchiveJobs=sqliteTable('security_archive_jobs',{
 id:text('id').primaryKey(),status:text('status').notNull(),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull(),leaseUntil:text('lease_until').notNull(),payload:text('payload').notNull(),
},t=>[index('security_jobs_updated_idx').on(t.updatedAt)]);
export const securityArchiveTasks=sqliteTable('security_archive_tasks',{
 jobId:text('job_id').notNull(),taskKey:text('task_key').notNull(),status:text('status').notNull(),payload:text('payload').notNull(),
},t=>[primaryKey({columns:[t.jobId,t.taskKey]})]);
