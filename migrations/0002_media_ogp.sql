-- 記事ごとの OGP 画像。**添付のうち 1 枚を「その記事の代表」にする。**
--
-- posts に media への参照を持たせるのではなく media 側に印を置くのは、
-- 添付を消したときに何も残らないため（参照側だと消えた行を指したままになる。
-- FK の ON DELETE SET NULL でも「消したら選択も消える」を DB とアプリの
-- 両方に書くことになる）。
--
-- 選んでいないのが既定なので DEFAULT 0。列を足すだけなので、デプロイの前に
-- 当てても古いコードは何も壊さない（migrations は追加のみ、が前提）。
ALTER TABLE media ADD COLUMN is_ogp INTEGER NOT NULL DEFAULT 0 CHECK (is_ogp IN (0, 1));

-- **1 記事につき 1 枚。** 部分ユニーク索引なので、選んでいない添付は何枚でも並ぶ。
-- 記事に紐づかない添付 (post_id IS NULL) は NULL 同士が衝突しないので対象外。
CREATE UNIQUE INDEX media_post_ogp ON media(post_id) WHERE is_ogp = 1;
