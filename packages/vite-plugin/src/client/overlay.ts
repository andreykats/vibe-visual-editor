export type BoxStyle = 'editable' | 'readonly' | 'select-hover' | 'selected';

const CSS = `
:host { all: initial; position: fixed; inset: 0; pointer-events: none; z-index: 2147483647; }
.box { position: fixed; box-sizing: border-box; border-radius: 2px; display: none; }
.editable { border: 2px solid #3b82f6; background: rgba(59,130,246,.08); }
.readonly { border: 1px dashed #9ca3af; }
.select-hover { border: 1px solid #a855f7; background: rgba(168,85,247,.08); }
.selected { border: 2px solid #a855f7; }
.tip, .toast { position: fixed; display: none; max-width: 360px; padding: 4px 8px; border-radius: 4px;
  font: 12px/1.4 system-ui, -apple-system, sans-serif; color: #fff; background: #1f2937; box-shadow: 0 2px 8px rgba(0,0,0,.3); }
.toast { left: 50%; bottom: 16px; transform: translateX(-50%); background: #b91c1c; }
.toast.info { background: #1f2937; }
`;

/** Highlight boxes and tooltips, in a closed shadow root so page CSS can't touch them. */
export class Overlay {
  readonly host: HTMLElement;
  private readonly hover: HTMLDivElement;
  private readonly selected: HTMLDivElement;
  private readonly tip: HTMLDivElement;
  private readonly toastEl: HTMLDivElement;
  private toastTimer: ReturnType<typeof setTimeout> | undefined;
  private tracked: (() => DOMRect | null) | null = null;
  private frame = 0;

  constructor() {
    this.host = document.createElement('vibe-visual-editor-overlay');
    const root = this.host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = CSS;
    const make = (cls: string) => {
      const d = document.createElement('div');
      d.className = cls;
      root.appendChild(d);
      return d;
    };
    root.appendChild(style);
    this.selected = make('box selected');
    this.hover = make('box');
    this.tip = make('tip');
    this.toastEl = make('toast');
    this.mount();
  }

  /** Re-attaches the host if the app replaced the document's children. */
  mount(): void {
    if (!this.host.isConnected) document.documentElement.appendChild(this.host);
  }

  showHover(rect: DOMRect, style: BoxStyle, tip?: string): void {
    this.mount();
    place(this.hover, rect);
    this.hover.className = `box ${style}`;
    if (tip) {
      this.tip.textContent = tip;
      this.tip.style.display = 'block';
      this.tip.style.left = `${Math.max(4, rect.left)}px`;
      this.tip.style.top = `${rect.bottom + 6 > innerHeight - 30 ? Math.max(4, rect.top - 30) : rect.bottom + 6}px`;
    } else {
      this.tip.style.display = 'none';
    }
  }

  hideHover(): void {
    this.hover.style.display = 'none';
    this.tip.style.display = 'none';
  }

  /** Keeps the selection box on `measure()` every frame until cleared. */
  trackSelection(measure: (() => DOMRect | null) | null): void {
    this.tracked = measure;
    cancelAnimationFrame(this.frame);
    if (!measure) {
      this.selected.style.display = 'none';
      return;
    }
    const tick = () => {
      const rect = this.tracked?.();
      if (rect) place(this.selected, rect);
      else this.selected.style.display = 'none';
      this.frame = requestAnimationFrame(tick);
    };
    tick();
  }

  toast(message: string, kind: 'error' | 'info' = 'error'): void {
    this.mount();
    this.toastEl.textContent = message;
    this.toastEl.className = `toast ${kind}`;
    this.toastEl.style.display = 'block';
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => (this.toastEl.style.display = 'none'), 4000);
  }
}

function place(el: HTMLElement, rect: DOMRect): void {
  el.style.display = 'block';
  el.style.left = `${rect.left - 2}px`;
  el.style.top = `${rect.top - 2}px`;
  el.style.width = `${rect.width + 4}px`;
  el.style.height = `${rect.height + 4}px`;
}
