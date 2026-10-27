import { formatMoney } from '../../../src/lib/money';
import { roundToCents } from '../../../src/lib/settlement';
import { currencyOf, isSettled, nameOf, summarize } from '../group';
import { READ_ONLY, run, type RegisterTool } from './common';

type Debt = { name: string; currency: string; amount: number; parts: { group: string; signed: number }[] };

export const registerMyBalances: RegisterTool = (server, { session, now = Date.now }) => {
  server.registerTool('my_balances', {
    title: 'What I owe and am owed',
    description:
      'Across all of the user\'s Splitr groups: who the user owes money to and who owes the user, per person, ' +
      'with the amount in each group\'s currency. Based on each group\'s simplified settle-up plan, the same one the app shows. ' +
      'Use for "Who still hasn\'t paid me back?" or "What do I owe overall?".',
    annotations: READ_ONLY,
  }, () => run(async () => {
    const groups = await session.groups();
    if (groups.length === 0) return 'You are not in any Splitr groups yet.';

    // person|currency → net (positive: they owe me). Amounts can't be added
    // across currencies, and payments are recorded per group, so each group
    // is listed next to the total.
    const debts = new Map<string, Debt>();
    for (const g of groups) {
      const { plan } = summarize(await session.groupData(g), now());
      for (const t of plan) {
        if (t.from !== session.uid && t.to !== session.uid) continue;
        const other = t.from === session.uid ? t.to : t.from;
        const signed = t.from === session.uid ? -t.amount : t.amount;
        // Members are the same person in every group; name-only people are per group
        const key = `${g.members.includes(other) ? other : `${g.id}/${other}`}|${currencyOf(g)}`;
        const d = debts.get(key) ?? { name: nameOf(g, other, session.uid), currency: currencyOf(g), amount: 0, parts: [] };
        d.amount = roundToCents(d.amount + signed);
        d.parts.push({ group: g.name, signed });
        debts.set(key, d);
      }
    }

    const all = [...debts.values()].filter(d => !isSettled(d.amount)).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
    if (all.length === 0) return 'You\'re settled up in every group: you don\'t owe anyone and nobody owes you.';

    const line = (d: Debt) => {
      const money = (n: number) => formatMoney(Math.abs(n), d.currency);
      if (d.parts.length === 1) return `- ${d.name}: ${money(d.amount)} (${d.parts[0].group})`;
      const where = d.parts.map(p => `${p.group}: ${p.signed < 0 ? 'you owe' : 'owes you'} ${money(p.signed)}`).join('; ');
      return `- ${d.name}: ${money(d.amount)} overall (${where})`;
    };
    const iOwe = all.filter(d => d.amount < 0);
    const owedToMe = all.filter(d => d.amount > 0);
    return [
      iOwe.length ? ['You owe:', ...iOwe.map(line)].join('\n') : 'You don\'t owe anyone.',
      owedToMe.length ? ['Owed to you:', ...owedToMe.map(line)].join('\n') : 'Nobody owes you.',
    ].join('\n\n');
  }));
};
