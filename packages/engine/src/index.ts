import { compilePack } from './pack.js';
import { UAE_PACK } from './packs/uae.js';

export * from './money.js';
export * from './canonical.js';
export * from './expr.js';
export * from './pack.js';
export * from './contracts.js';
export * from './calc.js';
export * from './sif.js';
export { UAE_PACK };

/** Packs shipped with the engine and their assurance level. Assurance is registry data, not part of the pack hash. */
export const PACK_REGISTRY = {
  'ae-private-sector': { pack: compilePack(UAE_PACK), assurance: 'L0' as const },
};
