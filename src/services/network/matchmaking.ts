// =============================================================================
// FOUNDRY — Founder Network & Matchmaking
// Connects founders by sector, stage, and complementary challenges.
// =============================================================================

import { query } from '../../db/client.js';
import { callSonnet, parseJSONResponse } from '../ai/client.js';
import { nanoid } from 'nanoid';

export interface MatchResult {
  founder_id: string;
  display_name: string;
  match_reason: string;
  match_score: number;
  shared_challenges: string[];
}

/**
 * Create or update a network profile.
 */
export async function upsertNetworkProfile(
  founderId: string,
  profile: {
    display_name?: string;
    bio?: string;
    expertise_areas?: string[];
    seeking_help_with?: string[];
    willing_to_help_with?: string[];
    timezone?: string;
  }
): Promise<void> {
  // A FOUNDER WITH TWO COMPANIES HAS NO SINGLE SECTOR, and this took whichever
  // one SQLite returned first — `LIMIT 1` with no ORDER BY — to describe them
  // to every other founder in the network. The profile carries the sector and
  // stage when they are unambiguous; when the founder's active companies
  // disagree, it carries neither, and the founder can state them themselves.
  const productsResult = await query(
    "SELECT sector_profile, growth_stage FROM products WHERE owner_id = ? AND status = 'active'",
    [founderId]
  );
  const rows = productsResult.rows as Array<Record<string, string | null>>;
  const only = <K extends 'sector_profile' | 'growth_stage'>(key: K): string | null => {
    const values = [...new Set(rows.map((r) => r[key]).filter((v): v is string => !!v))];
    return values.length === 1 ? values[0] : null;
  };
  const p = rows.length === 0 ? undefined : {
    sector_profile: only('sector_profile'),
    growth_stage: only('growth_stage'),
  };

  await query(
    `INSERT INTO network_profiles (id, founder_id, display_name, bio, sector, growth_stage, expertise_areas, seeking_help_with, willing_to_help_with, timezone)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (founder_id) DO UPDATE SET
       display_name = COALESCE(excluded.display_name, network_profiles.display_name),
       bio = COALESCE(excluded.bio, network_profiles.bio),
       sector = COALESCE(excluded.sector, network_profiles.sector),
       growth_stage = COALESCE(excluded.growth_stage, network_profiles.growth_stage),
       expertise_areas = COALESCE(excluded.expertise_areas, network_profiles.expertise_areas),
       seeking_help_with = COALESCE(excluded.seeking_help_with, network_profiles.seeking_help_with),
       willing_to_help_with = COALESCE(excluded.willing_to_help_with, network_profiles.willing_to_help_with),
       timezone = COALESCE(excluded.timezone, network_profiles.timezone),
       updated_at = datetime('now')`,
    [
      nanoid(), founderId,
      profile.display_name ?? null,
      profile.bio ?? null,
      p?.sector_profile ?? null,
      p?.growth_stage ?? null,
      profile.expertise_areas ? JSON.stringify(profile.expertise_areas) : null,
      profile.seeking_help_with ? JSON.stringify(profile.seeking_help_with) : null,
      profile.willing_to_help_with ? JSON.stringify(profile.willing_to_help_with) : null,
      profile.timezone ?? null,
    ]
  );
}

/**
 * Find compatible founders for introductions.
 */
export async function findMatches(founderId: string, limit: number = 5): Promise<MatchResult[]> {
  const myProfile = await query('SELECT * FROM network_profiles WHERE founder_id = ?', [founderId]);
  const me = myProfile.rows[0] as Record<string, unknown> | undefined;
  if (!me) return [];

  // A SHORTLIST OF TWENTY, AND THE RANKING BELOW ONLY SEES THOSE TWENTY.
  //
  // This took twenty candidates in storage order and then scored and sorted
  // them, so the best match in the network could not win if it was not among
  // the arbitrary twenty the database happened to return first. That is the
  // same shape as the fleet letter that ranked only the fifty oldest pending
  // decisions: naming a page a page is not enough when the ranking that follows
  // is the thing that decides.
  //
  // The full score needs JSON overlap between two founders' expertise and needs,
  // which SQL here cannot compute — so the page is ordered by the part of the
  // score it CAN: a candidate matching both sector and stage starts 25 points
  // ahead of one matching neither. The residual is real and is said out loud
  // rather than left in the shape of the query: this returns the best matches
  // among a shortlist of twenty, not the best matches in the network.
  const candidates = await query(
    `SELECT np.* FROM network_profiles np
     WHERE np.founder_id != ?
     AND np.visible = 1
     AND (np.sector = ? OR np.growth_stage = ?)
     AND np.founder_id NOT IN (
       SELECT founder_b_id FROM introductions WHERE founder_a_id = ?
       UNION SELECT founder_a_id FROM introductions WHERE founder_b_id = ?
     )
     ORDER BY (np.sector = ?) DESC, (np.growth_stage = ?) DESC, np.founder_id ASC
     LIMIT 20`,
    [founderId, me.sector, me.growth_stage, founderId, founderId, me.sector, me.growth_stage]
  );

  if (candidates.rows.length === 0) return [];

  const mySeeking = me.seeking_help_with ? JSON.parse(me.seeking_help_with as string) : [];
  const myExpertise = me.expertise_areas ? JSON.parse(me.expertise_areas as string) : [];

  const matches: MatchResult[] = [];
  for (const row of candidates.rows as unknown as Array<Record<string, unknown>>) {
    const theirExpertise = row.expertise_areas ? JSON.parse(row.expertise_areas as string) : [];
    const theirSeeking = row.seeking_help_with ? JSON.parse(row.seeking_help_with as string) : [];

    // Score: complementary skills (I need what they have, they need what I have)
    const iGetHelp = mySeeking.filter((s: string) => theirExpertise.includes(s));
    const theyGetHelp = theirSeeking.filter((s: string) => myExpertise.includes(s));
    const sectorMatch = row.sector === me.sector ? 1 : 0;
    const stageMatch = row.growth_stage === me.growth_stage ? 1 : 0;

    const score = iGetHelp.length * 25 + theyGetHelp.length * 25 + sectorMatch * 15 + stageMatch * 10;
    if (score < 10) continue;

    const sharedChallenges = [...iGetHelp, ...theyGetHelp].slice(0, 3);
    const reason = sharedChallenges.length > 0
      ? `Complementary expertise: ${sharedChallenges.join(', ')}`
      : `Same ${row.sector} sector at ${row.growth_stage} stage`;

    matches.push({
      founder_id: row.founder_id as string,
      display_name: (row.display_name as string) ?? 'Anonymous founder',
      match_reason: reason,
      match_score: Math.min(100, score),
      shared_challenges: sharedChallenges,
    });
  }

  return matches.sort((a, b) => b.match_score - a.match_score).slice(0, limit);
}

/**
 * Propose an introduction between two founders.
 */
export async function proposeIntroduction(
  founderAId: string,
  founderBId: string,
  matchReason: string,
  matchScore: number
): Promise<string> {
  const id = nanoid();
  await query(
    `INSERT INTO introductions (id, founder_a_id, founder_b_id, match_reason, match_score, status)
     VALUES (?, ?, ?, ?, ?, 'proposed')`,
    [id, founderAId, founderBId, matchReason, matchScore]
  );
  return id;
}

/**
 * Accept or decline an introduction.
 */
export async function respondToIntroduction(
  introId: string,
  founderId: string,
  accept: boolean
): Promise<void> {
  if (accept) {
    await query(
      `UPDATE introductions SET status = 'accepted', accepted_at = datetime('now') WHERE id = ? AND (founder_a_id = ? OR founder_b_id = ?)`,
      [introId, founderId, founderId]
    );
  } else {
    await query(
      `UPDATE introductions SET status = 'declined', declined_at = datetime('now') WHERE id = ? AND (founder_a_id = ? OR founder_b_id = ?)`,
      [introId, founderId, founderId]
    );
  }
}

// `submitPeerReview` was here. It wrote into a table nothing has ever read,
// through a route that took the reviewed company's id out of the request body
// and asked nothing. Retired in migration 163 rather than given a reader — the
// reader is what was ruled out, and a writer with no reader is not a feature
// waiting for one.

/**
 * Create or join a cohort group.
 */
export async function joinCohortGroup(founderId: string): Promise<string> {
  const profile = await query('SELECT sector, growth_stage FROM network_profiles WHERE founder_id = ?', [founderId]);
  const p = profile.rows[0] as Record<string, string> | undefined;

  // Find an existing group with space
  const existing = await query(
    `SELECT cg.id, COUNT(cm.id) as member_count FROM cohort_groups cg
     LEFT JOIN cohort_memberships cm ON cg.id = cm.cohort_group_id AND cm.active = 1
     WHERE cg.sector = ? AND cg.growth_stage = ?
     GROUP BY cg.id
     HAVING member_count < cg.max_members
     LIMIT 1`,
    [p?.sector ?? 'b2b_saas', p?.growth_stage ?? 'growth']
  );

  let groupId: string;
  if (existing.rows.length > 0) {
    groupId = (existing.rows[0] as Record<string, string>).id;
  } else {
    groupId = nanoid();
    await query(
      `INSERT INTO cohort_groups (id, name, sector, growth_stage) VALUES (?, ?, ?, ?)`,
      [groupId, `${p?.sector ?? 'SaaS'} ${p?.growth_stage ?? ''} Cohort`, p?.sector ?? 'b2b_saas', p?.growth_stage ?? 'growth']
    );
  }

  await query(
    `INSERT INTO cohort_memberships (id, cohort_group_id, founder_id)
     VALUES (?, ?, ?)
     ON CONFLICT (cohort_group_id, founder_id) DO UPDATE SET active = 1`,
    [nanoid(), groupId, founderId]
  );

  return groupId;
}
