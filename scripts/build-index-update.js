const fs = require('fs');

const batch = JSON.parse(fs.readFileSync('post.json', 'utf8'));
const lines = fs.readFileSync(process.argv[2] || 'series-urls.txt', 'utf8')
  .trim()
  .split(/\r?\n/)
  .filter(Boolean);
const published = Object.fromEntries(lines.map(line => {
  const split = line.indexOf('=');
  return [Number(line.slice(0, split)), line.slice(split + 1)];
}));

const urls = {
  1: 'https://note.com/rapomaru666/n/n110e09eb7afd',
  2: 'https://note.com/rapomaru666/n/nc9aeb780906d',
  3: batch.previousUrl,
  ...published
};

const texts = {
  1: '① noteのアカウントを作る',
  2: '② 投稿する記事のテーマを決める',
  3: '③ ChatGPTへ記事作成を依頼する',
  4: '④ ChatGPTが作った文章を修正する',
  5: '⑤ 完成した文章をnoteへ投稿する',
  6: '⑥ 見出し画像とハッシュタグを設定する',
  7: '⑦ 有料記事の価格と公開範囲を設定する',
  8: '⑧ 記事を確認して公開する'
};

for (let number = 1; number <= 8; number++) {
  if (!urls[number]) throw new Error(`記事${number}のURLがありません。`);
}

const update = {
  action: 'updateLinks',
  noteId: 'n3ef43761b3f8',
  paid: false,
  links: Object.keys(texts).map(key => ({
    text: texts[key],
    url: urls[key]
  }))
};

fs.writeFileSync('generated-index-update.json', JSON.stringify(update, null, 2) + '\n');
fs.writeFileSync('all-published-urls.txt', Object.keys(urls).map(key => `${key}=${urls[key]}`).join('\n') + '\n');
console.log('初級編INDEXのリンク更新データを作成しました。');
