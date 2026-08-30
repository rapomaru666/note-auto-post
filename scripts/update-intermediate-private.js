const { chromium } = require('playwright');
const fs = require('fs');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function clickFirstVisible(candidates) {
  for (const candidate of candidates) {
    try {
      const el = candidate.first();
      if (await el.isVisible({ timeout: 1200 }).catch(() => false)) {
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
          await el.type(value, { delay: 20 });
        });
        return true;
      }
    } catch (_) {}
  }
  return false;
}

async function selectText(editor, text, occurrence = 0) {
  return editor.evaluate((root, values) => {
    const needle = values.needle;
    const occurrence = values.occurrence;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let combined = '';
    let node;
    while ((node = walker.nextNode())) {
      nodes.push({ node, start: combined.length, end: combined.length + node.nodeValue.length });
      combined += node.nodeValue;
    }
    let start = -1;
    let fromIndex = 0;
    for (let i = 0; i <= occurrence; i++) {
      start = combined.indexOf(needle, fromIndex);
      if (start < 0) return false;
      fromIndex = start + needle.length;
    }
    const end = start + needle.length;
    const a = nodes.find(x => x.start <= start && x.end > start);
    const b = nodes.find(x => x.start < end && x.end >= end);
    if (!a || !b) return false;
    const range = document.createRange();
    range.setStart(a.node, start - a.start);
    range.setEnd(b.node, end - b.start);
    a.node.parentElement?.scrollIntoView({ block: 'center', inline: 'nearest' });
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    return sel.toString() === needle;
  }, { needle: text, occurrence });
}

async function applyTextLink(page, editor, link, occurrence = 0) {
  await page.keyboard.press('Escape').catch(() => {});
  await editor.focus();
  const selected = await selectText(editor, link.text, occurrence);
  if (!selected) throw new Error(`link text not found: ${link.text}`);
  await sleep(350);
  const linkButton = page.locator('button[aria-label="リンク"]:visible').first();
  await linkButton.waitFor({ state: 'visible', timeout: 10000 });
  await linkButton.dispatchEvent('click');
  const field = page.locator('textarea[placeholder="https://"]:visible').first();
  await field.waitFor({ state: 'visible', timeout: 10000 });
  await field.fill(link.url.replace(/^https?:\/\//, ''));
  const apply = page.getByRole('button', { name: '適用', exact: true }).first();
  await apply.waitFor({ state: 'visible', timeout: 10000 });
  await apply.evaluate(el => el.click());
  await sleep(700);
  const href = await editor.locator('a').filter({ hasText: link.text }).nth(occurrence)
    .getAttribute('href', { timeout: 3000 }).catch(() => null);
  if (!href || !href.includes('note.com/')) throw new Error(`link apply failed: ${link.text}`);
}

async function openPublishSettings(page) {
  const ok = await clickFirstVisible([
    page.getByRole('button', { name: /公開設定/ }),
    page.getByRole('button', { name: /公開に進む/ }),
    page.getByText('公開設定', { exact: true }),
    page.getByText('公開に進む', { exact: true })
  ]);
  if (!ok) throw new Error('publish settings button not found');
  await page.waitForURL(/\/publish\/?/, { timeout: 60000 }).catch(() => {});
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await sleep(10000);
}

async function replaceHashtags(page, tags) {
  const candidates = [
    page.getByPlaceholder(/ハッシュタグ/),
    page.getByLabel(/ハッシュタグ/),
    page.locator('input[placeholder*="ハッシュ"]'),
    page.locator('input[aria-label*="ハッシュ"]'),
    page.locator('textarea[placeholder*="ハッシュ"]')
  ];
  let field = null;
  for (let attempt = 0; attempt < 30 && !field; attempt++) {
    for (const c of candidates) {
      const count = await c.count().catch(() => 0);
      for (let i = 0; i < count; i++) {
        if (await c.nth(i).isVisible().catch(() => false)) { field = c.nth(i); break; }
      }
      if (field) break;
    }
    if (!field && attempt === 4) {
      await clickFirstVisible([page.getByRole('button', { name: /詳細設定/ }), page.getByText('詳細設定', { exact: true })]);
    }
    if (!field) await sleep(500);
  }
  if (!field) throw new Error('hashtag input not found');

  const container = field.locator('xpath=..');
  const selected = container.locator('button:has([aria-label="削除"])');
  while (await selected.count() > 0) {
    await selected.first().click();
    await sleep(200);
  }
  for (const raw of tags || []) {
    const tag = String(raw).replace(/^#/, '');
    await field.click();
    await field.fill(tag);
    await field.press('Space');
    await sleep(350);
  }
}

function buildLinks(article, manifest) {
  const links = [];
  const lines = String(article.body).split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  const indexUrl = manifest.articles?.['00']?.url;
  const roadmap = '中級編の全体ロードマップはこちら';
  if (indexUrl && lines.includes(roadmap)) links.push({ text: roadmap, url: indexUrl });
  const circles = ['','①','②','③','④','⑤','⑥','⑦','⑧','⑨'];
  for (let i = 1; i <= 9; i++) {
    const prefix = `中級編${circles[i]}：`;
    const text = lines.find(line => line.startsWith(prefix));
    const url = manifest.articles?.[String(i).padStart(2, '0')]?.url;
    if (text && url) links.push({ text, url });
  }
  return links;
}

function paragraphIndex(body, anchor) {
  const p = String(body).split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  const matches = p.map((text, index) => ({text,index})).filter(x => x.text === anchor);
  if (matches.length !== 1) throw new Error(`paidStartText must match once: ${anchor}`);
  return matches[0].index;
}

async function finalizeUpdate(page) {
  let done = false;
  for (let attempt = 0; attempt < 45 && !done; attempt++) {
    done = await clickFirstVisible([
      page.getByRole('button', { name: /^更新$/ }),
      page.getByRole('button', { name: /更新する/ }),
      page.getByRole('button', { name: /^公開$/ }),
      page.getByRole('button', { name: /投稿する/ }),
      page.getByRole('button', { name: /公開する/ }),
      page.getByText('更新', { exact: true }),
      page.getByText('公開', { exact: true })
    ]);
    if (!done) {
      const paidArea = page.getByRole('button', { name: /有料エリア設定/ }).first();
      if (await paidArea.isVisible().catch(() => false)) {
        await paidArea.click().catch(() => {});
        await sleep(2500);
      } else {
        await sleep(500);
      }
    }
  }
  if (!done) throw new Error('final update button not found');
  await sleep(2500);
  await clickFirstVisible([
    page.getByRole('button', { name: /更新する/ }),
    page.getByRole('button', { name: /^更新$/ }),
    page.getByRole('button', { name: /公開する/ }),
    page.getByRole('button', { name: /投稿する/ }),
    page.getByRole('button', { name: /^公開$/ })
  ]).catch(() => {});
  await sleep(7000);
}

(async () => {
  if (!process.env.NOTE_STORAGE_STATE) throw new Error('NOTE_STORAGE_STATE is not set');
  const payloadPath = process.env.PRIVATE_PAYLOAD_FILE || '/tmp/intermediate-payload.json';
  const payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
  const manifest = JSON.parse(fs.readFileSync('intermediate/published.json', 'utf8'));
  const articles = payload.articles || [];
  if (articles.length !== 10) throw new Error(`expected 10 articles, got ${articles.length}`);

  const storageState = JSON.parse(process.env.NOTE_STORAGE_STATE);
  const browser = await chromium.launch({ headless: false, channel: 'chrome' });
  const context = await browser.newContext({ storageState, viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.on('requestfailed', req => console.log('[requestfailed]', req.url(), req.failure()?.errorText || ''));
  page.on('pageerror', err => console.log('[pageerror]', err.message));

  const completed = [];
  try {
    for (const article of articles) {
      const number = String(article.number).padStart(2, '0');
      const noteId = manifest.articles?.[number]?.noteId;
      if (!noteId) throw new Error(`missing noteId for ${number}`);
      console.log(`[private-update] ${number} start: ${noteId}`);
      await page.goto(`https://editor.note.com/notes/${noteId}/edit/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await sleep(12000);
      const title = page.getByPlaceholder('記事タイトル').first();
      await title.waitFor({ state: 'visible', timeout: 60000 });
      await title.fill(article.title);

      const editor = page.locator('[contenteditable="true"]').first();
      await editor.waitFor({ state: 'visible', timeout: 60000 });
      await editor.fill(article.body).catch(async () => {
        await editor.click();
        await page.keyboard.press('Control+A');
        await page.keyboard.type(article.body, { delay: 1 });
      });
      await sleep(5000);

      const links = buildLinks(article, manifest);
      for (const link of links) {
        await applyTextLink(page, editor, link);
      }
      await sleep(5000);

      await openPublishSettings(page);
      try {
        await replaceHashtags(page, article.tags || []);
      } catch (err) {
        console.warn(`[private-update] ${number} hashtag update skipped: ${err.message}`);
      }

      if (article.paid) {
        const paidRadio = page.locator('input#paid').first();
        await paidRadio.waitFor({ state: 'attached', timeout: 10000 });
        await paidRadio.evaluate(el => el.click());
        await page.waitForFunction(() => document.querySelector('input#paid')?.checked === true, null, { timeout: 10000 });
        await sleep(1000);

        const priceFilled = await fillFirstVisible([
          page.getByLabel(/価格（円）|価格\(円\)|価格/),
          page.getByPlaceholder(/価格|円/),
          page.locator('label:has-text("価格")').locator('input'),
          page.locator('text=価格').locator('xpath=following::input[1]'),
          page.locator('input[inputmode="decimal"]'),
          page.locator('input[inputmode="numeric"]'),
          page.locator('input[type="number"]')
        ], String(article.price || 300));
        if (!priceFilled) throw new Error(`price input not found for ${number}`);

        const paidAreaOpened = await clickFirstVisible([
          page.getByRole('button', { name: /有料エリア設定/ }),
          page.getByText('有料エリア設定', { exact: true })
        ]);
        if (!paidAreaOpened) throw new Error(`paid area button not found for ${number}`);
        await sleep(2500);
        const buttons = page.getByText(/ラインをこの場所に変更|ここから有料/);
        const count = await buttons.count();
        if (!count) throw new Error(`paid line choices not found for ${number}`);
        const idx = paragraphIndex(article.body, article.paidStartText);
        if (idx >= count) throw new Error(`paidStartText index ${idx} exceeds line choices ${count} for ${number}`);
        await buttons.nth(idx).click();
        await sleep(1800);
      } else {
        await clickFirstVisible([
          page.getByRole('radio', { name: /無料/ }),
          page.getByRole('button', { name: /^無料$/ }),
          page.getByText('無料', { exact: true })
        ]);
      }

      await finalizeUpdate(page);
      const publicUrl = `https://note.com/rapomaru666/n/${noteId}`;
      completed.push({ number, noteId, url: publicUrl });
      fs.writeFileSync('/tmp/private-update-progress.json', JSON.stringify({ completed }, null, 2));
      console.log(`[private-update] ${number} complete: ${publicUrl}`);
      await sleep(1500);
    }
    await page.screenshot({ path: '/tmp/private-update-final.png', fullPage: true }).catch(() => {});
  } finally {
    await browser.close();
  }
})().catch(err => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
