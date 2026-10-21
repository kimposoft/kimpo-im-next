export interface HighlightPart { text: string; match: boolean; }

/** Returns plain text segments for template rendering; callers must never inject HTML. */
export function highlightParts(text: string, keyword: string): HighlightPart[] {
  const needle = keyword.trim();
  if (!needle) return [{ text, match: false }];
  const lowerText = text.toLocaleLowerCase();
  const lowerNeedle = needle.toLocaleLowerCase();
  const parts: HighlightPart[] = [];
  let offset = 0;
  while (offset < text.length) {
    const index = lowerText.indexOf(lowerNeedle, offset);
    if (index < 0) { parts.push({ text: text.slice(offset), match: false }); break; }
    if (index > offset) parts.push({ text: text.slice(offset, index), match: false });
    parts.push({ text: text.slice(index, index + needle.length), match: true });
    offset = index + needle.length;
  }
  return parts.length ? parts : [{ text, match: false }];
}
