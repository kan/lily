#!/usr/bin/env node
/**
 * lily の入口コマンド。今あるのは `init` だけ。
 *
 *   npx @kanf/lily init [directory]
 *
 * **ブログ 1 つ分のディレクトリを作る。** 中身は同梱している `template/` で、
 * 対話で聞いた値を `src/config.ts` と `wrangler.jsonc` に埋めてから書き出す。
 *
 * **Deploy to Cloudflare のボタンとの違いはそこ。** あちらは押せば動くが、
 * サイト名も公開 URL も既定のままで、直すには repo を触ることになる（#11）。
 * こちらは最初に聞く。
 *
 * **雛形はパッケージに同梱したものを使う**（GitHub から取ってこない）。
 * こうしておくと、init が作るのは**その版の lily に合った雛形**になり、
 * 手元が offline でも通る。
 *
 * 依存を足さない。対話は `node:readline/promises` で足りる。
 */
import { spawn } from 'node:child_process';
import { cp, mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { basename, join, resolve } from 'node:path';
import process from 'node:process';
import { failWith, message, packageRoot } from './util.mjs';

const lily = packageRoot(import.meta.url);
const fail = failWith('lily');
const template = join(lily, 'template');

const USAGE = `usage: npx @kanf/lily init [directory] [--yes] [--no-install]

  init          create a blog in a new directory
  --yes, -y     take every default without asking
  --no-install  write the files and stop, without running npm install
`;

const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h') || argv.length === 0) {
  process.stdout.write(USAGE);
  process.exit(argv.length === 0 ? 1 : 0);
}
if (argv[0] !== 'init') fail(`unknown command: ${argv[0]}\n\n${USAGE}`);

const useDefaults = argv.includes('--yes') || argv.includes('-y');
const skipInstall = argv.includes('--no-install');
const positional = argv.slice(1).find((arg) => !arg.startsWith('-'));

// **聞ける相手がいないなら、既定で進めない。** パイプで答えを流し込む形は
// 支えない（readline は端末でないとき、質問を出す前に行を読み切って閉じる）ので、
// 黙って既定で作るより `--yes` を促して落ちる方が読める。
if (!useDefaults && !process.stdin.isTTY) {
  fail('no terminal to ask on. Pass --yes to take every default.');
}

await init();

async function init() {
  const rl = useDefaults ? null : createInterface({ input: process.stdin, output: process.stdout });
  // **Ctrl+C と Ctrl+D で止まれる。** 途中で抜けた人に stack trace を読ませない
  // （readline は Ctrl+D を AbortError にして投げてくる）。答えが尽きたパイプも
  // 同じ経路で、待ち続けずに終わる。
  rl?.on('SIGINT', cancel);
  const ask = async (question, fallback) => {
    if (rl === null) return fallback;
    const answer = await rl.question(`${question} (${fallback}) `).catch(cancel);
    return answer.trim() === '' ? fallback : answer.trim();
  };

  try {
    const minPassword = await minPasswordLength();
    const directory = positional ?? (await ask('Directory', 'my-blog'));
    const target = resolve(process.cwd(), directory);
    await checkEmpty(target, directory);

    // Worker・D1・R2 の名前はディレクトリ名から作る。**聞く項目を増やさない**が、
    // `my-blog` のまま出すと、複数立てたときに名前がぶつかる。**最後の 1 つだけ**を
    // 使う（`~/sites/blog` を渡した人の Worker が `home-kan-sites-blog` になり、
    // 深いパスでは Cloudflare の名前の上限にも当たる）。
    const slug = slugify(basename(target));
    const site = {
      name: await ask('Site name', 'My blog'),
      description: await ask('Description', 'A blog running on lily'),
      author: await ask('Author', await guessAuthor()),
      // **origin に落とす。** 末尾の `/` を残すと `ogImage` が `…com//ogp.png` になる
      // （`site.url` の方は `core/paths.ts` の `siteOrigin()` が実行時に削る）。
      url: new URL(
        await askUntil(ask, 'Public URL', 'https://example.com', isHttpUrl, 'not an http(s) URL'),
      ).origin,
      lang: await askUntil(ask, 'Language (BCP 47)', 'en', isLang, 'not a language tag'),
      timeZone: await askUntil(ask, 'Time zone (IANA)', guessTimeZone(), isTimeZone, 'unknown zone'),
      mountPath: await askUntil(ask, 'Mount path', '/', isMountPath, 'must start with /'),
    };

    // **パスワードはここで聞いて `.dev.vars` に書く。** 後回しにすると、
    // 「デプロイしてから短すぎると言われる」を踏む（#4）。長さの決まりを
    // **打つ前に**知らせられるのが、聞く値打ちのほとんど。
    const password = await askPassword(rl, minPassword);

    await cp(template, target, { recursive: true, filter: packableOnly });
    await restoreGitignore(target);
    await write(target, site, slug);
    if (password !== null) await writeDevVars(target, password);

    process.stdout.write(`\nCreated ${target}\n`);

    const install = skipInstall
      ? false
      : (await ask('Install dependencies now? (y/n)', 'y')).toLowerCase().startsWith('y');
    rl?.close();
    if (install) await npmInstall(target);
    printNextSteps(directory, install, password !== null);
  } finally {
    rl?.close();
  }
}

/** 書き出し。**埋める場所は 1 つずつ名指しする**（`replaceOnce` が見つからなければ落ちる）。 */
async function write(target, site, slug) {
  // **どれも `quote()` を通す。** 検査を通った値でも `'` は入りうるし、入ると
  // `config.ts` が構文として壊れる（気付くのは生成した木を型検査したとき）。
  await edit(join(target, 'src', 'config.ts'), (source) =>
    [
      ["    url: 'https://example.com',", `    url: ${quote(site.url)},`],
      ["    name: 'My blog',", `    name: ${quote(site.name)},`],
      ["    description: 'A blog running on lily',", `    description: ${quote(site.description)},`],
      ["    author: 'Someone',", `    author: ${quote(site.author)},`],
      ["    lang: 'en',", `    lang: ${quote(site.lang)},`],
      ["    timeZone: 'UTC',", `    timeZone: ${quote(site.timeZone)},`],
      [
        "ogImage: { url: 'https://example.com/ogp.png'",
        `ogImage: { url: ${quote(`${site.url}/ogp.png`)}`,
      ],
      ["  mountPath: '/',", `  mountPath: ${quote(site.mountPath)},`],
    ].reduce((text, [from, to]) => replaceOnce(text, from, to), source),
  );

  await edit(join(target, 'wrangler.jsonc'), (source) =>
    [
      ['"name": "my-blog",', `"name": "${slug}",`],
      ['"database_name": "my-blog",', `"database_name": "${slug}",`],
      ['"bucket_name": "my-blog-media"', `"bucket_name": "${slug}-media"`],
      ['"my-blog-backup"', `"${slug}-backup"`],
    ].reduce((text, [from, to]) => replaceOnce(text, from, to), source),
  );

  await edit(join(target, 'package.json'), async (source) => {
    const named = replaceOnce(source, '"name": "my-blog",', `"name": "${slug}",`);
    // **自分と同じ版を指す。** 同梱の雛形に書いてある範囲は publish 時のものなので、
    // そのままだと init で作った木だけが古い lily で始まりうる。
    //
    // **今の範囲を雛形から読んでから、名指しで置き換える。** 正規表現で当てると、
    // 雛形の書き方が変わった日に 0 件置換で素通りする（古い lily を指したまま
    // 出てくる）。
    const current = JSON.parse(source).dependencies['@kanf/lily'];
    return replaceOnce(
      named,
      `"@kanf/lily": "${current}"`,
      `"@kanf/lily": "^${await version()}"`,
    );
  });

  await edit(join(target, 'README.md'), (source) =>
    replaceOnce(source, '# my-blog', `# ${site.name}`).replaceAll('my-blog', slug),
  );
}

async function npmInstall(target) {
  process.stdout.write('\n');
  const code = await new Promise((done) => {
    const npm = spawn('npm', ['install'], { cwd: target, stdio: 'inherit', shell: process.platform === 'win32' });
    npm.on('error', () => done(1));
    npm.on('close', (status) => done(status ?? 1));
  });
  if (code !== 0) fail('npm install failed. Run it yourself in the new directory.');
}

function printNextSteps(directory, installed, hasPassword) {
  const steps = [
    `cd ${directory}`,
    ...(installed ? [] : ['npm install']),
    ...(hasPassword ? [] : ['cp .dev.vars.example .dev.vars   # and fill in ADMIN_PASSWORD']),
    'npm run dev                      # http://localhost:8787',
  ];
  const secret = hasPassword
    ? '  npx wrangler secret put ADMIN_PASSWORD   # the same one you just chose'
    : '  npx wrangler secret put ADMIN_PASSWORD';

  process.stdout.write(`\nNext:\n\n${steps.map((step) => `  ${step}`).join('\n')}\n
Deploying takes a Cloudflare account and nothing else:

  npx wrangler login
  npm run deploy:first
${secret}

The README in the new directory has the rest.\n`);
}

/**
 * 空でないディレクトリには書かない。**上書きの意味が人によって違う**ので、
 * ここで止めて、どうしたいかを選ばせる。
 */
async function checkEmpty(target, directory) {
  let entries;
  try {
    entries = await readdir(target);
  } catch (error) {
    // **無いときだけ作る。** ファイルがあるときの `readdir` は ENOTDIR で、
    // そのまま `mkdir` すると EEXIST の stack trace が出る。
    if (error?.code !== 'ENOENT') fail(`cannot write to ${directory} (${message(error)})`);
    await mkdir(target, { recursive: true });
    return;
  }
  if (entries.length > 0) fail(`${directory} is not empty`);
}

/**
 * 無視の設定を `.gitignore` に戻す。
 *
 * **npm は `.gitignore` をパッケージに入れない**ので、配るときは `gitignore` という
 * 名前の複製を入れてある（`scripts/pack-template.mjs`）。戻し忘れると、作った木に
 * 無視の設定が無く、**`node_modules/` も手元の secret（`.dev.vars`）も commit される。**
 *
 * repo から直に走らせたときは `.gitignore` がそのまま来るので、何もしない。
 */
async function restoreGitignore(target) {
  const ignore = join(target, '.gitignore');
  try {
    await rename(join(target, 'gitignore'), ignore);
  } catch {
    // 複製が無いのは、repo から走っているとき（`.gitignore` がそのまま来る）か、
    // `prepack` を通していない tarball から走っているとき。**後者を見分ける** ——
    // 黙って通すと、無視の設定が無い木ができる。
    await stat(ignore).catch(() =>
      fail('the template has no .gitignore (was it packed without prepack?)'),
    );
  }
}

/**
 * 生成物と手元の物は持っていかない。**`npm run dev` が作り直すもの**（`dist/`・
 * `worker-configuration.d.ts`・`.wrangler/`）と、手元の secret（`.dev.vars`）。
 * ロックは同梱していないが、repo から直に走らせたときのために除いておく。
 */
function packableOnly(source) {
  return !/[\\/](node_modules|dist|\.wrangler|package-lock\.json|\.dev\.vars|worker-configuration\.d\.ts)$/.test(
    source,
  );
}

async function edit(path, change) {
  const source = await readFile(path, 'utf8');
  await writeFile(path, await change(source));
}

/**
 * **1 箇所だけ置き換える。** 見つからなければ落とす —— 雛形を直した日に
 * 黙って 0 件置換になると、既定値のままのブログが出てくる。
 */
function replaceOnce(source, from, to) {
  const at = source.indexOf(from);
  if (at === -1) fail(`the template no longer contains: ${from}`);
  if (source.indexOf(from, at + from.length) !== -1) fail(`the template repeats: ${from}`);
  return `${source.slice(0, at)}${to}${source.slice(at + from.length)}`;
}

/**
 * 管理画面のパスワード。**空のままにできる。**
 *
 * 手元は secret が無ければ `localhostOnly` で開くので、いま決めなくても
 * 書き始められる。**決めたいならここで長さの決まりを教える**のが眼目で、
 * 打ち込んだものが短ければその場でやり直せる。
 *
 * 入力は隠さない。**書き出す先（`.dev.vars`）は平文**で、隠しても守るものが
 * 増えないため。
 */
async function askPassword(rl, minLength) {
  if (rl === null) return null;
  for (;;) {
    const answer = await rl
      .question(`Admin password (${minLength}+ characters, blank to decide later) `)
      .catch(cancel);
    const password = answer.trim();
    if (password === '') return null;
    if (password.length >= minLength) return password;
    process.stdout.write(`  shorter than ${minLength} characters\n`);
  }
}

/**
 * 手元の secret。**`.dev.vars.example` の行を埋めて書く**ので、決まりを書いた
 * コメントもそのまま残る。`.gitignore` に入っているので git には乗らない。
 */
async function writeDevVars(target, password) {
  const example = await readFile(join(target, '.dev.vars.example'), 'utf8');
  const filled = replaceOnce(example, 'ADMIN_PASSWORD=', `ADMIN_PASSWORD=${password}`);
  await writeFile(join(target, '.dev.vars'), filled);
}

/**
 * 拒否される長さ。**lily 本体から読む。**
 *
 * ここに 12 と書くと、本体が動かした日に init だけが古い決まりで検査する
 * （通したものが管理画面で拒否される）。
 *
 * **読むのは公開 API（`dist/lib/index.js`）。** `core/auth/password.js` を名指しで
 * 掴むと、core の中を動かしただけで黙って読めなくなる。読めないのは配り方が
 * 壊れているときなので、**落とす。**
 */
async function minPasswordLength() {
  const entry = new URL('../dist/lib/index.js', import.meta.url).href;
  const lib = await import(entry).catch((error) =>
    fail(`cannot read lily itself (${message(error)}). Is the package built?`),
  );
  return lib.MIN_PASSWORD_LENGTH;
}

async function askUntil(ask, question, fallback, ok, reason) {
  // **聞かないときに回り続けない。** `--yes` は同じ既定を返し続けるので、
  // その既定が通らない形（tzdata の無い環境の `Etc/Unknown` など）だと
  // 無限に「駄目だ」と言い続けることになる。
  if (useDefaults && !ok(fallback)) fail(`${reason}: ${fallback}`);
  for (;;) {
    const answer = await ask(question, fallback);
    if (ok(answer)) return answer;
    process.stdout.write(`  ${reason}\n`);
  }
}

/** TypeScript の文字列として書ける形にする。 */
function quote(value) {
  return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
}

/** Worker・D1・R2 の名前に使える形。 */
function slugify(directory) {
  const slug = directory
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug === '' ? 'my-blog' : slug;
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.pathname === '/';
  } catch {
    return false;
  }
}

function isLang(value) {
  try {
    return new Intl.Locale(value).language !== '';
  } catch {
    return false;
  }
}

function isTimeZone(value) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** `/` か、`/` で始まり `/` で終わらないもの。判定の正は `core/paths.ts`。 */
function isMountPath(value) {
  return value === '/' || (value.startsWith('/') && !value.endsWith('/'));
}

/** 手元の git が知っていれば、それを既定にする。 */
async function guessAuthor() {
  const name = await new Promise((done) => {
    const git = spawn('git', ['config', 'user.name'], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    git.stdout.on('data', (chunk) => (out += chunk));
    git.on('error', () => done(''));
    git.on('close', () => done(out.trim()));
  });
  return name === '' ? 'Someone' : name;
}

/**
 * 手元のタイムゾーン。**読めない環境では `UTC`。**
 *
 * tzdata の入っていない小さなイメージでは `'Etc/Unknown'` が返る（`undefined` では
 * ないので `??` では拾えない）。そのまま既定にすると、`Intl` が受け付けない値を
 * 勧めることになる。
 */
function guessTimeZone() {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return zone !== undefined && isTimeZone(zone) ? zone : 'UTC';
}

async function version() {
  const manifest = JSON.parse(await readFile(join(lily, 'package.json'), 'utf8'));
  return manifest.version;
}

/** 途中で抜けた人向け。**失敗ではない**ので、理由を並べずに終わる。 */
function cancel() {
  process.stdout.write('\ncancelled\n');
  process.exit(130);
}
