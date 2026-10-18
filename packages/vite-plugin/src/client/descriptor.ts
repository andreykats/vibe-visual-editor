import { LOC_ATTRIBUTE, type ElementDescriptor } from '@vibe-visual-editor/protocol';
import { nearestLoc } from './locs';

const LABEL_ATTRS = ['role', 'aria-label', 'aria-labelledby', 'aria-describedby', 'aria-expanded', 'aria-pressed', 'aria-checked', 'title', 'alt', 'name', 'type'];
const MAX_LABEL_ATTRS = 3;

const STYLE_PROPS = [
  'display', 'position', 'width', 'height', 'margin', 'padding', 'font-size', 'font-weight', 'line-height',
  'color', 'background-color', 'border', 'border-radius', 'gap', 'flex-direction', 'justify-content',
  'align-items', 'grid-template-columns', 'text-align', 'opacity',
];
/** Values that say nothing useful; omitted to keep the descriptor small. */
const UNINTERESTING = new Set(['', 'none', 'normal', 'auto', '0px', 'static', 'rgba(0, 0, 0, 0)', '0px none rgb(0, 0, 0)', '1', 'start']);

/** The page's markup without Vibe Visual Editor's own attributes, which only add noise for the agent. */
const OWN_ATTRIBUTES = new RegExp(` ${LOC_ATTRIBUTE}="[^"]*"`, 'g');

function clip(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

function cssEscape(s: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : s.replace(/[^\w-]/g, (c) => `\\${c}`);
}

function isUnique(selector: string): boolean {
  try {
    return document.querySelectorAll(selector).length === 1;
  } catch {
    return false;
  }
}

/** Shortest selector found walking up from `el` that matches only `el`. */
export function uniqueSelector(el: Element): string {
  const parts: string[] = [];
  for (let cur: Element | null = el; cur && cur !== document.documentElement; cur = cur.parentElement) {
    let part = cur.tagName.toLowerCase();
    if (cur.id) {
      part = `#${cssEscape(cur.id)}`;
    } else {
      const testId = cur.getAttribute('data-testid');
      if (testId) part += `[data-testid="${testId.replace(/["\\]/g, '\\$&')}"]`;
      const parent = cur.parentElement;
      if (parent) {
        const same = [...parent.children].filter((c) => c.tagName === cur!.tagName);
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(cur) + 1})`;
      }
    }
    parts.unshift(part);
    const selector = parts.join(' > ');
    if (isUnique(selector)) return clip(selector, 1024);
  }
  return clip(parts.join(' > '), 1024);
}

export function describeElement(el: Element, editableText?: ElementDescriptor['editableText']): ElementDescriptor {
  const attributes: Record<string, string> = {};
  for (const name of LABEL_ATTRS) {
    if (Object.keys(attributes).length >= MAX_LABEL_ATTRS) break;
    const value = el.getAttribute(name);
    if (value !== null) attributes[name] = clip(value, 512);
  }
  const computed = getComputedStyle(el);
  const styles: Record<string, string> = {};
  for (const prop of STYLE_PROPS) {
    const value = computed.getPropertyValue(prop);
    if (!UNINTERESTING.has(value)) styles[prop] = clip(value, 256);
  }
  const rect = el.getBoundingClientRect();
  const site = nearestLoc(el);
  const testId = el.getAttribute('data-testid');
  return {
    tag: el.tagName.toLowerCase().slice(0, 64),
    ...(el.id ? { id: clip(el.id, 256) } : {}),
    classList: [...el.classList].slice(0, 32).map((c) => clip(c, 256)),
    ...(testId ? { testId: clip(testId, 256) } : {}),
    attributes,
    textContent: clip((el.textContent ?? '').replace(/\s+/g, ' ').trim(), 300),
    selector: uniqueSelector(el),
    outerHTML: clip(el.outerHTML.replace(OWN_ATTRIBUTES, ''), 2048),
    boundingRect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
    styles,
    ...(site ? { creationSite: site.loc } : {}),
    creationSiteIsAncestor: site?.isAncestor ?? false,
    ...(editableText ? { editableText } : {}),
    pageUrl: clip(location.href, 4096),
    route: clip(location.hash, 2048),
    timestamp: Date.now(),
  };
}
