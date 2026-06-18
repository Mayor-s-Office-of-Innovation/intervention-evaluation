/**
 * Parse TSV text into an array of objects.
 * First line is treated as headers.
 */
export function parseTSV(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split('\t');
  return lines.slice(1).map(line => {
    const values = line.split('\t');
    return Object.fromEntries(headers.map((h, i) => [h.trim(), (values[i] || '').trim()]));
  });
}

/**
 * Group an array of objects by a key.
 */
export function groupBy(arr, key) {
  const groups = {};
  for (const item of arr) {
    const k = item[key];
    if (!groups[k]) groups[k] = [];
    groups[k].push(item);
  }
  return groups;
}
