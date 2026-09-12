<script setup lang="ts">
/**
 * サイト設定の確認。**変更はできない。**
 *
 * 値はソース (`src/site/meta.ts`) にあり、入口 HTML に差し込まれて届く
 * (`core/routes/admin.ts`)。D1 に置いて画面から変えられるようにする案もあったが、
 * 年に数回しか動かない値を DB に移すと git の履歴・レビュー・ロールバックの外に
 * 出てしまう。**今どうなっているかを確かめられれば足りる**ので、表示だけにしてある。
 */
import { MOUNT } from '../api.ts';
import { LOGOUT_URL } from '../auth.ts';
import { go } from '../router.ts';
import { MOUNT_LABEL, SITE } from '../site.ts';

/**
 * 表示する項目。
 *
 * `mount` を持つ行は、値のうしろにそれを太字で足す。**公開 URL とマウントを
 * 別々の行にすると、実際に配信されている URL がどれなのか読み取れない。**
 */
const rows: { label: string; value: string; mount?: string }[] = [
  { label: 'サイト名', value: SITE.name },
  { label: '説明', value: SITE.description },
  { label: '著者', value: SITE.author },
  // origin は差し込む側で正規化済み (`core/paths.ts` の `siteOrigin`)。
  // ここで整形し直すと、配信されている URL と設定画面の表示がずれる。
  { label: '公開 URL', value: SITE.url, mount: MOUNT_LABEL },
];
</script>

<template>
  <header class="bar">
    <h1>設定</h1>
    <span class="spacer" />
    <a :href="`${MOUNT}/`" target="_blank" rel="noreferrer">ブログを開く</a>
    <button @click="go('/')">一覧へ</button>
  </header>

  <dl class="settings">
    <template v-for="row in rows" :key="row.label">
      <dt>{{ row.label }}</dt>
      <dd>{{ row.value }}<strong v-if="row.mount">{{ row.mount }}</strong></dd>
    </template>
  </dl>

  <p class="muted settings-note">
    ここでは変更できません。値はソースのサイト設定にあり、書き換えてデプロイすると
    反映されます。サイト名はブラウザの題・OGP・フィードに、著者は記事下と Atom に
    出ます。太字はマウント位置で、route の設定と必ず対で変えるものです。
  </p>

  <!-- ログアウトできる認証方式のときだけ出る。**素の form で送る** -->
  <!-- （fetch ではないので、押すとページごとログイン画面へ移る）。 -->
  <form v-if="LOGOUT_URL" class="logout" :action="LOGOUT_URL" method="post">
    <button type="submit">ログアウト</button>
    <p class="muted">
      このブラウザのセッションを終わらせます。次に開くときはパスワードを入れ直します。
    </p>
  </form>
</template>
