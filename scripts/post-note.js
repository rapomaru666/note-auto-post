const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const post = JSON.parse(fs.readFileSync('post.json', 'utf8'));
  const storageState = JSON.parse(process.env.NOTE_STORAGE_STATE || '{}');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState });
  const page = await context.newPage();

  try {
    await page.goto('https://note.com/new', { waitUntil: 'domcontentloaded' });

    // note側のDOM変更に備え、候補を複数持たせる。
    const title = page.locator('textarea, input').filter({ has: page.locator('xpath=..') }).first();
    const editables = page.locator('[contenteditable="true"]');

    if (await editables.count() < 1) {
      throw new Error('本文入力欄を検出できません。noteの画面仕様を確認してください。');
    }

    // タイトル欄はplaceholder等を優先して探索。
    const titleCandidates = [
      page.getByPlaceholder(/タイトル/i),
      page.locator('textarea').first(),
      page.locator('input').first()
    ];
    let titleFilled = false;
    for (const candidate of titleCandidates) {
      if (await candidate.count()) {
        try {
          await candidate.fill(post.title);
          titleFilled = true;
          break;
        } catch (_) {}
      }
    }
    if (!titleFilled) throw new Error('タイトル入力欄を検出できません。');

    const body = editables.last();
    await body.click();
    await body.fill(post.body);

    // 初期版は安全のため公開操作をしない。
    // noteの自動保存を待って終了する。
    await page.waitForTimeout(5000);
    console.log('noteへの入力処理が完了しました。公開操作は行っていません。');
  } finally {
    await browser.close();
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});
