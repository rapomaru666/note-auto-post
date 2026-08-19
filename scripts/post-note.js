const { chromium } = require('playwright');
const fs = require('fs');

async function clickFirstVisible(candidates) {
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

async function fillFirstVisible(candidates, value) {
  for (const candidate of candidates) {
    try {
      const count = await candidate.count();
      for (let i = 0; i < count; i++) {
        const el = candidate.nth(i);
        if (!await el.isVisible().catch(() => false)) continue;
        await el.click().catch(() => {});
        await el.fill(value).catch(async () => {
          await el.press('Control+A').catch(() => {});
          await el.type(value, { delay: 30 });
        });
        return true;
      }
    } catch (_) {}
  }
  return false;
}

async function selectText(editor, text) {
  return editor.evaluate((root, needle) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let combined = '';
    let node;

    while ((node = walker.nextNode())) {
      nodes.push({ node, start: combined.length, end: combined.length + node.nodeValue.length });
      combined += node.nodeValue;
    }

    const start = combined.indexOf(needle);
    if (start < 0) return false;
    const end = start + needle.length;
    const startEntry = nodes.find(entry => entry.start <= start && entry.end > start);
    const endEntry = nodes.find(entry => entry.start < end && entry.end >= end);
    if (!startEntry || !endEntry) return false;

    const range = document.createRange();
    range.setStart(startEntry.node, start - startEntry.start);
    range.setEnd(endEntry.node, end - endEntry.start);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    return selection.toString() === needle;
  }, text);
}

async function applyTextLink(page, editor, link) {
  const selected = await selectText(editor, link.text);
  if (!selected) throw new Error(`リンク対象の文字を検出できません: ${link.text}`);

  const linkButtonClicked = await clickFirstVisible([
    page.getByRole('button', { name: /リンク/ }),
    page.locator('button[aria-label*="リンク"]'),
    page.locator('[role="button"][aria-label*="リンク"]')
  ]);

  if (!linkButtonClicked) {
    await page.keyboard.press('Control+K');
  }
  await page.waitForTimeout(700);

  const urlFilled = await fillFirstVisible([
    page.locator('textarea[placeholder="https://"]'),
    page.getByPlaceholder(/URL|リンク/),
    page.getByLabel(/URL|リンク/),
    page.locator('input[type="url"]'),
    page.locator('input').filter({ hasNot: page.locator('[type="checkbox"],[type="radio"]') })
  ], link.url);

  if (!urlFilled) throw new Error(`リンク先URLの入力欄を検出できません: ${link.text}`);

  const applied = await clickFirstVisible([
    page.getByRole('button', { name: '適用', exact: true }),
    page.getByText('適用', { exact: true }),
    page.getByRole('button', { name: '完了', exact: true })
  ]);
  if (!applied) await page.keyboard.press('Enter');
  await page.waitForTimeout(1000);

  const href = await editor.locator('a').filter({ hasText: link.text }).first()
    .getAttribute('href', { timeout: 3000 }).catch(() => null);
  if (!href) throw new Error(`リンクの適用を確認できません: ${link.text}`);
  console.log('リンク設定完了:', link.text, link.url);
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
    await page.waitForTimeout(3000);

    for (const link of post.links || []) {
      await applyTextLink(page, editor, link);
    }
    await page.waitForTimeout(2000);

    const openedPublishSettings = await clickFirstVisible([
      page.getByRole('button', { name: /公開設定/ }),
      page.getByRole('button', { name: /公開に進む/ }),
      page.getByText('公開設定', { exact: true }),
      page.getByText('公開に進む', { exact: true })
    ]);
    if (!openedPublishSettings) throw new Error('公開設定ボタンを検出できません。');
    await page.waitForTimeout(3000);

    if (post.paid === true) {
      const paidSelected = await clickFirstVisible([
        page.getByRole('radio', { name: /有料/ }),
        page.getByRole('button', { name: /^有料$/ }),
        page.getByText('有料', { exact: true })
      ]);
      if (!paidSelected) throw new Error('販売設定「有料」を検出できません。');
      await page.waitForTimeout(2500);

      const priceFilled = await fillFirstVisible([
        page.getByLabel(/価格（円）|価格\(円\)|価格/),
        page.getByPlaceholder(/価格|円/),
        page.locator('label:has-text("価格")').locator('input'),
        page.locator('text=価格').locator('xpath=following::input[1]'),
        page.locator('input[inputmode="decimal"]'),
        page.locator('input[inputmode="numeric"]'),
        page.locator('input[type="number"]')
      ], String(post.price || 100));
      if (!priceFilled) throw new Error('価格入力欄を検出できません。');
      console.log(`価格${post.price || 100}円を設定`);
      await page.waitForTimeout(1000);

      const paidAreaOpened = await clickFirstVisible([
        page.getByRole('button', { name: /有料エリア設定/ }),
        page.getByText('有料エリア設定', { exact: true })
      ]);

      if (paidAreaOpened) {
        await page.waitForTimeout(2500);
        const lineButtons = page.getByText(/ラインをこの場所に変更|ここから有料/);
        const lineCount = await lineButtons.count();
        if (lineCount > 0) {
          const idx = Math.min(post.paidLineIndex || 3, lineCount - 1);
          await lineButtons.nth(idx).click();
          console.log('有料ラインを設定:', idx);
        }
        await page.waitForTimeout(1500);
      }
    } else {
      const freeSelected = await clickFirstVisible([
        page.getByRole('radio', { name: /無料/ }),
        page.getByRole('button', { name: /^無料$/ }),
        page.getByText('無料', { exact: true })
      ]);
      console.log(freeSelected ? '無料記事を選択' : '無料記事の初期設定を使用');
      await page.waitForTimeout(1000);
    }

    const published = await clickFirstVisible([
      page.getByRole('button', { name: /^公開$/ }),
      page.getByRole('button', { name: /投稿する/ }),
      page.getByRole('button', { name: /公開する/ }),
      page.getByText('公開', { exact: true })
    ]);
    if (!published) throw new Error('最終公開ボタンを検出できません。');

    await page.waitForTimeout(3000);
    await clickFirstVisible([
      page.getByRole('button', { name: /公開する/ }),
      page.getByRole('button', { name: /投稿する/ }),
      page.getByRole('button', { name: /^公開$/ })
    ]).catch(() => {});

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
