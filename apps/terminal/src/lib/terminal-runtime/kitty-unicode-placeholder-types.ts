interface KittyPlaceholderCell {
  column: number;
  imageId: number;
  placementId: number;
  row: number;
}

export interface KittyVirtualPlacement {
  columns: number;
  imageId: number;
  placementId: number;
  rows: number;
  zIndex: number;
}

export interface KittyImageSource {
  close?: () => void;
  height: number;
  source: CanvasImageSource;
  width: number;
}

export interface KittyStoredImage {
  imageNumber?: number;
  source: KittyImageSource;
}

export interface KittyPlaceholderExtendedAttributes {
  clone(): KittyPlaceholderExtendedAttributes;
  ext: number;
  isEmpty(): boolean;
  kittyPlaceholder?: Omit<KittyPlaceholderCell, "column" | "row"> & {
    imageColumn: number;
    imageRow: number;
  };
  underlineColor: number;
  underlineStyle: number;
  underlineVariantOffset: number;
  urlId: number;
}
