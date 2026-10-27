import { describe, expect, it } from 'vitest';
import { callTool, fakeBackend } from '../helpers';
import { NOW, docs, me } from '../fixture';
import type { Props } from '../../src/token';

const call = (name: string, args: Record<string, unknown> = {}) => callTool(fakeBackend(docs, 'u1').fetch, me, name, args, NOW);

describe('list_groups', () => {
  it('lists only my groups with currency, people and my net balance', async () => {
    const { text, isError } = await call('list_groups');
    expect(isError).toBe(false);
    expect(text).toContain("You're in 3 groups:");
    // 3 members + Rahul (Amit's placeholder is claimed, so not counted twice)
    expect(text).toContain('- Goa Trip (code GOA111) · INR · 4 people · you are owed ₹400.00');
    expect(text).toContain('- Flat (code FLAT22) · JPY · 2 people · you owe ¥1,500');
    // Older groups have no currency field: USD
    expect(text).toContain('- Goa Trip 2025 (code GOA2025) · USD · 1 person · settled up');
    expect(text).not.toContain('Secret');
  });
});

describe('get_group_summary', () => {
  it('resolves claims and names, counts only confirmed payments, and plans who pays whom', async () => {
    const { text } = await call('get_group_summary', { group: 'goa trip' });
    expect(text).toContain('Goa Trip (code GOA111) · INR');
    expect(text).toContain('People: Asha (you, admin), Priya, Amit S, Rahul (not on the app)');
    expect(text).toContain('Spent: ₹1,600.00 across 2 expenses · your share ₹500.00');
    expect(text).toContain('- You: are owed ₹400.00');
    expect(text).toContain('- Priya: owes ₹200.00');
    expect(text).toContain('- Amit S: owes ₹200.00'); // the claimed "Amit" placeholder's debts are his
    expect(text).toContain('- Rahul: settled up');
    expect(text).toContain('- Priya pays you ₹200.00');
    expect(text).toContain('- Amit S pays you ₹200.00');
    expect(text).toContain('1 payment waiting for the receiver to confirm');
  });

  it('accepts a group code in any case', async () => {
    const { text } = await call('get_group_summary', { group: 'flat22' });
    expect(text).toContain('Flat (code FLAT22) · JPY');
    expect(text).toContain('- You pay Priya ¥1,500');
  });

  it('asks which group when a name is ambiguous', async () => {
    const { text, isError } = await call('get_group_summary', { group: 'goa' });
    expect(isError).toBe(true);
    expect(text).toContain('matches more than one group');
    expect(text).toContain('"Goa Trip" (GOA111)');
    expect(text).toContain('"Goa Trip 2025" (GOA2025)');
  });

  it("can't reach a group I'm not in, even by its code", async () => {
    const { text, isError } = await call('get_group_summary', { group: 'SECRET' });
    expect(isError).toBe(true);
    expect(text).toContain('No group matches "SECRET"');
    expect(text).not.toContain('Hidden');
  });
});

describe('list_expenses', () => {
  it('lists newest first with payer names and my share', async () => {
    const { text } = await call('list_expenses', { group: 'GOA111' });
    expect(text).toContain('Goa Trip: 2 of 2 expenses, newest first:');
    const lines = text.split('\n').slice(1);
    expect(lines[0]).toBe('- 21 Oct 2026 · Taxi · ₹400.00 · paid by Priya · split 2 ways (your share ₹200.00)');
    expect(lines[1]).toBe('- 20 Oct 2026 · Dinner at the shack · ₹1,200.00 · paid by you · split 4 ways (your share ₹300.00)');
  });

  it('filters by text and respects the limit', async () => {
    expect((await call('list_expenses', { group: 'Goa Trip', search: 'DINNER' })).text)
      .toContain('Goa Trip: 1 of 1 expense matching "DINNER"');
    expect((await call('list_expenses', { group: 'Goa Trip', search: 'priya' })).text).toContain('Taxi');
    expect((await call('list_expenses', { group: 'Goa Trip', limit: 1 })).text).toContain('1 of 2 expenses');
    expect((await call('list_expenses', { group: 'Goa Trip', search: 'pizza' })).text).toBe('No expenses in Goa Trip match "pizza".');
  });
});

describe('my_balances', () => {
  it('lists debts per person, keeping currencies apart', async () => {
    const { text } = await call('my_balances');
    expect(text).toContain('You owe:\n- Priya: ¥1,500 (Flat)');
    expect(text).toContain('Owed to you:');
    expect(text).toContain('- Priya: ₹200.00 (Goa Trip)');
    expect(text).toContain('- Amit S: ₹200.00 (Goa Trip)');
  });
});

describe('list_pending_payments', () => {
  it('shows what waits for me, with the auto-confirm date and id', async () => {
    const { text } = await call('list_pending_payments');
    expect(text).toContain('Waiting for you to confirm (1):');
    expect(text).toContain('- Priya paid you ₹500.00 in Goa Trip · recorded 26 Oct 2026 · counts automatically on 2 Nov 2026 unless rejected · payment id s2');
    // s3 is past 7 days: it already counts, so it's not pending
    expect(text).not.toContain('s3');
    expect(text).toContain('None of your payments are waiting on others.');
  });

  it('shows payments I recorded that wait on the receiver', async () => {
    const asPriya: Props = { uid: 'u2', refreshToken: 'rt-u2' };
    const { text } = await callTool(fakeBackend(docs, 'u2').fetch, asPriya, 'list_pending_payments', { group: 'goa trip' }, NOW);
    expect(text).toContain('Nothing is waiting for you to confirm in Goa Trip.');
    expect(text).toContain('- You paid Asha (old name) ₹500.00 in Goa Trip · waiting for Asha (old name) to confirm');
  });
});
