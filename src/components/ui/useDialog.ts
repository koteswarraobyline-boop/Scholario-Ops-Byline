import { useEffect, useRef, type KeyboardEvent } from 'react';

const FOCUSABLE = 'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Modal dialog behaviour for a panel: focus moves into it on open (unless a child already took it),
 * Tab stays inside, Escape closes, and focus returns to the opener on close. Spread the result on
 * the panel element and give it an accessible name (aria-labelledby or aria-label).
 */
export function useDialog(onClose: () => void) {
  const ref = useRef<HTMLDivElement & HTMLFormElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    if (!ref.current?.contains(document.activeElement)) ref.current?.focus();
    return () => { if (opener?.isConnected) opener.focus?.(); };
  }, []);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); close.current(); return; }
    if (e.key !== 'Tab' || !ref.current) return;
    const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(el => !el.hasAttribute('disabled') && el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  return { ref, onKeyDown, role: 'dialog' as const, 'aria-modal': true, tabIndex: -1 };
}
