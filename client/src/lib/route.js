// Maps the app's navigation state to a URL hash so the browser's Back/Forward buttons work.
//   #/note/<id>  -> document view on that note
//   #/table | #/tasks | #/trash -> those views
const VIEWS = ['table', 'tasks', 'trash'];

export function parseHash(hash) {
  const parts = String(hash || '').replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'note' && parts[1]) return { view: 'document', noteId: decodeURIComponent(parts[1]) };
  if (VIEWS.includes(parts[0])) return { view: parts[0], noteId: null };
  return { view: 'document', noteId: null };
}

export function formatHash(view, noteId) {
  if (view !== 'document') return `#/${view}`;
  return noteId ? `#/note/${encodeURIComponent(noteId)}` : '#/';
}
