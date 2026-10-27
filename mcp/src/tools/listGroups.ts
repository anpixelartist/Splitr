import { currencyOf, isSettled, moneyIn, myNet, summarize } from '../group';
import { READ_ONLY, plural, run, type RegisterTool } from './common';

export const describeNet = (net: number, money: (n: number) => string) =>
  isSettled(net) ? 'settled up' : net > 0 ? `you are owed ${money(net)}` : `you owe ${money(-net)}`;

export const registerListGroups: RegisterTool = (server, { session, now = Date.now }) => {
  server.registerTool('list_groups', {
    title: 'List my Splitr groups',
    description:
      'Lists every Splitr group the user belongs to, with its code, currency, number of people, ' +
      'and the user\'s net balance in it (whether they owe or are owed, and how much). ' +
      'Use this first when the user mentions a group, or asks for an overview of their groups.',
    annotations: READ_ONLY,
  }, () => run(async () => {
    const groups = await session.groups();
    if (groups.length === 0) return 'You are not in any Splitr groups yet. Create or join one in the app.';
    const lines = await Promise.all(groups.map(async g => {
      const { balances } = summarize(await session.groupData(g), now());
      const people = g.members.length + (g.participants ?? []).filter(p => !g.claims?.[p.id]).length;
      return `- ${g.name} (code ${g.id}) · ${currencyOf(g)} · ${plural(people, 'person', 'people')} · ${describeNet(myNet(balances, session.uid), moneyIn(g))}`;
    }));
    return `You're in ${plural(groups.length, 'group')}:\n${lines.join('\n')}`;
  }));
};
