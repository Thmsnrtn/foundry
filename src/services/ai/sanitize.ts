/**
 * Redact personally identifiable information (PII) from text.
 * Removes email addresses and phone numbers to prevent PII leakage
 * into AI prompts and logs.
 */
export function redactPII(input: string): string {
  if (!input) return '';
  // Email addresses
  let result = input.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[email redacted]');
  // Phone numbers (common formats)
  result = result.replace(/(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, '[phone redacted]');
  return result;
}

/**
 * Sanitize user-controlled text before injecting into LLM prompts.
 *
 * Defense-in-depth approach:
 * 1. Denylist filter (catches obvious patterns)
 * 2. XML boundary wrapping via wrapUserContent() (primary defense)
 * 3. Length truncation (prevents context-stuffing)
 * 4. XML tag stripping (prevents breaking out of XML boundaries)
 * 5. PII redaction (prevents email/phone leakage into prompts)
 *
 * The denylist alone is bypassable (RT09 finding). The primary defense
 * is XML boundary wrapping — Claude respects XML tag boundaries, so
 * user content wrapped in <user_data>...</user_data> is treated as data,
 * not instructions. Always use wrapUserContent() for external data.
 */
export function sanitizeForPrompt(input: string): string {
  if (!input || typeof input !== 'string') return '';

  let cleaned = input;

  // Strip XML-like tags that could break out of boundary wrapping
  // This is the most important defense — prevents </user_data> injection
  cleaned = cleaned.replace(/<\/?[a-zA-Z_][\w.-]*[^>]*>/g, '[tag removed]');

  // Remove common prompt injection patterns (case-insensitive)
  const injectionPatterns = [
    /ignore\s+(all\s+)?previous\s+instructions/gi,
    /ignore\s+(all\s+)?above\s+instructions/gi,
    /disregard\s+(all\s+)?(previous|above|prior)/gi,
    /you\s+are\s+now\s+a/gi,
    /act\s+as\s+(a\s+|an\s+)?/gi,
    /pretend\s+(you('re|\s+are)\s+)/gi,
    /new\s+instructions?\s*:/gi,
    /override\s+(all\s+)?instructions/gi,
    /system\s*:\s*/gi,
    /\[INST\]/gi,
    /\[\/INST\]/gi,
    /<\|im_start\|>/gi,
    /<\|im_end\|>/gi,
    /<<SYS>>/gi,
    /<<\/SYS>>/gi,
    /Human:\s*/gi,
    /Assistant:\s*/gi,
  ];

  for (const pattern of injectionPatterns) {
    cleaned = cleaned.replace(pattern, '[filtered]');
  }

  // Truncate extremely long inputs that could be context-stuffing attacks
  const MAX_LENGTH = 5000;
  if (cleaned.length > MAX_LENGTH) {
    cleaned = cleaned.slice(0, MAX_LENGTH) + '... [truncated]';
  }

  // Redact PII (emails, phone numbers) to prevent leakage into prompts
  cleaned = redactPII(cleaned);

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
