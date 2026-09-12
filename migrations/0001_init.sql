-- lily の初期スキーマ。
--
-- 方針: **DB 制約を最終防衛線にする。** zod は外部入力の検証、TypeScript は
-- アプリ内部の型、SQLite の制約が永続化時の最後の砦。ORM を使わないぶん、
-- この層を厚くする。全テーブル STRICT で、enum / boolean 相当は CHECK、
-- path や filename の形も書ける範囲は CHECK で表現する
-- (アプリ側の normalizePostPath と二重に守る)。

CREATE TABLE posts (
  id                 INTEGER PRIMARY KEY,            -- 内部 ID。FK はこれ
  public_id          TEXT    NOT NULL UNIQUE,        -- uuid v4。不変の identity で、既定の URL でもある
  title              TEXT    NOT NULL CHECK (length(title) > 0),
  description        TEXT,
  body_md            TEXT    NOT NULL,               -- 正。mount も deployment も知らない
  body_html          TEXT,                           -- 派生。media 参照は placeholder のまま持つ
  renderer_version   TEXT,
  status             TEXT    NOT NULL DEFAULT 'draft'
                             CHECK (status IN ('draft', 'published')),
  published_at       TEXT,                           -- UTC ISO8601 (末尾 Z)。表示は Asia/Tokyo
  updated_at         TEXT    NOT NULL,
  created_at         TEXT    NOT NULL,
  preview_token_hash TEXT,                           -- SHA-256。生トークンは保存しない
  bluesky_uri        TEXT,                           -- 告知済みなら AT-URI (二重投稿の抑止)
  CHECK (status = 'draft' OR published_at IS NOT NULL),
  CHECK (body_html IS NULL OR renderer_version IS NOT NULL)
) STRICT;

-- 一覧・フィードの並び (published_at DESC, public_id ASC) をそのまま索引にする。
-- public_id を落とすと、同時刻の記事があるたびに並べ替えが要る。
CREATE INDEX posts_published ON posts(status, published_at DESC, public_id);
CREATE UNIQUE INDEX posts_preview_token
  ON posts(preview_token_hash) WHERE preview_token_hash IS NOT NULL;

-- 公開 URL。1 記事に複数持てて、canonical は 1 本。旧パスは alias として残す。
CREATE TABLE post_paths (
  path         TEXT    PRIMARY KEY CHECK (
                 length(path) > 0
                 AND path NOT LIKE '/%' AND path NOT LIKE '%/'   -- 前後スラッシュ禁止
                 AND path NOT LIKE '%//%'                        -- 空セグメント禁止
                 AND instr(path, char(92)) = 0                   -- バックスラッシュ禁止
                 AND instr(path, '%') = 0                        -- percent encoding は保存しない
               ),
  post_id      INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  is_canonical INTEGER NOT NULL DEFAULT 0 CHECK (is_canonical IN (0, 1)),
  created_at   TEXT    NOT NULL
) STRICT;

CREATE UNIQUE INDEX post_paths_canonical ON post_paths(post_id) WHERE is_canonical = 1;
-- 大文字小文字違いの重複を禁じる (export 先が case-insensitive なファイルシステムだと衝突するため)。
-- SQLite の lower() は ASCII だけを畳む。パスの照合もこの索引に合わせて lower() で行う。
CREATE UNIQUE INDEX post_paths_path_ci   ON post_paths(lower(path));
CREATE INDEX        post_paths_post      ON post_paths(post_id);

-- 記事に紐づく添付。本文の相対参照 (./sample.png) と filename で突き合わせる。
CREATE TABLE media (
  id         INTEGER PRIMARY KEY,
  public_id  TEXT    NOT NULL UNIQUE,                -- 配信 URL に使う
  post_id    INTEGER REFERENCES posts(id) ON DELETE CASCADE,
  filename   TEXT    NOT NULL CHECK (
               length(filename) > 0
               AND instr(filename, '/') = 0
               AND instr(filename, char(92)) = 0
               AND filename NOT IN ('.', '..')
             ),
  r2_key     TEXT    NOT NULL UNIQUE,
  mime       TEXT    NOT NULL,
  bytes      INTEGER NOT NULL CHECK (bytes > 0),
  width      INTEGER CHECK (width  IS NULL OR width  > 0),
  height     INTEGER CHECK (height IS NULL OR height > 0),
  created_at TEXT    NOT NULL
) STRICT;

CREATE UNIQUE INDEX media_post_filename ON media(post_id, filename);

CREATE TABLE tags (
  id   INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE CHECK (length(name) > 0),
  slug TEXT NOT NULL UNIQUE CHECK (length(slug) > 0)
) STRICT;

CREATE TABLE post_tags (
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  tag_id  INTEGER NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
  PRIMARY KEY (post_id, tag_id)
) STRICT;
