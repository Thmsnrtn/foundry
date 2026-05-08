-- =============================================================================
-- FOUNDRY — V3.1 Layer C: Products.disabled_tools
-- JSON array of tool names the gateway must refuse for this product. Used
-- by kill-switch.ts. Coexists with agent_instances.status (per-agent pause)
-- and products.status (product-wide pause).
-- =============================================================================

ALTER TABLE products ADD COLUMN disabled_tools TEXT;
