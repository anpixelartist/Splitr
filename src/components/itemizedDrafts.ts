import { v4 as uuidv4 } from 'uuid';
import type { SplitCharge } from '../types';

// Form state for the "Items" split method. Strings, so half-typed numbers
// ("12.") survive; turned into a SplitConfig by AddExpenseModal.

export type ItemDraft = {
  key: string;
  name: string;
  price: string;                    // per unit
  qty: string;                      // blank = 1
  portions: Record<string, string>; // present = had some; '' = 1 portion
  uneven: boolean;                  // show the portion boxes
};

export type ChargeDraft = {
  key: string;
  kind: SplitCharge['kind'];
  mode: SplitCharge['mode'];
  value: string;
};

export const MAX_ITEMS = 100;
export const MAX_CHARGES = 20;

export const newItem = (people: string[]): ItemDraft => ({
  key: uuidv4(), name: '', price: '', qty: '',
  portions: Object.fromEntries(people.map(p => [p, ''])), uneven: false,
});
