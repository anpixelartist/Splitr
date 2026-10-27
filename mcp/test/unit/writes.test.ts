import { describe, expect, it } from 'vitest';
import { callTool, fakeBackend } from '../helpers';
import { NOW, docs, me } from '../fixture';

// Runs a write tool and returns its text plus the Firestore writes it sent.
async function write(name: string, args: Record<string, unknown>) {
  const backend = fakeBackend(docs, 'u1');
  const result = await callTool(backend.fetch, me, name, args, NOW);
  const writes = backend.calls
    .filter(c => c.url.endsWith(':commit'))
    .flatMap(c => (c.body as { writes: Record<string, any>[] }).writes);
  return { ...result, writes };
}

const fieldsOf = (w: Record<string, any>) =>
  Object.fromEntries(Object.entries(w.update.fields as Record<string, any>).map(([k, v]) => [k, Object.values(v)[0]]));

describe('add_expense', () => {
  it('saves exactly the app\'s fields: I paid, split equally between everyone', async () => {
    const { text, isError, writes } = await write('add_expense', { group: 'GOA111', description: ' Boat ride ', amount: 1000 });
    expect(isError).toBe(false);
    expect(writes).toHaveLength(1);
    const w = writes[0];
    expect(w.currentDocument).toEqual({ exists: false });
    const f = fieldsOf(w);
    expect(Object.keys(f).sort()).toEqual(['amount', 'createdAt', 'createdBy', 'date', 'description', 'groupId', 'id', 'paidBy', 'split', 'splits']);
    expect(f.date).toBe('2026-10-27');
    expect(w.update.name).toMatch(new RegExp(`/documents/groups/GOA111/expenses/${f.id}$`));
    expect(f).toMatchObject({ groupId: 'GOA111', description: 'Boat ride', amount: '1000', paidBy: 'u1', createdBy: 'u1' });
    // Members plus Rahul (unclaimed), not Amit's claimed placeholder
    const splits = (f.splits as any).values.map((v: any) => v.mapValue.fields.userId.stringValue);
    expect(splits).toEqual(['u1', 'u2', 'u3', 'p1']);
    expect(text).toContain('Saved in Goa Trip: "Boat ride", ₹1,000.00, paid by you, on 27 Oct 2026.');
    expect(text).toContain('- Rahul: ₹250.00');
  });

  it('splits between named people without losing a yen', async () => {
    const { text, writes } = await write('add_expense', {
      group: 'flat', description: 'Rice', amount: 1001, paid_by: 'priya', split_between: ['me', 'Priya'],
    });
    expect(writes).toHaveLength(1);
    expect(text).toContain('paid by Priya');
    expect(text).toContain('- you: ¥501');
    expect(text).toContain('on 27 Oct 2026');
    expect(text).toContain('- Priya: ¥500');
  });

  it('takes exact shares, and refuses ones that don\'t add up', async () => {
    const ok = await write('add_expense', {
      group: 'GOA111', description: 'Snacks', amount: 90,
      exact_shares: [{ person: 'me', amount: 60 }, { person: 'Rahul', amount: 30 }],
    });
    expect(ok.isError).toBe(false);
    expect(ok.text).toContain('- Rahul: ₹30.00');

    const bad = await write('add_expense', {
      group: 'GOA111', description: 'Snacks', amount: 90,
      exact_shares: [{ person: 'me', amount: 60 }, { person: 'Rahul', amount: 20 }],
    });
    expect(bad).toMatchObject({ isError: true, writes: [] });
    expect(bad.text).toContain("don't add up");
  });

  it('saves the day it was spent when given one', async () => {
    const { text, writes } = await write('add_expense', { group: 'flat', description: 'Rice', amount: 1000, date: '2026-10-03' });
    expect(fieldsOf(writes[0]).date).toBe('2026-10-03');
    expect(text).toContain('on 3 Oct 2026');
  });

  it('refuses decimals in a currency without them, and unknown people', async () => {
    const yen = await write('add_expense', { group: 'flat', description: 'Tea', amount: 10.5 });
    expect(yen).toMatchObject({ isError: true, writes: [] });
    expect(yen.text).toContain('JPY amounts are whole numbers');

    const who = await write('add_expense', { group: 'GOA111', description: 'Tea', amount: 10, paid_by: 'Zed' });
    expect(who).toMatchObject({ isError: true, writes: [] });
    expect(who.text).toContain('Nobody called "Zed"');
  });

  it("can't add to a group I'm not in", async () => {
    const r = await write('add_expense', { group: 'SECRET', description: 'Tea', amount: 10 });
    expect(r).toMatchObject({ isError: true, writes: [] });
  });
});

describe('record_payment', () => {
  it('records my payment to someone on the app as pending, with the server\'s time', async () => {
    const { text, writes } = await write('record_payment', { group: 'flat', to: 'Priya', amount: 500 });
    expect(writes).toHaveLength(1);
    const w = writes[0];
    expect(w.updateTransforms).toEqual([{ fieldPath: 'recordedAt', setToServerValue: 'REQUEST_TIME' }]);
    const f = fieldsOf(w);
    expect(Object.keys(f).sort()).toEqual(['amount', 'createdAt', 'from', 'groupId', 'id', 'recordedBy', 'status', 'to']);
    expect(f).toMatchObject({ from: 'u1', to: 'u2', amount: '500', recordedBy: 'u1', status: 'pending', groupId: 'FLAT22' });
    expect(text).toContain('You paid Priya ¥500 (part of ¥1,500 owed)');
    expect(text).toContain('pending');
  });

  it('records the full amount owed to me as confirmed', async () => {
    const { text, writes } = await write('record_payment', { group: 'GOA111', from: 'Priya', to: 'me' });
    expect(fieldsOf(writes[0])).toMatchObject({ from: 'u2', to: 'u1', amount: '200', status: 'confirmed' });
    expect(text).toContain('Priya paid you ₹200.00');
  });

  it('only allows payments from the settle-up plan, up to what is owed', async () => {
    const wrongWay = await write('record_payment', { group: 'GOA111', to: 'Priya' });
    expect(wrongWay).toMatchObject({ isError: true, writes: [] });
    expect(wrongWay.text).toContain("You don't owe Priya anything");

    const tooMuch = await write('record_payment', { group: 'flat', to: 'Priya', amount: 2000 });
    expect(tooMuch).toMatchObject({ isError: true, writes: [] });
    expect(tooMuch.text).toContain('more than the ¥1,500 owed');
  });
});

describe('confirm_payment / reject_payment', () => {
  it('confirms a payment waiting for me, changing only the status', async () => {
    const { text, writes } = await write('confirm_payment', { group: 'GOA111', payment_id: 's2' });
    expect(writes).toHaveLength(1);
    const w = writes[0];
    expect(w.update.name).toMatch(/groups\/GOA111\/settlements\/s2$/);
    expect(w.updateMask).toEqual({ fieldPaths: ['status', 'decidedBy'] });
    expect(w.currentDocument).toEqual({ exists: true });
    expect(w.updateTransforms).toEqual([{ fieldPath: 'decidedAt', setToServerValue: 'REQUEST_TIME' }]);
    expect(fieldsOf(w)).toEqual({ status: 'confirmed', decidedBy: 'u1' });
    expect(text).toBe('Confirmed in Goa Trip: Priya paid you ₹500.00. It now counts toward balances.');
  });

  it('rejects a payment waiting for me', async () => {
    const { text, writes } = await write('reject_payment', { group: 'GOA111', payment_id: 's2' });
    expect(fieldsOf(writes[0])).toEqual({ status: 'rejected', decidedBy: 'u1' });
    expect(text).toContain('Rejected in Goa Trip');
  });

  it("won't decide payments that aren't mine to decide or are already settled", async () => {
    // s3: Amit paid Priya, and it auto-confirmed after 7 days
    const notMine = await write('confirm_payment', { group: 'GOA111', payment_id: 's3' });
    expect(notMine).toMatchObject({ isError: true, writes: [] });
    expect(notMine.text).toContain('already confirmed');
    // s1: an older confirmed record
    const done = await write('reject_payment', { group: 'GOA111', payment_id: 's1' });
    expect(done).toMatchObject({ isError: true, writes: [] });
    const missing = await write('confirm_payment', { group: 'GOA111', payment_id: 'nope' });
    expect(missing.text).toContain("There's no payment nope");
  });
});
