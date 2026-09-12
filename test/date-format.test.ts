import { describe, expect, it } from 'vitest';
import { createDateFormat } from '../src/core/date.ts';

const tokyo = createDateFormat('Asia/Tokyo');

describe('createDateFormat', () => {
  it('設定のタイムゾーンで切り出す (実行環境の TZ に依存しない)', () => {
    // 2026-08-20T08:00 JST = 2026-08-19T23:00Z。UTC のまま頭を 10 文字取ると
    // 前日になる (公開ページと編集画面で日付がずれる形。実際に踏んでいる)。
    const early = new Date('2026-08-19T23:00:00.000Z');
    expect(tokyo.isoDate(early)).toBe('2026-08-20');
    expect(tokyo.toDateTimeInput(early)).toBe('2026-08-20T08:00');

    const utc = createDateFormat('UTC');
    expect(utc.isoDate(early)).toBe('2026-08-19');
    expect(utc.toDateTimeInput(early)).toBe('2026-08-19T23:00');
  });

  it('入力欄の値を UTC に戻せる', () => {
    expect(tokyo.fromDateTimeInput('2026-08-20T08:00')).toBe('2026-08-19T23:00:00.000Z');
    expect(createDateFormat('UTC').fromDateTimeInput('2026-08-20T08:00')).toBe(
      '2026-08-20T08:00:00.000Z',
    );
  });

  it('読めない入力は null', () => {
    for (const bad of ['', '2026-08-20', '2026-08-20 08:00', '2026-13-40T08:00', 'いつか']) {
      expect(tokyo.fromDateTimeInput(bad), bad).toBeNull();
    }
  });

  /**
   * **夏時間のある地域で往復が壊れないこと。** オフセットを `+09:00` のような
   * 固定値で書くと、切り替えの前後で 1 時間ずれる。JST に夏時間が無いので、
   * ここを見ていないと `fromDateTimeInput` の 2 段構えが利いているか分からない
   * （実際、1 段目だけにしても本番の設定ではテストが 1 つも落ちない）。
   */
  it('夏時間をまたいでも入力欄の値と往復する', () => {
    for (const zone of ['America/New_York', 'Europe/Berlin', 'Australia/Lord_Howe']) {
      const format = createDateFormat(zone);
      // 切り替わりの前後を 1 時間刻みで舐める。北半球の 3 月と 11 月、
      // 南半球の 4 月と 10 月がどこかに当たる。
      for (const month of ['03', '04', '10', '11']) {
        for (let hour = 0; hour < 24; hour++) {
          const wall = `2026-${month}-05T${String(hour).padStart(2, '0')}:30`;
          const utc = format.fromDateTimeInput(wall);
          expect(utc, `${zone} ${wall} を読めない`).not.toBeNull();
          // 入れた壁時計の値がそのまま返ること。存在しない時刻 (春の飛ぶ 1 時間)
          // は無いところを選んである。
          expect(format.toDateTimeInput(new Date(utc as string)), `${zone} ${wall}`).toBe(wall);
        }
      }
    }
  });
});
