# Foundry repository instructions

Before changing Foundry, read `docs/foundry-institution/README.md` and the governing documents it indexes. Treat those documents as the durable product, architecture, experience, economics, proof, and implementation-state contract.

For every meaningful slice: verify the live baseline; state the governing requirement; implement the smallest complete change; test normal, failure, and adversarial behavior; record evidence maturity and proof debt; use shadow → compare → cutover → delete for migrations; and prefer simpler equivalent architecture. Never infer authority from capability or allow a caller to declare its own authority/safety.

## Codex Cloud and GitHub

- Never request or require `GH_TOKEN`, `GITHUB_TOKEN`, personal access tokens, SSH keys, repository credentials, or `gh auth login`.
- Do not authenticate to GitHub, push branches, or create or update pull requests from inside the task sandbox.
- Missing authenticated `gh`, `make_pr`, a Git remote, or direct GitHub network access is not an implementation blocker.
- Complete repository work by editing, testing, and committing locally; leave the working tree clean and report the commit SHA, checks, proposed PR title and body, evidence maturity, and proof debt.
- GitHub publishing happens afterward through the Codex product UI.
