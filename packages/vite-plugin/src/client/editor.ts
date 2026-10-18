/** An open text editor. The client routes pointer and key events to it while it's active. */
export interface TextEditor {
  readonly active: boolean;
  /** Whether a pointer event's target belongs to the editor, which then gets the event's default action. */
  contains(target: EventTarget | null): boolean;
  /** Enter, a click elsewhere, a mode change. */
  commit(): void;
  /** Escape. */
  cancel(): void;
  /** Other keys while active; the page never sees them. */
  key?(e: KeyboardEvent): void;
}

export interface InlineEditorOptions {
  /** Shown above the editor, e.g. "Used in 3 places". */
  warning?: string;
  onCommit(value: string): void;
  onCancel(): void;
}

/** For single-line fields: line breaks become spaces. */
export const flatten = (s: string) => s.replace(/[\r\n]+/g, ' ');
/** Line breaks as `\n`, whatever the clipboard or platform used. */
const toLf = (s: string) => s.replace(/\r\n?/g, '\n');

/**
 * Plain-text editor for one text node. A temporary
 * `contenteditable="plaintext-only"` span holding the text is inserted just
 * before the node (never the parent, so structure can't be edited), and the
 * node is emptied while the edit is open. The node itself never moves, so a
 * framework that owns it (React keeps references to its text nodes) can still
 * update, remove or insert around it. Shift+Enter adds a line break as a `\n`
 * character, never a `<br>`.
 */
export class InlineEditor implements TextEditor {
  readonly span: HTMLSpanElement;
  private readonly original: string;
  private placeholder: HTMLBRElement | null = null;
  private done = false;

  constructor(
    private readonly text: Text,
    private readonly options: InlineEditorOptions,
  ) {
    this.original = text.data;
    const span = (this.span = document.createElement('span'));
    span.setAttribute('contenteditable', 'plaintext-only');
    span.setAttribute('spellcheck', 'false');
    span.style.cssText =
      'outline:2px solid #3b82f6;outline-offset:2px;border-radius:2px;cursor:text;white-space:pre-wrap;min-width:1ch;display:inline-block;';
    if (options.warning) span.title = options.warning;
    span.textContent = text.data;
    text.before(span);
    text.data = '';

    span.addEventListener('beforeinput', this.onBeforeInput);
    span.addEventListener('input', this.onInput);
    span.addEventListener('paste', this.onPaste);
    span.addEventListener('drop', this.onDrop);
    span.addEventListener('blur', this.onBlur);
    span.focus();
    const range = document.createRange();
    range.selectNodeContents(span);
    const sel = getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

  get active(): boolean {
    return !this.done;
  }

  contains(node: EventTarget | null): boolean {
    return node instanceof Node && this.span.contains(node);
  }

  commit(): void {
    this.finish(true);
  }

  cancel(): void {
    this.finish(false);
  }

  private finish(commit: boolean): void {
    if (this.done) return;
    this.done = true;
    this.span.removeEventListener('blur', this.onBlur);
    const value = toLf(this.span.textContent ?? '');
    this.text.data = commit ? value : this.original;
    this.span.remove();
    if (commit && value !== this.original) this.options.onCommit(value);
    else this.options.onCancel();
  }

  key(e: KeyboardEvent): void {
    if (e.key !== 'Enter' || !e.shiftKey) return;
    e.preventDefault();
    this.insert('\n');
  }

  private readonly onBlur = () => this.commit();

  // Native breaks would be <br> or <div>; key() inserts them as text instead.
  private readonly onBeforeInput = (e: InputEvent) => {
    if (e.inputType === 'insertParagraph' || e.inputType === 'insertLineBreak') e.preventDefault();
  };

  private readonly onPaste = (e: ClipboardEvent) => {
    e.preventDefault();
    this.insert(toLf(e.clipboardData?.getData('text/plain') ?? ''));
  };

  /** Replaces the selection with plain text and puts the caret after it. */
  private insert(text: string): void {
    const sel = getSelection();
    if (!sel || sel.rangeCount === 0 || !this.span.contains(sel.anchorNode)) return;
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);
    this.syncTrailingBreak();
    range.setStartAfter(node);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  /**
   * A trailing `\n` gets no line of its own, so the caret couldn't go after it.
   * A placeholder <br> gives it one; it isn't part of textContent, and it goes
   * away with the span.
   */
  private syncTrailingBreak(): void {
    const needed = (this.span.textContent ?? '').endsWith('\n');
    if (needed && !(this.span.lastChild instanceof HTMLBRElement)) {
      this.placeholder = document.createElement('br');
      this.span.appendChild(this.placeholder);
    } else if (!needed && this.placeholder) {
      this.placeholder.remove();
      this.placeholder = null;
    }
  }

  private readonly onInput = () => this.syncTrailingBreak();

  private readonly onDrop = (e: DragEvent) => e.preventDefault();
}
