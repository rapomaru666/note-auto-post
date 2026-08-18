const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const post = JSON.parse(fs.readFileSync('post.json', 'utf8'));
  const storageState = JSON.parse(process.env.NOTE_STORAGE_STATE || '{}');
  const headless = process.env.HEADLESS !== 'false';

  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({ storageState });
  const page = await context.newPage();

  page.on('console', msg => console.log('[browser]', msg.type(), msg.text()));
  page.on('pageerror', err => console.log('[pageerror]', err.message));
  page.on('requestfailed', req => console.log('[requestfailed]', req.url(), req.failure()?.errorText || ''));

  try {
    await page.goto('https://note.com/new', { waitUntil: 'domcontentloaded', timeout: 60000 });
    console.log('Current URL:', page.url());
    console.log('Page title:', await page.title());

    // SPAのローディングが終わるまで待つ。
    await page.waitForTimeout(15000);

    const titleInput = page.getByPlaceholder('記事タイトル').first();
    await titleInput.waitFor({ state: 'visible', timeout: 60000 });
    await titleInput.click();
    await titleInput.fill(post.title);
    console.log('タイトル入力完了');

    const editor = page.locator('[contenteditable="true"]').first();
    await editor.waitFor({ state: 'visible', timeout: 60000 });
    await editor.click();
    await page.keyboard.type(post.body, { delay: 4 });
    console.log('本文入力完了');

    const saveButton = page.getByRole('button', { name: '下書き保存' }).first();
    await saveButton.waitFor({ state: 'visible', timeout: 15000 });
    await saveButton.click();
    await page.waitForTimeout(3000);

    console.log('下書き保存完了URL:', page.url());
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
