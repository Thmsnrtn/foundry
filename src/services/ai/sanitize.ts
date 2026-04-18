/**
 * Sanitize user-controlled text before injecting into LLM prompts.
 * Strips common injection patterns while preserving useful content.
 */
export function sanitizeForPrompt(input: string): string {
  if (!input || typeof input !== 'string') return '';

  let cleaned = input;

  // Remove common prompt injection patterns (case-insensitive)
  const injectionPatterns = [
    /ignore\s+(all\s+)?previous\s+instructions/gi,
    /ignore\s+(all\s+)?above\s+instructions/gi,
    /disregard\s+(all\s+)?previous/gi,
    /you\s+are\s+now\s+a/gi,
    /system\s*:\s*/gi,
    /\[INST\]/gi,
    /\[\/INST\]/gi,
    /<\|im_start\|>/gi,
    /<\|im_end\|>/gi,
    /<<SYS>>/gi,
    /<<\/SYS>>/gi,
  ];

  for (const pattern of injectionPatterns) {
    cleaned = cleaned.replace(pattern, '[filtered]');
  }

  // Truncate extremely long inputs that could be context-stuffing attacks
  const MAX_LENGTH = 5000;
  if (cleaned.length > MAX_LENGTH) {
    cleaned = cleaned.slice(0, MAX_LENGTH) + '... [truncated]';
  }

  return cleaned;
}

/**
 * Wrap user-controlled content in XML tags for clear boundary marking.
 * Claude models respect XML boundaries, making injection harder.
 */
export function wrapUserContent(tag: string, content: string): string {
  const sanitized = sanitizeForPrompt(content);
  return `<${tag}>${sanitized}</${tag}>`;
}
