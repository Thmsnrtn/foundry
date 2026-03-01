// =============================================================================
// FOUNDRY — GitHub API Integration
// Read-only repository access via GitHub REST API.
// Rate limiting with exponential backoff.
// =============================================================================

interface GitHubTreeEntry {
  path: string;
  mode: string;
  type: 'blob' | 'tree';
  sha: string;
  size?: number;
  url: string;
}

interface GitHubTree {
  sha: string;
  url: string;
  tree: GitHubTreeEntry[];
  truncated: boolean;
}

interface GitHubFile {
  name: string;
  path: string;
  sha: string;
  size: number;
  content: string; // Base64 encoded
  encoding: string;
}

const GITHUB_API = 'https://api.github.com';

/**
 * Make a GitHub API request with authentication and rate limit handling.
 */
async function githubFetch(
  url: string,
  token: string,
  retries: number = 3
): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    if (response.status === 403) {
      const rateLimitRemaining = response.headers.get('X-RateLimit-Remaining');
      if (rateLimitRemaining === '0') {
        const resetTime = parseInt(response.headers.get('X-RateLimit-Reset') || '0', 10);
        const waitMs = Math.max(0, resetTime * 1000 - Date.now()) + 1000;
        const backoff = Math.min(waitMs, 60000); // Max 60s wait
        await sleep(backoff);
        continue;
      }
    }

    if (response.status === 429) {
      const backoff = Math.pow(2, attempt) * 1000;
      await sleep(backoff);
      continue;
    }

    if (!response.ok && attempt < retries) {
      const backoff = Math.pow(2, attempt) * 500;
      await sleep(backoff);
      continue;
    }

    return response;
  }

  throw new Error(`GitHub API request failed after ${retries} retries: ${url}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Get the full recursive file tree for a repository.
 */
export async function getRepoTree(
  owner: string,
  repo: string,
  token: string,
  branch: string = 'main'
): Promise<GitHubTreeEntry[]> {
  // First get the default branch SHA
  const refResponse = await githubFetch(
    `${GITHUB_API}/repos/${owner}/${repo}/git/ref/heads/${branch}`,
    token
  );

  if (!refResponse.ok) {
    // Try 'master' if 'main' fails
    if (branch === 'main') {
      return getRepoTree(owner, repo, token, 'master');
    }
    throw new Error(`Failed to get branch ref: ${refResponse.status}`);
  }

  const refData = await refResponse.json() as { object: { sha: string } };
  const sha = refData.object.sha;

  // Get recursive tree
  const treeResponse = await githubFetch(
    `${GITHUB_API}/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`,
    token
  );

  if (!treeResponse.ok) {
    throw new Error(`Failed to get repo tree: ${treeResponse.status}`);
  }

  const treeData = await treeResponse.json() as GitHubTree;
  return treeData.tree;
}

/**
 * Get the contents of a specific file.
 */
export async function getFileContent(
  owner: string,
  repo: string,
  path: string,
  token: string
): Promise<string> {
  const response = await githubFetch(
    `${GITHUB_API}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`,
    token
  );

  if (!response.ok) {
    throw new Error(`Failed to get file ${path}: ${response.status}`);
  }

  const data = await response.json() as GitHubFile;

  if (data.encoding === 'base64') {
    return Buffer.from(data.content, 'base64').toString('utf-8');
  }

  return data.content;
}

/**
 * Get multiple files efficiently, targeting key analysis files.
 */
export async function getKeyFiles(
  owner: string,
  repo: string,
  token: string,
  tree: GitHubTreeEntry[]
): Promise<Map<string, string>> {
  const files = new Map<string, string>();

  // Target files for analysis
  const targetPatterns = [
    'package.json',
    'tsconfig.json',
    /\.env\.example$/,
    /fly\.toml$/,
    /docker-compose/,
    /Dockerfile/,
    /^src\/index\./,
    /^src\/app\./,
    /routes?\//,
    /middleware\//,
    /^src\/.*config/,
    /pricing/i,
    /landing/i,
    /stripe/i,
    /billing/i,
    /auth/i,
    /error/i,
    /analytics/i,
    /telemetry/i,
  ];

  const targetFiles = tree.filter((entry) => {
    if (entry.type !== 'blob') return false;
    return targetPatterns.some((pattern) => {
      if (typeof pattern === 'string') return entry.path === pattern || entry.path.endsWith(`/${pattern}`);
      return pattern.test(entry.path);
    });
  });

  // Limit to ~50 files to stay within rate limits
  const filesToFetch = targetFiles.slice(0, 50);

  for (const file of filesToFetch) {
    try {
      const content = await getFileContent(owner, repo, file.path, token);
      files.set(file.path, content);
    } catch {
      // Skip files that can't be read (binary, too large, etc.)
      continue;
    }
  }

  return files;
}

// ─── Write Operations (for Remediation Engine) ──────────────────────────────

/**
 * Get the latest commit SHA from the default branch.
 */
export async function getDefaultBranchSha(
  owner: string,
  repo: string,
  token: string,
  branch: string = 'main',
): Promise<string> {
  const response = await githubFetch(
    `${GITHUB_API}/repos/${owner}/${repo}/git/ref/heads/${branch}`,
    token,
  );
  if (!response.ok && branch === 'main') {
    return getDefaultBranchSha(owner, repo, token, 'master');
  }
  if (!response.ok) throw new Error(`Failed to get branch SHA: ${response.status}`);
  const data = await response.json() as { object: { sha: string } };
  return data.object.sha;
}

/**
 * Create a new branch from a given SHA.
 */
export async function createBranch(
  owner: string,
  repo: string,
  branchName: string,
  baseSha: string,
  token: string,
): Promise<void> {
  const response = await githubFetchMutate(
    `${GITHUB_API}/repos/${owner}/${repo}/git/refs`,
    token,
    'POST',
    { ref: `refs/heads/${branchName}`, sha: baseSha },
  );
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to create branch ${branchName}: ${response.status} ${body}`);
  }
}

/**
 * Commit files to a branch using the Git data API.
 * Creates blobs → tree → commit → updates branch ref.
 */
export async function commitFiles(
  owner: string,
  repo: string,
  branchName: string,
  files: Array<{ path: string; content: string }>,
  commitMessage: string,
  token: string,
): Promise<string> {
  // 1. Get current commit SHA for the branch
  const refResp = await githubFetch(
    `${GITHUB_API}/repos/${owner}/${repo}/git/ref/heads/${branchName}`,
    token,
  );
  if (!refResp.ok) throw new Error(`Branch ${branchName} not found: ${refResp.status}`);
  const refData = await refResp.json() as { object: { sha: string } };
  const parentSha = refData.object.sha;

  // 2. Get the tree SHA from current commit
  const commitResp = await githubFetch(
    `${GITHUB_API}/repos/${owner}/${repo}/git/commits/${parentSha}`,
    token,
  );
  const commitData = await commitResp.json() as { tree: { sha: string } };
  const baseTreeSha = commitData.tree.sha;

  // 3. Create blobs for each file
  const treeItems: Array<{ path: string; mode: string; type: string; sha: string }> = [];
  for (const file of files) {
    const blobResp = await githubFetchMutate(
      `${GITHUB_API}/repos/${owner}/${repo}/git/blobs`,
      token,
      'POST',
      { content: file.content, encoding: 'utf-8' },
    );
    if (!blobResp.ok) throw new Error(`Failed to create blob for ${file.path}`);
    const blobData = await blobResp.json() as { sha: string };
    treeItems.push({ path: file.path, mode: '100644', type: 'blob', sha: blobData.sha });
  }

  // 4. Create new tree
  const treeResp = await githubFetchMutate(
    `${GITHUB_API}/repos/${owner}/${repo}/git/trees`,
    token,
    'POST',
    { base_tree: baseTreeSha, tree: treeItems },
  );
  if (!treeResp.ok) throw new Error('Failed to create tree');
  const treeData = await treeResp.json() as { sha: string };

  // 5. Create commit
  const newCommitResp = await githubFetchMutate(
    `${GITHUB_API}/repos/${owner}/${repo}/git/commits`,
    token,
    'POST',
    { message: commitMessage, tree: treeData.sha, parents: [parentSha] },
  );
  if (!newCommitResp.ok) throw new Error('Failed to create commit');
  const newCommitData = await newCommitResp.json() as { sha: string };

  // 6. Update branch ref
  const updateResp = await githubFetchMutate(
    `${GITHUB_API}/repos/${owner}/${repo}/git/refs/heads/${branchName}`,
    token,
    'PATCH',
    { sha: newCommitData.sha },
  );
  if (!updateResp.ok) throw new Error('Failed to update branch ref');

  return newCommitData.sha;
}

/**
 * Open a pull request and return PR number and URL.
 */
export async function createPullRequest(
  owner: string,
  repo: string,
  title: string,
  body: string,
  headBranch: string,
  baseBranch: string,
  token: string,
): Promise<{ number: number; url: string }> {
  const response = await githubFetchMutate(
    `${GITHUB_API}/repos/${owner}/${repo}/pulls`,
    token,
    'POST',
    { title, body, head: headBranch, base: baseBranch },
  );
  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Failed to create PR: ${response.status} ${errBody}`);
  }
  const data = await response.json() as { number: number; html_url: string };
  return { number: data.number, url: data.html_url };
}

/**
 * Check if a PR has been merged.
 */
export async function isPRMerged(
  owner: string,
  repo: string,
  prNumber: number,
  token: string,
): Promise<boolean> {
  const response = await githubFetch(
    `${GITHUB_API}/repos/${owner}/${repo}/pulls/${prNumber}`,
    token,
  );
  if (!response.ok) return false;
  const data = await response.json() as { merged: boolean; state: string };
  return data.merged;
}

/**
 * Check if a PR is still open.
 */
export async function isPROpen(
  owner: string,
  repo: string,
  prNumber: number,
  token: string,
): Promise<boolean> {
  const response = await githubFetch(
    `${GITHUB_API}/repos/${owner}/${repo}/pulls/${prNumber}`,
    token,
  );
  if (!response.ok) return false;
  const data = await response.json() as { state: string };
  return data.state === 'open';
}

/**
 * GitHub API mutating request (POST/PATCH/PUT) with auth and backoff.
 */
async function githubFetchMutate(
  url: string,
  token: string,
  method: 'POST' | 'PATCH' | 'PUT',
  body: unknown,
  retries: number = 3,
): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify(body),
    });

    if (response.status === 403 || response.status === 429) {
      const backoff = Math.pow(2, attempt) * 1000;
      await sleep(backoff);
      continue;
    }

    if (!response.ok && attempt < retries) {
      const backoff = Math.pow(2, attempt) * 500;
      await sleep(backoff);
      continue;
    }

    return response;
  }
  throw new Error(`GitHub API mutate request failed after ${retries} retries: ${url}`);
}

/**
 * List available repositories for the authenticated user.
 */
export async function listRepos(token: string): Promise<Array<{ name: string; full_name: string; owner: string; private: boolean }>> {
  const response = await githubFetch(
    `${GITHUB_API}/user/repos?per_page=100&sort=updated`,
    token
  );

  if (!response.ok) {
    throw new Error(`Failed to list repos: ${response.status}`);
  }

  const repos = await response.json() as Array<{
    name: string;
    full_name: string;
    owner: { login: string };
    private: boolean;
  }>;

  return repos.map((r) => ({
    name: r.name,
    full_name: r.full_name,
    owner: r.owner.login,
    private: r.private,
  }));
}
