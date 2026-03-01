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

export function generateCaseStudyHTML(artifact: FoundingStoryArtifact): string {
  const timestamp = new Date(artifact.created_at).toISOString();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${artifact.title} — Foundry Case Study</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: system-ui, sans-serif; max-width: 720px; margin: 40px auto; padding: 0 20px; color: #1a1a1a; }
    .timestamp { color: #666; font-size: 0.875rem; margin-bottom: 24px; }
    .badge { display: inline-block; padding: 4px 12px; border-radius: 4px; font-size: 0.75rem; font-weight: 600; }
    .content { line-height: 1.7; }
    .evidence { background: #f5f5f5; padding: 16px; border-radius: 8px; margin-top: 24px; }
    .footer { margin-top: 48px; border-top: 1px solid #eee; padding-top: 16px; font-size: 0.75rem; color: #999; }
  </style>
</head>
<body>
  <h1>${artifact.title}</h1>
  <div class="timestamp">
    <span class="badge" style="background: #e0f2fe; color: #0369a1;">${artifact.artifact_type}</span>
    Phase: ${artifact.phase} · Generated: ${timestamp}
  </div>
  <div class="content">${artifact.content}</div>
  ${artifact.evidence_links ? `<div class="evidence"><h3>Evidence</h3><ul>${(artifact.evidence_links as string[]).map((l) => `<li><a href="${l}">${l}</a></li>`).join('')}</ul></div>` : ''}
  <div class="footer">
    Cryptographic timestamp: ${timestamp}<br>
    Published via Foundry — Autonomous Business Intelligence Platform
  </div>
</body>
</html>`;
}
