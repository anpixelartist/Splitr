import { z } from 'zod';
import type { SettlementRecord } from '../../../src/types';
import { AUTO_CONFIRM_MS, allowedActions, effectiveStatus } from '../../../src/lib/payments';
import { adminsOf, moneyIn, namer, pickGroup } from '../group';
import { READ_ONLY, day, plural, run, type RegisterTool } from './common';

export const registerPendingPayments: RegisterTool = (server, { session, now = Date.now }) => {
  server.registerTool('list_pending_payments', {
    title: 'Payments waiting for confirmation',
    description:
      'Lists recorded payments that are still pending: ones waiting for the user to confirm (someone says they paid the user), ' +
      'and ones the user recorded that are waiting for the other person. Pending payments don\'t change balances until ' +
      'the receiver confirms them; they count automatically after 7 days unless rejected. Optionally limit to one group.',
    inputSchema: z.object({
      group: z.string().optional().describe('Only this group (name or code). Leave out for all groups.'),
    }),
    annotations: READ_ONLY,
  }, ({ group: query }) => run(async () => {
    const all = await session.groups();
    const groups = query ? [pickGroup(all, query)] : all;
    const t = now();

    const forMe: string[] = [];
    const forOthers: string[] = [];
    for (const g of groups) {
      const { settlements } = await session.groupData(g);
      const money = moneyIn(g);
      const name = namer(g, session.uid);
      const isAdmin = adminsOf(g).includes(session.uid);
      for (const r of settlements.filter((s: SettlementRecord) => effectiveStatus(s, t) === 'pending')) {
        const counts = r.recordedAt !== undefined ? ` · counts automatically on ${day(r.recordedAt + AUTO_CONFIRM_MS)} unless rejected` : '';
        const what = `${name(r.from) === 'you' ? 'You' : name(r.from)} paid ${name(r.to)} ${money(r.amount)} in ${g.name}`;
        const meta = ` · recorded ${day(r.createdAt)}${counts} · payment id ${r.id}`;
        const mine = allowedActions(r, session.uid, { memberUids: g.members, isAdmin });
        if (mine.includes('confirmed')) forMe.push(`- ${what}${meta}`);
        else if (r.recordedBy === session.uid || r.from === session.uid) forOthers.push(`- ${what} · waiting for ${name(r.to)} to confirm${meta}`);
      }
    }

    const where = query ? ` in ${groups[0].name}` : '';
    if (!forMe.length && !forOthers.length) return `No pending payments${where}.`;
    return [
      forMe.length ? [`Waiting for you to confirm (${forMe.length}):`, ...forMe].join('\n') : `Nothing is waiting for you to confirm${where}.`,
      forOthers.length ? [`Waiting on others (${plural(forOthers.length, 'payment')}):`, ...forOthers].join('\n') : `None of your payments are waiting on others${where}.`,
    ].join('\n\n');
  }));
};
