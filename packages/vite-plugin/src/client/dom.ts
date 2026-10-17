/** Direct, non-blank text child of `el` whose box contains the point. */
export function textNodeAt(x: number, y: number, ignore: Element): Text | null {
  const el = document.elementFromPoint(x, y);
  if (!el || ignore.contains(el)) return null;
  for (const child of el.childNodes) {
    if (child.nodeType !== Node.TEXT_NODE) continue;
    const text = child as Text;
    if (text.data.trim() === '') continue;
    for (const rect of textRects(text)) {
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return text;
    }
  }
  return null;
}

/** The `<select>` at the point. Its option texts aren't hit-testable: the browser draws the list itself. */
export function selectAt(x: number, y: number, ignore: Element): HTMLSelectElement | null {
  const el = document.elementFromPoint(x, y);
  if (!el || ignore.contains(el)) return null;
  return el.closest('select');
}

/** The option's first non-blank direct text node. */
export function optionText(option: HTMLOptionElement): Text | null {
  for (const child of option.childNodes) if (child.nodeType === Node.TEXT_NODE && (child as Text).data.trim()) return child as Text;
  return null;
}

/** Whether the element shows a `\n` in its text as a line break rather than a space. */
export function showsLineBreaks(el: Element): boolean {
  const style = getComputedStyle(el);
  const collapse = style.getPropertyValue('white-space-collapse');
  if (collapse) return collapse === 'preserve' || collapse === 'preserve-breaks' || collapse === 'break-spaces';
  return style.whiteSpace !== 'normal' && style.whiteSpace !== 'nowrap';
}

export function textRects(text: Text): DOMRect[] {
  const range = document.createRange();
  range.selectNodeContents(text);
  return [...range.getClientRects()];
}

export function textBounds(text: Text): DOMRect {
  const range = document.createRange();
  range.selectNodeContents(text);
  return range.getBoundingClientRect();
}

/** All non-blank text nodes under `root`, skipping `ignore`. */
export function textNodesIn(root: Node, ignore: Element): Text[] {
  if (root.nodeType === Node.TEXT_NODE) return (root as Text).data.trim() ? [root as Text] : [];
  if (!(root instanceof Element) || ignore.contains(root)) return [];
  const out: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) if ((n as Text).data.trim()) out.push(n as Text);
  return out;
}
