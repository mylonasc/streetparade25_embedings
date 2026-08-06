import {ChevronDown, ChevronUp} from 'lucide-react';
import type {PointerEvent as ReactPointerEvent, ReactNode} from 'react';

type BottomSheetProps = {
  title: string;
  children: ReactNode;
  show: boolean;
  minimized: boolean;
  onMinimize: (minimized: boolean) => void;
  onToggle: () => void;
  className?: string;
  ariaLive?: boolean;
  actions?: ReactNode;
};

export function BottomSheet({title, children, show, minimized, onMinimize, onToggle, className, ariaLive, actions}: BottomSheetProps) {
  function handleGripPointerDown(event: ReactPointerEvent<HTMLElement>) {
    if ((event.target as HTMLElement | null)?.closest?.('button')) return;
    const target = event.currentTarget;
    const startY = event.clientY;
    target.setPointerCapture?.(event.pointerId);

    function handlePointerUp(nextEvent: PointerEvent) {
      const deltaY = nextEvent.clientY - startY;
      onMinimize(Math.abs(deltaY) > 34 ? deltaY > 0 : true);
      target.removeEventListener('pointerup', handlePointerUp);
      target.removeEventListener('pointercancel', handlePointerCancel);
      target.releasePointerCapture?.(event.pointerId);
    }

    function handlePointerCancel() {
      target.removeEventListener('pointerup', handlePointerUp);
      target.removeEventListener('pointercancel', handlePointerCancel);
      target.releasePointerCapture?.(event.pointerId);
    }

    target.addEventListener('pointerup', handlePointerUp);
    target.addEventListener('pointercancel', handlePointerCancel);
  }

  return (
    <section
      className={`${className || ''} selection-panel ${show ? 'has-selection' : ''} ${minimized ? 'is-minimized' : ''}`}
      aria-live={ariaLive ? 'polite' : undefined}
    >
      <div className="sheet-grip" aria-hidden="true" onPointerDown={handleGripPointerDown} />
      <div className="selection-panel-header" onPointerDown={handleGripPointerDown}>
        <button
          type="button"
          className="sheet-minimize-toggle"
          aria-expanded={!minimized}
          aria-label={minimized ? 'Expand' : 'Minimize'}
          onClick={onToggle}
        >
          {minimized ? <ChevronUp size={20} aria-hidden="true" /> : <ChevronDown size={20} aria-hidden="true" />}
        </button>
        <h2 className="selection-title">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}
