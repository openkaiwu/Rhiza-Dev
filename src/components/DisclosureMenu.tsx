import { useEffect, useRef, type ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';

/** Native disclosure keeps secondary actions keyboard-accessible without a modal. */
export function DisclosureMenu({ label, trigger, children, className = '' }: { label: string; trigger?: ReactNode; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (restoreFocus: boolean) => {
      const element = ref.current;
      if (!element?.open) return;
      element.open = false;
      if (restoreFocus) element.querySelector('summary')?.focus();
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && ref.current?.open && ref.current.contains(document.activeElement)) {
        event.preventDefault();
        close(true);
      }
    };
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !ref.current?.contains(event.target)) close(false);
    };
    document.addEventListener('keydown', keydown);
    document.addEventListener('pointerdown', outside);
    return () => { document.removeEventListener('keydown', keydown); document.removeEventListener('pointerdown', outside); };
  }, []);
  return <details ref={ref} className={`disclosure-menu ${className}`}>
    <summary aria-label={label} title={label}>{trigger ?? <MoreHorizontal size={18}/>}<span className="sr-only">{label}</span></summary>
    <div className="disclosure-content" onClick={event => {
      if (event.target instanceof Element && event.target.closest('button') && ref.current) {
        const focusedInside = ref.current.contains(document.activeElement);
        ref.current.open = false;
        if (focusedInside) ref.current.querySelector('summary')?.focus();
      }
    }}>{children}</div>
  </details>;
}
