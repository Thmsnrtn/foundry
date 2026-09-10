// =============================================================================
// WHAT THE EDGE WROTE DOWN, READ ONE WAY.
//
// A message reaches the institution by two doors: the intake the edge program
// calls as mail arrives, and the replay that reads the Workshop's own store
// after an outage. Both must understand a stored record identically, or a
// message recovered later would be a different message from the one that came.
// So the reading lives here, once, and both doors use it.
//
// Everything in here is untrusted external content. It is parsed, bounded and
// stripped; nothing is executed, no link is fetched, and no attachment is
// decoded.
// =============================================================================

export interface EdgeMessage {
  to: string; from: string; fromName: string | null; subject: string | null; body: string;
  rfcMessageId: string; inReplyTo: string | null; references: string | null;
  spf: string | null; dkim: string | null; dmarc: string | null;
  sentAt: string | null; size: number | null;
}

const s = (v: unknown): string => (typeof v === 'string' ? v : '');

export function edgeRecordToMessage(payload: Record<string, unknown>): EdgeMessage {
  const headers = (payload.headers ?? {}) as Record<string, string>;
  const raw = s(payload.raw_base64);
  const decoded = raw ? Buffer.from(raw, 'base64').toString('utf8') : '';
  return {
    to: s(payload.to),
    // The address a person would answer, never the relay's bounce envelope.
    from: addressFrom(s(headers.from)) || s(payload.from),
    fromName: nameFrom(s(headers.from)),
    subject: decodeWords(s(headers.subject)) || null,
    body: textOf(decoded),
    rfcMessageId: s(headers['message-id']) || `<generated-${Date.now()}@intake>`,
    inReplyTo: s(headers['in-reply-to']) || null,
    references: s(headers.references) || null,
    spf: s(headers['received-spf']) || null,
    dkim: s(headers['dkim-signature']) ? 'present' : null,
    dmarc: s(headers['authentication-results']) || null,
    sentAt: s(headers.date) || null,
    size: typeof payload.size === 'number' ? payload.size : null,
  };
}

/** The display name, if the header carries one. Never trusted as identity. */
export function nameFrom(fromHeader: string): string | null {
  const m = /^\s*"?([^"<]+?)"?\s*</.exec(fromHeader);
  return m ? m[1]!.trim() || null : null;
}

/**
 * WHO A PERSON WOULD SAY WROTE THIS, out of the From: header.
 *
 * The envelope sender is not it. A message relayed through any sending service
 * arrives with a per-message return-path belonging to nobody. Stored as
 * identity that means a reply addressed nowhere and, far worse, an opt-out
 * recorded against an address that will never be seen again while the person
 * who asked to be left alone stays on the list.
 */
export function addressFrom(fromHeader: string): string {
  const angled = /<([^>]+)>/.exec(fromHeader);
  const candidate = (angled ? angled[1]! : fromHeader).trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate.toLowerCase() : '';
}

/**
 * A SUBJECT AS A PERSON WROTE IT, not as SMTP carried it. Anything outside
 * ASCII travels as an RFC 2047 encoded-word; left encoded it is unreadable to
 * the owner, and the rules that read a message see the `?` in the encoding and
 * take a statement for a question.
 */
export function decodeWords(subject: string): string {
  if (!subject.includes('=?')) return subject;
  return subject.replace(/=\?([A-Za-z0-9_-]+)\?([BbQq])\?([^?]*)\?=/g, (whole, charset: string, kind: string, text: string) => {
    try {
      const enc = charset.toLowerCase() === 'utf-8' ? 'utf8' : 'latin1';
      if (kind.toLowerCase() === 'b') return Buffer.from(text, 'base64').toString(enc);
      const bytes = text.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)));
      return Buffer.from(bytes, 'latin1').toString(enc);
    } catch { return whole; }
  }).replace(/\?=\s+=\?/g, '').trim();
}

/**
 * THE TEXT A PERSON WROTE, out of the MIME a machine sent.
 *
 * Deliberately small and deliberately not a MIME library: it takes the first
 * text/plain part it can find, falls back to stripping tags, and truncates.
 * The whole message is kept at the edge, so nothing here has to be perfect —
 * it only has to be safe. No HTML is stored for rendering, no attachment is
 * decoded, nothing is executed, and no reference in the message is fetched.
 */
export function textOf(rawMime: string): string {
  if (!rawMime.trim()) return '(no readable body)';
  const body = rawMime.split(/\r?\n\r?\n/).slice(1).join('\n\n') || rawMime;
  const plain = /content-type:\s*text\/plain[\s\S]*?\r?\n\r?\n([\s\S]*?)(?:\r?\n--|\r?\n\.\r?\n|$)/i.exec(rawMime);
  const chosen = plain ? plain[1]! : body;
  const stripped = chosen
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
  return (stripped || '(no readable body)').slice(0, 100_000);
}
