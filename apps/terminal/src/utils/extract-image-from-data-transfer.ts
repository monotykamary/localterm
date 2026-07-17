interface TransferredImage {
  blob: Blob;
  name: string;
}

export const extractImageFromDataTransfer = (
  dataTransfer: DataTransfer | null,
): TransferredImage | null => {
  const items = dataTransfer?.items;
  if (!items) return null;
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) return { blob: file, name: file.name || "image" };
    }
  }
  return null;
};
