import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('audio briefing economics', () => {
  it('does not restore ungoverned TTS spend or mismatched provider credentials', () => {
    const source = readFileSync(resolve(__dirname, '../../src/services/scp/briefing/audio.ts'), 'utf8');
    expect(source).not.toMatch(/api\.elevenlabs\.io|api\.openai\.com\/v1\/audio|ELEVENLABS_API_KEY|OPENAI_API_KEY|OPENROUTER_API_KEY/);
    expect(source).toContain('const audio_url: string | null = null');
  });
});
