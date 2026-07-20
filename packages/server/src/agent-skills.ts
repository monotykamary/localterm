import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import matter from "gray-matter";
import { AGENT_SKILL_CACHE_MAX_ENTRIES, AGENT_SKILL_CACHE_TTL_MS } from "./constants.js";
import type { AgentSkillInfo } from "./types.js";

type SkillSource = AgentSkillInfo["source"];

interface SkillDir {
  path: string;
  source: SkillSource;
}

interface DiscoveredSkill extends AgentSkillInfo {
  filePath: string;
}

// The skill list rarely changes, so cache it per cwd for a few minutes; the
// first call scans the filesystem, later calls reuse the cache.
const skillCache = new Map<string, { at: number; skills: AgentSkillInfo[] }>();

const DISABLE_MODEL_INVOCATION_KEY = "disable-model-invocation";

// pi's agent config dir: $PI_CODING_AGENT_DIR (tilde-expanded) || ~/.pi/agent.
const resolveAgentDir = (): string => {
  const envDir = process.env.PI_CODING_AGENT_DIR;
  if (envDir) {
    return envDir.startsWith("~/") ? join(homedir(), envDir.slice(2)) : envDir;
  }
  return join(homedir(), ".pi", "agent");
};

// Standard pi skill directories (priority order, matching pi-toggle-skills):
// global ~/.pi/agent/skills + ~/.agents/skills, then the project's .pi/skills +
// .agents/skills. Dirs are deduped by resolved path so a symlinked
// ~/.agents/skills → ~/.pi/agent/skills is scanned once.
const collectSkillDirs = (cwd: string): SkillDir[] => {
  const dirs: SkillDir[] = [
    { path: join(resolveAgentDir(), "skills"), source: "global-pi" },
    { path: join(homedir(), ".agents", "skills"), source: "global-agents" },
  ];
  if (cwd.length > 0) {
    dirs.push(
      { path: join(cwd, ".pi", "skills"), source: "project-pi" },
      { path: join(cwd, ".agents", "skills"), source: "project-agents" },
    );
  }
  const seen = new Set<string>();
  return dirs.filter((dir) => {
    let resolved = dir.path;
    try {
      resolved = realpathSync(dir.path);
    } catch {
      // dir may not exist yet
    }
    if (seen.has(resolved)) return false;
    seen.add(resolved);
    return true;
  });
};

const isRootFileSource = (source: SkillSource): boolean =>
  source === "global-pi" || source === "project-pi";

// Parse a SKILL.md (or root .md) file's frontmatter. Skills without a
// description are skipped (pi won't load them). The name falls back to the
// parent directory name when frontmatter omits it.
const loadSkillFromFile = (filePath: string, source: SkillSource): DiscoveredSkill | null => {
  try {
    const raw = readFileSync(filePath, "utf8");
    const { data } = matter(raw);
    const name =
      typeof data.name === "string" && data.name.length > 0
        ? data.name
        : basename(dirname(filePath));
    const description = typeof data.description === "string" ? data.description : "";
    if (description.trim() === "") return null;
    let realFilePath = filePath;
    try {
      realFilePath = realpathSync(filePath);
    } catch {
      // keep the original path
    }
    return {
      name,
      description,
      disabled: data[DISABLE_MODEL_INVOCATION_KEY] === true,
      source,
      filePath: realFilePath,
    };
  } catch {
    return null;
  }
};

// Mirror pi's discovery rules: a directory with SKILL.md is one skill (no
// recursion); otherwise root .md files load only in ~/.pi/agent/skills and
// .pi/skills; subdirectories are always recursed into (looking for SKILL.md).
const loadSkillsFromDir = (dir: string, source: SkillSource): DiscoveredSkill[] => {
  const skills: DiscoveredSkill[] = [];
  if (!existsSync(dir)) return skills;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return skills;
  }

  if (entries.some((entry) => entry.name === "SKILL.md")) {
    const skill = loadSkillFromFile(join(dir, "SKILL.md"), source);
    if (skill) skills.push(skill);
    return skills;
  }

  if (isRootFileSource(source)) {
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      if (!entry.name.endsWith(".md")) continue;
      let isFile = entry.isFile();
      if (entry.isSymbolicLink()) {
        try {
          isFile = statSync(join(dir, entry.name)).isFile();
        } catch {
          continue;
        }
      }
      if (!isFile) continue;
      const skill = loadSkillFromFile(join(dir, entry.name), source);
      if (skill) skills.push(skill);
    }
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    let isDirectory = entry.isDirectory();
    if (entry.isSymbolicLink()) {
      try {
        isDirectory = statSync(join(dir, entry.name)).isDirectory();
      } catch {
        continue;
      }
    }
    if (!isDirectory) continue;
    skills.push(...loadSkillsFromDir(join(dir, entry.name), source));
  }
  return skills;
};

const discoverSkills = (cwd: string): AgentSkillInfo[] => {
  const seen = new Set<string>();
  const skills: AgentSkillInfo[] = [];
  for (const { path: dirPath, source } of collectSkillDirs(cwd)) {
    for (const skill of loadSkillsFromDir(dirPath, source)) {
      if (seen.has(skill.filePath)) continue;
      seen.add(skill.filePath);
      skills.push({
        name: skill.name,
        description: skill.description,
        disabled: skill.disabled,
        source: skill.source,
      });
    }
  }
  return skills;
};

export const listAgentSkills = (cwd: string): AgentSkillInfo[] => {
  const cached = skillCache.get(cwd);
  if (cached && Date.now() - cached.at < AGENT_SKILL_CACHE_TTL_MS) {
    skillCache.delete(cwd);
    skillCache.set(cwd, cached);
    return cached.skills;
  }
  const skills = discoverSkills(cwd);
  skillCache.delete(cwd);
  skillCache.set(cwd, { at: Date.now(), skills });
  while (skillCache.size > AGENT_SKILL_CACHE_MAX_ENTRIES) {
    const oldestCwd = skillCache.keys().next().value;
    if (oldestCwd === undefined) break;
    skillCache.delete(oldestCwd);
  }
  return skills;
};

// Test-only: reset the skill-list cache so a case never sees another's cached
// result.
export const __resetAgentSkillsCache = (): void => {
  skillCache.clear();
};
