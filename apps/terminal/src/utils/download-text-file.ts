// Trigger a browser download of `content` as `filename`. Builds a Blob URL,
// clicks a hidden anchor, then revokes the URL. Kept generic so any feature
// that produces client-side text (the age-armored secrets export, etc.) can
// save it without a server round-trip.
export const downloadTextFile = (filename: string, content: string): void => {
  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};
