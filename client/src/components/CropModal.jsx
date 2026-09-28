import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Crop } from 'lucide-react';
import { initialSquare, moveSquare, resizeSquare, canCrop } from '../lib/cropMath.js';

// Pick a square on a photo: drag the square to move it, use the slider or the mouse
// wheel to resize it. The square is kept in the photo's own pixels (as the browser shows
// it, i.e. already upright) and only scaled for display. Rendered into <body> so the
// editor pane's layout can't clip it.
export default function CropModal({ attachment, onCancel, onSave }) {
  const [natural, setNatural] = useState(null); // { width, height } once the photo loads
  const [square, setSquare] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const imgRef = useRef(null);
  const dragRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !saving) onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [saving, onCancel]);

  const handleLoad = (e) => {
    const { naturalWidth: width, naturalHeight: height } = e.currentTarget;
    setNatural({ width, height });
    setSquare(initialSquare(width, height));
  };

  // Photo pixels per screen pixel, read at the moment it's needed (the window can resize).
  const scale = () => (natural && imgRef.current ? natural.width / imgRef.current.clientWidth : 1);

  const handlePointerDown = (e) => {
    if (saving) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, start: square, scale: scale() };
  };
  const handlePointerMove = (e) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = (e.clientX - drag.startX) * drag.scale;
    const dy = (e.clientY - drag.startY) * drag.scale;
    setSquare(moveSquare(drag.start, dx, dy, natural.width, natural.height));
  };
  const handlePointerUp = () => { dragRef.current = null; };

  const handleWheel = (e) => {
    if (!square || saving) return;
    const factor = e.deltaY < 0 ? 1.05 : 1 / 1.05;
    setSquare((sq) => resizeSquare(sq, sq.size * factor, natural.width, natural.height));
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(square);
    } catch (err) {
      setError(err.message || 'Could not crop the photo');
      setSaving(false);
    }
  };

  const tooSmall = natural && !canCrop(natural.width, natural.height);
  const pct = (v) => `${(v / (natural?.width || 1)) * 100}%`;
  const pctY = (v) => `${(v / (natural?.height || 1)) * 100}%`;

  return createPortal(
    <div className="modal-overlay" onClick={() => !saving && onCancel()}>
      <div className="modal-card crop-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Crop size={18} color="var(--accent-primary)" />
            <h3 style={{ fontSize: 16, fontWeight: 600 }}>Crop to a square</h3>
          </div>
          <button className="btn-icon" onClick={onCancel} disabled={saving} aria-label="Cancel">
            <X size={16} />
          </button>
        </div>

        <div className="modal-body">
          <div className="crop-stage" onWheel={handleWheel}>
            <img ref={imgRef} src={attachment.url} alt={attachment.filename} onLoad={handleLoad} draggable={false} />
            {square && !tooSmall && (
              <div
                className="crop-square"
                data-testid="crop-square"
                style={{ left: pct(square.x), top: pctY(square.y), width: pct(square.size), height: pctY(square.size) }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
              />
            )}
          </div>

          {tooSmall ? (
            <div className="crop-note">This photo is too small to crop.</div>
          ) : square && (
            <label className="crop-size">
              <span>Size</span>
              <input
                type="range"
                min={Math.min(64, Math.min(natural.width, natural.height))}
                max={Math.min(natural.width, natural.height)}
                value={square.size}
                disabled={saving}
                onChange={(e) => setSquare((sq) => resizeSquare(sq, Number(e.target.value), natural.width, natural.height))}
              />
              <span className="crop-size-value">{Math.min(square.size, 2048)} px</span>
            </label>
          )}

          {error && <div className="crop-error">{error}</div>}

          <div className="crop-actions">
            <button type="button" className="btn-conflict" onClick={onCancel} disabled={saving}>Cancel</button>
            <button type="button" className="btn-primary" onClick={handleSave} disabled={saving || !square || tooSmall}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
