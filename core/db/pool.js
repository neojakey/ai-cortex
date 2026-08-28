import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const poolConfig = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  database: process.env.DB_NAME || 'ai_cortex',
  user: process.env.DB_USER || 'devuser',
  password: process.env.DB_PASS || '',
  waitForConnections: true,
  connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT || '20', 10),
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
  charset: 'utf8mb4',
  namedPlaceholders: true
};

export const pool = mysql.createPool(poolConfig);

/**
 * Ping MySQL and return latency in milliseconds
 */
export async function checkConnection() {
  const start = performance.now();
  const connection = await pool.getConnection();
  try {
    await connection.ping();
    const latency = (performance.now() - start).toFixed(2);
    return { ok: true, latencyMs: Number(latency) };
  } finally {
    connection.release();
  }
}

export default pool;
