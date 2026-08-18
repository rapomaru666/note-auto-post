const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const post = JSON.parse(fs.readFileSync('post.json', 'utf8'));
  const storageState = JSON.parse(process.env.NOTE_STORAGE_STATE || '{}');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState });
  const page = await context.newPage();

  try {
    await page.goto('https://note.com/new', { waitUntil: 'domcontentloaded', timeout: 60000 });

    // note editor is an SPA and can take a while to fully render.
    await page.waitForTimeout(20000);

    console.log('Current URL:', page.url());
    console.log('Page title:', await page.title());

    const titleSelectors = [
      'textarea[placeholder="記事タイトル"]',
      'textarea[placeholder*="タイトル"]',
      'div[data-placeholder*="タイトル"]',
      'h1[contenteditable="true"]'
    ];

    let titleFilled = false;
    for (const sel of titleSelectors) {
      try {
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: 5000 }).catch(() => false)) {
          await el.click();
          const tag = await el.evaluate(node => node.tagName.toLowerCase());
          if (tag === 'textarea' || tag === 'input') {
            await el.fill(post.title);
          } else {
            await page.keyboard.type(post.title, { delay: 20 });
          }
          titleFilled = true;
          console.log('Title selector used:', sel);
          break;
        }
      } catch (_) {}
    }

    if (!titleFilled) {
      await page.screenshot({ path: 'note-debug.png', fullPage: true });
      throw new Error(`タイトル入力欄を検出できません。現在URL: ${page.url()}`);
    }

    const bodySelectors = [
      'div.ProseMirror[contenteditable="true"]',
      'div[contenteditable="true"][role="textbox"]',
      '.ProseMirror',
      'div[contenteditable="true"]'
    ];

    let bodyFilled = false;
    for (const sel of bodySelectors) {
      try {
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: 10000 }).catch(() => false)) {
          await el.click();
          await page.keyboard.type(post.body, { delay: 5 });
          bodyFilled = true;
          console.log('Body selector used:', sel);
          break;
        }
      } catch (_) {}
    }

    if (!bodyFilled) {
      await page.screenshot({ path: 'note-debug.png', fullPage: true });
      throw new Error(`本文入力欄を検出できません。現在URL: ${page.url()}`);
    }

    // Give note time to autosave. Do not publish in this safety-first version.
    await page.waitForTimeout(10000);
    console.log('noteへの入力処理が完了しました。公開操作は行っていません。');
  } finally {
    await browser.close();
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});
