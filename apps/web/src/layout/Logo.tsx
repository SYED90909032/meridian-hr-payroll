/**
 * Meridian logo in the Spike style (cf. Spike's SpikeLogoMark: a rounded gradient tile plus a
 * 600-weight wordmark). The "M" path is the original Meridian brand mark.
 */
import { Box, Typography } from '@mui/material';
import { Link } from 'react-router-dom';

export const LogoMark = ({ size = 36 }: { size?: number }) => (
  <Box aria-hidden sx={{ width: size, height: size, borderRadius: `${Math.round(size * 0.3)}px`, flex: 'none', display: 'grid', placeItems: 'center', background: 'linear-gradient(135deg, #0085DB 0%, #46CAEB 100%)', boxShadow: '0 6px 14px -4px rgba(0,133,219,.55)' }}>
    <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 32 32"><path d="M7 24V9l9 10 9-10v15" fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
  </Box>
);

export function Logo({ sub, collapsed }: { sub?: string; collapsed?: boolean }) {
  return (
    <Box component={Link} to="/" aria-label="Meridian home" sx={{ display: 'flex', alignItems: 'center', gap: 1.5, textDecoration: 'none !important', color: 'text.primary', minWidth: 0 }}>
      <LogoMark />
      {!collapsed && (
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontWeight: 700, fontSize: '1.375rem', lineHeight: 1.1, letterSpacing: '-0.02em' }}>Meridian</Typography>
          {sub && <Typography noWrap sx={{ fontSize: '0.75rem', color: 'text.secondary', maxWidth: 170 }}>{sub}</Typography>}
        </Box>
      )}
    </Box>
  );
}
