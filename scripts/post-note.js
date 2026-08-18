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
    console.log('Current URL:', page.url());
    console.log('Page title:', await page.title());

    // 2026年7月時点のnoteエディタではタイトル欄のplaceholderは「記事タイトル」。
    const titleInput = page.getByPlaceholder('記事タイトル').first();
    await titleInput.waitFor({ state: 'visible', timeout: 60000 });
    await titleInput.click();
    await titleInput.fill(post.title);
    console.log('タイトル入力完了');

    // 本文はcontenteditable。fillではなく実際のキー入力で内部状態も更新する。
    const editor = page.locator('[contenteditable="true"]').first();
    await editor.waitFor({ state: 'visible', timeout: 60000 });
    await editor.click();
    await page.waitForTimeout(300);
    await page.keyboard.type(post.body, { delay: 4 });
    await page.waitForTimeout(500);
    console.log('本文入力完了');

    // 下書き保存ボタンを押す。公開はしない。
    const saveButton = page.getByRole('button', { name: '下書き保存' }).first();
    await saveButton.waitFor({ state: 'visible', timeout: 15000 });
    await saveButton.click();
    await page.waitForTimeout(2000);
    await page.waitForURL(/\/notes\/[a-z0-9]+\/edit/, { timeout: 15000 }).catch(() => {});

    console.log('下書き保存完了URL:', page.url());
  } catch (err) {
    try {
      await page.screenshot({ path: 'note-debug.png', fullPage: true });
    } catch (_) {}
    throw err;
  } finally {
    await browser.close();
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});
