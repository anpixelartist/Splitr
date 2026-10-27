import { z } from 'zod';
import type { PaymentStatus } from '../../../src/types';
import { allowedActions, effectiveStatus } from '../../../src/lib/payments';
import { UserFacingError, adminsOf, moneyIn, namer, pickGroup } from '../group';
import { WRITES, run, type RegisterTool } from './common';
import { groupInput } from './groupSummary';

// Confirms or rejects a pending payment, like the app's decidePayment
// (GroupContext.tsx), and only when allowedActions says the user may.

const register = (tool: 'confirm_payment' | 'reject_payment', status: Extract<PaymentStatus, 'confirmed' | 'rejected'>): RegisterTool =>
  (server, { session, now = Date.now }) => {
    const confirm = status === 'confirmed';
    server.registerTool(tool, {
      title: confirm ? 'Confirm a payment' : 'Reject a payment',
      description: confirm
        ? 'Confirms a pending payment someone says they made to the user, so it counts toward balances. ' +
          'Get the payment id from list_pending_payments, and check with the user first.'
        : 'Rejects a pending payment someone says they made to the user (they say it never arrived), so it never counts. ' +
          'Get the payment id from list_pending_payments, and check with the user first.',
      inputSchema: z.object({
        group: groupInput,
        payment_id: z.string().min(1).describe('The payment id shown by list_pending_payments.'),
      }),
      annotations: confirm ? WRITES : { ...WRITES, destructiveHint: true },
    }, ({ group: query, payment_id }) => run(async () => {
      const group = pickGroup(await session.groups(), query);
      const { settlements } = await session.groupData(group);
      const payment = settlements.find(s => s.id === payment_id.trim());
      if (!payment) throw new UserFacingError(`There's no payment ${payment_id} in ${group.name}. list_pending_payments shows the ids.`);

      const money = moneyIn(group);
      const name = namer(group, session.uid);
      const what = `${name(payment.from)} paid ${name(payment.to)} ${money(payment.amount)}`;
      const current = effectiveStatus(payment, now());
      const mine = allowedActions(payment, session.uid, { memberUids: group.members, isAdmin: adminsOf(group).includes(session.uid) });
      // A pending payment past its 7 days already counts: nothing left to decide
      if (current !== 'pending' || !mine.includes(status)) {
        const why = current !== 'pending'
          ? `it is already ${current}`
          : `only ${name(payment.to)} can ${confirm ? 'confirm' : 'reject'} it`;
        throw new UserFacingError(`Can't ${confirm ? 'confirm' : 'reject'} "${what}": ${why}.`);
      }

      const db = await session.db();
      await db.commit([{
        path: `groups/${group.id}/settlements/${payment.id}`,
        data: { status, decidedBy: session.uid },
        updateFields: ['status', 'decidedBy'],
        serverTime: ['decidedAt'],
      }]);
      return confirm
        ? `Confirmed in ${group.name}: ${what}. It now counts toward balances.`
        : `Rejected in ${group.name}: ${what}. It won't count toward balances.`;
    }));
  };

export const registerConfirmPayment = register('confirm_payment', 'confirmed');
export const registerRejectPayment = register('reject_payment', 'rejected');
