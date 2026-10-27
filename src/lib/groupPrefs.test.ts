import { describe, expect, it } from 'vitest';
import { MAX_PINNED, orderGroups, toggleIn, togglePin } from './groupPrefs';

const g = (...ids: string[]) => ids.map(id => ({ id }));
const ids = (list: { id: string }[]) => list.map(x => x.id);

describe('orderGroups', () => {
  it('puts pinned groups first, in pin order, and keeps the rest as they were', () => {
    expect(ids(orderGroups(g('A', 'B', 'C', 'D'), ['C', 'A'], [], false))).toEqual(['C', 'A', 'B', 'D']);
  });

  it('ignores pins for groups I am no longer in', () => {
    expect(ids(orderGroups(g('A', 'B'), ['GONE', 'B'], [], false))).toEqual(['B', 'A']);
  });

  it('shows only favourites when filtering, still pinned first', () => {
    expect(ids(orderGroups(g('A', 'B', 'C'), ['C'], ['A', 'C'], true))).toEqual(['C', 'A']);
  });
});

describe('togglePin', () => {
  const all = ['A', 'B', 'C', 'D', 'E'];

  it('pins and unpins', () => {
    expect(togglePin([], 'A', all)).toEqual({ next: ['A'], full: false });
    expect(togglePin(['A', 'B'], 'A', all)).toEqual({ next: ['B'], full: false });
  });

  it(`allows at most ${MAX_PINNED} pins`, () => {
    expect(togglePin(['A', 'B', 'C'], 'D', all)).toEqual({ next: ['A', 'B', 'C'], full: true });
  });

  it('frees the slot of a group I left', () => {
    expect(togglePin(['GONE', 'B', 'C'], 'D', all)).toEqual({ next: ['B', 'C', 'D'], full: false });
  });
});

it('toggleIn adds and removes', () => {
  expect(toggleIn(['A'], 'B')).toEqual(['A', 'B']);
  expect(toggleIn(['A', 'B'], 'A')).toEqual(['B']);
});
