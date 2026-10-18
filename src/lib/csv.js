/**
 * Quote a value for a CSV row when it holds a comma, quote or newline.
 *
 * Text that starts like a formula (= + - @, or a tab or carriage return) gets
 * a leading apostrophe, so a spreadsheet shows it instead of running it: an
 * activity typed as =HYPERLINK(...) by a student must not become a live link
 * or formula on the school admin's computer. Plain numbers, negative ones
 * included, are left alone.
 */
export function csvCell(v) {
  let s = String(v ?? '')
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
}
