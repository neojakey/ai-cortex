import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { pool, checkConnection } from '../db/pool.js';
import { noteService } from '../services/noteService.js';
import { searchService } from '../services/searchService.js';
import { attachmentService } from '../services/attachmentService.js';
import { exportService } from '../services/exportService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const app = express();
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '127.0.0.1';

// Only browser origins on the loopback interface may drive this API.
const LOOPBACK_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

// Host header allow-list (anti-DNS-rebinding). Extendable via env for LAN use.
const ALLOWED_HOSTS = new Set(
  ['127.0.0.1', 'localhost', '::1', '[::1]']
    .concat(
      (process.env.ALLOWED_HOSTS || '')
        .split(',')
        .map((h) => h.trim().toLowerCase())
        .filter(Boolean)
    )
    .concat(process.env.HOST ? [process.env.HOST.toLowerCase()] : [])
);

app.use(cors({
  origin(origin, cb) {
    // Non-browser clients (no Origin) and loopback origins may read responses.
    if (!origin || LOOPBACK_ORIGIN.test(origin)) return cb(null, true);
    return cb(null, false);
  }
}));
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// Anti-DNS-rebinding: reject requests whose Host header isn't a known loopback name.
app.use((req, res, next) => {
  const hostname = (req.headers.host || '').toLowerCase().replace(/:\d+$/, '');
  if (hostname && !ALLOWED_HOSTS.has(hostname)) {
    return res.status(403).json({ error: 'Host not allowed' });
  }
  next();
});

// CSRF guard: block state-changing requests a browser flags as cross-site/cross-origin.
const CSRF_SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
app.use((req, res, next) => {
  if (CSRF_SAFE_METHODS.has(req.method)) return next();

  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') {
    return res.status(403).json({ error: 'Cross-site request blocked' });
  }

  const origin = req.headers.origin;
  if (origin && !LOOPBACK_ORIGIN.test(origin)) {
    return res.status(403).json({ error: 'Cross-origin request blocked' });
  }

  next();
});

// Multer memory storage for uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: (parseInt(process.env.MAX_UPLOAD_MB || '50', 10)) * 1024 * 1024 }
});

/* =========================================================================
   1. Health & Telemetry
   ========================================================================= */
app.get('/api/health', async (req, res) => {
  try {
    const dbCheck = await checkConnection();
    const storageStats = await attachmentService.getStorageStats();
    const [noteCountRows] = await pool.query(
      `SELECT status, COUNT(*) as count FROM notes GROUP BY status`
    );
    const [linkCountRows] = await pool.query(`SELECT COUNT(*) as count FROM note_links`);

    const statusCounts = {};
    for (const r of noteCountRows) {
      statusCounts[r.status] = Number(r.count);
    }

    res.json({
      status: 'healthy',
      uptime: process.uptime(),
      db: {
        connected: dbCheck.ok,
        latencyMs: dbCheck.latencyMs,
        database: process.env.DB_NAME || 'ai_cortex'
      },
      counts: {
        activeNotes: statusCounts['active'] || 0,
        archivedNotes: statusCounts['archived'] || 0,
        trashNotes: statusCounts['trash'] || 0,
        totalLinks: Number(linkCountRows[0].count)
      },
      storage: storageStats,
      system: {
        platform: process.platform,
        nodeVersion: process.version,
        memoryUsageMb: Math.round(process.memoryUsage().rss / 1024 / 1024)
      }
    });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

/* =========================================================================
   2. Notes Endpoints
   ========================================================================= */
// List notes
app.get('/api/notes', async (req, res) => {
  try {
    const { status = 'active', tag, search, limit = 100, offset = 0, sortBy, sortOrder } = req.query;
    const notes = await noteService.listNotes({
      status: status === 'all' ? null : status,
      tag,
      search,
      limit: Number(limit),
      offset: Number(offset),
      sortBy,
      sortOrder
    });
    res.json({ notes, total: notes.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Full-text search
app.get('/api/search', async (req, res) => {
  try {
    const { q, limit = 30 } = req.query;
    const results = await searchService.search(q, { limit: Number(limit) });
    res.json({ results, total: results.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Daily note
app.get('/api/daily', async (req, res) => {
  try {
    const { date } = req.query;
    const note = await noteService.getOrCreateDailyNote(date);
    res.json({ note });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get single note by ID
app.get('/api/notes/:id', async (req, res) => {
  try {
    const note = await noteService.getNoteById(req.params.id);
    if (!note) return res.status(404).json({ error: 'Note not found' });
    res.json({ note });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create note
app.post('/api/notes', async (req, res) => {
  try {
    const { title, content, status, dueDate, properties, customTags } = req.body;
    const note = await noteService.createNote({
      title,
      content,
      status,
      dueDate,
      properties,
      customTags
    });
    res.status(201).json({ note });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Update note
app.put('/api/notes/:id', async (req, res) => {
  try {
    const { title, content, status, dueDate, properties, customTags } = req.body;
    const note = await noteService.updateNote(req.params.id, {
      title,
      content,
      status,
      dueDate,
      properties,
      customTags
    });
    res.json({ note });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Delete note (soft or permanent)
app.delete('/api/notes/:id', async (req, res) => {
  try {
    const permanent = req.query.permanent === 'true';
    const success = await noteService.deleteNote(req.params.id, { permanent });
    if (!success) return res.status(404).json({ error: 'Note not found' });
    res.json({ success });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Restore note
app.post('/api/notes/:id/restore', async (req, res) => {
  try {
    const success = await noteService.restoreNote(req.params.id);
    if (!success) return res.status(404).json({ error: 'Note not found' });
    res.json({ success });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Note version snapshots
app.get('/api/notes/:id/versions', async (req, res) => {
  try {
    const versions = await noteService.getVersions(req.params.id);
    res.json({ versions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* =========================================================================
   3. Tags & Tasks
   ========================================================================= */
app.get('/api/tags', async (req, res) => {
  try {
    const tags = await noteService.listTags();
    res.json({ tags });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/tasks', async (req, res) => {
  try {
    const completed = req.query.completed === undefined ? null : req.query.completed === 'true';
    const tasks = await noteService.getTasks({ completed });
    res.json({ tasks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* =========================================================================
   4. Attachments (Upload, Stream, Delete)
   ========================================================================= */
app.post('/api/attachments', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const noteId = req.body.noteId || null;
    const attachment = await attachmentService.saveAttachment({
      noteId,
      filename: req.file.originalname,
      mimeType: req.file.mimetype,
      buffer: req.file.buffer
    });

    res.status(201).json({ attachment });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Stream attachment file with Range & Cache-Control headers
app.get('/api/attachments/:id/file', async (req, res) => {
  try {
    const attachment = await attachmentService.getAttachmentById(req.params.id);
    if (!attachment) return res.status(404).send('Attachment not found');

    const filePath = attachmentService.resolveDiskPath(attachment.storagePath);
    if (!fs.existsSync(filePath)) {
      return res.status(404).send('File missing on disk');
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    // HTTP 206 Partial Content (Range requests for audio/video)
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = end - start + 1;
      const file = fs.createReadStream(filePath, { start, end });

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': attachment.mimeType,
        'ETag': `"${attachment.sha256}"`,
        'Cache-Control': 'public, max-age=31536000, immutable'
      });
      file.pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': attachment.mimeType,
        'ETag': `"${attachment.sha256}"`,
        'Cache-Control': 'public, max-age=31536000, immutable'
      });
      fs.createReadStream(filePath).pipe(res);
    }
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.delete('/api/attachments/:id', async (req, res) => {
  try {
    const success = await attachmentService.deleteAttachment(req.params.id);
    res.json({ success });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* =========================================================================
   5. Vault Import & Export
   ========================================================================= */
app.get('/api/vault/export', async (req, res) => {
  try {
    const timestamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="SecondBrain-Vault-${timestamp}.zip"`);
    await exportService.exportVaultToZip(res);
  } catch (err) {
    console.error('[vault/export] failed:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    } else {
      res.destroy(err);
    }
  }
});

app.post('/api/vault/import', upload.single('vaultZip'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No zip file uploaded' });
    const result = await exportService.importVaultFromZip(req.file.buffer);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* =========================================================================
   6. MCP & AI Integration Configurator
   ========================================================================= */
app.get('/api/settings/mcp-config', (req, res) => {
  const mcpScriptPath = path.resolve(__dirname, '../mcp/index.js');
  const nodeBinary = process.execPath || 'node';

  // Config for Claude Desktop and Gemini / Antigravity
  const mcpServersConfig = {
    mcpServers: {
      "ai-cortex": {
        command: nodeBinary,
        args: [mcpScriptPath]
      }
    }
  };

  // Paths for various operating systems
  const homeDir = os.homedir();
  const configPaths = {
    macOS: path.join(homeDir, 'Library/Application Support/Claude/claude_desktop_config.json'),
    windows: path.join(homeDir, 'AppData/Roaming/Claude/claude_desktop_config.json'),
    linux: path.join(homeDir, '.config/Claude/claude_desktop_config.json'),
    currentOS: process.platform === 'darwin' ? 'macOS' : process.platform === 'win32' ? 'windows' : 'linux'
  };

  res.json({
    mcpScriptPath,
    nodeBinary,
    claudeConfig: mcpServersConfig,
    geminiConfig: mcpServersConfig,
    configPaths,
    detectedPath: configPaths[configPaths.currentOS]
  });
});

// Auto-install to Claude Desktop config file if permitted
app.post('/api/settings/install-claude-config', async (req, res) => {
  try {
    const mcpScriptPath = path.resolve(__dirname, '../mcp/index.js');
    const nodeBinary = process.execPath || 'node';
    const homeDir = os.homedir();

    let targetPath = path.join(homeDir, '.config/Claude/claude_desktop_config.json');
    if (process.platform === 'darwin') {
      targetPath = path.join(homeDir, 'Library/Application Support/Claude/claude_desktop_config.json');
    } else if (process.platform === 'win32') {
      targetPath = path.join(homeDir, 'AppData/Roaming/Claude/claude_desktop_config.json');
    }

    let existingData = { mcpServers: {} };
    if (fs.existsSync(targetPath)) {
      try {
        existingData = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
      } catch (e) {
        existingData = { mcpServers: {} };
      }
    } else {
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    }

    if (!existingData.mcpServers) existingData.mcpServers = {};
    existingData.mcpServers["ai-cortex"] = {
      command: nodeBinary,
      args: [mcpScriptPath]
    };

    fs.writeFileSync(targetPath, JSON.stringify(existingData, null, 2), 'utf8');

    res.json({
      success: true,
      message: `AI-Cortex successfully added to Claude Desktop configuration at ${targetPath}`,
      path: targetPath
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Auto-install to Gemini / Antigravity workspace config (.agents/mcp_config.json)
app.post('/api/settings/install-gemini-config', async (req, res) => {
  try {
    const mcpScriptPath = path.resolve(__dirname, '../mcp/index.js');
    const nodeBinary = process.execPath || 'node';
    const projectRoot = path.resolve(__dirname, '../../');
    const agentsDir = path.join(projectRoot, '.agents');
    const targetPath = path.join(agentsDir, 'mcp_config.json');

    if (!fs.existsSync(agentsDir)) {
      fs.mkdirSync(agentsDir, { recursive: true });
    }

    let existingData = { mcpServers: {} };
    if (fs.existsSync(targetPath)) {
      try {
        existingData = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
      } catch (e) {
        existingData = { mcpServers: {} };
      }
    }

    if (!existingData.mcpServers) existingData.mcpServers = {};
    existingData.mcpServers["ai-cortex"] = {
      command: nodeBinary,
      args: [mcpScriptPath]
    };

    fs.writeFileSync(targetPath, JSON.stringify(existingData, null, 2), 'utf8');

    res.json({
      success: true,
      message: `AI-Cortex successfully registered for Gemini in this workspace at .agents/mcp_config.json`,
      path: targetPath
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Serve frontend build if dist exists
const distPath = path.resolve(__dirname, '../../dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// Graceful shutdown handling
let serverRef = null;
let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} signal received: closing HTTP server and MySQL pool`);
  await new Promise((resolve) => {
    if (serverRef) serverRef.close(() => resolve());
    else resolve();
  });
  await pool.end();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export function startServer(port = PORT, host = HOST) {
  serverRef = app.listen(port, host, () => {
    console.log(`[SecondBrain API] Server listening on http://${host}:${port}`);
  });
  return serverRef;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startServer();
}

export default app;
