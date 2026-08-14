# Foundry repository instructions

Before changing Foundry, read `docs/foundry-institution/README.md` and the governing documents it indexes. Treat those documents as the durable product, architecture, experience, economics, proof, and implementation-state contract.

For every meaningful slice: verify the live baseline; state the governing requirement; implement the smallest complete change; test normal, failure, and adversarial behavior; record evidence maturity and proof debt; use shadow → compare → cutover → delete for migrations; and prefer simpler equivalent architecture. Never infer authority from capability or allow a caller to declare its own authority/safety.
