import { normalizePastedImage, type NormalizedPastedImage } from "@/utils/normalize-pasted-image";

export const extractImageFromDataTransfer = (
  dataTransfer: DataTransfer | null,
): NormalizedPastedImage | null => {
  if (!dataTransfer) return null;
  const items = dataTransfer.items;
  if (items) {
    for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
      const item = items[itemIndex];
      if (!item || item.kind !== "file") continue;
      const file = item.getAsFile();
      if (!file) continue;
      const image = normalizePastedImage(file, file.name);
      if (image) return image;
    }
  }

  const files = dataTransfer.files;
  if (files) {
    for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
      const file = files[fileIndex];
      if (!file) continue;
      const image = normalizePastedImage(file, file.name);
      if (image) return image;
    }
  }
  return null;
};
