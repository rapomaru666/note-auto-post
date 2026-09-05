const fs = require('fs');
const path = require('path');

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function decodeXml(s = '') {
  return String(s)
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&');
}

function textOf(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  if (!m) return null;
  const raw = m[1].trim();
  const cdata = raw.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  return cdata ? cdata[1] : decodeXml(raw.replace(/<[^>]+>/g, ''));
}

function contentOf(xml) {
  const m = xml.match(/<content\b([^>]*)>([\s\S]*?)<\/content>/i);
  if (!m) return { type: null, body: null };
  const type = (m[1].match(/\btype=["']([^"']+)["']/i) || [])[1] || null;
  const raw = m[2].trim();
  const cdata = raw.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  return { type, body: cdata ? cdata[1] : decodeXml(raw) };
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`\\b${name}=["']([^"']+)["']`, 'i'));
  return m ? decodeXml(m[1]) : null;
}

function linksOf(xml) {
  const out = {};
  for (const m of xml.matchAll(/<link\b[^>]*\/?\s*>/gi)) {
    const tag = m[0];
    const rel = attr(tag, 'rel') || 'alternate';
    const href = attr(tag, 'href');
    if (href && !out[rel]) out[rel] = href;
  }
  return out;
}

function categoriesOf(xml) {
  return [...xml.matchAll(/<category\b[^>]*\bterm=["']([^"']+)["'][^>]*\/?\s*>/gi)]
    .map(m => decodeXml(m[1]));
}

async function main() {
  const hatenaId = requiredEnv('HATENA_ID');
  const apiKey = requiredEnv('HATENA_API_KEY');
  const blogId = process.env.HATENA_BLOG_ID || 'rapomarublog.hatenablog.com';
  let url = `https://blog.hatena.ne.jp/${encodeURIComponent(hatenaId)}/${encodeURIComponent(blogId)}/atom/entry`;
  const auth = `Basic ${Buffer.from(`${hatenaId}:${apiKey}`, 'utf8').toString('base64')}`;
  const headers = { Authorization: auth, 'User-Agent': 'rapoman-entry-discovery/1.0' };

  const visited = new Set();
  const entries = [];
  for (let page = 0; url && page < 100; page++) {
    if (visited.has(url)) break;
    visited.add(url);
    const res = await fetch(url, { headers });
    const xml = await res.text();
    if (!res.ok) throw new Error(`Hatena GET failed ${res.status}: ${xml.slice(0,500)}`);

    for (const m of xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)) {
      const entryXml = m[0];
      const links = linksOf(entryXml);
      const content = contentOf(entryXml);
      entries.push({
        id: textOf(entryXml, 'id'),
        title: textOf(entryXml, 'title'),
        published: textOf(entryXml, 'published'),
        updated: textOf(entryXml, 'updated'),
        url: links.alternate || null,
        memberUrl: links.edit || links.self || null,
        categories: categoriesOf(entryXml),
        contentType: content.type,
        body: content.body
      });
    }

    const feedLinks = linksOf(xml.replace(/<entry\b[\s\S]*?<\/entry>/gi, ''));
    url = feedLinks.next || null;
  }

  const dedup = [...new Map(entries.map(e => [e.memberUrl || e.url || e.id, e])).values()]
    .sort((a,b) => String(a.published || '').localeCompare(String(b.published || '')));
  const discoveredAt = new Date().toISOString();
  fs.writeFileSync('rapoman/discovered-entries.json', JSON.stringify({ discoveredAt, entries: dedup }, null, 2) + '\n');
  fs.writeFileSync('rapoman/discovered-summary.json', JSON.stringify({
    discoveredAt,
    entries: dedup.map(e => ({
      id: e.id,
      title: e.title,
      published: e.published,
      updated: e.updated,
      url: e.url,
      memberUrl: e.memberUrl,
      categories: e.categories,
      contentType: e.contentType,
      bodyLength: String(e.body || '').length
    }))
  }, null, 2) + '\n');

  const dir = 'rapoman/legacy-source';
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  dedup.forEach((e, index) => {
    const idTail = String(e.memberUrl || e.id || index).match(/(\d{8,})\/?$/)?.[1] || String(index + 1).padStart(3, '0');
    fs.writeFileSync(path.join(dir, `entry-${idTail}.json`), JSON.stringify(e, null, 2) + '\n');
  });

  console.log(`Discovered ${dedup.length} entries`);
  for (const e of dedup) console.log(`${e.published || ''}\t${e.title}\t${e.url}\t[${e.categories.join(', ')}]`);
}

main().catch(err => { console.error(err); process.exit(1); });
