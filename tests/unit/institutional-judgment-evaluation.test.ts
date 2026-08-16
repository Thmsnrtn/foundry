process.env.TURSO_DATABASE_URL='file::memory:';
import {beforeAll,describe,expect,it} from 'vitest'; import {runMigrations} from '../../src/db/migrate.js'; import {query} from '../../src/db/client.js';
import {evaluateInstitutionalJudgment} from '../../src/services/institution/institutional-judgment-evaluation.js';
beforeAll(async()=>{await runMigrations(); await query("INSERT INTO founders(id,clerk_user_id,email) VALUES('je_o','je_c','je@example.com')");
 await query("INSERT INTO products(id,name,owner_id) VALUES('je_p','Company','je_o')"); await query(`INSERT INTO strategic_decisions_log
 (id,product_id,decision_title,decision_description,decision_category,made_by,status,agent_context_json) VALUES('je_j','je_p','Capacity judgment','Original snapshot','operations','agent_recommendation','active','{}')`);});
describe('append-only judgment later reality',()=>{it('preserves judgment, uncertainty, conflict, economics, learning, and authority separation',async()=>{
 const original=await query("SELECT * FROM strategic_decisions_log WHERE id='je_j'"); expect(await evaluateInstitutionalJudgment('je_p','je_j')).toBe('not_yet_observable');
 await query(`INSERT INTO signal_events(id,product_id,source,event_type,severity,payload_json,summary) VALUES
 ('je_s','je_p','independent','judgment_expected_supported','low','{"judgment_id":"je_j","economic_result":{"amount":12,"currency":"USD"}}','Later reality')`);
 expect(await evaluateInstitutionalJudgment('je_p','je_j')).toBe('supported');
 await query(`INSERT INTO signal_events(id,product_id,source,event_type,severity,payload_json,summary) VALUES
 ('je_cx','je_p','independent','judgment_expected_contradicted','high','{"judgment_id":"je_j"}','Contradiction')`);
 expect(await evaluateInstitutionalJudgment('je_p','je_j')).toBe('conflicting'); expect(await query("SELECT * FROM strategic_decisions_log WHERE id='je_j'")).toEqual(original);
 expect((await query("SELECT COUNT(*) n FROM autonomy_consents WHERE product_id='je_p'")).rows[0]).toMatchObject({n:0});
 expect((await query("SELECT COUNT(*) n FROM institutional_judgment_evaluations WHERE judgment_id='je_j'")).rows[0]).toMatchObject({n:3});
 }); it('rejects foreign and circular derived evidence',async()=>{await expect(evaluateInstitutionalJudgment('foreign','je_j')).rejects.toThrow(/refused/);
  await expect(query(`INSERT INTO institutional_judgment_evaluations(id,judgment_id,product_id,state,evidence_refs_json,economic_result_json)
   VALUES('loop','je_j','je_p','supported','["reconstruction_claim:self"]','{}')`)).rejects.toThrow(/evidence_invalid/);});});
