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
  await page.keyboard.press('Escape').catch(() => {});
  const targetText = page.getByText(link.text, { exact: true }).first();
  await targetText.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await editor.focus();
  await page.waitForTimeout(300);
  const selected = await selectText(editor, link.text);
  if (!selected) throw new Error(`リンク対象の文字を検出できません: ${link.text}`);
  console.log('リンク対象を選択:', link.text);
  const linkButton = page.locator('button[aria-label="リンク"]:visible').first();
  await linkButton.waitFor({ state: 'visible', timeout: 10000 });
  await linkButton.dispatchEvent('click');
  console.log('リンク入力欄を表示:', link.text);

  const inputUrl = link.url.replace(/^https?:\/\//, '');
  const urlField = page.locator('textarea[placeholder="https://"]:visible').first();
  await urlField.waitFor({ state: 'visible', timeout: 10000 });
  await urlField.fill(inputUrl);
  console.log('リンクURLを入力:', await urlField.inputValue());

  const applyButton = page.getByRole('button', { name: '適用', exact: true }).first();
  await applyButton.waitFor({ state: 'visible', timeout: 10000 });
  await applyButton.click();
  await page.waitForTimeout(1000);

  const href = await editor.locator('a').filter({ hasText: link.text }).first()
    .getAttribute('href', { timeout: 3000 }).catch(() => null);
  let linkIsValid = false;
  try {
    linkIsValid = new URL(href).hostname === new URL(link.url).hostname;
  } catch (_) {}
  if (!linkIsValid) throw new Error(`リンクの適用を確認できません: ${link.text} (${href || 'hrefなし'})`);
  console.log('リンク設定完了:', link.text, link.url);
}

async function uploadHeaderImage(page, imagePath) {
  if (!imagePath) return;
  if (!fs.existsSync(imagePath)) {
    throw new Error(`見出し画像が見つかりません: ${imagePath}`);
  }

  const existingHeader = page.locator('figure:has(img[alt="eyecatch"])').first();
  if (await existingHeader.isVisible().catch(() => false)) {
    const removeHeaderButton = page
      .locator('figure:has(img[alt="eyecatch"]) + div button:has(svg[aria-label="削除"])')
      .first();
    await removeHeaderButton.waitFor({ state: 'visible', timeout: 10000 });
    await removeHeaderButton.click();
    await existingHeader.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1500);
    console.log('既存の見出し画像を取り外し');
  }

  // このボタンを押した時点で、noteが非表示の画像inputをDOMへ追加する。
  const addImageButton = page.locator('button:has(svg[aria-label="画像を追加"])').first();
  await addImageButton.waitFor({ state: 'visible', timeout: 15000 });
  await addImageButton.click();

  const uploadChoice = page.getByText('画像をアップロード', { exact: false }).first();
  await uploadChoice.waitFor({ state: 'visible', timeout: 10000 });
  await uploadChoice.click();

  // noteの見出し画像入力はモーダル内ではなく、編集ページ直下に常設された
  // 非表示input。追加ボタンを押した後、この実際のinputへ直接ファイルを渡す。
  const fileInput = page.locator('#note-editor-eyecatch-input');
  await fileInput.waitFor({ state: 'attached', timeout: 15000 });
  await fileInput.setInputFiles(imagePath);
  console.log('見出し画像を選択:', imagePath);
  await page.waitForTimeout(2500);

  const cropDialog = page.getByRole('dialog').last();
  if (await cropDialog.isVisible().catch(() => false)) {
    // 画像の読込・描画が終わる前に保存すると、未描画部分が灰色のまま
    // 書き出されることがある。推奨サイズ画像でも十分に待ってから確定する。
    await page.waitForTimeout(12000);
    await page.screenshot({ path: 'note-crop-ready.png' });
    const applied = await clickFirstVisible([
      cropDialog.getByRole('button', { name: /適用/ }),
      cropDialog.getByRole('button', { name: /完了/ }),
      cropDialog.getByRole('button', { name: /決定/ }),
      cropDialog.getByRole('button', { name: /保存/ })
    ]);
    if (!applied) throw new Error('見出し画像の確定ボタンを検出できません。');
    await cropDialog.waitFor({ state: 'hidden', timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(4000);
  }

  console.log('見出し画像の設定処理完了');
}

(async () => {
  const postPath = process.env.POST_FILE || 'post.json';
  const post = JSON.parse(fs.readFileSync(postPath, 'utf8'));
  if (process.env.PREVIOUS_URL && Array.isArray(post.links)) {
    post.links = post.links.map(link => ({
      ...link,
      url: link.url === '__PREVIOUS_URL__' ? process.env.PREVIOUS_URL : link.url
    }));
  }
  const storageState = JSON.parse(process.env.NOTE_STORAGE_STATE || '{}');
  const headless = process.env.HEADLESS !== 'false';

  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({ storageState, viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();

  page.on('console', msg => console.log('[browser]', msg.type(), msg.text()));
  page.on('pageerror', err => console.log('[pageerror]', err.message));
  page.on('requestfailed', req => console.log('[requestfailed]', req.url(), req.failure()?.errorText || ''));

  try {
    const updateCoverMode = post.action === 'updateCover' && post.noteId;
    const updateLinksMode = post.action === 'updateLinks' && post.noteId;
    const startUrl = (updateCoverMode || updateLinksMode)
      ? `https://editor.note.com/notes/${post.noteId}/edit/`
      : 'https://note.com/new';
    await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(15000);
    console.log('Current URL:', page.url());

    const titleInput = page.getByPlaceholder('記事タイトル').first();
    await titleInput.waitFor({ state: 'visible', timeout: 60000 });
    if (updateCoverMode) {
      console.log('公開済み記事の見出し画像だけを更新:', post.noteId);
      await uploadHeaderImage(page, post.coverImage);
    } else if (updateLinksMode) {
      console.log('公開済み記事の案内リンクを更新:', post.noteId);
      const editor = page.locator('[contenteditable="true"]').first();
      await editor.waitFor({ state: 'visible', timeout: 60000 });
      const links = post.links || [];
      for (let i = 0; i < links.length; i++) {
        await applyTextLink(page, editor, links[i]);
        if (i < links.length - 1) {
          // 公開済み記事は自動保存を待ってから再読込する。
          await page.waitForTimeout(5000);
          await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
          await page.waitForTimeout(8000);
          await editor.waitFor({ state: 'visible', timeout: 60000 });
          await page.getByText(links[i + 1].text, { exact: true }).waitFor({ state: 'visible', timeout: 60000 });
          console.log('次のリンク設定のため編集画面を再読込');
        }
      }
    } else {
      await titleInput.fill(post.title);

      const editor = page.locator('[contenteditable="true"]').first();
      await editor.waitFor({ state: 'visible', timeout: 60000 });
      await editor.click();
      await page.keyboard.type(post.body, { delay: 1 });
      console.log('本文入力完了');
      await page.waitForTimeout(3000);

      await uploadHeaderImage(page, post.coverImage);

      const links = post.links || [];
      for (let i = 0; i < links.length; i++) {
        await applyTextLink(page, editor, links[i]);
        if (i < links.length - 1) {
          const saved = await clickFirstVisible([
            page.getByRole('button', { name: '下書き保存', exact: true }),
            page.getByText('下書き保存', { exact: true })
          ]);
          if (!saved) throw new Error('リンク設定後の下書き保存ボタンを検出できません。');
          await page.waitForTimeout(5000);
          await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
          await page.waitForTimeout(8000);
          await editor.waitFor({ state: 'visible', timeout: 60000 });
          await page.getByText(links[i + 1].text, { exact: true }).waitFor({ state: 'visible', timeout: 60000 });
          console.log('次のリンク設定のため編集画面を再読込');
        }
      }
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
      const paidRadio = page.locator('input#paid').first();
      await paidRadio.waitFor({ state: 'attached', timeout: 10000 });
      await paidRadio.evaluate(element => element.click());
      await page.waitForFunction(() => document.querySelector('input#paid')?.checked === true, null, { timeout: 10000 });
      console.log('有料記事を選択');
      await page.waitForTimeout(1500);

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
      page.getByRole('button', { name: /^更新$/ }),
      page.getByRole('button', { name: /更新する/ }),
      page.getByRole('button', { name: /^公開$/ }),
      page.getByRole('button', { name: /投稿する/ }),
      page.getByRole('button', { name: /公開する/ }),
      page.getByText('更新', { exact: true }),
      page.getByText('公開', { exact: true })
    ]);
    if (!published) throw new Error('最終公開ボタンを検出できません。');

    await page.waitForTimeout(3000);
    await clickFirstVisible([
      page.getByRole('button', { name: /更新する/ }),
      page.getByRole('button', { name: /^更新$/ }),
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
