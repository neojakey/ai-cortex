import { pool } from './pool.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runMigrations() {
  console.log('[Migration] Starting MySQL 8.4 schema migrations...');
  const conn = await pool.getConnection();

  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS notes (
        id VARCHAR(36) PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        slug VARCHAR(255) NOT NULL UNIQUE,
        content LONGTEXT,
        content_text LONGTEXT,
        status ENUM('active', 'archived', 'trash') DEFAULT 'active',
        due_date DATE NULL,
        created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
        updated_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        INDEX idx_slug (slug),
        INDEX idx_status (status),
        INDEX idx_updated_at (updated_at),
        INDEX idx_due_date (due_date),
        FULLTEXT idx_fulltext (title, content_text)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS note_links (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        source_note_id VARCHAR(36) NOT NULL,
        target_slug VARCHAR(255) NOT NULL,
        target_note_id VARCHAR(36) NULL,
        created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
        UNIQUE KEY uq_source_target (source_note_id, target_slug),
        INDEX idx_target_slug (target_slug),
        INDEX idx_target_note_id (target_note_id),
        CONSTRAINT fk_links_source FOREIGN KEY (source_note_id) REFERENCES notes(id) ON DELETE CASCADE,
        CONSTRAINT fk_links_target FOREIGN KEY (target_note_id) REFERENCES notes(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS tags (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL UNIQUE,
        created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS note_tags (
        note_id VARCHAR(36) NOT NULL,
        tag_id INT NOT NULL,
        PRIMARY KEY (note_id, tag_id),
        INDEX idx_tag_id (tag_id),
        CONSTRAINT fk_tags_note FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
        CONSTRAINT fk_tags_tag FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS note_properties (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        note_id VARCHAR(36) NOT NULL,
        property_name VARCHAR(64) NOT NULL,
        property_type VARCHAR(32) NOT NULL DEFAULT 'text',
        property_value TEXT,
        created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
        UNIQUE KEY uq_note_prop (note_id, property_name),
        INDEX idx_prop_name (property_name),
        CONSTRAINT fk_props_note FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS attachments (
        id VARCHAR(36) PRIMARY KEY,
        note_id VARCHAR(36) NULL,
        filename VARCHAR(255) NOT NULL,
        mime_type VARCHAR(100) NOT NULL,
        file_size BIGINT NOT NULL,
        sha256 CHAR(64) NOT NULL,
        storage_path VARCHAR(500) NOT NULL,
        created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
        INDEX idx_note_id (note_id),
        INDEX idx_sha256 (sha256),
        CONSTRAINT fk_attachments_note FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS note_versions (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        note_id VARCHAR(36) NOT NULL,
        title VARCHAR(255) NOT NULL,
        content LONGTEXT,
        created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
        INDEX idx_note_versions (note_id, created_at),
        CONSTRAINT fk_versions_note FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Ensure attachments storage directory exists
    const storageDir = path.resolve(__dirname, '../../storage/attachments');
    if (!fs.existsSync(storageDir)) {
      fs.mkdirSync(storageDir, { recursive: true });
    }

    console.log('[Migration] All tables and indexes successfully created & verified!');
    return { ok: true };
  } catch (err) {
    console.error('[Migration] Failed to run migrations:', err);
    throw err;
  } finally {
    conn.release();
  }
}

// Direct execution support
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runMigrations()
    .then(() => {
      console.log('Migration completed.');
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
