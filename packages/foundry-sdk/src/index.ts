// =============================================================================
// @foundry/sdk — Embedded Intelligence Adapter
//
// Install Foundry intelligence into any Node.js application.
// Your app's data stays in your database. Foundry reads it via your adapter.
//
// Install:
//   npm install @foundry/sdk
//
// Usage (Express):
//   import { createFoundryAdapter } from '@foundry/sdk'
//   const foundry = createFoundryAdapter({ ... })
//   app.use('/admin/foundry', foundry.expressMiddleware())
//
// Usage (Hono):
//   import { createFoundryAdapter } from '@foundry/sdk'
//   const foundry = createFoundryAdapter({ ... })
//   app.route('/admin/foundry', foundry.honoApp())
// =============================================================================

export type { FoundryAdapterConfig, SchemaMapping, FoundrySyncPayload } from './types.js';
export { createFoundryAdapter } from './adapter.js';
export { FoundrySchemaDetector } from './detector.js';
