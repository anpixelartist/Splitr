import { z } from 'zod';
import { moneyIn, namer, pickGroup } from '../group';
import { READ_ONLY, day, plural, run, type RegisterTool } from './common';
import { groupInput } from './groupSummary';

export const registerListExpenses: RegisterTool = (server, { session }) => {
  server.registerTool('list_expenses', {
    title: 'List expenses',
    description:
      'Lists recent expenses in one Splitr group, newest first: date, description, amount, who paid, ' +
      'how it was split and the user\'s share. Optionally filter by text in the description ' +
      '(e.g. "dinner") or by who paid (e.g. "Priya").',
    inputSchema: z.object({
      group: groupInput,
      search: z.string().optional().describe('Only expenses whose description or payer contains this text.'),
      limit: z.number().int().min(1).max(50).optional().describe('How many to show (default 10, at most 50).'),
    }),
    annotations: READ_ONLY,
  }, ({ group: query, search, limit = 10 }) => run(async () => {
    const group = pickGroup(await session.groups(), query);
    const { expenses } = await session.groupData(group);
    const money = moneyIn(group);
    const name = namer(group, session.uid);

    const needle = search?.trim().toLowerCase();
    const matching = needle
      ? expenses.filter(e => e.description.toLowerCase().includes(needle) || name(e.paidBy).toLowerCase().includes(needle))
      : expenses;
    if (matching.length === 0) {
      return needle ? `No expenses in ${group.name} match "${search}".` : `${group.name} has no expenses yet.`;
    }

    const shown = matching.slice(0, limit);
    const lines = shown.map(e => {
      const mine = e.splits.find(s => s.userId === session.uid)?.amount;
      const split = e.splits.length === 1 ? `for ${name(e.splits[0].userId)}` : `split ${e.splits.length} ways`;
      return `- ${day(e.createdAt)} · ${e.description} · ${money(e.amount)} · paid by ${name(e.paidBy)} · ${split}`
        + (mine !== undefined ? ` (your share ${money(mine)})` : ' (you\'re not in it)');
    });
    const scope = needle ? ` matching "${search}"` : '';
    return `${group.name}: ${shown.length} of ${plural(matching.length, 'expense')}${scope}, newest first:\n${lines.join('\n')}`;
  }));
};
