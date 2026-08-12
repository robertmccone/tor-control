import { useEffect, useRef, useState } from 'react';
import { Check, Copy, X } from 'lucide-react';
import { copyToClipboard } from '../api.js';

/** Copy-to-clipboard button that briefly confirms the result inline. */
export default function CopyButton({ value, label = 'Copy', className = '' }) {
  const [state, setState] = useState('idle'); // idle | copied | failed
  const timerRef = useRef(null);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const handleClick = async () => {
    try {
      await copyToClipboard(value);
      setState('copied');
    } catch {
      setState('failed');
    }
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setState('idle'), 1800);
  };

  const styles = {
    idle: 'border-ink-600 bg-ink-800 text-ink-100 hover:border-accent-500/60 hover:bg-ink-700',
    copied: 'border-online-500/50 bg-online-500/15 text-online-400',
    failed: 'border-red-500/50 bg-red-500/15 text-red-400',
  }[state];

  const Icon = { idle: Copy, copied: Check, failed: X }[state];
  const text = { idle: label, copied: 'Copied', failed: 'Failed' }[state];

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={`${label} to clipboard`}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/70 ${styles} ${className}`}
    >
      <Icon size={13} aria-hidden="true" />
      {text}
    </button>
  );
}
