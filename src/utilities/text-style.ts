/**
 * The byte order mark and line ending of a text file, so saves that rewrite
 * a whole file (tasks, settings) keep both as the file had them.
 */
const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);
const CRLF = String.fromCharCode(13, 10);

export interface TextStyle {
  readonly bom: boolean;
  /** "\n" or "\r\n". */
  readonly eol: string;
}

/** New files: no byte order mark, LF line endings. */
export const LF_STYLE: TextStyle = { bom: false, eol: "\n" };

export const withoutByteOrderMark = (text: string): string => (text.startsWith(BYTE_ORDER_MARK) ? text.slice(1) : text);

/** The style of `text`; its first line ending decides. */
export function textStyleOf(text: string): TextStyle {
  const end = text.indexOf("\n");
  return { bom: text.startsWith(BYTE_ORDER_MARK), eol: end > 0 && text[end - 1] === "\r" ? CRLF : "\n" };
}

/** `text`, whatever its line endings and mark, in `style`. */
export const applyTextStyle = (text: string, style: TextStyle): string =>
  (style.bom ? BYTE_ORDER_MARK : "") + withoutByteOrderMark(text).replace(/\r?\n/g, style.eol);
