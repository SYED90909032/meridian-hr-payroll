/**
 * <SolarIcon icon="solar:..." />: Iconify Solar icons bundled offline (Spike Admin UI system).
 * The name must be a plain string literal so scripts/build-solar-subset.mjs can find it.
 * Colour follows currentColor.
 */
import { addCollection, Icon } from '@iconify/react';
import type { IconifyJSON } from '@iconify/types';
import { Box, type SxProps, type Theme } from '@mui/material';
import subset from './solar-subset.json';

addCollection(subset as unknown as IconifyJSON);

export type SolarName = `solar:${string}`;
export interface SolarIconProps { icon: SolarName; size?: number | string; color?: string; className?: string; sx?: SxProps<Theme> }

export const SolarIcon = ({ icon, size = 20, color, className, sx }: SolarIconProps) => (
  <Box component="span" className={className} sx={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color, lineHeight: 0, flexShrink: 0, ...sx }}>
    <Icon icon={icon} width={size} height={size} />
  </Box>
);
export default SolarIcon;
