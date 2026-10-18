import { expect, type FrameLocator, type Locator, type Page } from '@playwright/test';
import { APP_URL, HARNESS } from '../../playwright.config';

export type Msg = { type: string; [key: string]: unknown };

/** Opens `app` (the h() fixture by default) in the harness and waits for the client's hello. */
export async function open(page: Page, hash = '', harness = HARNESS, app = APP_URL): Promise<FrameLocator> {
  await page.goto(`${harness}/?target=${encodeURIComponent(app + hash)}`);
  const frame = page.frameLocator('#frame');
  await expect(frame.locator('h1')).toBeVisible();
  await expect.poll(() => received(page, 'le:hello')).toHaveLength(1);
  return frame;
}

export function received(page: Page, type?: string): Promise<Msg[]> {
  return page.evaluate((t) => (window as unknown as { received: Msg[] }).received.filter((m) => !t || m.type === t), type);
}

/** Waits until at least `count` messages of `type` arrived and returns the latest. */
export async function lastOf(page: Page, type: string, count = 1): Promise<Msg> {
  await expect.poll(async () => (await received(page, type)).length).toBeGreaterThanOrEqual(count);
  const list = await received(page, type);
  return list[list.length - 1]!;
}

/** Clicks the middle of the element's first text node, as a user aiming at the text would. */
export async function clickText(target: Locator): Promise<void> {
  await clickTextOnly(target);
}

/** Clicks the text and waits for the inline editor to open on it. */
export async function editText(target: Locator): Promise<void> {
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

export const toFrame = (page: Page, msg: Msg) => page.evaluate((m) => (window as unknown as { toFrame(m: Msg): void }).toFrame(m), msg);
export const setMode = (page: Page, mode: string) => toFrame(page, { type: 'le:setMode', mode });
