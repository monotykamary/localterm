import type { RpcClient } from "../pi-rpc-client.js";

export interface RpcCommandResult {
  success: boolean;
  error?: string;
}

export const sendRpcCommand = async (
  client: RpcClient,
  command: Record<string, unknown>,
  timeoutMs: number,
): Promise<RpcCommandResult> => {
  const commandName = String(command.type ?? "");
  client.send(command);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const line = await client.nextLine(deadline - Date.now());
    if (line === null) {
      if (client.closed)
        return { success: false, error: `${commandName} closed before responding` };
      continue;
    }

    try {
      const response: unknown = JSON.parse(line);
      if (typeof response !== "object" || response === null) continue;
      if (Reflect.get(response, "type") !== "response") continue;
      if (Reflect.get(response, "command") !== commandName) continue;
      return Reflect.get(response, "success") === true
        ? { success: true }
        : {
            success: false,
            error: String(Reflect.get(response, "error") ?? `${commandName} failed`),
          };
    } catch {}
  }

  return { success: false, error: `${commandName} timed out` };
};
