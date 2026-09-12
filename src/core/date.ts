/**
 * 日付整形の部品。**タイムゾーンを引数で受ける純粋な関数だけ。**
 *
 * **core 自身はこれを使わない**（core は日付を整形しない）。使うのはテーマと
 * 管理画面で、どちらも `SiteConfig.timeZone` を渡す。2 箇所が別実装を持つと、
 * 編集画面で入れた日時と記事に出る日付が食い違う。
 *
 * 実行環境の TZ に任せないのが要点。編集している端末が海外にあっても、
 * サイトの日付は動かない。
 *
 * DOM もランタイムも触らないので、夏時間をまたぐ往復をユニットテストから
 * 確かめられる（`test/date-format.test.ts`）。
 */

export type DateFormat = {
  /** `YYYY-MM-DD`。一覧に出す日付。 */
  isoDate(d: Date): string;
  /** `<input type="datetime-local">` に入れる `YYYY-MM-DDTHH:mm`。 */
  toDateTimeInput(d: Date): string;
  /**
   * その逆。`YYYY-MM-DDTHH:mm` を**そのタイムゾーンの日時として**読み、
   * UTC の ISO8601 に戻す。読めない入力は null（呼び出し側が弾く）。
   */
  fromDateTimeInput(value: string): string | null;
};

export function createDateFormat(timeZone: string): DateFormat {
  const ymd = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const ymdhm = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });

  const parts = (format: Intl.DateTimeFormat, d: Date): Record<string, string> =>
    Object.fromEntries(format.formatToParts(d).map((part) => [part.type, part.value]));

  /** その瞬間のオフセット（ミリ秒。UTC より東が正）。 */
  const offsetMs = (at: Date): number => {
    const p = parts(ymdhm, at);
    const seen = Date.UTC(
      Number(p.year),
      Number(p.month) - 1,
      Number(p.day),
      Number(p.hour),
      Number(p.minute),
    );
    // 分より下は formatToParts に出していないので、比較も分に丸めて行う。
    return seen - Math.floor(at.getTime() / 60000) * 60000;
  };

  return {
    isoDate(d) {
      const p = parts(ymd, d);
      return `${p.year}-${p.month}-${p.day}`;
    },

    toDateTimeInput(d) {
      const p = parts(ymdhm, d);
      return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
    },

    fromDateTimeInput(value) {
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
      const asUtc = new Date(`${value}:00Z`);
      if (Number.isNaN(asUtc.getTime())) return null;
      // **オフセットは固定値で書かない。** `+09:00` のように焼き込むと、夏時間の
      // ある地域で年に 2 回 1 時間ずれる。まず UTC として読んだ位置のオフセットを
      // 当て、当てた先のオフセットで測り直す（切り替わりをまたぐと 1 回目が
      // 古い側のものになるため）。
      const guess = new Date(asUtc.getTime() - offsetMs(asUtc));
      const corrected = new Date(asUtc.getTime() - offsetMs(guess));
      return Number.isNaN(corrected.getTime()) ? null : corrected.toISOString();
    },
  };
}
