-- 公開記事の全文検索（`<mount>/search.json`。issue #65）。
--
-- **索引に入れるのは公開記事だけ。** 下書きは認証の無い入口から一切引けないように、
-- 索引そのものに載せない（検索の側で status を見て落とすのでは、条件を書き忘れた
-- 日に下書きの本文が漏れる）。「公開記事とは何か」の正は `core/db/posts.ts` の
-- `PUBLISHED_WHERE` で、ここの `status = 'published'` はその写し。条件を変える日は
-- 両方を直す。
--
-- **tokenizer は trigram。** 日本語には単語の区切りが無く、既定の unicode61 は
-- 空白で区切れない文を 1 語として扱うので、文の途中の語で引けない。trigram は
-- 3 文字ずつの組を索引にするので、任意の部分文字列で引ける。**3 文字未満の語は
-- 索引に当たらない**ので、検索の側で LIKE に落とす（`searchPublishedPosts`）。
--
-- **同期はトリガで行う。** 書き込みの経路（管理画面・import・公開・取り下げ・削除）の
-- どれかで索引の更新を忘れると、検索が黙って古くなる。DB に任せれば経路を足しても
-- 漏れない。UPDATE は検索に効く列と status の値が変わったときだけ索引を作り直す
-- （プレビューのトークンや Bluesky の URI を書いても索引は動かない）。
--
-- **この表があると `wrangler d1 export` が使えない**（D1 は仮想テーブルを含む DB の
-- export を拒む）。回避の手順は `docs/portable.md`。
--
-- 表とトリガを足すだけなので、デプロイの前に当てても古いコードは何も壊さない
-- （migrations は追加のみ、が前提）。最後の INSERT で既存の公開記事を索引に入れる。

CREATE VIRTUAL TABLE posts_fts USING fts5(
  title,
  description,
  body,
  tokenize = 'trigram'
);

CREATE TRIGGER posts_fts_insert AFTER INSERT ON posts
WHEN new.status = 'published'
BEGIN
  INSERT INTO posts_fts (rowid, title, description, body)
  VALUES (new.id, new.title, coalesce(new.description, ''), new.body_md);
END;

-- `UPDATE OF` は列が SET に入れば値が同じでも発火する（管理画面の保存は題・説明・
-- 本文をそろえて送る）。値が変わったときだけ作り直す。本文が長いと trigram の行が
-- 数千になるので、タグだけ直した保存で書き直させない。
CREATE TRIGGER posts_fts_update AFTER UPDATE OF title, description, body_md, status ON posts
WHEN old.title IS NOT new.title
  OR old.description IS NOT new.description
  OR old.body_md IS NOT new.body_md
  OR old.status IS NOT new.status
BEGIN
  DELETE FROM posts_fts WHERE rowid = old.id;
  INSERT INTO posts_fts (rowid, title, description, body)
  SELECT new.id, new.title, coalesce(new.description, ''), new.body_md
   WHERE new.status = 'published';
END;

CREATE TRIGGER posts_fts_delete AFTER DELETE ON posts
BEGIN
  DELETE FROM posts_fts WHERE rowid = old.id;
END;

INSERT INTO posts_fts (rowid, title, description, body)
SELECT id, title, coalesce(description, ''), body_md
  FROM posts
 WHERE status = 'published';
