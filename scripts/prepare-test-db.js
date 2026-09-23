// Creates (if needed) and migrates the throwaway test database. Runs automatically
// before `npm test` and `npm run test:integration` so a fresh machine just works.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { TEST_DB_NAME } from '../tests/helpers/test-env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// Connect without selecting a database, since the test one may not exist yet.
const admin = await mysql.createConnection({
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  user: process.env.DB_USER || 'devuser',
  password: process.env.DB_PASS || ''
});
await admin.query(
  `CREATE DATABASE IF NOT EXISTS \`${TEST_DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
);
await admin.end();

// test-env.js has already pointed DB_NAME at the test database, so migrations land there.
const { runMigrations } = await import('../core/db/migrate.js');
const { pool } = await import('../core/db/pool.js');
await runMigrations();
await pool.end();
console.log(`[test] Database "${TEST_DB_NAME}" is ready.`);
