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
      gridTemplateColumns: 'repeat(auto-fill, minmax(155px, 1fr))',
      gap: 12,
      width: '100%'
    }}>
      {COLOR_SCHEMES.map((scheme) => {
        const isActive = activeSchemeId === scheme.id && !customColor;
        const palette = isDark ? scheme.dark : scheme.light;

        return (
          <button
            key={scheme.id}
            type="button"
            onClick={() => onSelectScheme(scheme.id)}
            style={{
              background: 'var(--bg-card)',
              border: isActive ? '2px solid var(--accent-primary)' : '1px solid var(--border-dim)',
              borderRadius: 'var(--radius-md)',
              padding: '12px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
              boxShadow: isActive ? '0 0 16px var(--accent-glow)' : 'var(--shadow-subtle)',
              position: 'relative'
            }}
            onMouseEnter={(e) => {
              if (!isActive) {
                e.currentTarget.style.borderColor = 'var(--border-subtle)';
                e.currentTarget.style.transform = 'translateY(-2px)';
              }
            }}
            onMouseLeave={(e) => {
              if (!isActive) {
                e.currentTarget.style.borderColor = 'var(--border-dim)';
                e.currentTarget.style.transform = 'translateY(0)';
              }
            }}
          >
            {/* Elegant Gradient Swatch Ribbon */}
            <div style={{
              width: '100%',
              height: 28,
              borderRadius: 6,
              background: palette.gradient,
              boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.2), 0 2px 6px rgba(0,0,0,0.15)',
              position: 'relative',
              overflow: 'hidden'
            }}>
              {/* Subtle inner highlight shimmer */}
              <div style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: '40%',
                background: 'linear-gradient(to bottom, rgba(255,255,255,0.25), transparent)',
                pointerEvents: 'none'
              }} />
            </div>

            {/* Label & Active State */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              width: '100%'
            }}>
              <span style={{
                fontSize: 12.5,
                fontWeight: isActive ? 600 : 500,
                color: isActive ? 'var(--accent-primary)' : 'var(--text-main)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}>
                {scheme.name}
              </span>

              {isActive && (
                <div style={{
                  width: 16,
                  height: 16,
                  borderRadius: '50%',
                  background: 'var(--accent-primary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0
                }}>
                  <Check size={10} color="#ffffff" strokeWidth={3} />
                </div>
              )}
            </div>
          </button>
        );
      })}

      {/* 16th Card: Custom Hue Eyedropper */}
      <button
        type="button"
        onClick={() => colorInputRef.current?.click()}
        style={{
          background: 'var(--bg-card)',
          border: customColor ? '2px solid var(--accent-primary)' : '1px dashed var(--border-subtle)',
          borderRadius: 'var(--radius-md)',
          padding: '12px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          cursor: 'pointer',
          textAlign: 'left',
          transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
          boxShadow: customColor ? '0 0 16px var(--accent-glow)' : 'var(--shadow-subtle)',
          position: 'relative'
        }}
        onMouseEnter={(e) => {
          if (!customColor) {
            e.currentTarget.style.borderColor = 'var(--accent-primary)';
            e.currentTarget.style.transform = 'translateY(-2px)';
          }
        }}
        onMouseLeave={(e) => {
          if (!customColor) {
            e.currentTarget.style.borderColor = 'var(--border-subtle)';
            e.currentTarget.style.transform = 'translateY(0)';
          }
        }}
      >
        <input
          type="color"
          ref={colorInputRef}
          value={customColor || '#6366f1'}
          onChange={(e) => onSelectCustomColor(e.target.value)}
          style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }}
        />

        {/* Custom Color Swatch Ribbon */}
        <div style={{
          width: '100%',
          height: 28,
          borderRadius: 6,
          background: customColor || 'linear-gradient(135deg, #ec4899 0%, #8b5cf6 50%, #3b82f6 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.2), 0 2px 6px rgba(0,0,0,0.15)',
          gap: 6
        }}>
          <Pipette size={14} color="#ffffff" />
        </div>

        {/* Label & Active State */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%'
        }}>
          <span style={{
            fontSize: 12.5,
            fontWeight: customColor ? 600 : 500,
            color: customColor ? 'var(--accent-primary)' : 'var(--text-main)'
          }}>
            {customColor ? customColor.toUpperCase() : 'Custom Hue'}
          </span>

          {customColor && (
            <div style={{
              width: 16,
              height: 16,
              borderRadius: '50%',
              background: 'var(--accent-primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }}>
              <Check size={10} color="#ffffff" strokeWidth={3} />
            </div>
          )}
        </div>
      </button>
    </div>
  );
}
