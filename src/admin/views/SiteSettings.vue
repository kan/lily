<script setup lang="ts">
/**
 * サイト設定の確認。**変更できるのは画面の言語だけ。**
 *
 * 値はソース (`src/site/meta.ts`) にあり、入口 HTML に差し込まれて届く
 * (`core/routes/admin.ts`)。D1 に置いて画面から変えられるようにする案もあったが、
 * 年に数回しか動かない値を DB に移すと git の履歴・レビュー・ロールバックの外に
 * 出てしまう。**今どうなっているかを確かめられれば足りる**ので、表示だけにしてある。
 *
 * **言語だけが例外**なのは、あれが deployment ではなく**この端末を使う人**のもの
 * だから（同じブログを別々の言語の人が触ることがある）。
 */
import { computed } from 'vue';
import { LOCALES, type Locale } from '../../core/locale.ts';
import { MOUNT } from '../api.ts';
import { LOGOUT_URL } from '../auth.ts';
import { LOCALE_LABELS, locale, t } from '../i18n.ts';
import { go } from '../router.ts';
import { MOUNT_LABEL, SITE } from '../site.ts';

/**
 * 表示する項目。
 *
 * `mount` を持つ行は、値のうしろにそれを太字で足す。**公開 URL とマウントを
 * 別々の行にすると、実際に配信されている URL がどれなのか読み取れない。**
 */
const rows = computed<{ label: string; value: string; mount?: string }[]>(() => [
  { label: t.settings.siteName, value: SITE.name },
  { label: t.settings.description, value: SITE.description },
  { label: t.settings.author, value: SITE.author },
  // origin は差し込む側で正規化済み (`core/paths.ts` の `siteOrigin`)。
  // ここで整形し直すと、配信されている URL と設定画面の表示がずれる。
  { label: t.settings.publicUrl, value: SITE.url, mount: MOUNT_LABEL },
]);

/**
 * 選択と `i18n.ts` の繋ぎ。**選んだ時点で覚える**ので、保存のボタンは無い
 * （表と `<html lang>` と覚え書きは `i18n.ts` の `watch` が揃える）。
 */
const chosen = computed<Locale>({
  get: () => locale.value,
  set: (next) => {
    locale.value = next;
  },
});
</script>

<template>
  <header class="bar">
    <h1>{{ t.settings.title }}</h1>
    <span class="spacer" />
    <a :href="`${MOUNT}/`" target="_blank" rel="noreferrer">{{ t.common.openBlog }}</a>
    <button @click="go('/')">{{ t.common.toList }}</button>
  </header>

  <dl class="settings">
    <template v-for="row in rows" :key="row.label">
      <dt>{{ row.label }}</dt>
      <dd>{{ row.value }}<strong v-if="row.mount">{{ row.mount }}</strong></dd>
    </template>
  </dl>

  <!-- **注記は表示だけの項目の直後。** 下の言語は変えられるので、あいだに挟んで
       「ここでは変更できません」が言語にも掛かって読めないようにする。 -->
  <p class="muted settings-note">{{ t.settings.note }}</p>

  <dl class="settings">
    <dt>{{ t.settings.language }}</dt>
    <dd>
      <select v-model="chosen">
        <option v-for="value in LOCALES" :key="value" :value="value">
          {{ LOCALE_LABELS[value] }}
        </option>
      </select>
      <p class="muted">{{ t.settings.languageNote }}</p>
    </dd>
  </dl>

  <!-- ログアウトできる認証方式のときだけ出る。**素の form で送る** -->
  <!-- （fetch ではないので、押すとページごとログイン画面へ移る）。 -->
  <form v-if="LOGOUT_URL" class="logout" :action="LOGOUT_URL" method="post">
    <button type="submit">{{ t.settings.logout }}</button>
    <p class="muted">{{ t.settings.logoutNote }}</p>
  </form>
</template>
