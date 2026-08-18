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
    await page.waitForTimeout(5000);

    console.log('Current URL:', page.url());
    console.log('Page title:', await page.title());

    if (!page.url().includes('note.com')) {
      throw new Error(`note.comを開けませんでした: ${page.url()}`);
    }

    const titleCandidates = [
      page.getByPlaceholder(/タイトル/i),
      page.locator('textarea[placeholder*="タイトル"]'),
      page.locator('input[placeholder*="タイトル"]'),
      page.locator('textarea').first(),
      page.locator('input').first()
    ];

    let titleFilled = false;
    for (const candidate of titleCandidates) {
      try {
        if (await candidate.count()) {
          await candidate.first().waitFor({ state: 'visible', timeout: 5000 });
          await candidate.first().fill(post.title);
          titleFilled = true;
          break;
        }
      } catch (_) {}
    }

    if (!titleFilled) {
      await page.screenshot({ path: 'note-debug.png', fullPage: true });
      throw new Error(`タイトル入力欄を検出できません。現在URL: ${page.url()}`);
    }

    const bodyCandidates = [
      page.getByRole('textbox').filter({ hasNot: page.locator('textarea, input') }),
      page.locator('[contenteditable="true"]'),
      page.locator('[contenteditable="plaintext-only"]'),
      page.locator('div[role="textbox"]')
    ];

    let bodyFilled = false;
    for (const candidate of bodyCandidates) {
      try {
        const count = await candidate.count();
        if (count > 0) {
          const target = candidate.last();
          await target.waitFor({ state: 'visible', timeout: 10000 });
          await target.click();
          try {
            await target.fill(post.body);
          } catch (_) {
            await target.pressSequentially(post.body, { delay: 1 });
          }
          bodyFilled = true;
          break;
        }
      } catch (_) {}
    }

    if (!bodyFilled) {
      await page.screenshot({ path: 'note-debug.png', fullPage: true });
      throw new Error(`本文入力欄を検出できません。現在URL: ${page.url()}`);
    }

    await page.waitForTimeout(8000);
    console.log('noteへの入力処理が完了しました。公開操作は行っていません。');
  } finally {
    await browser.close();
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});
