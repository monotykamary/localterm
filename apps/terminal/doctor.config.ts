import { defineConfig } from "react-doctor/api";

export default defineConfig({
  ignore: {
    overrides: [
      {
        files: ["src/hooks/use-file-diff-pane-state.ts"],
        rules: ["react-doctor/no-global-css-variable-animation"],
      },
      {
        files: ["src/hooks/use-terminal-runtime.ts"],
        rules: ["react-doctor/effect-needs-cleanup"],
      },
    ],
  },
});
