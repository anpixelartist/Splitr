import React from 'react';
import { OTPInput, type SlotProps } from 'input-otp';

// Six boxes, split 3 + 3 like a verification code. Typing, pasting ("abc-123",
// " ABC123 ") and SMS/password-manager autofill all land in the right boxes.
// Any letter or digit is accepted: codes made before the look-alike-free
// alphabet can still contain 0, O, 1, I or L.

const clean = (s: string) => s.replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 6);

type Props = {
  value: string;
  onChange: (code: string) => void;
  onComplete?: (code: string) => void;
};

export const JoinCodeInput: React.FC<Props> = ({ value, onChange, onComplete }) => (
  <OTPInput
    maxLength={6}
    value={value}
    onChange={v => onChange(clean(v))}
    onComplete={onComplete}
    pattern="^[a-zA-Z0-9]*$"
    pasteTransformer={clean}
    inputMode="text"
    autoCapitalize="characters"
    autoComplete="off"
    aria-label="Group code"
    containerClassName="flex items-center gap-2"
    render={({ slots }) => (
      <>
        <div className="flex flex-1 gap-1.5">{slots.slice(0, 3).map((s, i) => <Slot key={i} {...s} />)}</div>
        <span aria-hidden="true" className="w-2 h-0.5 rounded-full bg-gray-300 shrink-0" />
        <div className="flex flex-1 gap-1.5">{slots.slice(3).map((s, i) => <Slot key={i} {...s} />)}</div>
      </>
    )}
  />
);

const Slot: React.FC<SlotProps> = ({ char, isActive, hasFakeCaret }) => (
  <div
    className={`relative flex-1 h-12 rounded-xl bg-gray-100 flex items-center justify-center font-mono text-lg font-semibold text-gray-900 transition-shadow ${
      isActive ? 'ring-2 ring-blue-600 bg-surface' : ''
    }`}
  >
    {char}
    {hasFakeCaret && (
      <span aria-hidden="true" className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <span className="w-px h-5 bg-gray-900 animate-pulse" />
      </span>
    )}
  </div>
);
