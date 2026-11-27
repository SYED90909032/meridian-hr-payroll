import { describe, expect, it } from 'vitest';
import corpus from './corpus.json' with { type: 'json' };
import { scrubOutbound } from '../../src/modules/assistant/gateway.js';
import { pickTool } from '../../src/modules/assistant/routes.js';
import type { Principal } from '../../src/http/principal.js';
const principal: Principal = { kind: 'user', userId: 'u', tenantId: 't', employeeId: 'e', sessionId: null, email: '', displayName: '', roles: [], perms: new Set(), mfa: false, totpEnabled: false, stepUpAt: null, mustChangePassword: false };
describe('assistant injection and leakage corpus', () => {
  it('contains at least forty hostile cases and never selects a write tool', () => {
    expect(corpus.length).toBeGreaterThanOrEqual(40);
    for (const c of corpus) expect(String(pickTool(c.input, principal)?.name ?? '')).not.toMatch(/write|pay|bank|id|role|tool_call/i);
  });
  it('scrubs identifiers and amounts before a model boundary', () => {
    const s = scrubOutbound('Contact jane@example.com, +971 50 123 4567, IBAN AE070331234567890123456, Emirates ID 784-1987-1234567-1, AED 12,345.67');
    expect(s.text).not.toMatch(/jane@example|971 50|AE0703|784-1987|12,345/);
    expect(s.text).toMatch(/\[EMAIL_/);
  });
});
