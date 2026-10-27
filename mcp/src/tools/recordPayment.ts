import { z } from 'zod';
import type { SettlementRecord } from '../../../src/types';
import { initialStatus } from '../../../src/lib/payments';
import { UserFacingError, currencyOf, digitsOf, moneyIn, namer, peopleIn, pickGroup, pickPerson, summarize } from '../group';
import { WRITES, run, type RegisterTool } from './common';
import { groupInput } from './groupSummary';

// Records a payment the way the app's Settle up screen does (recordSettlements
// in GroupContext.tsx): only a payment from the "who pays whom" plan, for up
// to the amount owed, with initialStatus and the server's recordedAt.

export const registerRecordPayment: RegisterTool = (server, { session, now = Date.now }) => {
  server.registerTool('record_payment', {
    title: 'Record a payment',
    description:
      'Records that someone paid someone back in a Splitr group, like "I paid Priya ₹500 in Goa Trip". ' +
      'The payment must be one of the group\'s "who pays whom" settle-up payments (see get_group_summary); ' +
      'leave out the amount for the full amount, or give less for a part payment. ' +
      'If the receiver is on the app and didn\'t record it themselves, it waits for them to confirm before it counts. ' +
      'Confirm the details with the user before calling.',
    inputSchema: z.object({
      group: groupInput,
      to: z.string().min(1).describe('Who was paid (a name in the group; "me" for the user).'),
      from: z.string().optional().describe('Who paid. Leave out if the user paid.'),
      amount: z.number().positive().optional().describe('How much. Leave out for everything owed.'),
    }),
    annotations: WRITES,
  }, (args) => run(async () => {
    const group = pickGroup(await session.groups(), args.group);
    const people = peopleIn(group, session.uid, await session.myName());
    const from = args.from ? pickPerson(people, args.from, session.uid) : { id: session.uid };
    const to = pickPerson(people, args.to, session.uid);
    const money = moneyIn(group);
    const name = namer(group, session.uid);
    const Name = (id: string) => name(id).replace(/^you$/, 'You');

    const { plan } = summarize(await session.groupData(group), now());
    const owed = plan.find(t => t.from === from.id && t.to === to.id);
    if (!owed) {
      const rows = plan.map(t => `${Name(t.from)} → ${name(t.to)} ${money(t.amount)}`).join('; ');
      throw new UserFacingError(
        `${Name(from.id)} ${from.id === session.uid ? "don't" : "doesn't"} owe ${name(to.id)} anything in ${group.name} right now. ` +
        (rows ? `Settle-up payments: ${rows}.` : 'Everyone is settled up.'),
      );
    }
    const digits = digitsOf(group);
    const amount = args.amount ?? owed.amount;
    const scale = 10 ** digits;
    if (Math.abs(amount * scale - Math.round(amount * scale)) > 1e-6) {
      throw new UserFacingError(digits === 0 ? `${currencyOf(group)} amounts are whole numbers.` : 'Amounts can only have whole cents.');
    }
    if (Math.round(amount * 100) > Math.round(owed.amount * 100)) {
      throw new UserFacingError(`That's more than the ${money(owed.amount)} owed. Record at most ${money(owed.amount)}.`);
    }

    const record: Omit<SettlementRecord, 'recordedAt'> = {
      id: crypto.randomUUID(),
      groupId: group.id,
      from: from.id,
      to: to.id,
      amount: Math.round(amount * 100) / 100,
      recordedBy: session.uid,
      createdAt: new Date().toISOString(),
      status: initialStatus(session.uid, to.id, group.members),
    };
    const db = await session.db();
    await db.commit([{
      path: `groups/${group.id}/settlements/${record.id}`, data: record, mustNotExist: true, serverTime: ['recordedAt'],
    }]);

    const status = record.status === 'pending'
      ? `It's pending: it counts once ${name(to.id)} confirms it in Splitr (or automatically after 7 days unless they reject it).`
      : 'It counts toward balances now.';
    const part = record.amount < owed.amount ? ` (part of ${money(owed.amount)} owed)` : '';
    return `Recorded in ${group.name}: ${Name(from.id)} paid ${name(to.id)} ${money(record.amount)}${part}. ${status}\nPayment id ${record.id}.`;
  }));
};
