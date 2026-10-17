import { replaceChildren } from './ui/dom';
import { homeView } from './views/home';
import { settingsView } from './views/settings';

function render(): void {
  const app = document.getElementById('app')!;
  replaceChildren(app, location.hash === '#/settings' ? settingsView() : homeView());
}

window.addEventListener('hashchange', render);
render();
