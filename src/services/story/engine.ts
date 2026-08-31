// =============================================================================
// FOUNDRY — Founding Story Engine
// =============================================================================

import { query } from '../../db/client.js';
import { nanoid } from 'nanoid';
import type { ArtifactType, FoundingStoryArtifact } from '../../types/index.js';

export async function captureArtifact(input: {
  productId: string;
  phase: string;
  artifactType: ArtifactType;
  title: string;
  content: string;
  evidenceLinks?: string[];
}): Promise<string> {
  const id = nanoid();
  await query(
    `INSERT INTO founding_story_artifacts (id, product_id, phase, artifact_type, title, content, evidence_links)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, input.productId, input.phase, input.artifactType, input.title, input.content,
     input.evidenceLinks ? JSON.stringify(input.evidenceLinks) : null]
  );
  return id;
}

export async function publishArtifact(artifactId: string, productId: string): Promise<string> {
  await query('UPDATE founding_story_artifacts SET published = 1 WHERE id = ? AND product_id = ?', [artifactId, productId]);
  // Return public URL
  const appUrl = process.env.APP_URL ?? 'https://foundry.app';
  return `${appUrl}/case-studies/${artifactId}`;
}

// `generateCaseStudyHTML` REMOVED.
//
// It rendered "Cryptographic timestamp: ${timestamp}" where `timestamp` was
// `new Date(artifact.created_at).toISOString()` — no hash, no signature, no
// anchor, anywhere in this file. A date presented as cryptographic evidence is
// exactly the fabrication the constitution forbids: presentation is allowed,
// evidence is not invented.
//
// It had no caller — the live page is `routes/public/landing.ts` — so deleting
// it removes a false claim and an orphan in one go. The same claim was being
// SOLD in the tier-gate upgrade copy, which is why this mattered more than a
// dead function usually would; that copy is corrected too.
//
// If a case study ever needs to be verifiable, that is a real feature with a
// real mechanism, and it starts by not saying so until it is.

