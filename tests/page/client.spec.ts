import { expect, test, type FrameLocator, type Locator, type Page } from '@playwright/test';
import { APP_URL, HARNESS, UNTRUSTED_HARNESS } from '../../playwright.config';

type Msg = { type: string; [key: string]: unknown };

async function open(page: Page, hash = '', harness = HARNESS): Promise<FrameLocator> {
  await page.goto(`${harness}/?target=${encodeURIComponent(APP_URL + hash)}`);
  const frame = page.frameLocator('#frame');
  await expect(frame.locator('h1')).toBeVisible();
  await expect.poll(() => received(page, 'le:hello')).toHaveLength(1);
  return frame;
}

function received(page: Page, type?: string): Promise<Msg[]> {
  return page.evaluate((t) => (window as unknown as { received: Msg[] }).received.filter((m) => !t || m.type === t), type);
}

/** Waits until at least `count` messages of `type` arrived and returns the latest. */
async function lastOf(page: Page, type: string, count = 1): Promise<Msg> {
  await expect.poll(async () => (await received(page, type)).length).toBeGreaterThanOrEqual(count);
  const list = await received(page, type);
  return list[list.length - 1]!;
}

/** Clicks the middle of the element's first text node, as a user aiming at the text would. */
async function clickText(target: Locator): Promise<void> {
  await clickTextOnly(target);
}

/** Clicks the text and waits for the inline editor to open on it. */
async function editText(target: Locator): Promise<void> {
  await clickTextOnly(target);
  await expect(target.locator('span[contenteditable="plaintext-only"]')).toBeVisible();
}

async function clickTextOnly(target: Locator): Promise<void> {
  const position = await target.evaluate((el) => {
    const text = [...el.childNodes].find((n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim())!;
    const range = document.createRange();
    range.selectNodeContents(text);
    const r = range.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    return { x: r.left - box.left + r.width / 2, y: r.top - box.top + r.height / 2 };
  });
  await target.click({ position });
}

const toFrame = (page: Page, msg: Msg) => page.evaluate((m) => (window as unknown as { toFrame(m: Msg): void }).toFrame(m), msg);
const setMode = (page: Page, mode: string) => toFrame(page, { type: 'le:setMode', mode });

test('handshake: hello, then ready once the trusted parent acks', async ({ page }) => {
  await open(page);
  const hello = await lastOf(page, 'le:hello');
  expect(hello).toMatchObject({ v: 1, url: APP_URL, title: 'h-app fixture' });
  expect(await lastOf(page, 'le:ready')).toMatchObject({ v: 1, url: APP_URL });
});

test('select mode: click selects, is swallowed, and describes the element', async ({ page }) => {
  const frame = await open(page);
  await setMode(page, 'select');
  await frame.getByTestId('press').click();
  await expect(frame.getByTestId('counter')).toHaveText('Pressed 0 times');
  const sel = await lastOf(page, 'le:select');
  const d = sel.descriptor as Record<string, any>;
  expect(d.tag).toBe('button');
  expect(d.testId).toBe('press');
  expect(d.textContent).toBe('Press me');
  expect(d.creationSite).toMatchObject({ rel: 'src/views/home.ts', line: 18 });
  expect(d.creationSiteIsAncestor).toBe(false);
  expect(d.editableText).toMatchObject({ value: 'Press me', rel: 'src/views/home.ts', line: 18 });
  expect(await frame.locator(d.selector).count()).toBe(1);

  // The anchor's creation site is its own h() call.
  await frame.locator('a').click();
  const a = (await lastOf(page, 'le:select', 2)).descriptor as Record<string, any>;
  expect(a.creationSite).toMatchObject({ rel: 'src/views/home.ts', line: 22 });
  expect(a.creationSiteIsAncestor).toBe(false);

  await page.keyboard.press('Escape');
  await lastOf(page, 'le:clearSelection');
});

test('select mode: descriptor is size-bounded', async ({ page }) => {
  const frame = await open(page);
  await setMode(page, 'select');
  // Body margin: the point hits <html>, the largest element on the page.
  await frame.locator('body').click({ position: { x: -10, y: -10 }, force: true });
  const d = (await lastOf(page, 'le:select')).descriptor as Record<string, any>;
  expect(d.tag).toBe('html');
  expect(d.outerHTML.length).toBeLessThanOrEqual(2048);
  expect(d.textContent.length).toBeLessThanOrEqual(300);
  expect(Object.keys(d.styles).length).toBeLessThanOrEqual(20);
  expect(JSON.stringify(d).length).toBeLessThan(6000);
});

test('edit mode: Enter commits a plain-text edit and restores the DOM structure', async ({ page }) => {
  const frame = await open(page);
  await setMode(page, 'edit');
  const h1 = frame.locator('h1');
  await clickText(h1);
  const editor = frame.locator('h1 > span[contenteditable="plaintext-only"]');
  await expect(editor).toBeVisible();
  await page.keyboard.type('Hello there');
  await page.keyboard.press('Enter');
  await expect(editor).toHaveCount(0);
  await expect(h1).toHaveText('Hello there');
  expect(await h1.evaluate((el) => el.childNodes.length)).toBe(1);
  const edit = await lastOf(page, 'le:edit');
  expect(edit.newValue).toBe('Hello there');
  expect((edit.candidates as any[])[0]).toMatchObject({ raw: "'Welcome home'", rel: 'src/views/home.ts', quote: "'" });
});

test('edit mode: Escape cancels and sends nothing', async ({ page }) => {
  const frame = await open(page);
  await setMode(page, 'edit');
  await editText(frame.locator('h1'));
  await page.keyboard.type('discard me');
  await page.keyboard.press('Escape');
  await expect(frame.locator('h1')).toHaveText('Welcome home');
  expect(await received(page, 'le:edit')).toHaveLength(0);
});

test('edit mode: paste is plain text and keeps line breaks as \\n', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const frame = await open(page);
  await setMode(page, 'edit');
  await editText(frame.locator('p.lead'));
  await frame.locator('p.lead > span').evaluate((span) => {
    const data = new DataTransfer();
    data.setData('text/plain', 'two\r\nlines');
    data.setData('text/html', '<b>bold</b>');
    span.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await page.keyboard.press('Enter');
  expect(await frame.locator('p.lead').evaluate((el) => el.textContent)).toBe('two\nlines');
  expect(await frame.locator('p.lead b').count()).toBe(0);
  expect((await lastOf(page, 'le:edit')).newValue).toBe('two\nlines');
});

test('edit mode: Shift+Enter adds a line break as text; Enter still commits', async ({ page }) => {
  const frame = await open(page);
  await setMode(page, 'edit');
  const h1 = frame.locator('h1');
  await editText(h1);
  await page.keyboard.type('Hello');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('there');
  await page.keyboard.press('Enter');
  await expect(h1.locator('span[contenteditable]')).toHaveCount(0);
  // One text node holding "\n": no <br> or <div> in the app's DOM.
  expect(await h1.evaluate((el) => [el.childNodes.length, el.textContent])).toEqual([1, 'Hello\nthere']);
  expect((await lastOf(page, 'le:edit')).newValue).toBe('Hello\nthere');
});

test('edit mode: a trailing line break can be removed, and cleared text retyped', async ({ page }) => {
  const frame = await open(page);
  await setMode(page, 'edit');
  await editText(frame.locator('h1'));
  await page.keyboard.type('A');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.press('Backspace');
  await page.keyboard.type('B');
  await page.keyboard.press('Enter');
  expect((await lastOf(page, 'le:edit')).newValue).toBe('AB');

  await editText(frame.locator('p.lead'));
  await page.keyboard.press('Backspace');
  await page.keyboard.type('X');
  await page.keyboard.press('Enter');
  expect((await lastOf(page, 'le:edit', 2)).newValue).toBe('X');
});

test('edit mode: clicking a button label edits it without pressing the button', async ({ page }) => {
  const frame = await open(page);
  await setMode(page, 'edit');
  await frame.getByTestId('press').click();
  await expect(frame.locator('[data-testid="press"] > span[contenteditable]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(frame.getByTestId('counter')).toHaveText('Pressed 0 times');
});

test('edit mode: runtime-built text is not editable', async ({ page }) => {
  const frame = await open(page);
  await setMode(page, 'edit');
  await frame.getByTestId('counter').click();
  await page.waitForTimeout(300);
  expect(await frame.locator('[contenteditable]').count()).toBe(0);
  expect(await received(page, 'le:edit')).toHaveLength(0);
});

const optionTexts = (select: Locator) => select.locator('option').allTextContents();

test('edit mode: a dropdown lists its options; Tab saves a row and Enter closes', async ({ page }) => {
  const frame = await open(page);
  await setMode(page, 'edit');
  const select = frame.getByTestId('size');
  const panel = frame.locator('vibe-visual-editor-options');
  await select.click();
  await expect(panel).toHaveCount(1);
  // Focus starts on the selected option with its text selected.
  await page.keyboard.type('Tiny');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Huge');
  await page.keyboard.press('Enter');
  await expect(panel).toHaveCount(0);
  expect(await optionTexts(select)).toEqual(['Tiny', 'Huge', 'Size 0']);
  await expect.poll(async () => (await received(page, 'le:edit')).map((e) => e.newValue)).toEqual(['Tiny', 'Huge']);
  const edits = await received(page, 'le:edit');
  expect((edits[0]!.candidates as any[])[0]).toMatchObject({ raw: "'Small'", rel: 'src/views/home.ts' });
  expect((edits[1]!.candidates as any[])[0]).toMatchObject({ raw: "'Large'", rel: 'src/views/home.ts' });
  // The app's own selection is untouched.
  await expect(select).toHaveValue('s');
});

test('edit mode: Escape closes the dropdown panel without an edit', async ({ page }) => {
  const frame = await open(page);
  await setMode(page, 'edit');
  const select = frame.getByTestId('size');
  await select.click();
  await expect(frame.locator('vibe-visual-editor-options')).toHaveCount(1);
  await page.keyboard.type('Nope');
  await page.keyboard.press('Escape');
  await expect(frame.locator('vibe-visual-editor-options')).toHaveCount(0);
  expect(await optionTexts(select)).toEqual(['Small', 'Large', 'Size 0']);
  expect(await received(page, 'le:edit')).toHaveLength(0);
});

test('edit mode: runtime-built options are listed but skipped', async ({ page }) => {
  const frame = await open(page);
  await setMode(page, 'edit');
  const select = frame.getByTestId('size');
  await select.click();
  await expect(frame.locator('vibe-visual-editor-options')).toHaveCount(1);
  // Small -> Large -> back to Small: Tab wraps and passes over "Size 0".
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Tiny');
  await page.keyboard.press('Enter');
  expect(await optionTexts(select)).toEqual(['Tiny', 'Large', 'Size 0']);
  await expect.poll(async () => (await received(page, 'le:edit')).map((e) => e.newValue)).toEqual(['Tiny']);
});

test('pending edits survive re-renders and revert when discarded', async ({ page }) => {
  const frame = await open(page, '#/settings');
  await setMode(page, 'edit');
  await editText(frame.locator('h2'));
  await page.keyboard.type('Clips');
  await page.keyboard.press('Enter');
  const edit = await lastOf(page, 'le:edit');
  const candidate = (edit.candidates as any[])[0];
  await toFrame(page, { type: 'le:editApplied', requestId: edit.requestId, literalId: candidate.id, value: 'Clips' });
  await toFrame(page, { type: 'le:pending', edits: [{ literalId: candidate.id, value: 'Clips', original: 'Videos' }] });

  await setMode(page, 'browse');
  await frame.getByTestId('rerender').click();
  await expect(frame.locator('h2')).toHaveText('Clips');

  await toFrame(page, { type: 'le:pending', edits: [] });
  await expect(frame.locator('h2')).toHaveText('Videos');
});

test('rejected edits revert the text', async ({ page }) => {
  const frame = await open(page);
  await setMode(page, 'edit');
  await editText(frame.locator('h1'));
  await page.keyboard.type('Nope');
  await page.keyboard.press('Enter');
  const edit = await lastOf(page, 'le:edit');
  await toFrame(page, { type: 'le:editRejected', requestId: edit.requestId, reason: 'file changed' });
  await expect(frame.locator('h1')).toHaveText('Welcome home');
});

test('keyboard: save/undo/redo are forwarded and the browser default is prevented', async ({ page }) => {
  const frame = await open(page);
  await clickText(frame.locator('h1'));
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.keyboard.press(`${mod}+s`);
  await page.keyboard.press(`${mod}+z`);
  await page.keyboard.press(`${mod}+Shift+z`);
  await expect.poll(async () => (await received(page, 'le:key')).map((m) => m.action)).toEqual(['save', 'undo', 'redo']);
});

test('location changes are reported', async ({ page }) => {
  const frame = await open(page);
  await frame.locator('a[href="#/settings"]').click();
  const loc = await lastOf(page, 'le:location');
  expect(loc.url).toBe(`${APP_URL}#/settings`);
});

test('an untrusted parent gets no messages after hello', async ({ page }) => {
  const frame = await open(page, '', UNTRUSTED_HARNESS);
  await setMode(page, 'select');
  await clickText(frame.locator('h1'));
  await page.waitForTimeout(300);
  expect((await received(page)).map((m) => m.type)).toEqual(['le:hello']);
});

test('a normal browser tab is unaffected', async ({ page }) => {
  await page.goto(APP_URL);
  await expect(page.locator('h1')).toHaveText('Welcome home');
  expect(await page.locator('vibe-visual-editor-overlay').count()).toBe(0);
  await page.getByTestId('press').click();
  await expect(page.getByTestId('counter')).toHaveText('Pressed 1 times');
});
