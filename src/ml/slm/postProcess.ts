/**
 * Strips conversational LLM preambles and normalizes formatting.
 */
export function postProcessOutput(rawOutput: string): string {
  let text = rawOutput.trim();

  // Strip common conversational preambles
  const preamblePatterns = [
    /^(here\s+(is|are)\s+(the|your)\s+(rewritten|professional|casual)\s+(text|version|note):?)\s*/i,
    /^(output:?)\s*/i,
    /^(rewritten:?)\s*/i,
    /^(sure,?\s*(here\s+is\s+.*?:?))\s*/i,
  ];

  for (const pattern of preamblePatterns) {
    text = text.replace(pattern, '').trim();
  }

  // Remove surrounding quotation marks if the entire text was wrapped
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith('“') && text.endsWith('”')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    text = text.slice(1, -1).trim();
  }

  return text;
}
