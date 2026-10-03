/**
 * Migration runner — reads ordered SQL files from /migrations and applies them.
 * Run: tsx src/database/migrate.ts
 * Rollback is not implemented in this runner — use explicit rollback SQL files if needed.
 */
import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';
import dotenv from 'dotenv';

// Load .env from server root — works whether run via tsx or compiled js
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../server/.env') });

const DB_URL = process.env.DATABASE_URL!;
if (!DB_URL) {
  console.error('DATABASE_URL is not set. Make sure server/.env exists.');
  process.exit(1);
}

const MIGRATIONS_DIR = path.resolve(process.cwd(), 'migrations');

async function run() {
  const pool = new Pool({ connectionString: DB_URL });
  const client = await pool.connect();

  try {
    // Ensure migrations table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    VARCHAR(20) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        description TEXT
      )
    `);

    // Read applied versions
    const { rows: applied } = await client.query<{ version: string }>(
      'SELECT version FROM schema_migrations ORDER BY version'
    );
    const appliedSet = new Set(applied.map(r => r.version));

    // Read all migration files
    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .sort();

    let ran = 0;
    for (const file of files) {
      const version = file.split('_')[0]; // e.g. "001" from "001_extensions.sql"
      if (appliedSet.has(version)) {
        console.log(`  ✓  ${file} (already applied)`);
        continue;
      }

      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');

      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (version, description) VALUES ($1, $2)',
          [version, file]
        );
        await client.query('COMMIT');
        console.log(`  ✅  ${file}`);
        ran++;
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`  ❌  ${file} FAILED:`, err);
        throw err;
      }
    }

    if (ran === 0) {
      console.log('Database is up to date.');
    } else {
      console.log(`\nApplied ${ran} migration(s).`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
