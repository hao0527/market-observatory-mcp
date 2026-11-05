import {sqliteTable,text,index} from 'drizzle-orm/sqlite-core';
export const marketLastSuccess=sqliteTable('market_last_success',{
  cacheKey:text('cache_key').primaryKey(),
  payload:text('payload').notNull(),
  dataTime:text('data_time').notNull(),
  fetchedAt:text('fetched_at').notNull(),
  expiresAt:text('expires_at').notNull(),
},table=>[index('market_cache_expiry_idx').on(table.expiresAt)]);
