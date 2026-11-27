import type { Config } from '../config.js';
import { ClamdScanner, NoneScanner, type Scanner } from './scanner.js';

export function createScanner(cfg: Config): Scanner {
  if (cfg.SCANNER === 'clamd') return new ClamdScanner({ host: cfg.CLAMD_HOST, port: cfg.CLAMD_PORT, timeoutMs: cfg.CLAMD_TIMEOUT_MS, maxResponseBytes: cfg.SCANNER_MAX_RESPONSE_BYTES });
  if (cfg.NODE_ENV === 'production' && !cfg.ALLOW_UNSCANNED_DOCUMENTS) throw new Error('SCANNER=none is not allowed in production unless ALLOW_UNSCANNED_DOCUMENTS=true');
  if (cfg.NODE_ENV === 'production') console.warn('WARNING: document uploads are unscanned because ALLOW_UNSCANNED_DOCUMENTS=true');
  return new NoneScanner();
}
