/**
 * Sun ⇄ moon glyph for the header colour-mode switch, ported from the supplied theme-toggle
 * reference. The eight rays retract one after another (15 ms stagger) while the group turns
 * 45°, and the disc morphs into a crescent. Both paths have the same command structure
 * (M + 4 C + Z), so the CSS `d` transition can interpolate them. Browsers without CSS `d`
 * support (Safari) swap the shape instantly; the rays still animate everywhere.
 * Reduced-motion users get no transitions (see the media query below).
 */
import type { CSSProperties } from 'react';
import { Box } from '@mui/material';

const SUN = 'M12 5C15.866 5 19 8.134 19 12C19 15.866 15.866 19 12 19C8.134 19 5 15.866 5 12C5 8.134 8.134 5 12 5Z';
const MOON = 'M18.9 15.2C17.2 19.3 12.9 21.2 8.8 19.4C4.7 17.6 2.7 13 4.4 8.8C5.4 6.2 7.7 4.3 10.4 3.8C8.1 10.4 12.3 16.8 18.9 15.2Z';
const EASE = 'cubic-bezier(.42,0,.18,1)';

export function ThemeToggleIcon({ dark, size = 22 }: { dark: boolean; size?: number }) {
  const body = dark ? MOON : SUN;
  return (
    <Box component="svg" viewBox="0 0 24 24" width={size} height={size} fill="none" aria-hidden focusable="false"
      sx={{ overflow: 'visible', '@media (prefers-reduced-motion: reduce)': { '& *': { transition: 'none !important' } } }}>
      <g style={{ transformOrigin: '12px 12px', transform: `rotate(${dark ? 45 : 0}deg)`, transition: `transform .5s ${EASE}` }}>
        {Array.from({ length: 8 }, (_, i) => (
          <path key={i} d="M12 1.5V3" transform={`rotate(${i * 45} 12 12)`} stroke="currentColor" strokeWidth={1.6} strokeLinecap="round"
            pathLength={1} strokeDasharray="1 1"
            style={{ strokeDashoffset: dark ? 1 : 0, opacity: dark ? 0 : 1, transition: `stroke-dashoffset .2s ease ${i * 15}ms, opacity .2s ease ${i * 15}ms` }} />
        ))}
      </g>
      <path d={body} fill="currentColor"
        style={{ d: `path("${body}")`, transformOrigin: '12px 12px', transform: `rotate(${dark ? -12 : 0}deg)`, transition: `d .5s ${EASE}, transform .5s ${EASE}` } as CSSProperties} />
    </Box>
  );
}
