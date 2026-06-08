export interface DaemonStartArgsInput {
  port: number;
  host: string;
  open: boolean;
}

export const buildDaemonStartArgs = (input: DaemonStartArgsInput): string[] => {
  const args = ["start", "--port", String(input.port), "--host", input.host];
  if (input.open) args.push("--open");
  return args;
};
