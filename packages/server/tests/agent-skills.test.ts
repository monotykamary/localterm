import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { __resetAgentSkillsCache, listAgentSkills } from "../src/agent-skills.js";

const skillMd = (frontmatter: string, body = "instructions"): string =>
  `---\n${frontmatter}\n---\n\n# Skill\n\n${body}\n`;

describe("listAgentSkills", () => {
  let home: string;
  let agentDir: string;
  let cwd: string;
  let savedHome: string | undefined;
  let savedAgentDir: string | undefined;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "skills-home-"));
    agentDir = mkdtempSync(join(tmpdir(), "skills-agent-"));
    cwd = mkdtempSync(join(tmpdir(), "skills-cwd-"));
    savedHome = process.env.HOME;
    savedAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.HOME = home;
    process.env.PI_CODING_AGENT_DIR = agentDir;
    __resetAgentSkillsCache();
  });

  afterEach(() => {
    if (savedHome === undefined) delete process.env.HOME;
    else process.env.HOME = savedHome;
    if (savedAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = savedAgentDir;
    rmSync(home, { recursive: true, force: true });
    rmSync(agentDir, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
    __resetAgentSkillsCache();
  });

  const mkdir = (dir: string): void => {
    mkdirSync(dir, { recursive: true });
  };

  it("discovers a SKILL.md in a global-pi subdir", () => {
    mkdir(join(agentDir, "skills", "my-skill"));
    writeFileSync(
      join(agentDir, "skills", "my-skill", "SKILL.md"),
      skillMd("name: my-skill\ndescription: Does a thing"),
    );
    const skills = listAgentSkills(cwd);
    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({ name: "my-skill", source: "global-pi", disabled: false });
  });

  it("falls back to the parent directory name when frontmatter omits name", () => {
    mkdir(join(agentDir, "skills", "inferred-name"));
    writeFileSync(
      join(agentDir, "skills", "inferred-name", "SKILL.md"),
      skillMd("description: Has no name field"),
    );
    expect(listAgentSkills(cwd)[0].name).toBe("inferred-name");
  });

  it("skips skills without a description", () => {
    mkdir(join(agentDir, "skills", "no-desc"));
    writeFileSync(join(agentDir, "skills", "no-desc", "SKILL.md"), skillMd("name: no-desc"));
    expect(listAgentSkills(cwd)).toHaveLength(0);
  });

  it("reads disable-model-invocation as disabled", () => {
    mkdir(join(agentDir, "skills", "manual"));
    writeFileSync(
      join(agentDir, "skills", "manual", "SKILL.md"),
      skillMd("name: manual\ndescription: manual only\ndisable-model-invocation: true"),
    );
    expect(listAgentSkills(cwd)[0].disabled).toBe(true);
  });

  it("discovers root .md files in global-pi but not global-agents", () => {
    mkdir(join(agentDir, "skills"));
    writeFileSync(
      join(agentDir, "skills", "loose.md"),
      skillMd("name: loose\ndescription: a root md"),
    );
    mkdir(join(home, ".agents", "skills"));
    writeFileSync(
      join(home, ".agents", "skills", "ignored.md"),
      skillMd("name: ignored\ndescription: should not load"),
    );
    expect(listAgentSkills(cwd).map((skill) => skill.name)).toEqual(["loose"]);
  });

  it("discovers project skills under the cwd", () => {
    mkdir(join(cwd, ".pi", "skills", "proj"));
    writeFileSync(
      join(cwd, ".pi", "skills", "proj", "SKILL.md"),
      skillMd("name: proj\ndescription: project skill"),
    );
    const skills = listAgentSkills(cwd);
    expect(skills.map((skill) => skill.name)).toContain("proj");
    expect(skills.find((skill) => skill.name === "proj")?.source).toBe("project-pi");
  });

  it("dedups the same physical skill reached via a symlinked dir", () => {
    mkdir(join(home, ".agents", "skills", "real"));
    writeFileSync(
      join(home, ".agents", "skills", "real", "SKILL.md"),
      skillMd("name: real\ndescription: once"),
    );
    mkdir(join(agentDir, "skills"));
    symlinkSync(join(home, ".agents", "skills", "real"), join(agentDir, "skills", "alias"));
    const skills = listAgentSkills(cwd);
    expect(skills.filter((skill) => skill.name === "real")).toHaveLength(1);
    expect(skills[0].source).toBe("global-pi");
  });

  it("skips project dirs when cwd is empty", () => {
    mkdir(join(cwd, ".pi", "skills", "proj"));
    writeFileSync(
      join(cwd, ".pi", "skills", "proj", "SKILL.md"),
      skillMd("name: proj\ndescription: project skill"),
    );
    expect(listAgentSkills("").map((skill) => skill.name)).not.toContain("proj");
  });

  it("caches the result across calls within the ttl", () => {
    mkdir(join(agentDir, "skills", "cached"));
    writeFileSync(
      join(agentDir, "skills", "cached", "SKILL.md"),
      skillMd("name: cached\ndescription: cached"),
    );
    const first = listAgentSkills(cwd);
    mkdir(join(agentDir, "skills", "added"));
    writeFileSync(
      join(agentDir, "skills", "added", "SKILL.md"),
      skillMd("name: added\ndescription: added"),
    );
    const second = listAgentSkills(cwd);
    expect(second.map((skill) => skill.name)).toEqual(first.map((skill) => skill.name));
    expect(second.map((skill) => skill.name)).not.toContain("added");
  });
});
