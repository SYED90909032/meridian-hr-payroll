import { createHash } from 'node:crypto';
import pg from 'pg';
import { loadDotEnv } from '../env.js';
loadDotEnv();

const url = process.env.DATABASE_URL_OWNER;
if (!url) { console.error('DATABASE_URL_OWNER is required'); process.exit(1); }
const cliArgs = process.argv.slice(2).filter((arg) => arg !== '--');
const [command, ...args] = cliArgs;
const value = (name: string): string | undefined => { const i = args.indexOf(`--${name}`); return i < 0 ? undefined : args[i + 1]; };
const required = (name: string): string => { const v = value(name); if (!v) throw new Error(`missing --${name}`); return v; };
const db = new pg.Client({ connectionString: url });

async function status(packId: string, version: string, hash: string) {
  const reg = (await db.query('select assurance, reviewer, reviewed_at from pay.pack_registry where pack_id = $1 and version = $2 and pack_hash = $3', [packId, version, hash])).rows[0];
  const sign = (await db.query('select reviewer_name, reviewer_organisation, credential_note, signed_at, scope, document_reference, document_hash, golden_vector_set_hash, bank_wps_acceptance_reference, parallel_run_ids from pay.pack_signoff where pack_id = $1 and version = $2 and pack_hash = $3', [packId, version, hash])).rows[0];
  const ids = (sign?.parallel_run_ids ?? []) as string[];
  const qualifying = ids.length ? Number((await db.query("select count(distinct r.id)::int as n from pay.parallel_run r join pay.pay_run pr on pr.id = r.pay_run_id where r.id = any($1::uuid[]) and r.status = 'zero_variance' and r.zero_unexplained and r.completed_at is not null and pr.pack_id = $2 and pr.pack_version = $3 and pr.pack_hash = $4", [ids, packId, version, hash])).rows[0].n) : 0;
  const missing: string[] = [];
  if (!reg) missing.push('pack registry row');
  if (!sign) missing.push('matching reviewer sign-off');
  if (!sign?.golden_vector_set_hash) missing.push('golden-vector set hash');
  if (!sign?.bank_wps_acceptance_reference) missing.push('bank WPS acceptance reference');
  if (qualifying < 2) missing.push(`two qualifying zero-variance parallel runs (found ${qualifying})`);
  if ((!reg?.reviewer || !reg?.reviewed_at) && (!sign?.reviewer_name || !sign?.signed_at)) missing.push('named reviewer and review date');
  console.log(JSON.stringify({ pack: { packId, version, hash }, assurance: reg?.assurance ?? 'unregistered', missing, signoff: sign ? { reviewer: sign.reviewer_name, organisation: sign.reviewer_organisation, signedAt: sign.signed_at, scope: sign.scope, documentReference: sign.document_reference, documentHash: sign.document_hash, goldenVectorSetHash: sign.golden_vector_set_hash, bankWpsAcceptanceReference: sign.bank_wps_acceptance_reference, parallelRunIds: ids, qualifyingParallelRuns: qualifying } : null }, null, 2));
  return { reg, sign, qualifying, missing };
}

try {
  await db.connect();
  if (command === 'record') {
    const packId = required('pack-id'), version = required('version'), packHash = required('pack-hash');
    const doc = required('document-reference');
    if (!/^[a-f0-9]{64}$/.test(packHash)) throw new Error('pack-hash must be a SHA-256 hex digest');
    const ids = (value('parallel-run-id') ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    await db.query(`insert into pay.pack_signoff (pack_id, version, pack_hash, reviewer_name, reviewer_organisation, credential_note, signed_at, scope, document_reference, document_hash, golden_vector_set_hash, bank_wps_acceptance_reference, parallel_run_ids) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::uuid[]) on conflict (pack_id,version,pack_hash) do update set reviewer_name=excluded.reviewer_name, reviewer_organisation=excluded.reviewer_organisation, credential_note=excluded.credential_note, signed_at=excluded.signed_at, scope=excluded.scope, document_reference=excluded.document_reference, document_hash=excluded.document_hash, golden_vector_set_hash=excluded.golden_vector_set_hash, bank_wps_acceptance_reference=excluded.bank_wps_acceptance_reference, parallel_run_ids=excluded.parallel_run_ids`, [packId, version, packHash, required('reviewer-name'), required('reviewer-organisation'), required('credential-note'), required('signed-at'), required('scope'), doc, value('document-hash') ?? createHash('sha256').update(doc).digest('hex'), value('golden-vector-hash') ?? null, value('bank-acceptance-reference') ?? null, ids]);
    console.log('sign-off recorded; promotion remains blocked until status reports no missing evidence');
  } else if (command === 'status') {
    await status(required('pack-id'), required('version'), required('pack-hash'));
  } else if (command === 'promote') {
    const packId = required('pack-id'), version = required('version'), hash = required('pack-hash');
    const s = await status(packId, version, hash);
    if (s.missing.length) throw new Error(`promotion blocked; missing: ${s.missing.join('; ')}`);
    await db.query('begin');
    try { await db.query("update pay.pack_registry set assurance = 'L2', reviewer = $3, reviewed_at = now() where pack_id = $1 and version = $2 and pack_hash = $4", [packId, version, required('reviewer'), hash]); await db.query('commit'); console.log('pack promoted to L2'); }
    catch (e) { await db.query('rollback'); throw e; }
  } else throw new Error('usage: record|status|promote');
} catch (e) { console.error((e as Error).message); process.exitCode = 1; } finally { await db.end(); }
