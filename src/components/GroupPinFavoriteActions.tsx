import React from 'react';
import { Pin, PinOff, Star, StarOff } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useGroup } from '../context/GroupContext';
import { useToast } from '../context/ToastContext';
import { MAX_PINNED, toggleIn, togglePin } from '../lib/groupPrefs';

interface Props {
  groupId: string;
  /** Called after either action, e.g. to close the menu it sits in */
  onDone: () => void;
}

/** "Pin to top" and "Add to favourites" rows for a group's action sheet. */
export const GroupPinFavoriteActions: React.FC<Props> = ({ groupId, onDone }) => {
  const { pinnedGroups, favoriteGroups, setPinnedGroups, setFavoriteGroups } = useAuth();
  const { groups } = useGroup();
  const { showToast } = useToast();
  const isPinned = pinnedGroups.includes(groupId);
  const isFavorite = favoriteGroups.includes(groupId);

  const handlePin = () => {
    const { next, full } = togglePin(pinnedGroups, groupId, groups.map(g => g.id));
    if (full) {
      showToast(`You can pin up to ${MAX_PINNED} groups. Unpin one first.`, 'error');
    } else {
      setPinnedGroups(next);
      showToast(isPinned ? 'Unpinned' : 'Pinned to top');
    }
    onDone();
  };

  const handleFavorite = () => {
    setFavoriteGroups(toggleIn(favoriteGroups, groupId));
    showToast(isFavorite ? 'Removed from favourites' : 'Added to favourites');
    onDone();
  };

  const PinIcon = isPinned ? PinOff : Pin;
  const StarIcon = isFavorite ? StarOff : Star;
  return (
    <>
      <button
        onClick={handlePin}
        className="w-full flex items-center gap-3 px-4 py-4 hover:bg-gray-50 text-left transition-colors"
      >
        <PinIcon className="w-5 h-5 text-gray-500" />
        <div>
          <p className="font-medium text-gray-800">{isPinned ? 'Unpin' : 'Pin to top'}</p>
          <p className="text-xs text-gray-400">
            {isPinned ? 'Back to its usual place in your list' : `Keeps it first in your list (up to ${MAX_PINNED})`}
          </p>
        </div>
      </button>
      <button
        onClick={handleFavorite}
        className="w-full flex items-center gap-3 px-4 py-4 hover:bg-gray-50 text-left transition-colors"
      >
        <StarIcon className={`w-5 h-5 ${isFavorite ? 'text-gray-500' : 'text-[#FF9F0A]'}`} />
        <div>
          <p className="font-medium text-gray-800">{isFavorite ? 'Remove from favourites' : 'Add to favourites'}</p>
          <p className="text-xs text-gray-400">
            {isFavorite ? 'Takes the star off' : 'Stars it, and shows it under Favourites'}
          </p>
        </div>
      </button>
    </>
  );
};
