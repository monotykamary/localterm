export const toOpaqueHexColor = (color: string): string => {
  const digits = color.slice(1);
  if (digits.length >= 6) return `#${digits.slice(0, 6)}`;
  return `#${digits
    .slice(0, 3)
    .split("")
    .map((digit) => digit + digit)
    .join("")}`;
};
