// Maps the app's navigation state to a URL hash so the browser's Back/Forward buttons work.
//   #/note/<id>  -> document view on that note
//   #/journal[/YYYY-MM] | #/table | #/tasks | #/trash -> those views (the journal remembers its month)
const VIEWS = ['journal', 'table', 'tasks', 'trash'];

export function parseHash(hash) {
  const parts = String(hash || '').replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'note' && parts[1]) return { view: 'document', noteId: decodeURIComponent(parts[1]) };
  if (parts[0] === 'journal') {
    const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(parts[1] || '') ? parts[1] : null;
    return { view: 'journal', noteId: null, month };
  }
  if (VIEWS.includes(parts[0])) return { view: parts[0], noteId: null };
  return { view: 'document', noteId: null };
}

export function formatHash(view, noteId, month = null) {
  if (view === 'journal') return month ? `#/journal/${month}` : '#/journal';
  if (view !== 'document') return `#/${view}`;
  return noteId ? `#/note/${encodeURIComponent(noteId)}` : '#/';
}
