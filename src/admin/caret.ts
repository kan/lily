/**
 * textarea の中の「この位置」がどこに描かれているかを測る。
 *
 * **textarea はキャレットの座標を教えてくれない。** そこで、同じ字送り・同じ幅の
 * 写しを作って本文の先頭からその位置までを流し込み、続きを包んだ `span` の
 * 位置を読む（折り返しの計算をブラウザにやらせる）。
 *
 * 写しに移すのは**描画に効く指定だけ**。`font` を落とすと 1 行の文字数が変わり、
 * 折り返しの位置がずれる。
 */
const COPIED = [
  'boxSizing',
  'borderBottomWidth',
  'borderLeftWidth',
  'borderRightWidth',
  'borderTopWidth',
  'fontFamily',
  'fontSize',
  'fontStretch',
  'fontStyle',
  'fontVariant',
  'fontWeight',
  'letterSpacing',
  'lineHeight',
  'paddingBottom',
  'paddingLeft',
  'paddingRight',
  'paddingTop',
  'tabSize',
  'textIndent',
  'textTransform',
  'wordSpacing',
] as const satisfies readonly (keyof CSSStyleDeclaration & string)[];

export type CaretPoint = {
  /** textarea の左上からの位置（スクロール量を引いた、見えている座標）。 */
  readonly top: number;
  readonly left: number;
  /** その行の高さ。下に何かを置くときの送り。 */
  readonly lineHeight: number;
};

export function caretPoint(area: HTMLTextAreaElement, index: number): CaretPoint {
  const style = getComputedStyle(area);

  const mirror = document.createElement('div');
  for (const property of COPIED) mirror.style[property] = style[property];
  mirror.style.position = 'absolute';
  mirror.style.top = '0';
  mirror.style.left = '-9999px';
  mirror.style.visibility = 'hidden';
  mirror.style.width = `${area.clientWidth}px`;
  mirror.style.height = 'auto';
  // textarea と同じ折り返し方。これが無いと 1 行に収まってしまう。
  mirror.style.whiteSpace = 'pre-wrap';
  mirror.style.overflowWrap = 'break-word';

  mirror.textContent = area.value.slice(0, index);

  // **続きの 1 文字を包む。** 空だと高さが 0 になって行の位置が取れないので、
  // 何も無いときは代わりの文字を入れる。
  const marker = document.createElement('span');
  marker.textContent = area.value.slice(index, index + 1) || '.';
  mirror.appendChild(marker);

  document.body.appendChild(mirror);
  const lineHeight = marker.offsetHeight || parseFloat(style.lineHeight) || 0;
  const point = {
    top: marker.offsetTop - area.scrollTop,
    left: marker.offsetLeft - area.scrollLeft,
    lineHeight,
  };
  mirror.remove();

  return point;
}
