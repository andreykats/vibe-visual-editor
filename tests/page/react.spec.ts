import { expect, test, type Page } from '@playwright/test';
import { HARNESS, REACT_URL } from '../../playwright.config';
import { clickText, editText, lastOf, open, received, setMode, toFrame } from './helpers';

const openReact = (page: Page) => open(page, '', HARNESS, REACT_URL);

test('react: edits JSX text in place, keeping the text node where React put it', async ({ page }) => {
  const frame = await openReact(page);
  await setMode(page, 'edit');
  const h1 = frame.locator('h1');
  await editText(h1);
  // React keeps a reference to its text node: it must stay a direct child while the editor is open.
  expect(await h1.evaluate((el) => [...el.childNodes].map((n) => n.nodeName))).toEqual(['SPAN', '#text']);
  await page.keyboard.type('Hello React');
  await page.keyboard.press('Enter');
  await expect(h1).toHaveText('Hello React');
  expect(await h1.evaluate((el) => el.childNodes.length)).toBe(1);
  const edit = await lastOf(page, 'le:edit');
  expect(edit.newValue).toBe('Hello React');
  expect((edit.candidates as any[])[0]).toMatchObject({ rel: 'src/App.tsx', quote: 'jsx', raw: 'Welcome to React', line: 9 });

  // React still owns a working DOM after the edit.
  await setMode(page, 'browse');
  await frame.getByTestId('press').click();
  await expect(frame.getByTestId('counter')).toHaveText('Pressed 1 times');
});

test("react: a component's text prop resolves to the prop at the call site", async ({ page }) => {
  const frame = await openReact(page);
  await setMode(page, 'edit');
  await editText(frame.locator('h2'));
  await page.keyboard.type('Settings');
  await page.keyboard.press('Enter');
  const edit = await lastOf(page, 'le:edit');
  expect((edit.candidates as any[])[0]).toMatchObject({ rel: 'src/App.tsx', quote: 'jsx-attr', raw: '"Card title"' });
});

test('react: multi-line JSX text and entities resolve to their source', async ({ page }) => {
  const frame = await openReact(page);
  await setMode(page, 'edit');
  await editText(frame.locator('p.lead'));
  await page.keyboard.press('Enter');
  await editText(frame.getByTestId('entity'));
  await page.keyboard.type('Tom & Jerry & co');
  await page.keyboard.press('Enter');
  const edit = await lastOf(page, 'le:edit');
  expect(edit.newValue).toBe('Tom & Jerry & co');
  expect((edit.candidates as any[])[0]).toMatchObject({ quote: 'jsx', raw: 'Tom &amp; Jerry' });
});

test('react: text built at runtime is not editable', async ({ page }) => {
  const frame = await openReact(page);
  await setMode(page, 'edit');
  await frame.getByTestId('counter').click();
  await page.waitForTimeout(300);
  expect(await frame.locator('[contenteditable]').count()).toBe(0);
  expect(await received(page, 'le:edit')).toHaveLength(0);
});

test('react: select mode points at the JSX element and keeps data-vve-loc out of the descriptor', async ({ page }) => {
  const frame = await openReact(page);
  await setMode(page, 'select');
  await clickText(frame.locator('h1'));
  const d = (await lastOf(page, 'le:select')).descriptor as Record<string, any>;
  expect(d.tag).toBe('h1');
  expect(d.creationSite).toMatchObject({ rel: 'src/App.tsx', line: 9, column: 7 });
  expect(d.creationSiteIsAncestor).toBe(false);
  expect(d.editableText).toMatchObject({ value: 'Welcome to React', rel: 'src/App.tsx', line: 9 });
  expect(d.outerHTML).toBe('<h1>Welcome to React</h1>');
});

test('react: pending edits survive a React re-render and revert when discarded', async ({ page }) => {
  const frame = await openReact(page);
  await setMode(page, 'edit');
  const h1 = frame.locator('h1');
  await editText(h1);
  await page.keyboard.type('Pending');
  await page.keyboard.press('Enter');
  const edit = await lastOf(page, 'le:edit');
  const candidate = (edit.candidates as any[])[0];
  await toFrame(page, { type: 'le:editApplied', requestId: edit.requestId, literalId: candidate.id, value: 'Pending' });
  await toFrame(page, { type: 'le:pending', edits: [{ literalId: candidate.id, value: 'Pending', original: 'Welcome to React' }] });

  await setMode(page, 'browse');
  await frame.getByTestId('press').click();
  await expect(frame.getByTestId('counter')).toHaveText('Pressed 1 times');
  await expect(h1).toHaveText('Pending');

  await toFrame(page, { type: 'le:pending', edits: [] });
  await expect(h1).toHaveText('Welcome to React');
});
