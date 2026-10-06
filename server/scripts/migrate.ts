/** Applies pending PostgreSQL migrations (also done automatically at server start). */
import { migrate, closePool, SCHEMA } from '../db.ts';

migrate()
  .then(async ran => {
    console.log(ran.length ? `Applied to schema "${SCHEMA}": ${ran.join(', ')}` : `Schema "${SCHEMA}" is up to date.`);
    await closePool();
  })
  .catch(async err => {
    console.error('Migration failed:', (err as Error).message);
    await closePool();
    process.exit(1);
  });
