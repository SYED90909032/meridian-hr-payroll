/** Types for the Solar icon subset builder (scripts/build-solar-subset.mjs). */
import type { Plugin } from 'vite';
export function buildSolarSubset(opts?: { quiet?: boolean }): boolean;
export function solarSubsetPlugin(): Plugin;
