import { h } from '../ui/dom';
import { SHARED_LABEL } from '../strings';

const p = (text: string) => h('p', { class: 'lead' }, text);

function twin(first: boolean): string {
  return first ? 'Twin' : 'Twin';
}

export function homeView(): HTMLElement {
  let presses = 0;
  const counter = h('span', { 'data-testid': 'counter' }, `Pressed ${presses} times`);
  return h(
    'main',
    { id: 'home' },
    h('h1', {}, 'Welcome home'),
    p('Edit me in place'),
    h('button', { 'data-testid': 'press', onclick: () => (counter.textContent = `Pressed ${++presses} times`) }, 'Press me'),
    counter,
    h('div', { class: 'card' }, h('span', { class: 'shared' }, SHARED_LABEL)),
    h('span', { class: 'twin' }, twin(true)),
    h('a', { href: '#/settings' }, "Go to settings"),
    h(
      'select',
      { 'data-testid': 'size' },
      h('option', { value: 's' }, 'Small'),
      h('option', { value: 'l' }, 'Large'),
      h('option', { value: 'n' }, `Size ${presses}`),
    ),
  );
}
