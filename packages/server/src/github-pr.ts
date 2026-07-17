import { Octokit } from "@octokit/rest";
import {
  GIT_GITHUB_REQUEST_TIMEOUT_MS,
  GIT_PR_CACHE_TTL_MS,
  GIT_PR_FETCH_LIMIT,
} from "./constants.js";
import { getCurrentBranch, isGitRepo, verifyRef, type RefInfo } from "./git-branch-metadata.js";
import { resolveGithubToken } from "./utils/resolve-github-token.js";
import { memoBy } from "./utils/memo-by.js";
import { runGit } from "./utils/run-git.js";
import type {
  GitBranchPr,
  GitBranchPrMergeable,
  GitBranchPrState,
} from "./types.js";

// PrApiData is the raw shape the GitHub API returns — PR fields plus the
// internal owner/repo hints. It does NOT carry a resolved base ref (the API
// can't know which local remote a repo maps to); detectPr resolves that.
interface PrApiData {
  number: number;
  title: string;
  baseRefName: string;
  url: string | null;
  state: GitBranchPrState;
  isDraft: boolean;
  mergeable: GitBranchPrMergeable;
  headOwner: string | null;
  baseRepoFullName: string | null;
  mergedAt: string | null;
}

// ParsedPr is the wire type + the internal owner/repo hints. baseRef (a wire
// field) is the server-resolved comparison ref, computed once in detectPr so
// neither the diff path nor the client re-resolves it. headOwner and
// baseRepoFullName stay internal — toWirePr strips them.
export interface ParsedPr extends GitBranchPr {
  headOwner: string | null;
  baseRepoFullName: string | null;
}

interface PrCache {
  pr: ParsedPr | null;
  builtAt: number;
}

export interface PrFetcher {
  list(slug: string, branch: string, state: string, perPage: number): Promise<PrApiData[]>;
}

interface GraphqlRepositoryOwner {
  login: string;
}

interface GraphqlBaseRepository {
  nameWithOwner: string;
}

interface GraphqlPrNode {
  number: number;
  title: string | null;
  url: string | null;
  isDraft: boolean;
  mergedAt: string | null;
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN" | null;
  state: "OPEN" | "CLOSED" | "MERGED";
  baseRefName: string;
  headRepositoryOwner: GraphqlRepositoryOwner | null;
  baseRepository: GraphqlBaseRepository | null;
}

interface GraphqlPullRequests {
  nodes: GraphqlPrNode[];
}

interface GraphqlRepository {
  pullRequests: GraphqlPullRequests;
}

interface GraphqlPrResponse {
  repository: GraphqlRepository | null;
}

export interface GithubRemote {
  name: string;
  slug: string;
  owner: string;
}

// PR detection cache, keyed by (cwd, branch). The client's `getGitBranchPr` call
// (fired in parallel with `getGitBranchInfo` on viewer open) populates this, so
// by the time `branchInfo?.pr` is truthy client-side and the viewer opens into
// branch mode, the server cache is warm — and `resolveEffectiveBaseRef` can
// read the PR's base repo without a GitHub round-trip on the diff path (which is
// local-only by design). The branch is part of the key, so switching branches
// misses and the next `getGitBranchPr` refetches; a TTL backstops a stale entry.
const prCacheByCwd = new Map<string, Map<string, PrCache>>();

// In-flight detectPr dedup, keyed by (cwd, branch), so the diff path's cold-cache
// resolution and the client's concurrent getGitBranchPr share a single GitHub
// round-trip instead of racing into two. Cleared on settle.
const inflightDetectPr = new Map<string, Promise<ParsedPr | null>>();

export const readPrCache = (cwd: string, branch: string): ParsedPr | null | undefined => {
  const byBranch = prCacheByCwd.get(cwd);
  if (!byBranch) return undefined;
  const entry = byBranch.get(branch);
  if (!entry) return undefined;
  if (Date.now() - entry.builtAt > GIT_PR_CACHE_TTL_MS) {
    byBranch.delete(branch);
    if (byBranch.size === 0) prCacheByCwd.delete(cwd);
    return undefined;
  }
  return entry.pr;
};

const writePrCache = (cwd: string, branch: string, pr: ParsedPr | null): void => {
  let byBranch = prCacheByCwd.get(cwd);
  if (!byBranch) {
    byBranch = new Map();
    prCacheByCwd.set(cwd, byBranch);
  }
  byBranch.set(branch, { pr, builtAt: Date.now() });
};

const normalizeGraphqlPrState = (state: string): GitBranchPrState => {
  if (state === "MERGED") return "merged";
  if (state === "CLOSED") return "closed";
  return "open";
};

const resolveGraphqlMergeable = (mergeable: string | null | undefined): GitBranchPrMergeable => {
  if (mergeable === "MERGEABLE") return "mergeable";
  if (mergeable === "CONFLICTING") return "conflicting";
  return "unknown";
};

// GraphQL `pullRequests(headRefName:)` filters by branch name across same-repo
// and fork PRs — the same semantics `gh pr list --head` uses. The REST
// `pulls.list` `head` param can't: `owner:branch` only matches fork PRs (0 for
// a same-repo PR), and a bare branch is silently ignored (returns all PRs). So
// a same-repo PR — the common case where you push to origin directly — was
// never detected. GraphQL also returns `mergeable` inline, so there is no
// per-PR detail round-trip.
const PR_LIST_QUERY = `
  query($owner: String!, $repo: String!, $branch: String!, $perPage: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequests(
        headRefName: $branch
        states: [OPEN, CLOSED, MERGED]
        first: $perPage
        orderBy: { field: CREATED_AT, direction: DESC }
      ) {
        nodes {
          number
          title
          url
          isDraft
          mergedAt
          mergeable
          state
          baseRefName
          headRepositoryOwner { login }
          baseRepository { nameWithOwner }
        }
      }
    }
  }
`;

const defaultPrFetcher: PrFetcher = {
  list: async (slug, branch, _state, perPage) => {
    const token = await resolveGithubToken();
    if (!token) return [];
    try {
      const [owner, repo] = slug.split("/");
      const octokit = new Octokit({
        auth: token,
        request: { timeout: GIT_GITHUB_REQUEST_TIMEOUT_MS },
      });
      const data = await octokit.graphql<GraphqlPrResponse>(PR_LIST_QUERY, {
        owner,
        repo,
        branch,
        perPage,
      });
      const nodes = data?.repository?.pullRequests?.nodes ?? [];
      return nodes.map((pullRequest) => {
        const state = normalizeGraphqlPrState(pullRequest.state);
        return {
          number: pullRequest.number,
          title: pullRequest.title ?? "",
          baseRefName: pullRequest.baseRefName ?? "",
          url: pullRequest.url ?? null,
          state,
          isDraft: pullRequest.isDraft ?? false,
          mergeable:
            state === "open" ? resolveGraphqlMergeable(pullRequest.mergeable) : "unknown",
          headOwner: pullRequest.headRepositoryOwner?.login ?? null,
          baseRepoFullName: pullRequest.baseRepository?.nameWithOwner ?? null,
          mergedAt: pullRequest.mergedAt ?? null,
        };
      });
    } catch {
      return [];
    }
  },
};

let activePrFetcher: PrFetcher = defaultPrFetcher;

export const setPrFetcher = (fetcher: PrFetcher): void => {
  activePrFetcher = fetcher;
};

const parseGithubRemotes = async (cwd: string): Promise<GithubRemote[]> => {
  const result = await runGit(cwd, ["remote", "-v"]);
  if (result.exitCode !== 0) return [];

  const raw: GithubRemote[] = [];
  const seen = new Set<string>();
  for (const line of result.stdout.toString("utf8").split("\n")) {
    // Partial/blobless clones annotate the fetch line with the filter spec,
    // e.g. `origin\t<url> (fetch) [blob:none]`; a bare `(fetch)$` anchor misses
    // it, so PR detection silently no-ops on partial clones.
    const match = /^(\S+)\t(.+?)\s+\(fetch\)(?:\s+\[[^\]]*\])?$/.exec(line);
    if (!match) continue;
    const [, name, url] = match;
    if (seen.has(name)) continue;
    seen.add(name);
    const urlMatch = /github\.com[/:]([^\s/]+)\/([^\s]+?)(?:\.git)?$/i.exec(url);
    if (!urlMatch) continue;
    const [, owner, repoName] = urlMatch;
    raw.push({ name, slug: `${owner}/${repoName}`, owner });
  }

  return memoBy(raw, (remote) => `${remote.name} ${remote.slug}`);
};

// The wire type strips the internal-only fields (headOwner, baseRepoFullName)
// so they never reach the client.
const toWirePr = (pr: ParsedPr): GitBranchPr => ({
  number: pr.number,
  title: pr.title,
  baseRefName: pr.baseRefName,
  baseRef: pr.baseRef,
  url: pr.url,
  state: pr.state,
  isDraft: pr.isDraft,
  mergeable: pr.mergeable,
  mergedAt: pr.mergedAt,
});

const resolvePrBaseRef = async (
  cwd: string,
  pr: Pick<ParsedPr, "baseRepoFullName" | "baseRefName">,
  remotes: GithubRemote[],
): Promise<RefInfo | null> => {
  if (!pr.baseRepoFullName || !pr.baseRefName) return null;
  const baseRepo = pr.baseRepoFullName.toLowerCase();
  const remote = remotes.find((candidate) => candidate.slug.toLowerCase() === baseRepo);
  if (!remote) return null;
  const candidate = `${remote.name}/${pr.baseRefName}`;
  if (await verifyRef(cwd, candidate)) return { ref: candidate, source: "pr" };
  // Remote configured but its tracking ref isn't local — the common fork state:
  // `upstream` added but never fetched, since the server only reads existing
  // refs and never fetches on its own. Fetch just that one branch so the fork PR
  // can diff against the upstream base instead of falling back to the fork's own
  // (possibly drifted) default. Bounded by GIT_SPAWN_TIMEOUT_MS and
  // GIT_TERMINAL_PROMPT=0, so a dead/slow/unauthenticated upstream degrades to the
  // repo default below. Explicit refspec so the tracking ref is created/updated
  // regardless of the remote's fetch refspec config (a bare `git fetch <remote>
  // <branch>` only reliably writes FETCH_HEAD on older git).
  await runGit(cwd, [
    "fetch",
    "--no-tags",
    "--no-recurse-submodules",
    "--",
    remote.name,
    `${pr.baseRefName}:refs/remotes/${remote.name}/${pr.baseRefName}`,
  ]);
  return (await verifyRef(cwd, candidate)) ? { ref: candidate, source: "pr" } : null;
};

// detectPr returns the full ParsedPr (headOwner + baseRepoFullName retained)
// and caches it per (cwd, branch) so the diff path can resolve a fork PR's
// upstream base without a second GitHub round-trip. getGitBranchPr maps to the
// wire type; resolveEffectiveBaseRef reads the cache directly.
const detectPr = async (cwd: string): Promise<ParsedPr | null> => {
  const currentBranch = await getCurrentBranch(cwd);
  if (!currentBranch) return null;
  const remotes = await parseGithubRemotes(cwd);
  if (remotes.length === 0) return null;
  const ownRemote = remotes.find((remote) => remote.name === "origin") ?? remotes[0];
  const ownOwner = ownRemote.owner.toLowerCase();
  const slugs = memoBy(remotes, (remote) => remote.slug).map((remote) => remote.slug);

  const results = await Promise.all(
    slugs.map((slug) => activePrFetcher.list(slug, currentBranch, "all", GIT_PR_FETCH_LIMIT)),
  );

  const candidates = memoBy(
    results.flat().filter((pr) => pr.headOwner && pr.headOwner.toLowerCase() === ownOwner),
    (pr) => pr.url ?? `#${pr.number}`,
  );
  const openPr = candidates.find((pr) => pr.state === "open");
  const chosenApi = openPr ?? candidates[0] ?? null;
  // Resolve the comparison ref once here (mapping the PR's base repo to a local
  // remote, fetching the upstream branch when it isn't local yet) so the diff
  // path and the UI picker both read cachedPr.baseRef without re-resolving. A
  // fork PR resolves to <upstream>/<baseRefName>; a same-repo PR (base repo is
  // origin) to <origin>/<baseRefName> — automatic from the remote-slug match.
  const chosen: ParsedPr | null = chosenApi
    ? {
        number: chosenApi.number,
        title: chosenApi.title,
        baseRefName: chosenApi.baseRefName,
        url: chosenApi.url,
        state: chosenApi.state,
        isDraft: chosenApi.isDraft,
        mergeable: chosenApi.mergeable,
        baseRef: (await resolvePrBaseRef(cwd, chosenApi, remotes))?.ref ?? null,
        headOwner: chosenApi.headOwner,
        baseRepoFullName: chosenApi.baseRepoFullName,
        mergedAt: chosenApi.mergedAt,
      }
    : null;
  writePrCache(cwd, currentBranch, chosen);
  return chosen;
};

// detectPr with per-(cwd, branch) in-flight dedup. Used by both getGitBranchPr
// (the client lease) and the diff path's cold-cache fallback so they never
// double-hit the GitHub API when they race.
export const detectPrDeduped = async (cwd: string): Promise<ParsedPr | null> => {
  const currentBranch = await getCurrentBranch(cwd);
  if (!currentBranch) return null;
  const key = `${cwd}\0${currentBranch}`;
  const inflight = inflightDetectPr.get(key);
  if (inflight) return inflight;
  const pending = detectPr(cwd).finally(() => {
    inflightDetectPr.delete(key);
  });
  inflightDetectPr.set(key, pending);
  return pending;
};

export const listGithubRemoteSlugs = async (cwd: string): Promise<string[]> => {
  const remotes = await parseGithubRemotes(cwd);
  return memoBy(remotes, (remote) => remote.slug).map((remote) => remote.slug);
};

export const getGitBranchPr = async (cwd: string): Promise<GitBranchPr | null> => {
  if (!(await isGitRepo(cwd))) return null;
  const detected = await detectPrDeduped(cwd);
  return detected ? toWirePr(detected) : null;
};
