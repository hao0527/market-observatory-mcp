"""Validate production migration/upsert ordering with SQLite, without accessing user data."""
from pathlib import Path
import json
import re
import sqlite3

connection = sqlite3.connect(':memory:')
for path in sorted(Path('drizzle').glob('*.sql')):
    connection.executescript(path.read_text().replace('--> statement-breakpoint', ''))
source = Path('db/cache.ts').read_text()
upsert = re.search(r"prepare\('(INSERT INTO market_last_success[^']+)'\)", source).group(1)

def write(key, value, quote_time, fetch_time, expiry='2026-11-19T02:00:00Z'):
    connection.execute(upsert, (key, json.dumps({'value': value}), quote_time, fetch_time, expiry))

def value(key):
    return json.loads(connection.execute('SELECT payload FROM market_last_success WHERE cache_key=?', (key,)).fetchone()[0])['value']

write('test', 10, '2026-11-05T02:00:00Z', '2026-11-05T02:00:05Z')
write('test', 9, '2026-11-05T01:00:00Z', '2026-11-05T03:00:00Z')
assert value('test') == 10, 'An older quote must not replace a newer quote, even if fetched later.'
write('test', 11, '2026-11-05T02:00:00Z', '2026-11-05T02:00:06Z')
assert value('test') == 11, 'A later fetch may update the same quote timestamp.'
write('test', 12, '2026-11-05T02:00:00Z', '2026-11-05T02:00:04Z')
assert value('test') == 11, 'An out-of-order fetch must not overwrite a newer fetch.'
for i in range(101):
    write('expired:'+str(i), i, '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z', '2026-10-15T00:00:00Z')
cleanup = re.search(r"prepare\('(DELETE FROM market_last_success[^']+)'\)", source).group(1)
connection.execute(cleanup, ('2026-11-05T02:00:00Z',))
assert connection.execute("SELECT COUNT(*) FROM market_last_success WHERE cache_key LIKE 'expired:%'").fetchone()[0] == 1
assert value('test') == 11
print('PASS: actual cache migration, ordered upserts and bounded expiry cleanup')
