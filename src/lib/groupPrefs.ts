// Personal ordering of the groups list: pinned groups first (in the order they
// were pinned), then the rest as they were. Favourites only add a star and a
// filter. Both are lists of group ids kept on the user's own profile.

export const MAX_PINNED = 3;

/** Pinned ids that still refer to one of my groups (I may have left some). */
export const livePinned = (pinned: string[], groupIds: string[]) =>
  pinned.filter(id => groupIds.includes(id));

export function orderGroups<G extends { id: string }>(
  groups: G[],
  pinned: string[],
  favorites: string[],
  favoritesOnly: boolean,
): G[] {
  const shown = favoritesOnly ? groups.filter(g => favorites.includes(g.id)) : groups;
  const top = pinned.flatMap(id => shown.filter(g => g.id === id));
  return [...top, ...shown.filter(g => !pinned.includes(g.id))];
}

/** Pin or unpin. `full` when there's no room for another pin (nothing changes). */
export function togglePin(pinned: string[], id: string, groupIds: string[]): { next: string[]; full: boolean } {
  const live = livePinned(pinned, groupIds);
  if (live.includes(id)) return { next: live.filter(p => p !== id), full: false };
  if (live.length >= MAX_PINNED) return { next: live, full: true };
  return { next: [...live, id], full: false };
}

export const toggleIn = (list: string[], id: string) =>
  list.includes(id) ? list.filter(x => x !== id) : [...list, id];
