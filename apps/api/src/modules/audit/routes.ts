import { z } from 'zod';
import { defineRoute, type Services } from '../../http/route.js';
import { conflict } from '../../errors.js';
import { limitQ } from '../../http/schemas.js';
import { blockMessage, makeSigner, merkleRoot } from '../../crypto/sign.js';

export function registerAuditRoutes(svc: Services): void {
  const signer = makeSigner(svc.cfg.signingSeed);
  defineRoute(svc, {
    method: 'GET', path: '/api/v1/audit/events', summary: 'Audit log, newest first', tag: 'Audit', auth: 'any', perm: 'audit.read',
    query: z.object({ limit: limitQ, before_seq: z.coerce.number().int().min(1).optional(), action: z.string().max(80).optional() }),
    handler: async ({ db, query }) => {
      const args: unknown[] = []; const where: string[] = [];
      if (query.before_seq) { args.push(query.before_seq); where.push(`e.seq < $${args.length}`); }
      if (query.action) { args.push(query.action + '%'); where.push(`e.action like $${args.length}`); }
      args.push(query.limit);
      const r = await db.query(
        `select e.seq, e.at, e.actor_user_id, u.display_name as actor, e.action, e.entity, e.entity_id, e.data, e.ip, e.hash
           from kernel.audit_event e left join kernel.user_account u on u.id = e.actor_user_id
          ${where.length ? 'where ' + where.join(' and ') : ''} order by e.seq desc limit $${args.length}`, args);
      return { events: r.rows };
    },
  });
  defineRoute(svc, {
    method: 'GET', path: '/api/v1/audit/verify', summary: 'Recompute the whole hash chain and check sealed blocks', tag: 'Audit', auth: 'any', perm: 'audit.read',
    rateLimit: { max: 10, timeWindow: '1 minute' },
    handler: async ({ db, ctx }) => {
      const broken = (await db.query('select kernel.verify_audit($1) as seq', [ctx.tenantId])).rows[0].seq as string | null;
      const blocks = await db.query('select from_seq, to_seq, merkle_root, signature from kernel.audit_block order by from_seq');
      const badBlocks: Array<{ from_seq: string; reason: string }> = [];
      for (const b of blocks.rows) {
        const hs = await db.query('select hash from kernel.audit_event where seq between $1 and $2 order by seq', [b.from_seq, b.to_seq]);
        const expected = hs.rows.length === Number(b.to_seq) - Number(b.from_seq) + 1 ? merkleRoot(hs.rows.map((x) => x.hash as string)) : null;
        if (expected !== b.merkle_root) badBlocks.push({ from_seq: b.from_seq, reason: 'root_mismatch' });
        else if (!b.signature || !signer.verify(blockMessage(ctx.tenantId, b.from_seq, b.to_seq, b.merkle_root), b.signature)) badBlocks.push({ from_seq: b.from_seq, reason: 'bad_signature' });
      }
      return { intact: broken === null && badBlocks.length === 0, first_broken_seq: broken, bad_blocks: badBlocks, sealed_blocks: blocks.rows.length };
    },
  });
  defineRoute(svc, {
    method: 'GET', path: '/api/v1/audit/blocks', summary: 'Sealed audit blocks and the public key to check them', tag: 'Audit', auth: 'any', perm: 'audit.read',
    handler: async ({ db }) => {
      const r = await db.query('select from_seq, to_seq, merkle_root, signature, key_id, sealed_at from kernel.audit_block order by from_seq desc limit 200');
      return { blocks: r.rows, public_key_pem: signer.publicKeyPem, key_id: signer.keyId };
    },
  });
  defineRoute(svc, {
    method: 'POST', path: '/api/v1/audit/seal', summary: 'Seal all events since the last block with a Merkle root, signed with Ed25519', tag: 'Audit', auth: 'session', perm: 'audit.seal', stepUp: true,
    handler: async ({ db, ctx, audit }) => {
      // append_audit serialises writers on the head row until commit, so committed events are always contiguous. A concurrent seal collides on the (tenant, from_seq) key.
      const last = (await db.query('select coalesce(max(to_seq), 0) as s from kernel.audit_block')).rows[0].s as string;
      const from = Number(last) + 1;
      const hs = await db.query('select seq, hash from kernel.audit_event where seq >= $1 order by seq', [from]);
      if (!hs.rows.length) throw conflict('Nothing new to seal', 'nothing_to_seal');
      const to = Number(hs.rows[hs.rows.length - 1].seq);
      if (hs.rows.length !== to - from + 1) throw conflict('The audit chain has a gap. Run verify.', 'chain_gap');
      const root = merkleRoot(hs.rows.map((x) => x.hash as string));
      const signature = signer.sign(blockMessage(ctx.tenantId, from, to, root));
      await db.query('insert into kernel.audit_block (tenant_id, from_seq, to_seq, merkle_root, signature, key_id) values ($1, $2, $3, $4, $5, $6)', [ctx.tenantId, from, to, root, signature, signer.keyId]);
      await audit('audit.sealed', 'audit_block', String(from), { from_seq: from, to_seq: to, merkle_root: root, key_id: signer.keyId });
      return { status: 201, body: { from_seq: from, to_seq: to, merkle_root: root, key_id: signer.keyId } };
    },
  });
}
