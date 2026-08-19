const fs = require('fs');

const postFile = process.env.SENKI_POST_FILE || 'senki/post.json';
const ledgerFile = process.env.SENKI_LEDGER_FILE || 'senki/published.json';

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`GitHub Actions secret ${name} が未設定です。`);
  return value;
}

function xmlEscape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function cdata(value) {
  return String(value).replaceAll(']]>', ']]]]><![CDATA[>');
}

function xmlAttribute(value) {
  return String(value).replaceAll('&amp;', '&').replaceAll('&#39;', "'").replaceAll('&quot;', '"');
}

function getAlternateUrl(xml) {
  const match = xml.match(/<link\b(?=[^>]*\brel=["']alternate["'])(?=[^>]*\bhref=["']([^"']+)["'])[^>]*\/?\s*>/i)
    || xml.match(/<link\b(?=[^>]*\bhref=["']([^"']+)["'])(?=[^>]*\brel=["']alternate["'])[^>]*\/?\s*>/i);
  return match ? xmlAttribute(match[1]) : null;
}

function loadLedger() {
  if (!fs.existsSync(ledgerFile)) return { posts: [] };
  const ledger = JSON.parse(fs.readFileSync(ledgerFile, 'utf8'));
  if (!Array.isArray(ledger.posts)) ledger.posts = [];
  return ledger;
}

function savePublished(ledger, post, url, memberUrl, recovered = false) {
  ledger.posts.push({
    postKey: post.postKey,
    title: post.title,
    url,
    memberUrl,
    recovered,
    publishedAt: new Date().toISOString()
  });
  fs.writeFileSync(ledgerFile, JSON.stringify(ledger, null, 2) + '\n');
  fs.writeFileSync('senki-published-url.txt', url || memberUrl || '', 'utf8');
}

async function main() {
  const post = JSON.parse(fs.readFileSync(postFile, 'utf8'));
  if (!post.postKey || !post.title || !post.body) {
    throw new Error('postKey、title、bodyは必須です。');
  }

  const allowedTypes = new Set(['text/html', 'text/x-hatena-syntax', 'text/x-markdown']);
  const contentType = post.contentType || 'text/x-markdown';
  if (!allowedTypes.has(contentType)) throw new Error(`未対応のcontentTypeです: ${contentType}`);

  if (post.customUrl && !/^[A-Za-z0-9][A-Za-z0-9/_-]*$/.test(post.customUrl)) {
    throw new Error('customUrlには半角英数字、ハイフン、アンダースコア、スラッシュのみ使用できます。');
  }

  const ledger = loadLedger();
  const alreadyPublished = ledger.posts.find(item => item.postKey === post.postKey);
  if (alreadyPublished && post.updateExisting !== true) {
    fs.writeFileSync('senki-published-url.txt', alreadyPublished.url || '', 'utf8');
    console.log('投稿済みのためスキップ:', alreadyPublished.url || post.postKey);
    return;
  }

  const hatenaId = requiredEnv('HATENA_ID');
  const apiKey = requiredEnv('HATENA_API_KEY');
  const blogId = process.env.HATENA_BLOG_ID || 'rapomaru.hatenablog.com';
  const endpoint = `https://blog.hatena.ne.jp/${encodeURIComponent(hatenaId)}/${encodeURIComponent(blogId)}/atom/entry`;
  const authorization = `Basic ${Buffer.from(`${hatenaId}:${apiKey}`, 'utf8').toString('base64')}`;
  const headers = {
    Authorization: authorization,
    'Content-Type': 'application/atom+xml; charset=utf-8',
    'User-Agent': 'rapomaru-senki-auto-post/1.0'
  };

  if (post.customUrl && !alreadyPublished) {
    const latestResponse = await fetch(endpoint, { headers: { Authorization: authorization } });
    if (latestResponse.ok) {
      const latestXml = await latestResponse.text();
      const expectedPath = `/entry/${post.customUrl}`;
      const existingLinks = [...latestXml.matchAll(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*>/gi)]
        .map(match => xmlAttribute(match[1]));
      const existingUrl = existingLinks.find(url => {
        try {
          return new URL(url).pathname === expectedPath;
        } catch (_) {
          return false;
        }
      });
      if (existingUrl) {
        console.log('同じカスタムURLの記事を検出したため再投稿を防止:', existingUrl);
        savePublished(ledger, post, existingUrl, null, true);
        return;
      }
    }
  }

  const categories = (post.categories || [])
    .map(category => `  <category term="${xmlEscape(category)}" />`)
    .join('\n');
  const customUrl = post.customUrl
    ? `\n  <hatenablog:custom-url>${xmlEscape(post.customUrl)}</hatenablog:custom-url>`
    : '';
  const draft = post.draft === true ? 'yes' : 'no';

  const xml = `<?xml version="1.0" encoding="utf-8"?>
<entry xmlns="http://www.w3.org/2005/Atom"
       xmlns:app="http://www.w3.org/2007/app"
       xmlns:hatenablog="http://www.hatena.ne.jp/info/xmlns#hatenablog">
  <title>${xmlEscape(post.title)}</title>
  <author><name>${xmlEscape(hatenaId)}</name></author>
  <content type="${contentType}"><![CDATA[${cdata(post.body)}]]></content>
${categories}
  <app:control>
    <app:draft>${draft}</app:draft>
  </app:control>${customUrl}
</entry>`;

  if (alreadyPublished && post.updateExisting === true) {
    if (!alreadyPublished.memberUrl) {
      throw new Error('既存記事の更新URLが記録されていません。');
    }

    const updateResponse = await fetch(alreadyPublished.memberUrl, { method: 'PUT', headers, body: xml });
    const updateXml = await updateResponse.text();
    if (!updateResponse.ok) {
      throw new Error(`はてなブログの記事更新に失敗しました。HTTP ${updateResponse.status}: ${updateXml.slice(0, 500)}`);
    }

    const updatedUrl = getAlternateUrl(updateXml) || alreadyPublished.url;
    alreadyPublished.title = post.title;
    alreadyPublished.url = updatedUrl;
    alreadyPublished.updatedAt = new Date().toISOString();
    fs.writeFileSync(ledgerFile, JSON.stringify(ledger, null, 2) + '\n');
    fs.writeFileSync('senki-published-url.txt', updatedUrl || alreadyPublished.memberUrl || '', 'utf8');
    console.log('戦記の記事を更新しました:', updatedUrl || alreadyPublished.memberUrl);
    return;
  }

  const response = await fetch(endpoint, { method: 'POST', headers, body: xml });
  const responseXml = await response.text();
  if (response.status !== 201) {
    throw new Error(`はてなブログへの投稿に失敗しました。HTTP ${response.status}: ${responseXml.slice(0, 500)}`);
  }

  const memberUrl = response.headers.get('location');
  let publishedUrl = getAlternateUrl(responseXml);
  if (!publishedUrl && memberUrl) {
    const createdResponse = await fetch(memberUrl, { headers: { Authorization: authorization } });
    if (createdResponse.ok) publishedUrl = getAlternateUrl(await createdResponse.text());
  }
  if (!publishedUrl && post.customUrl && post.draft !== true) {
    publishedUrl = `https://${blogId}/entry/${post.customUrl}`;
  }
  if (!publishedUrl && post.draft !== true) {
    throw new Error('投稿は作成されましたが、公開URLをレスポンスから取得できませんでした。');
  }

  savePublished(ledger, post, publishedUrl, memberUrl, false);
  console.log(post.draft === true ? '戦記の下書きを作成しました:' : '戦記へ公開しました:', publishedUrl || memberUrl);
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
