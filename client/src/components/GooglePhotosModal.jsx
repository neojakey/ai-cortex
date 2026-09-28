import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, ImagePlus } from 'lucide-react';

// Paste a Google Photos share link to add that photo to a note as an attachment
// (core/services/googlePhotosImport.js does the download). The note's text is never
// touched. The window can't be closed while the photo downloads, and an error keeps the
// link in the box so it can be fixed and tried again. Rendered into <body> so the editor
// pane's layout can't clip it.
export default function GooglePhotosModal({ noteId, onClose, onAdded }) {
  const [link, setLink] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !adding) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [adding, onClose]);

  const url = link.trim();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!url || adding) return;
    setAdding(true);
    setError(null);
    try {
      const res = await fetch('/api/attachments/from-google-photos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, noteId })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.attachment) throw new Error(data.error || `Could not add the photo (${res.status})`);
      await onAdded(data.attachment);
      onClose();
    } catch (err) {
      setError(err.message);
      setAdding(false);
    }
  };

  return createPortal(
    <div className="modal-overlay" onClick={() => !adding && onClose()}>
      <div className="modal-card google-photos-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <ImagePlus size={18} color="var(--accent-primary)" />
            <h3 style={{ fontSize: 16, fontWeight: 600 }}>Add from Google Photos</h3>
          </div>
          <button className="btn-icon" onClick={onClose} disabled={adding} aria-label="Cancel">
            <X size={16} />
          </button>
        </div>

        <form className="modal-body" onSubmit={handleSubmit}>
          <label className="google-photos-field">
            <span>Share link</span>
            <input
              ref={inputRef}
              type="text"
              value={link}
              placeholder="https://photos.app.goo.gl/…"
              onChange={(e) => setLink(e.target.value)}
              disabled={adding}
              spellCheck={false}
              autoComplete="off"
            />
          </label>
          <div className="google-photos-hint">
            In Google Photos, open the photo and use Share → Create link, then paste it here.
          </div>

          {error && <div className="crop-error" role="alert">{error}</div>}

          <div className="crop-actions">
            <button type="button" className="btn-conflict" onClick={onClose} disabled={adding}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={!url || adding}>
              {adding ? 'Adding…' : 'Add'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
