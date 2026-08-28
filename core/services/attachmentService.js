import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../db/pool.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_STORAGE_DIR = process.env.STORAGE_DIR
  ? path.resolve(process.cwd(), process.env.STORAGE_DIR)
  : path.resolve(__dirname, '../../storage/attachments');

export class AttachmentService {
  constructor(storageDir = DEFAULT_STORAGE_DIR) {
    this.storageDir = storageDir;
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
  }

  /**
   * Compute SHA-256 hash of a buffer
   * @param {Buffer} buffer
   * @returns {string} hex hash
   */
  computeHash(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  /**
   * Save an uploaded file buffer with SHA-256 deduplication
   * @param {Object} param0
   * @param {string} [param0.noteId]
   * @param {string} param0.filename
   * @param {string} param0.mimeType
   * @param {Buffer} param0.buffer
   * @returns {Promise<Object>} saved attachment record
   */
  async saveAttachment({ noteId = null, filename, mimeType, buffer }) {
    if (!buffer || !Buffer.isBuffer(buffer)) {
      throw new Error('Valid file buffer is required');
    }

    const sha256 = this.computeHash(buffer);
    const ext = path.extname(filename) || '';
    const safeExt = ext.replace(/[^a-zA-Z0-9.]/g, '').slice(0, 10);
    const storageFilename = `${sha256}${safeExt}`;
    const absolutePath = path.join(this.storageDir, storageFilename);
    const relativePath = path.relative(path.resolve(__dirname, '../../'), absolutePath);

    // Save to disk if not already present (Deduplication)
    if (!fs.existsSync(absolutePath)) {
      await fs.promises.writeFile(absolutePath, buffer);
    }

    const attachmentId = crypto.randomUUID();
    const fileSize = buffer.length;

    await pool.query(
      `INSERT INTO attachments (id, note_id, filename, mime_type, file_size, sha256, storage_path)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [attachmentId, noteId, filename, mimeType || 'application/octet-stream', fileSize, sha256, relativePath]
    );

    return {
      id: attachmentId,
      noteId,
      filename,
      mimeType,
      fileSize,
      sha256,
      storagePath: relativePath,
      url: `/api/attachments/${attachmentId}/file`
    };
  }

  /**
   * Get attachment metadata by ID
   * @param {string} id
   * @returns {Promise<Object|null>}
   */
  async getAttachmentById(id) {
    const [rows] = await pool.query(
      `SELECT * FROM attachments WHERE id = ?`,
      [id]
    );
    if (!rows.length) return null;
    const item = rows[0];
    return {
      id: item.id,
      noteId: item.note_id,
      filename: item.filename,
      mimeType: item.mime_type,
      fileSize: Number(item.file_size),
      sha256: item.sha256,
      storagePath: item.storage_path,
      createdAt: item.created_at,
      url: `/api/attachments/${item.id}/file`
    };
  }

  /**
   * Get absolute filepath on disk
   * @param {string} storagePath
   * @returns {string}
   */
  resolveDiskPath(storagePath) {
    return path.resolve(path.resolve(__dirname, '../../'), storagePath);
  }

  /**
   * List attachments for a note
   * @param {string} noteId
   * @returns {Promise<Array>}
   */
  async listByNoteId(noteId) {
    const [rows] = await pool.query(
      `SELECT * FROM attachments WHERE note_id = ? ORDER BY created_at DESC`,
      [noteId]
    );
    return rows.map((item) => ({
      id: item.id,
      noteId: item.note_id,
      filename: item.filename,
      mimeType: item.mime_type,
      fileSize: Number(item.file_size),
      sha256: item.sha256,
      storagePath: item.storage_path,
      createdAt: item.created_at,
      url: `/api/attachments/${item.id}/file`
    }));
  }

  /**
   * Delete attachment record (and remove from disk if no other references share the SHA256)
   * @param {string} id
   */
  async deleteAttachment(id) {
    const item = await this.getAttachmentById(id);
    if (!item) return false;

    // Delete DB record
    await pool.query(`DELETE FROM attachments WHERE id = ?`, [id]);

    // Check if any other records still reference this SHA256
    const [others] = await pool.query(
      `SELECT COUNT(*) as cnt FROM attachments WHERE sha256 = ?`,
      [item.sha256]
    );

    if (others[0].cnt === 0) {
      const diskPath = this.resolveDiskPath(item.storagePath);
      if (fs.existsSync(diskPath)) {
        await fs.promises.unlink(diskPath).catch(() => {});
      }
    }

    return true;
  }

  /**
   * Get overall storage telemetry
   */
  async getStorageStats() {
    const [countRows] = await pool.query(
      `SELECT COUNT(*) as count, COALESCE(SUM(file_size), 0) as totalBytes FROM attachments`
    );
    return {
      totalAttachments: Number(countRows[0].count),
      totalBytes: Number(countRows[0].totalBytes),
      storageDir: this.storageDir
    };
  }
}

export const attachmentService = new AttachmentService();
export default attachmentService;
