// Database backup and restore via the mysqldump/mysql CLIs.
//
// Deliberately shells out rather than reconstructing SQL in JS: mysqldump already handles
// schema, data, character sets and escaping correctly, and restore just replays its output.
//
// Safety rules this enforces:
//   - The password is passed via the MYSQL_PWD env var, never as a CLI argument, so it can't
//     leak through `ps`/process listings.
//   - Every backup/restore is pinned to DB_NAME from .env — there is no way to point either
//     operation at a different database from the request.
//   - restore() always takes its own "pre-restore" safety dump first, so a bad restore is
//     itself recoverable, and it refuses to run against anything that doesn't look like a
//     mysqldump file.
//   - Filenames handed back to callers are generated here, never taken from user input, so
//     the download/delete endpoints can validate against a strict pattern and avoid path
//     traversal.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { pool } from '../db/pool.js';
import { attachmentService } from './attachmentService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BACKUP_DIR = process.env.BACKUP_DIR
  ? path.resolve(process.cwd(), process.env.BACKUP_DIR)
  : path.resolve(__dirname, '../../storage/backups');

// Newest N of each kind are kept; older ones are deleted after every successful backup.
const KEEP_MANUAL = 15;
const KEEP_PRE_RESTORE = 5;

// Attachment files are immutable and named by content hash, so the mirror is an incremental
// copy: a file already present with the same size is skipped. Nothing is ever deleted from it.
const ATTACHMENT_MIRROR_DIR = path.join(BACKUP_DIR, 'attachments');

const RESTORE_TIMEOUT_MS = 2 * 60 * 1000;
const DUMP_HEADER_RE = /mysqldump|MySQL dump/i;

// Matches only filenames this service itself generates.
const SAFE_FILENAME_RE = /^(ai-cortex-backup|pre-restore)-\d{8}-\d{6}\.sql\.gz$/;

function dbConfig() {
  const database = process.env.DB_NAME || 'ai_cortex';
  return {
    host: process.env.DB_HOST || '127.0.0.1',
    port: process.env.DB_PORT || '3306',
    user: process.env.DB_USER || 'devuser',
    password: process.env.DB_PASS || '',
    database
  };
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
}

function runCli(command, args, { input, outputPath, timeoutMs } = {}) {
  return new Promise((resolve, reject) => {
    const { password } = dbConfig();
    const child = spawn(command, args, {
      env: { ...process.env, MYSQL_PWD: password }
    });

    let stderr = '';
    let settled = false;
    let timer = null;

    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      fn(arg);
    };

    if (timeoutMs) {
      timer = setTimeout(() => {
        child.kill('SIGKILL');
        finish(reject, new Error(`${command} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    }

    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (err) => finish(reject, err));

    let outStream = null;
    if (outputPath) {
      outStream = fs.createWriteStream(outputPath);
      child.stdout.pipe(outStream);
      outStream.on('error', (err) => finish(reject, err));
    }

    child.on('close', (code) => {
      if (code === 0) {
        finish(resolve, { stderr });
      } else {
        finish(reject, new Error(`${command} exited with code ${code}: ${stderr.slice(-2000)}`));
      }
    });

    if (input !== undefined) {
      child.stdin.end(input);
    } else if (!outputPath) {
      child.stdin.end();
    }
  });
}

// Copies regular files from `fromDir` into `toDir` when missing there (or a different size).
// If `names` is given only those files are considered. Never deletes anything.
async function copyMissing(fromDir, toDir, names = null) {
  await fsp.mkdir(toDir, { recursive: true });
  const candidates = names || (await fsp.readdir(fromDir));
  let copied = 0;
  let bytes = 0;
  let total = 0;
  for (const name of candidates) {
    if (name.startsWith('.') || name.includes('/') || name.includes('\\')) continue;
    const src = path.join(fromDir, name);
    const srcStat = await fsp.stat(src).catch(() => null);
    if (!srcStat || !srcStat.isFile()) continue;
    total += 1;
    const dest = path.join(toDir, name);
    const destStat = await fsp.stat(dest).catch(() => null);
    if (destStat && destStat.size === srcStat.size) continue;
    const tmp = `${dest}.partial`;
    await fsp.copyFile(src, tmp);
    await fsp.rename(tmp, dest);
    copied += 1;
    bytes += srcStat.size;
  }
  return { copied, total, bytes };
}

async function ensureBackupDir() {
  await fsp.mkdir(BACKUP_DIR, { recursive: true });
}

async function cleanupOldBackups(prefix, keep) {
  const files = (await fsp.readdir(BACKUP_DIR))
    .filter((f) => f.startsWith(`${prefix}-`) && f.endsWith('.sql.gz'))
    .sort()
    .reverse();
  for (const f of files.slice(keep)) {
    await fsp.unlink(path.join(BACKUP_DIR, f)).catch(() => {});
  }
}

// Dumps the configured database, gzipped, to a new file in BACKUP_DIR. Returns its metadata.
async function createDump(prefix) {
  await ensureBackupDir();
  const { host, port, user, database } = dbConfig();
  const filename = `${prefix}-${timestamp()}.sql.gz`;
  const filePath = path.join(BACKUP_DIR, filename);
  const tmpPath = `${filePath}.partial`;

  const args = ['-h', host, '-P', String(port), '-u', user, '--single-transaction', '--routines', '--triggers', database];
  await new Promise((resolve, reject) => {
    const { password } = dbConfig();
    const child = spawn('mysqldump', args, { env: { ...process.env, MYSQL_PWD: password } });
    let stderr = '';
    child.stderr.on('data', (c) => { stderr += c.toString(); });
    child.on('error', reject);

    const gzip = zlib.createGzip();
    const out = fs.createWriteStream(tmpPath);
    pipeline(child.stdout, gzip, out).then(resolve).catch(reject);

    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`mysqldump exited with code ${code}: ${stderr.slice(-2000)}`));
    });
  }).catch(async (err) => {
    await fsp.unlink(tmpPath).catch(() => {});
    throw err;
  });

  await fsp.rename(tmpPath, filePath);
  const stat = await fsp.stat(filePath);
  return { filename, path: filePath, size: stat.size, createdAt: stat.mtime.toISOString() };
}

export const backupService = {
  BACKUP_DIR,

  copyMissing,
  ATTACHMENT_MIRROR_DIR,

  /**
   * Create a manual backup (database dump) and prune old ones beyond KEEP_MANUAL, then bring
   * the attachment mirror up to date. A failed mirror sync does not fail the database backup.
   */
  async createBackup() {
    const meta = await createDump('ai-cortex-backup');
    await cleanupOldBackups('ai-cortex-backup', KEEP_MANUAL);
    try {
      meta.attachments = await copyMissing(attachmentService.storageDir, ATTACHMENT_MIRROR_DIR);
    } catch (err) {
      meta.attachmentsError = err.message;
    }
    return meta;
  },

  /**
   * After a database restore: any attachment the database references whose file is gone from
   * live storage is copied back from the mirror. Reports what could not be recovered.
   */
  async restoreMissingAttachments() {
    const [rows] = await pool.query('SELECT DISTINCT storage_path FROM attachments');
    const names = rows.map((r) => path.basename(r.storage_path));
    const live = attachmentService.storageDir;
    const missing = [];
    for (const name of names) {
      if (!fs.existsSync(path.join(live, name))) missing.push(name);
    }
    if (!missing.length) return { restored: 0, stillMissing: 0 };
    const { copied } = await copyMissing(ATTACHMENT_MIRROR_DIR, live, missing);
    return { restored: copied, stillMissing: missing.length - copied };
  },

  /** List backups (both manual and automatic pre-restore ones), newest first. */
  async listBackups() {
    await ensureBackupDir();
    const files = await fsp.readdir(BACKUP_DIR);
    const entries = await Promise.all(
      files
        .filter((f) => SAFE_FILENAME_RE.test(f))
        .map(async (f) => {
          const stat = await fsp.stat(path.join(BACKUP_DIR, f));
          return {
            filename: f,
            kind: f.startsWith('pre-restore-') ? 'pre-restore' : 'manual',
            size: stat.size,
            createdAt: stat.mtime.toISOString()
          };
        })
    );
    return entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  /** Resolve a backup filename to a safe on-disk path, or null if it isn't one of ours. */
  resolveBackupPath(filename) {
    if (!SAFE_FILENAME_RE.test(filename)) return null;
    return path.join(BACKUP_DIR, filename);
  },

  async deleteBackup(filename) {
    const p = this.resolveBackupPath(filename);
    if (!p || !fs.existsSync(p)) return false;
    await fsp.unlink(p);
    return true;
  },

  /**
   * Restore the database from a gzipped mysqldump file on disk.
   * Always takes a pre-restore safety dump first. Rejects files that don't look like a
   * mysqldump export. `sourcePath` may be outside BACKUP_DIR (e.g. a temp upload).
   */
  async restoreFrom(sourcePath) {
    const raw = await fsp.readFile(sourcePath);
    // Gzip files start with the magic bytes 1f 8b; accept both .sql and .sql.gz uploads.
    const isGzip = raw.length > 2 && raw[0] === 0x1f && raw[1] === 0x8b;
    const sql = isGzip ? zlib.gunzipSync(raw) : raw;

    if (!DUMP_HEADER_RE.test(sql.subarray(0, 4096).toString('utf8'))) {
      throw new Error('This file does not look like a mysqldump export — refusing to restore.');
    }

    const safety = await createDump('pre-restore');
    await cleanupOldBackups('pre-restore', KEEP_PRE_RESTORE);

    const { host, port, user, database } = dbConfig();
    await runCli('mysql', ['-h', host, '-P', String(port), '-u', user, database], {
      input: sql,
      timeoutMs: RESTORE_TIMEOUT_MS
    });

    let attachments = null;
    try {
      attachments = await this.restoreMissingAttachments();
    } catch (err) {
      attachments = { error: err.message };
    }

    return { safetyBackup: safety.filename, attachments };
  }
};

export default backupService;
