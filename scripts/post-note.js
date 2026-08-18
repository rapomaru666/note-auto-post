const { chromium } = require('playwright');
const fs = require('fs');

async function clickFirstVisible(candidates, timeout = 12000) {
  for (const candidate of candidates) {
    try {
      const el = candidate.first();
      if (await el.isVisible({ timeout: 1500 }).catch(() => false)) {
        await el.click();
        return true;
      }
    } catch (_) {}
  }
  return false;
}

(async () => {
  const post = JSON.parse(fs.readFileSync('post.json', 'utf8'));
  const storageState = JSON.parse(process.env.NOTE_STORAGE_STATE || '{}');
  const headless = process.env.HEADLESS !== 'false';

  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({ storageState, viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();

  page.on('console', msg => console.log('[browser]', msg.type(), msg.text()));
  page.on('pageerror', err => console.log('[pageerror]', err.message));
  page.on('requestfailed', req => console.log('[requestfailed]', req.url(), req.failure()?.errorText || ''));

  try {
    await page.goto('https://note.com/new', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(15000);
    console.log('Current URL:', page.url());

    const titleInput = page.getByPlaceholder('記事タイトル').first();
    await titleInput.waitFor({ state: 'visible', timeout: 60000 });
    await titleInput.fill(post.title);

    const editor = page.locator('[contenteditable="true"]').first();
    await editor.waitFor({ state: 'visible', timeout: 60000 });
    await editor.click();
    await page.keyboard.type(post.body, { delay: 1 });
    console.log('本文入力完了');

    // 入力内容がnote側へ反映されるまで待つ。
    await page.waitForTimeout(5000);

    // 公開設定へ進む。現在のUI差異に備えて候補を複数持つ。
    const openedPublishSettings = await clickFirstVisible([
      page.getByRole('button', { name: /公開設定/ }),
      page.getByRole('button', { name: /公開に進む/ }),
      page.getByText('公開設定', { exact: true }),
      page.getByText('公開に進む', { exact: true })
    ]);
    if (!openedPublishSettings) throw new Error('公開設定ボタンを検出できません。');
    await page.waitForTimeout(3000);

    // 販売設定を「有料」にする。
    const paidSelected = await clickFirstVisible([
      page.getByRole('radio', { name: '有料' }),
      page.getByRole('button', { name: '有料' }),
      page.getByText('有料', { exact: true })
    ]);
    if (!paidSelected) throw new Error('販売設定「有料」を検出できません。');
    await page.waitForTimeout(1500);

    // 価格100円を設定。
    let priceFilled = false;
    const priceCandidates = [
      page.getByLabel(/価格/),
      page.getByPlaceholder(/価格/),
      page.locator('input[inputmode="numeric"]'),
      page.locator('input[type="number"]')
    ];
    for (const candidate of priceCandidates) {
      try {
        const count = await candidate.count();
        for (let i = 0; i < count; i++) {
          const el = candidate.nth(i);
          if (await el.isVisible().catch(() => false)) {
            await el.fill('100');
            priceFilled = true;
            break;
          }
        }
        if (priceFilled) break;
      } catch (_) {}
    }
    if (!priceFilled) throw new Error('価格入力欄を検出できません。');
    console.log('価格100円を設定');

    // 有料エリア設定。無料部分を残すため、可能なら数段落後にラインを置く。
    const paidAreaOpened = await clickFirstVisible([
      page.getByRole('button', { name: /有料エリア設定/ }),
      page.getByText('有料エリア設定', { exact: true })
    ]);

    if (paidAreaOpened) {
      await page.waitForTimeout(2500);
      const lineButtons = page.getByText(/ラインをこの場所に変更/);
      const lineCount = await lineButtons.count();
      if (lineCount > 0) {
        // 冒頭の説明を無料で読めるよう、先頭ではなく数段落後を選択。
        const idx = Math.min(3, lineCount - 1);
        await lineButtons.nth(idx).click();
        console.log('有料ラインを設定:', idx);
      } else {
        console.log('有料ライン変更ボタンは見つからず。note側の既定位置を使用。');
      }
      await page.waitForTimeout(1500);
    } else {
      console.log('有料エリア設定ボタンは見つからず。note側の既定位置を使用。');
    }

    // 最終公開。ボタン名はUIによって「公開」「投稿する」等になる。
    const published = await clickFirstVisible([
      page.getByRole('button', { name: /^公開$/ }),
      page.getByRole('button', { name: /投稿する/ }),
      page.getByRole('button', { name: /公開する/ }),
      page.getByText('公開', { exact: true })
    ], 15000);
    if (!published) throw new Error('最終公開ボタンを検出できません。');

    await page.waitForTimeout(3000);
    // 確認ダイアログが出た場合も承認する。
    await clickFirstVisible([
      page.getByRole('button', { name: /公開する/ }),
      page.getByRole('button', { name: /投稿する/ }),
      page.getByRole('button', { name: /^公開$/ })
    ], 5000).catch(() => {});

    await page.waitForTimeout(8000);
    console.log('公開処理完了URL:', page.url());
    fs.writeFileSync('published-url.txt', page.url(), 'utf8');
    await page.screenshot({ path: 'note-published.png', fullPage: true });
  } catch (err) {
    try {
      await page.screenshot({ path: 'note-debug.png', fullPage: true });
      fs.writeFileSync('note-debug.html', await page.content(), 'utf8');
    } catch (_) {}
    throw err;
  } finally {
    await browser.close();
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});
