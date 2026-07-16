export const isHerdrProcess = (process: string | null): boolean => {
  if (process === null) return false;
  return process.split("/").at(-1) === "herdr";
};
