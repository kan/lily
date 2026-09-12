/**
 * タグ名 → URL の slug。
 *
 * DB に触らないので query layer ではなく core に置く。`createUrls().tag()` が
 * URL を組む以上、そこに何の文字が入れるかを決めるのも core の仕事。
 */
import { normalizeSegment, type PathError } from './paths.ts';
import { err, type Result } from './result.ts';

/** slug に使えない文字。パスの 1 セグメントとして成立する範囲に寄せる。 */
const SLUG_FORBIDDEN = /[/\\<>:"|?*%\u0000-\u001F\u007F]/g;

/**
 * タグ名から slug を作る。
 *
 * 日本語のタグは日本語のまま slug になる (URL に組むときにエンコードする)。
 * ラテン文字だけを通す変換にすると、日本語タグの slug が全部空になってしまう。
 *
 * **最後は `normalizeSegment` に通す。** 記事パスと同じ規則で弾くので、
 * `.` や `..` が slug になって `/tags/../` を組む、といったことが起きない
 * (`encodeURIComponent` はドットを素通しする)。代償として `con` のような
 * Windows 予約名もタグにできないが、規則を 2 本持つよりは安い。
 */
export function slugifyTag(name: string): Result<string, PathError> {
  const candidate = name
    .normalize('NFC')
    .replace(SLUG_FORBIDDEN, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (candidate === '') return err({ code: 'empty' });
  return normalizeSegment(candidate);
}
