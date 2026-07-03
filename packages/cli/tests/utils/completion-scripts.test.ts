import { describe, expect, it } from "vite-plus/test";
import {
  buildBashCompletionScript,
  buildFishCompletionScript,
  buildZshCompletionFile,
  buildZshCompletionScript,
  completionFileFor,
  completionScriptFor,
} from "../../src/utils/completion-scripts.js";

describe("buildBashCompletionScript", () => {
  it("registers a completion handler for the localterm command", () => {
    expect(buildBashCompletionScript()).toContain(
      "complete -o default -F _localterm_completion localterm",
    );
  });

  it("falls back to filename completion when the CLI returns nothing", () => {
    expect(buildBashCompletionScript()).toContain("-o default");
  });

  it("calls back into the hidden _completion command with the full word list", () => {
    expect(buildBashCompletionScript()).toContain('localterm _completion -- "${COMP_WORDS[@]}"');
  });

  it("only fills COMPREPLY when candidates are non-empty", () => {
    expect(buildBashCompletionScript()).toContain("if [[ -n $candidates ]]");
  });
});

describe("buildZshCompletionScript", () => {
  it("declares itself as the localterm completion function", () => {
    expect(buildZshCompletionScript()).toContain("#compdef localterm");
    expect(buildZshCompletionScript()).toContain("compdef _localterm localterm");
  });

  it("compadds the newline-split candidates", () => {
    expect(buildZshCompletionScript()).toContain("compadd -- ${(f)candidates}");
  });

  it("falls back to file completion when the CLI returns nothing", () => {
    expect(buildZshCompletionScript()).toContain("_files");
  });

  it("guards compdef so sourcing before compinit is a silent no-op", () => {
    expect(buildZshCompletionScript()).toContain("if command -v compdef >/dev/null 2>&1");
  });
});

describe("buildFishCompletionScript", () => {
  it("registers the completer with -f (no default file completion)", () => {
    expect(buildFishCompletionScript()).toContain(
      'complete -c localterm -a "(__localterm_complete)" -f',
    );
  });

  it("builds the word list from the command line before and at the cursor", () => {
    expect(buildFishCompletionScript()).toContain("(commandline -opc) (commandline -ct)");
  });

  it("calls back into the hidden _completion command", () => {
    expect(buildFishCompletionScript()).toContain("localterm _completion -- $words");
  });
});

describe("buildZshCompletionFile (fpath drop-file form)", () => {
  it("declares the completion via the #compdef magic comment", () => {
    expect(buildZshCompletionFile()).toContain("#compdef localterm");
  });

  it("is the bare function body, not an _localterm() wrapper or explicit compdef", () => {
    const file = buildZshCompletionFile();
    expect(file).not.toContain("_localterm()");
    expect(file).not.toContain("compdef _localterm localterm");
    expect(file).toContain('candidates=$(localterm _completion -- "${words[@]}" 2>/dev/null)');
    expect(file).toContain("compadd -- ${(f)candidates}");
  });
});

describe("completionScriptFor / completionFileFor dispatchers", () => {
  it("routes the stdout/eval script per shell", () => {
    expect(completionScriptFor("bash")).toBe(buildBashCompletionScript());
    expect(completionScriptFor("zsh")).toBe(buildZshCompletionScript());
    expect(completionScriptFor("fish")).toBe(buildFishCompletionScript());
    expect(completionScriptFor("tcsh")).toBe("");
  });

  it("routes the drop-file content per shell (zsh uses the fpath-body form)", () => {
    expect(completionFileFor("bash")).toBe(buildBashCompletionScript());
    expect(completionFileFor("fish")).toBe(buildFishCompletionScript());
    expect(completionFileFor("zsh")).toBe(buildZshCompletionFile());
    expect(completionFileFor("tcsh")).toBe("");
  });
});
