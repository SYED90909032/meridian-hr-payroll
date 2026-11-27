import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';

let owner: pg.Pool;
const packId = `gate-${randomUUID().slice(0, 8)}`;
const version = '0.0.1';
const hash = 'a'.repeat(64);
const docHash = 'b'.repeat(64);

beforeAll(() => { owner = new pg.Pool({ connectionString: process.env.DATABASE_URL_OWNER, max: 2 }); });
afterAll(async () => {
  await owner.query('delete from pay.pack_signoff where pack_id = $1', [packId]);
  await owner.query('delete from pay.pack_registry where pack_id = $1', [packId]);
  await owner.end();
});

const blocked = async (sql: string, params: unknown[], message: RegExp) => {
  await expect(owner.query(sql, params)).rejects.toThrow(message);
};

async function addSignoff(fields: { golden?: string | null; bank?: string | null; ids?: string[]; packHash?: string } = {}) {
  await owner.query(`insert into pay.pack_signoff (pack_id, version, pack_hash, reviewer_name, reviewer_organisation, credential_note, signed_at, scope, document_reference, document_hash, golden_vector_set_hash, bank_wps_acceptance_reference, parallel_run_ids)
    values ($1,$2,$3,'Reviewer Name','Independent Payroll Org','Credential record supplied by reviewer',now(),'UAE private-sector monthly payroll','evidence://document',$4,$5,$6,$7::uuid[])`,
    [packId, version, fields.packHash ?? hash, docHash, fields.golden ?? null, fields.bank ?? null, fields.ids ?? []]);
}

describe('Phase 2 live-payment gate', () => {
  it('ships the UAE registry at L0', async () => {
    const r = await owner.query<{ assurance: string }>("select assurance from pay.pack_registry where pack_id = 'ae-private-sector'");
    expect(r.rows.length).toBeGreaterThan(0);
    expect(r.rows.every((x) => x.assurance === 'L0')).toBe(true);
  });

  it('blocks promotion with no matching sign-off', async () => {
    await owner.query("insert into pay.pack_registry (pack_id, version, pack_hash, assurance) values ($1,$2,$3,'L0')", [packId, version, hash]);
    await blocked("update pay.pack_registry set assurance = 'L2', reviewer = 'Reviewer Name', reviewed_at = now() where pack_id = $1", [packId], /matching sign-off is missing/);
  });

  it('blocks when the golden-vector evidence is missing', async () => {
    await addSignoff({ bank: 'BANK-ACCEPT-1' });
    await blocked("update pay.pack_registry set assurance = 'L2', reviewer = 'Reviewer Name', reviewed_at = now() where pack_id = $1", [packId], /golden vectors/);
    await owner.query('delete from pay.pack_signoff where pack_id = $1', [packId]);
  });

  it('blocks when bank evidence is missing', async () => {
    await addSignoff({ golden: hash });
    await blocked("update pay.pack_registry set assurance = 'L2', reviewer = 'Reviewer Name', reviewed_at = now() where pack_id = $1", [packId], /golden vectors/);
    await owner.query('delete from pay.pack_signoff where pack_id = $1', [packId]);
  });

  it('blocks when two qualifying parallel runs are missing', async () => {
    await addSignoff({ golden: hash, bank: 'BANK-ACCEPT-1' });
    await blocked("update pay.pack_registry set assurance = 'L2', reviewer = 'Reviewer Name', reviewed_at = now() where pack_id = $1", [packId], /golden vectors/);
  });

  it('changing the pack hash invalidates the prior sign-off', async () => {
    const changed = 'c'.repeat(64);
    await owner.query("update pay.pack_registry set pack_hash = $2 where pack_id = $1", [packId, changed]);
    await blocked("update pay.pack_registry set assurance = 'L2', reviewer = 'Reviewer Name', reviewed_at = now() where pack_id = $1", [packId], /matching sign-off is missing/);
    await owner.query('delete from pay.pack_signoff where pack_id = $1', [packId]);
  });
});
