export interface KittyGraphicsCommand {
  action: string;
  controls: Readonly<Record<string, string>>;
  payload: string;
}

export const parseKittyGraphicsCommand = (data: string): KittyGraphicsCommand => {
  const separator = data.indexOf(";");
  const controlText = separator === -1 ? data : data.slice(0, separator);
  const controls: Record<string, string> = {};
  for (const control of controlText.split(",")) {
    const equals = control.indexOf("=");
    if (equals <= 0) continue;
    controls[control.slice(0, equals)] = control.slice(equals + 1);
  }
  return {
    action: controls.a ?? "t",
    controls,
    payload: separator === -1 ? "" : data.slice(separator + 1),
  };
};

export const kittyIntegerControl = (
  command: KittyGraphicsCommand,
  key: string,
): number | undefined => {
  const value = command.controls[key];
  if (value === undefined || !/^-?\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
};
