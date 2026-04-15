-- =============================================================================
-- FOUNDRY — Idea Validation & Founder Voice
-- Supports Stage 1 founders (pre-build) and deep personalization.
-- =============================================================================

-- Idea validations — market research results for pre-build founders
CREATE TABLE IF NOT EXISTS idea_validations (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  idea_description TEXT NOT NULL,
  target_customer TEXT NOT NULL,
  hypothesis TEXT NOT NULL,
  known_competitors TEXT,
  analysis TEXT NOT NULL,
  verdict TEXT NOT NULL CHECK(verdict IN ('strong', 'moderate', 'weak')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_idea_validations_product ON idea_validations(product_id);

-- Founder voice profile — how the founder communicates, writes, and thinks
-- This is SEPARATE from Product DNA (which is about the product).
-- This is about the FOUNDER as a person.
CREATE TABLE IF NOT EXISTS founder_voice (
  founder_id TEXT PRIMARY KEY REFERENCES founders(id),
  -- Communication style
  writing_tone TEXT, -- 'formal', 'casual', 'technical', 'friendly', 'direct'
  formality_level INTEGER DEFAULT 5, -- 1-10 (1=very casual, 10=very formal)
  detail_preference TEXT DEFAULT 'standard', -- 'minimal', 'standard', 'comprehensive'
  -- Decision-making style (learned from patterns, but founder can override)
  risk_tolerance TEXT DEFAULT 'moderate', -- 'conservative', 'moderate', 'aggressive'
  decision_speed TEXT DEFAULT 'thoughtful', -- 'fast', 'thoughtful', 'deliberate'
  -- Business philosophy
  growth_philosophy TEXT, -- free-form: "I prefer organic growth over paid acquisition"
  pricing_philosophy TEXT, -- free-form: "I believe in value-based pricing"
  customer_philosophy TEXT, -- free-form: "I'd rather have 100 happy customers than 1000 lukewarm ones"
  -- Personal context (helps Foundry be a better advisor)
  working_hours TEXT, -- "9am-5pm ET" or "async, check in mornings"
  energy_pattern TEXT, -- "morning person" or "night owl" or "varies"
  biggest_strength TEXT, -- "technical execution" or "customer empathy"
  biggest_gap TEXT, -- "marketing" or "finance" or "operations"
  -- Meta
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
