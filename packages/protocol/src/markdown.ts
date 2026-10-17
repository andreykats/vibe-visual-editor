import type { ElementDescriptor } from './types';

/** Compact Markdown summary of a selection, followed by the full descriptor as JSON. */
export function formatSelectionMarkdown(d: ElementDescriptor): string {
  const lines: string[] = [];
  const label = `<${d.tag}${d.id ? `#${d.id}` : ''}${d.classList.length ? `.${d.classList.join('.')}` : ''}>`;
  lines.push(`**Selected element:** \`${label}\``);
  if (d.creationSite) {
    const s = d.creationSite;
    const where = `${s.rel}:${s.line}:${s.column}`;
    lines.push(
      d.creationSiteIsAncestor
        ? `**Created at:** \`${where}\` (nearest tagged ancestor; the element itself has no recorded creation site)`
        : `**Created at:** \`${where}\``,
    );
  } else {
    lines.push('**Created at:** unknown (no tagged element in its ancestry)');
  }
  if (d.editableText) {
    const t = d.editableText;
    lines.push(`**Text literal:** ${JSON.stringify(t.value)} at \`${t.rel}:${t.line}:${t.column}\``);
  }
  if (d.textContent) lines.push(`**Text:** ${JSON.stringify(d.textContent)}`);
  lines.push(`**Selector:** \`${d.selector}\``);
  lines.push(`**Page:** ${d.pageUrl}`);
  lines.push('', '```json', JSON.stringify(d, null, 2), '```');
  return lines.join('\n');
}
