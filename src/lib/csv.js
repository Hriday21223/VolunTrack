/** Quote a value for a CSV row when it holds a comma, quote or newline. */
export function csvCell(v) {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
}
