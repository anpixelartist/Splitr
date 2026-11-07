import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import type { SplitCharge } from '../types';
import { MAX_CHARGES, MAX_ITEMS, newItem, type ChargeDraft, type ItemDraft } from './itemizedDrafts';

const CHARGE_LABELS: Record<SplitCharge['kind'], string> = {
  tax: 'Tax', service: 'Service charge', tip: 'Tip', fee: 'Other fee', discount: 'Discount',
};

const field = 'border border-gray-300 rounded-md px-2 py-1.5 outline-none focus:ring-2 focus:ring-blue-500 bg-surface';

interface Props {
  people: { id: string; name: string }[]; // everyone ticked for this expense
  items: ItemDraft[];
  setItems: React.Dispatch<React.SetStateAction<ItemDraft[]>>;
  charges: ChargeDraft[];
  setCharges: React.Dispatch<React.SetStateAction<ChargeDraft[]>>;
  symbol: string;
  step: string;
  disabled: boolean;
  onChange: () => void;
}

export const ItemizedEditor: React.FC<Props> = ({ people, items, setItems, charges, setCharges, symbol, step, disabled, onChange }) => {
  const updateItem = (key: string, change: Partial<ItemDraft>) => {
    setItems(prev => prev.map(it => (it.key === key ? { ...it, ...change } : it)));
    onChange();
  };
  const updateCharge = (key: string, change: Partial<ChargeDraft>) => {
    setCharges(prev => prev.map(c => (c.key === key ? { ...c, ...change } : c)));
    onChange();
  };
  const togglePerson = (it: ItemDraft, id: string) => {
    const portions = { ...it.portions };
    if (id in portions) delete portions[id]; else portions[id] = '';
    updateItem(it.key, { portions });
  };

  return (
    <div className="space-y-3">
      {items.map((it, n) => (
        <div key={it.key} className="border rounded-lg p-3 space-y-2 bg-gray-50">
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder={`Item ${n + 1}`}
              aria-label={`Item ${n + 1} name`}
              className={`${field} flex-1 min-w-0`}
              value={it.name}
              onChange={e => updateItem(it.key, { name: e.target.value })}
              disabled={disabled}
            />
            <div className="relative w-24 shrink-0">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 text-sm">{symbol}</span>
              <input
                type="number" inputMode="decimal" step={step} min="0"
                placeholder="Price"
                aria-label={`${it.name || `Item ${n + 1}`} price each`}
                className={`${field} w-full pl-6`}
                value={it.price}
                onChange={e => updateItem(it.key, { price: e.target.value })}
                disabled={disabled}
              />
            </div>
            <span className="text-gray-400 text-sm" aria-hidden="true">×</span>
            <input
              type="number" inputMode="decimal" min="0" step="any"
              placeholder="1"
              aria-label={`${it.name || `Item ${n + 1}`} quantity`}
              className={`${field} w-12 shrink-0 text-center`}
              value={it.qty}
              onChange={e => updateItem(it.key, { qty: e.target.value })}
              disabled={disabled}
            />
            <button
              type="button"
              onClick={() => { setItems(prev => prev.filter(x => x.key !== it.key)); onChange(); }}
              disabled={disabled}
              className="p-1.5 text-gray-400 hover:text-red-500 shrink-0"
              aria-label={`Remove ${it.name || `item ${n + 1}`}`}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={`Who had ${it.name || `item ${n + 1}`}`}>
            {people.map(p => {
              const had = p.id in it.portions;
              return it.uneven && had ? (
                <label key={p.id} className="flex items-center gap-1 pl-2.5 pr-1 py-0.5 rounded-full bg-blue-600 text-white text-sm">
                  {p.name}
                  <input
                    type="number" inputMode="decimal" min="0" step="any"
                    placeholder="1"
                    aria-label={`${p.name}'s portions of ${it.name || `item ${n + 1}`}`}
                    className="w-10 rounded-full px-1.5 py-0.5 text-gray-900 text-center outline-none"
                    value={it.portions[p.id]}
                    onChange={e => updateItem(it.key, { portions: { ...it.portions, [p.id]: e.target.value } })}
                    disabled={disabled}
                  />
                  <button type="button" className="px-1" onClick={() => togglePerson(it, p.id)} aria-label={`${p.name} didn't have it`} disabled={disabled}>×</button>
                </label>
              ) : (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={had}
                  onClick={() => togglePerson(it, p.id)}
                  disabled={disabled}
                  className={`px-2.5 py-1 rounded-full text-sm border transition-colors ${
                    had ? 'bg-blue-600 border-blue-600 text-white' : 'bg-surface text-gray-600 border-gray-300'
                  }`}
                >
                  {p.name}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => updateItem(it.key, { uneven: !it.uneven })}
              disabled={disabled}
              className="ml-auto text-xs text-blue-600 dark:text-blue-400 hover:underline"
            >
              {it.uneven ? 'Share evenly' : 'Uneven portions'}
            </button>
          </div>
        </div>
      ))}

      {charges.map(c => (
        <div key={c.key} className="flex items-center gap-2">
          <select
            className={`${field} flex-1 min-w-0`}
            value={c.kind}
            onChange={e => updateCharge(c.key, { kind: e.target.value as SplitCharge['kind'] })}
            disabled={disabled}
            aria-label="Kind of charge"
          >
            {Object.entries(CHARGE_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
          <input
            type="number" inputMode="decimal" min="0" step="any"
            placeholder="0"
            aria-label={`${CHARGE_LABELS[c.kind]} ${c.mode === 'percent' ? 'percent' : 'amount'}`}
            className={`${field} w-20`}
            value={c.value}
            onChange={e => updateCharge(c.key, { value: e.target.value })}
            disabled={disabled}
          />
          <div className="flex bg-gray-100 rounded-md p-0.5 shrink-0" role="group" aria-label="Percent or amount">
            {(['percent', 'amount'] as const).map(m => (
              <button
                key={m}
                type="button"
                aria-pressed={c.mode === m}
                onClick={() => updateCharge(c.key, { mode: m })}
                disabled={disabled}
                className={`px-2 py-1 rounded text-sm ${c.mode === m ? 'bg-surface shadow-sm' : 'text-gray-500'}`}
              >
                {m === 'percent' ? '%' : symbol}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => { setCharges(prev => prev.filter(x => x.key !== c.key)); onChange(); }}
            disabled={disabled}
            className="p-1.5 text-gray-400 hover:text-red-500 shrink-0"
            aria-label={`Remove ${CHARGE_LABELS[c.kind].toLowerCase()}`}
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      ))}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => { setItems(prev => [...prev, newItem(people.map(p => p.id))]); onChange(); }}
          disabled={disabled || items.length >= MAX_ITEMS}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg border text-sm font-medium text-blue-600 dark:text-blue-400 hover:bg-gray-50 disabled:opacity-50"
        >
          <Plus className="w-4 h-4" /> Add item
        </button>
        <button
          type="button"
          onClick={() => { setCharges(prev => [...prev, { key: uuidv4(), kind: 'tax', mode: 'percent', value: '' }]); onChange(); }}
          disabled={disabled || charges.length >= MAX_CHARGES}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg border text-sm font-medium text-blue-600 dark:text-blue-400 hover:bg-gray-50 disabled:opacity-50"
        >
          <Plus className="w-4 h-4" /> Tax, tip or discount
        </button>
      </div>
    </div>
  );
};
