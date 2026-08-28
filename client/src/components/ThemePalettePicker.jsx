import React, { useRef } from 'react';
import { COLOR_SCHEMES } from '../theme/palettes.js';
import { Check, Pipette } from 'lucide-react';

export default function ThemePalettePicker({
  activeSchemeId,
  isDark,
  customColor,
  onSelectScheme,
  onSelectCustomColor
}) {
  const colorInputRef = useRef(null);

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(4, 1fr)',
      gap: 10,
      padding: 14,
      background: 'var(--bg-app)',
      border: '1px solid var(--border-dim)',
      borderRadius: 'var(--radius-lg)',
      width: 280,
      boxShadow: 'var(--shadow-modal)'
    }}>
      {COLOR_SCHEMES.map((scheme) => {
        const isActive = activeSchemeId === scheme.id && !customColor;
        const swatch = isDark ? scheme.swatchDark : scheme.swatchLight;

        return (
          <button
            key={scheme.id}
            onClick={() => onSelectScheme(scheme.id)}
            title={scheme.name}
            style={{
              aspectRatio: '1',
              background: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.04)',
              border: isActive ? '2px solid var(--accent-primary)' : '1px solid var(--border-dim)',
              borderRadius: 'var(--radius-md)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              position: 'relative',
              padding: 6,
              transition: 'all 0.15s ease'
            }}
          >
            {/* Split Circle Swatch Preview */}
            <div style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              overflow: 'hidden',
              position: 'relative',
              boxShadow: '0 2px 6px rgba(0,0,0,0.18)',
              display: 'flex',
              flexDirection: 'column'
            }}>
              {/* Top Half */}
              <div style={{ width: '100%', height: '50%', background: swatch.top }} />
              {/* Bottom Half (Split Left and Right) */}
              <div style={{ width: '100%', height: '50%', display: 'flex' }}>
                <div style={{ width: '50%', height: '100%', background: swatch.left }} />
                <div style={{ width: '50%', height: '100%', background: swatch.right }} />
              </div>

              {/* Active Checkmark Badge */}
              {isActive && (
                <div style={{
                  position: 'absolute',
                  top: 2,
                  right: 2,
                  width: 14,
                  height: 14,
                  borderRadius: '50%',
                  background: '#2563eb',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.4)'
                }}>
                  <Check size={9} color="#ffffff" strokeWidth={3} />
                </div>
              )}
            </div>
          </button>
        );
      })}

      {/* 16th Slot: Custom Color Eyedropper */}
      <button
        onClick={() => colorInputRef.current?.click()}
        title="Custom Accent Color"
        style={{
          aspectRatio: '1',
          background: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.04)',
          border: customColor ? '2px solid var(--accent-primary)' : '1px solid var(--border-dim)',
          borderRadius: 'var(--radius-md)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          position: 'relative',
          padding: 6,
          transition: 'all 0.15s ease'
        }}
      >
        <input
          type="color"
          ref={colorInputRef}
          value={customColor || '#6366f1'}
          onChange={(e) => onSelectCustomColor(e.target.value)}
          style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }}
        />
        <div style={{
          width: 36,
          height: 36,
          borderRadius: '50%',
          background: customColor || (isDark ? '#27272a' : '#e4e4e7'),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 2px 6px rgba(0,0,0,0.18)',
          position: 'relative'
        }}>
          <Pipette size={16} color={customColor ? '#ffffff' : 'var(--text-muted)'} />
          {customColor && (
            <div style={{
              position: 'absolute',
              top: 2,
              right: 2,
              width: 14,
              height: 14,
              borderRadius: '50%',
              background: '#2563eb',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 1px 3px rgba(0,0,0,0.4)'
            }}>
              <Check size={9} color="#ffffff" strokeWidth={3} />
            </div>
          )}
        </div>
      </button>
    </div>
  );
}
