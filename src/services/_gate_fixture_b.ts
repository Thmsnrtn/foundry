import { query } from "../db/client.js";
export const q = () => query(`SELECT zz_not_a_column FROM products WHERE id = ?`, []);
