// Browser check for Folders tree and moving notes between folders.
import { check, finish, createNote, deleteNotes, getNote, openBrowser, APP, api } from './helpers.js';

const createdNotes = [];

// Create test projects & notes
const suffix = Date.now();
const pZeta = `Project Zeta ${suffix}`;
const pGamma = `Project Gamma ${suffix}`;

// 1. Create a note in Project Zeta
const oldNote = await createNote({ title: 'Oldest Zeta Note', content: 'ancient text', project: pZeta });
createdNotes.push(oldNote);

// 2. Create 102 filler notes to push oldNote beyond the 100 newest notes
for (let i = 0; i < 102; i++) {
  const filler = await createNote({ title: `Filler ${String(i).padStart(3, '0')}`, content: 'filler' });
  createdNotes.push(filler);
}

// 3. A daily note (must be excluded from tree)
const dailyNote = await createNote({ title: 'Daily: 2026-03-15', content: 'journal day' });
createdNotes.push(dailyNote);

// 4. Note in Project Gamma (and a second active note so Gamma stays in projects even when noteA is archived)
const noteA = await createNote({ title: 'Note A in Gamma', content: 'gamma content', project: pGamma });
const noteA2 = await createNote({ title: 'Note A2 in Gamma', content: 'gamma content 2', project: pGamma });
createdNotes.push(noteA, noteA2);

// 5. Loose Unfiled Note
const noteB = await createNote({ title: 'Note B Unfiled', content: 'unfiled content' });
createdNotes.push(noteB);

const { browser, page, errors, dialogs } = await openBrowser({ settings: { ai_cortex_view_mode: 'edit' } });

try {
  // Navigate to Note A
  await page.goto(`${APP}/#/note/${noteA.id}`);
  await page.waitForSelector('.tree-folder-btn');
  await page.waitForTimeout(1000);


  // --- CHECK 1: The tree shows notes beyond the newest 100 ---
  // In the recent flat list (limited to 100), oldNote is pushed out
  const flatHasOld = await page.locator('.note-item', { hasText: 'Oldest Zeta Note' }).count();
  check(flatHasOld === 0, 'oldNote is beyond the newest 100 in the flat list');

  // In the tree, Project Zeta contains oldNote
  const zetaBtn = page.locator('.tree-folder-btn', { hasText: pZeta });
  check(await zetaBtn.count() === 1, 'Project Zeta folder exists in tree');
  // Expand Project Zeta
  if (await zetaBtn.getAttribute('aria-expanded') !== 'true') {
    await zetaBtn.click();
  }
  await page.waitForSelector('.tree-note-item:has-text("Oldest Zeta Note")', { timeout: 10000 });
  const treeHasOld = await page.locator('.tree-note-item', { hasText: 'Oldest Zeta Note' }).count();
  check(treeHasOld === 1, 'oldNote beyond newest 100 is visible in the Folders tree');

  // --- CHECK 2: Journal entries are excluded from tree ---
  const treeDailyCount = await page.locator('.tree-note-item', { hasText: '2026-03-15' }).count();
  check(treeDailyCount === 0, 'Journal daily notes never appear in the Folders tree');

  // --- CHECK 3: The open note's folder auto-expands & is highlighted ---
  const gammaBtn = page.locator('.tree-folder-btn', { hasText: pGamma });
  check(await gammaBtn.getAttribute('aria-expanded') === 'true', 'Open note A folder (Project Gamma) auto-expanded');
  const activeTreeNote = page.locator('.tree-note-item.active');
  check((await activeTreeNote.innerText()).trim() === 'Note A in Gamma', 'Open note A is highlighted active in tree');

  // --- CHECK 4: Expansion is remembered after a reload ---
  // Currently both Zeta and Gamma are expanded.
  await page.reload();
  await page.waitForSelector('.tree-folder-btn');
  await page.waitForTimeout(1000);
  check(await page.locator('.tree-folder-btn', { hasText: pZeta }).getAttribute('aria-expanded') === 'true', 'Zeta expansion remembered after reload');
  check(await page.locator('.tree-folder-btn', { hasText: pGamma }).getAttribute('aria-expanded') === 'true', 'Gamma expansion remembered after reload');

  // --- CHECK 5: Rename a note, and check the tree updates ---
  await page.click('.note-title-input');
  await page.fill('.note-title-input', 'Note A Renamed');
  // Wait for 600ms autosave debounce + save
  await page.waitForTimeout(1500);
  const renamedInTree = await page.locator('.tree-note-item', { hasText: 'Note A Renamed' }).count();
  check(renamedInTree === 1, 'Renaming note updates the tree title');

  // --- CHECK 6: Archive a note, and check the tree updates ---
  await page.selectOption('.properties-bar select.prop-select', 'archived');
  await page.waitForTimeout(1500);
  const archivedInTree = await page.locator('.tree-note-item', { hasText: 'Note A Renamed' }).count();
  check(archivedInTree === 0, 'Archived note is removed from the active Folders tree');

  // --- CHECK 7: Moving a note updates the tree and destination folder expands ---
  // Open noteB (currently unfiled)
  await page.goto(`${APP}/#/note/${noteB.id}`);
  await page.waitForSelector('.properties-bar .folder-select');
  await page.waitForTimeout(800);

  // Collapse Zeta first to verify destination auto-expands
  const zetaToggle = page.locator('.tree-folder-btn', { hasText: pZeta });
  if (await zetaToggle.getAttribute('aria-expanded') === 'true') {
    await zetaToggle.click();
    await page.waitForTimeout(300);
  }
  check(await zetaToggle.getAttribute('aria-expanded') === 'false', 'Zeta is collapsed before move');

  // Move noteB to Project Zeta
  await page.selectOption('.properties-bar .folder-select', pZeta);
  await page.waitForSelector(`.tree-folder:has-text("${pZeta}") .tree-note-item:has-text("Note B Unfiled")`, { timeout: 10000 });

  // Verify Zeta auto-expanded and contains noteB
  check(await page.locator('.tree-folder-btn', { hasText: pZeta }).getAttribute('aria-expanded') === 'true', 'Destination folder Zeta auto-expanded');
  const noteBInZeta = await page.locator(`.tree-folder:has-text("${pZeta}") .tree-note-item`, { hasText: 'Note B Unfiled' }).count();
  check(noteBInZeta === 1, 'Moved note B is in destination folder Zeta in tree');

  // --- CHECK 8: Typing just before moving a note is kept ---
  await page.click('.note-textarea');
  await page.keyboard.type('\nTyped right before moving');
  // Immediately move noteB back to Unfiled without pausing for autosave debounce
  await page.selectOption('.properties-bar .folder-select', '');
  await page.waitForTimeout(1500);

  const freshNoteB = await getNote(noteB.id);
  check(freshNoteB.content.includes('Typed right before moving'), 'Typing just before moving note is preserved');
  check(freshNoteB.project === null, 'Note B project is now null (unfiled)');

  // --- CHECK 9: New folder flow (creation, confirmation, case-insensitive match, suggestions) ---
  const pCancelled = `Never Created ${suffix}`;
  const pAccepted = `Brand New Folder ${suffix}`;

  // 9a: Cancelling the confirmation creates no project and does not move the note
  await page.selectOption('.properties-bar .folder-select', '__NEW_FOLDER__');
  await page.waitForSelector('.folder-create-input');
  await page.fill('.folder-create-input', pCancelled);

  const dialogCountBeforeCancel = dialogs.length;
  page.dialogAnswer = 'dismiss';
  await page.click('.folder-confirm-btn');
  await page.waitForTimeout(600);

  check(dialogs.length === dialogCountBeforeCancel + 1, 'Confirmation dialog was shown on new folder creation');
  check(dialogs[dialogs.length - 1].includes(pCancelled), 'Confirmation dialog message mentions the folder name');
  const cancelledFolderCount = await page.locator('.tree-folder-btn', { hasText: pCancelled }).count();
  check(cancelledFolderCount === 0, 'Cancelled folder was not added to the tree');
  const noteBAfterCancel = await getNote(noteB.id);
  check(noteBAfterCancel.project === null, 'Note B was not moved after cancelling confirmation');

  // Cancel the create input mode
  if (await page.locator('.folder-cancel-btn').isVisible()) {
    await page.click('.folder-cancel-btn');
    await page.waitForTimeout(300);
  }

  // 9b: Accepting the confirmation creates the folder and moves the note
  await page.selectOption('.properties-bar .folder-select', '__NEW_FOLDER__');
  await page.waitForSelector('.folder-create-input');
  await page.fill('.folder-create-input', pAccepted);

  const dialogCountBeforeAccept = dialogs.length;
  page.dialogAnswer = 'accept';
  await page.click('.folder-confirm-btn');
  await page.waitForSelector(`.tree-folder:has-text("${pAccepted}") .tree-note-item:has-text("Note B Unfiled")`, { timeout: 10000 });

  check(dialogs.length === dialogCountBeforeAccept + 1, 'Confirmation dialog was accepted');
  const noteBAfterAccept = await getNote(noteB.id);
  check(noteBAfterAccept.project?.name === pAccepted, 'Note B moved to newly created folder');

  // 9c: Typing an existing name in a different case moves note without creating duplicate project
  await page.selectOption('.properties-bar .folder-select', '__NEW_FOLDER__');
  await page.waitForSelector('.folder-create-input');
  const pGammaDifferentCase = pGamma.toLowerCase();
  await page.fill('.folder-create-input', pGammaDifferentCase);

  const dialogCountBeforeDiffCase = dialogs.length;
  await page.click('.folder-confirm-btn');
  await page.waitForSelector(`.tree-folder:has-text("${pGamma}") .tree-note-item:has-text("Note B Unfiled")`, { timeout: 10000 });

  check(dialogs.length === dialogCountBeforeDiffCase, 'No confirmation dialog shown for existing folder in different case');
  const noteBAfterDiffCase = await getNote(noteB.id);
  check(noteBAfterDiffCase.project?.name === pGamma, 'Note B moved to existing project pGamma');
  const allProjects = await api('/api/projects');
  const matchingProjects = (allProjects.projects || []).filter(
    (p) => p.name.toLowerCase() === pGamma.toLowerCase()
  );
  check(matchingProjects.length === 1, 'No duplicate project created for case-insensitive match');

  // 9d: The suggestion chips move the note (verifying normalized matching)
  await page.selectOption('.properties-bar .folder-select', '__NEW_FOLDER__');
  await page.waitForSelector('.folder-create-input');
  await page.fill('.folder-create-input', 'project   zeta');
  await page.waitForSelector(`.folder-suggestion-chip:has-text("${pZeta}")`, { timeout: 5000 });

  await page.click(`.folder-suggestion-chip:has-text("${pZeta}")`);
  await page.waitForSelector(`.tree-folder:has-text("${pZeta}") .tree-note-item:has-text("Note B Unfiled")`, { timeout: 10000 });

  const noteBAfterChip = await getNote(noteB.id);
  check(noteBAfterChip.project?.name === pZeta, 'Suggestion chip moved Note B to Project Zeta');

  // --- CHECK 10: Switching notes quickly never writes into the wrong note ---
  const switch1 = await createNote({ title: 'Switch One', content: 'original one' });
  const switch2 = await createNote({ title: 'Switch Two', content: 'original two' });
  createdNotes.push(switch1, switch2);

  await page.goto(`${APP}/#/note/${switch1.id}`);
  await page.waitForSelector('.note-textarea');
  await page.waitForTimeout(500);
  await page.click('.note-textarea');
  await page.keyboard.type(' EDITED ONE');

  // Rapidly switch to switch2
  await page.goto(`${APP}/#/note/${switch2.id}`);
  await page.waitForTimeout(1200);

  const check1 = await getNote(switch1.id);
  const check2 = await getNote(switch2.id);
  check(check1.content.includes('EDITED ONE'), 'Switch 1 got its edit');
  check(!check2.content.includes('EDITED ONE'), 'Switch 2 was NOT corrupted by switch 1 edit');

  // --- CHECK 11: Light and dark mode ---
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await page.waitForTimeout(300);
  check(await page.locator('.folders-tree-section').isVisible(), 'Tree renders in dark mode');

  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  await page.waitForTimeout(300);
  check(await page.locator('.folders-tree-section').isVisible(), 'Tree renders in light mode');

  check(errors.length === 0, `No browser errors: ${errors.join(', ')}`);
} finally {
  await browser.close();
  await deleteNotes(createdNotes);
}

finish();
