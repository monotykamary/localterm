import path from "node:path";

interface GetHerdrConfigPathsOptions {
  environment: NodeJS.ProcessEnv;
  homeDirectory: string;
}

export const getHerdrConfigPaths = ({
  environment,
  homeDirectory,
}: GetHerdrConfigPathsOptions): string[] => {
  if (environment.HERDR_CONFIG_PATH) {
    return [path.resolve(environment.HERDR_CONFIG_PATH)];
  }
  const configRoot = environment.XDG_CONFIG_HOME
    ? path.resolve(environment.XDG_CONFIG_HOME)
    : path.join(homeDirectory, ".config");
  return [
    path.join(configRoot, "herdr", "config.toml"),
    path.join(configRoot, "herdr-dev", "config.toml"),
  ];
};
