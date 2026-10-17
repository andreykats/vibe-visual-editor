import { h, replaceChildren } from '../ui/dom';
import { SHARED_LABEL } from '../strings';

function videosSection(): HTMLElement {
  return h('section', { class: 'card' }, h('h2', {}, 'Videos'), h('p', {}, `Rendered at ${new Date().toISOString()}`));
}

export function settingsView(): HTMLElement {
  const holder = h('div', { id: 'videos' }, videosSection());
  return h(
    'main',
    { id: 'settings' },
    h('h1', {}, 'Settings'),
    holder,
    h('button', { 'data-testid': 'rerender', onclick: () => replaceChildren(holder, videosSection()) }, 'Re-render'),
    h('p', {}, SHARED_LABEL),
    h('a', { href: '#/' }, 'Back'),
  );
}
