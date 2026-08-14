# Foundry repository instructions

Before changing Foundry, read `docs/foundry-institution/README.md` and the governing documents it indexes. Treat those documents as the durable product, architecture, experience, economics, proof, and implementation-state contract.

For every meaningful slice: verify the live baseline; state the governing requirement; implement the smallest complete change; test normal, failure, and adversarial behavior; record evidence maturity and proof debt; use shadow → compare → cutover → delete for migrations; and prefer simpler equivalent architecture. Never infer authority from capability or allow a caller to declare its own authority/safety.

## Codex Cloud and GitHub

In hosted Codex Cloud, complete and commit repository work locally, leave the working tree clean, and report the commit SHA, checks, proposed PR title and description, evidence maturity, and proof debt. GitHub publication is handled by the Codex product UI: do not request or use GitHub credentials, run `gh auth login`, or treat missing GitHub authentication, remotes, tools, or network access in the task sandbox as an implementation blocker.
