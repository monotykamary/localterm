export const isHerdrProcess = (processName: string): boolean => {
  const executableName = processName.replaceAll("\\", "/").split("/").at(-1);
  return executableName === "herdr" || executableName === "herdr.exe";
};
