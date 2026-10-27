import { z } from 'zod';
import { resolveId } from '../../../src/lib/claims';
import { adminsOf, currencyOf, isSettled, moneyIn, namer, peopleIn, pickGroup, summarize } from '../group';
import { READ_ONLY, plural, run, type RegisterTool } from './common';

export const groupInput = z.string().min(1).describe(
  'The group\'s name (partial names are fine, e.g. "goa") or its code (e.g. "K7QM2X").',
);

export const registerGroupSummary: RegisterTool = (server, { session, now = Date.now }) => {
  server.registerTool('get_group_summary', {
    title: 'Group summary',
    description:
      'Shows one Splitr group: who is in it, each person\'s balance (who owes and who is owed), ' +
      'total spending, and the simplified list of payments that would settle everyone up ("who pays whom"). ' +
      'Use for questions like "What do I owe in the Goa Trip group?" or "Who owes what in Flat?". ' +
      'Payments still waiting for the receiver to confirm are not counted yet.',
    inputSchema: z.object({ group: groupInput }),
    annotations: READ_ONLY,
  }, ({ group: query }) => run(async () => {
    const group = pickGroup(await session.groups(), query);
    const data = await session.groupData(group);
    const myName = await session.myName();
    const { balances, plan, pending } = summarize(data, now());
    const money = moneyIn(group);
    const name = namer(group, session.uid);
    const admins = adminsOf(group);

    const people = peopleIn(group, session.uid, myName);
    const ids = new Set(people.map(p => p.id));
    // People who left but still have a balance
    const former = Object.keys(balances).filter(id => !ids.has(id) && !isSettled(balances[id].netBalance));

    const who = people.map(p => {
      const tags = [
        p.id === session.uid ? 'you' : '',
        admins.includes(p.id) ? 'admin' : '',
        group.members.includes(p.id) ? '' : 'not on the app',
      ].filter(Boolean);
      return tags.length ? `${p.name} (${tags.join(', ')})` : p.name;
    });

    const balanceLine = (id: string) => {
      const n = balances[id]?.netBalance ?? 0;
      const label = id === session.uid ? 'You' : name(id);
      if (isSettled(n)) return `- ${label}: settled up`;
      const verb = id === session.uid ? (n > 0 ? 'are owed' : 'owe') : (n > 0 ? 'is owed' : 'owes');
      return `- ${label}: ${verb} ${money(Math.abs(n))}`;
    };

    const spent = data.expenses.reduce((sum, e) => sum + e.amount, 0);
    const myShare = data.expenses.reduce(
      (sum, e) => sum + (e.splits.find(s => resolveId(group.claims, s.userId) === session.uid)?.amount ?? 0), 0);

    const out = [
      `${group.name} (code ${group.id}) · ${currencyOf(group)}`,
      `People: ${who.join(', ')}`,
      `Spent: ${money(spent)} across ${plural(data.expenses.length, 'expense')} · your share ${money(myShare)}`,
      '',
      'Balances:',
      ...[...people.map(p => p.id), ...former].map(balanceLine),
      '',
      plan.length === 0
        ? 'Everyone is settled up.'
        : ['To settle up:', ...plan.map(t => `- ${name(t.from) === 'you' ? 'You pay' : `${name(t.from)} pays`} ${name(t.to)} ${money(t.amount)}`)].join('\n'),
    ];
    if (pending.length) {
      out.push('', `${plural(pending.length, 'payment')} waiting for the receiver to confirm (not counted above): see list_pending_payments.`);
    }
    return out.join('\n');
  }));
};
