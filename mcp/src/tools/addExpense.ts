import { z } from 'zod';
import type { Expense } from '../../../src/types';
import { splitEqually, validateExpense } from '../../../src/lib/settlement';
import { UserFacingError, currencyOf, digitsOf, moneyIn, peopleIn, pickGroup, pickPerson } from '../group';
import { WRITES, run, type RegisterTool } from './common';
import { groupInput } from './groupSummary';

// Saves an expense exactly as the app's addExpense does (GroupContext.tsx):
// the same fields, the same equal split, and the same validateExpense check.

export const registerAddExpense: RegisterTool = (server, { session }) => {
  server.registerTool('add_expense', {
    title: 'Add an expense',
    description:
      'Adds an expense to a Splitr group, like "Add ₹1,200 for dinner in Goa Trip, I paid, split with Priya and Amit". ' +
      'By default the person who asks paid and it is split equally between everyone in the group. ' +
      'Use split_between for an equal split between some people, or exact_shares for set amounts. ' +
      'Confirm the details with the user before calling. Expenses can be edited or deleted only in the app.',
    inputSchema: z.object({
      group: groupInput,
      description: z.string().min(1).max(200).describe('What it was for, e.g. "Dinner at the shack".'),
      amount: z.number().positive().describe('The total, in the group\'s currency.'),
      paid_by: z.string().optional().describe('Who paid (a name in the group). Leave out if the user paid.'),
      split_between: z.array(z.string()).optional()
        .describe('Split equally between these people (names; "me" for the user). Leave out for everyone in the group.'),
      exact_shares: z.array(z.object({ person: z.string(), amount: z.number().nonnegative() })).optional()
        .describe('Set amounts per person instead of an equal split. They must add up to the total.'),
    }),
    annotations: WRITES,
  }, (args) => run(async () => {
    const group = pickGroup(await session.groups(), args.group);
    const people = peopleIn(group, session.uid, await session.myName());
    const person = (q: string) => pickPerson(people, q, session.uid);
    const digits = digitsOf(group);
    const currency = currencyOf(group);

    const description = args.description.trim();
    if (!description) throw new UserFacingError('Please give a description.');
    if (digits === 0 && !Number.isInteger(args.amount)) throw new UserFacingError(`${currency} amounts are whole numbers.`);
    const amount = Math.round(args.amount * 100) / 100;
    const paidBy = args.paid_by ? person(args.paid_by).id : session.uid;

    let splits: Expense['splits'];
    if (args.exact_shares && args.split_between) {
      throw new UserFacingError('Use either split_between or exact_shares, not both.');
    } else if (args.exact_shares) {
      splits = args.exact_shares
        .map(s => ({ userId: person(s.person).id, amount: Math.round(s.amount * 100) / 100 }))
        .filter(s => s.amount > 0);
    } else {
      const ids = args.split_between ? args.split_between.map(q => person(q).id) : people.map(p => p.id);
      splits = splitEqually(amount, [...new Set(ids)], digits);
    }

    const problem = validateExpense({ amount, paidBy, splits }, people.map(p => p.id), digits);
    if (problem) throw new UserFacingError(problem);

    const expense: Expense = {
      id: crypto.randomUUID(),
      groupId: group.id,
      description,
      amount,
      paidBy,
      splits,
      createdBy: session.uid,
      createdAt: new Date().toISOString(),
    };
    const db = await session.db();
    await db.commit([{ path: `groups/${group.id}/expenses/${expense.id}`, data: expense, mustNotExist: true }]);

    const money = moneyIn(group);
    const name = (id: string) => (id === session.uid ? 'you' : people.find(p => p.id === id)!.name);
    return [
      `Saved in ${group.name}: "${description}", ${money(amount)}, paid by ${name(paidBy)}.`,
      'Shares:',
      ...splits.map(s => `- ${name(s.userId)}: ${money(s.amount)}`),
      `Expense id ${expense.id}. To change or delete it, use the Splitr app.`,
    ].join('\n');
  }));
};
