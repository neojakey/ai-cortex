// Imported FIRST by every test that touches the database or attachment storage.
//
// Forces a throwaway database and attachment directory so the suite can never read
// or write real notes, whatever the shell, .env, or test runner (npm, node --test,
// the VS Code test explorer) supplies. ES modules evaluate imports in order, so this
// must stay the first import: db/pool.js reads DB_NAME when it is first loaded.
import os from 'node:os';
import path from 'node:path';

export const TEST_DB_NAME = process.env.TEST_DB_NAME || 'ai_cortex_test';

if (!/_test$/.test(TEST_DB_NAME)) {
  throw new Error(`Refusing to run tests against "${TEST_DB_NAME}": TEST_DB_NAME must end in "_test".`);
}

process.env.DB_NAME = TEST_DB_NAME;
process.env.STORAGE_DIR = path.join(os.tmpdir(), 'ai-cortex-test-storage');
