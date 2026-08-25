import type { IDisposable, ITerminalAddon, Terminal as XtermTerminal } from "@xterm/xterm";

import {
  KITTY_GRAPHICS_IMAGE_ID_MAX,
  KITTY_GRAPHICS_MAX_ENCODED_BYTES,
  KITTY_GRAPHICS_MAX_STORED_IMAGES,
  KITTY_UNICODE_PLACEHOLDER_MAX_DIMENSION,
} from "@/lib/constants";
import { installKittyPlaceholderPrintHandler } from "@/lib/terminal-runtime/kitty-unicode-placeholder-buffer";
import { KittyUnicodePlaceholderRenderer } from "@/lib/terminal-runtime/kitty-unicode-placeholder-renderer";
import type {
  KittyImageSource,
  KittyStoredImage,
  KittyVirtualPlacement,
} from "@/lib/terminal-runtime/kitty-unicode-placeholder-types";
import { decodeKittyImage } from "@/utils/decode-kitty-image";
import {
  kittyIntegerControl,
  parseKittyGraphicsCommand,
  type KittyGraphicsCommand,
} from "@/utils/parse-kitty-graphics-command";

interface PendingTransmission {
  command: KittyGraphicsCommand;
  encodedBytes: number;
  payload: string[];
}

export interface KittyUnicodePlaceholderAddonOptions {
  decodeImage?: (
    command: KittyGraphicsCommand,
    encodedPayload: string,
  ) => Promise<KittyImageSource>;
}

const validId = (value: number | undefined): value is number =>
  value !== undefined && value > 0 && value <= KITTY_GRAPHICS_IMAGE_ID_MAX;

const validDimension = (value: number | undefined): value is number =>
  value !== undefined && value > 0 && value <= KITTY_UNICODE_PLACEHOLDER_MAX_DIMENSION;

export class KittyUnicodePlaceholderAddon implements ITerminalAddon, IDisposable {
  private readonly decodeImage: NonNullable<KittyUnicodePlaceholderAddonOptions["decodeImage"]>;
  private readonly images = new Map<number, KittyStoredImage>();
  private readonly placements = new Map<number, Map<number, KittyVirtualPlacement>>();
  private discardingTransmission = false;
  private disposables: IDisposable[] = [];
  private pending: PendingTransmission | undefined;
  private renderer: KittyUnicodePlaceholderRenderer | undefined;
  private restorePrintHandler: (() => void) | undefined;
  private terminal: XtermTerminal | undefined;

  constructor(options: KittyUnicodePlaceholderAddonOptions = {}) {
    this.decodeImage = options.decodeImage ?? decodeKittyImage;
  }

  activate(terminal: XtermTerminal): void {
    this.terminal = terminal;
    this.renderer = new KittyUnicodePlaceholderRenderer({
      resolve: (imageId, placementId) => this.resolve(imageId, placementId),
      terminal,
    });
    this.restorePrintHandler = installKittyPlaceholderPrintHandler(terminal);
    this.disposables = [
      terminal.parser.registerApcHandler({ final: "G" }, (data) => this.handleCommand(data)),
      terminal.parser.registerCsiHandler({ intermediates: "!", final: "p" }, () => {
        this.reset();
        return false;
      }),
      terminal.parser.registerEscHandler({ final: "c" }, () => {
        this.reset();
        return false;
      }),
    ];
  }

  dispose(): void {
    for (const disposable of this.disposables) disposable.dispose();
    this.disposables = [];
    this.restorePrintHandler?.();
    this.restorePrintHandler = undefined;
    this.renderer?.dispose();
    this.renderer = undefined;
    this.reset();
    this.terminal = undefined;
  }

  get imageCount(): number {
    return this.images.size;
  }

  get placementCount(): number {
    let count = 0;
    for (const placements of this.placements.values()) count += placements.size;
    return count;
  }

  private handleCommand(data: string): boolean | Promise<boolean> {
    const command = parseKittyGraphicsCommand(data);
    if (command.action === "d") {
      this.pending = undefined;
      this.discardingTransmission = false;
      this.delete(command);
      return false;
    }
    if (this.discardingTransmission) {
      if ((kittyIntegerControl(command, "m") ?? 0) !== 1) this.discardingTransmission = false;
      return true;
    }
    if (this.pending) return this.continueTransmission(command);

    if (command.controls.U !== "1") return false;

    if (command.action === "q") {
      this.respond(command, true);
      return true;
    }
    if (command.action === "p") {
      const success = this.createPlacement(command);
      this.respond(command, success, success ? undefined : "ENOENT:image not found");
      this.renderer?.refresh();
      return true;
    }
    if (command.action !== "t" && command.action !== "T") {
      this.respond(command, false, "EINVAL:unsupported virtual image action");
      return true;
    }
    if (command.controls.t !== undefined && command.controls.t !== "d") {
      this.respond(command, false, "EINVAL:unsupported transmission medium");
      return true;
    }

    const more = kittyIntegerControl(command, "m") ?? 0;
    if (more === 1) {
      this.pending = {
        command,
        encodedBytes: command.payload.length,
        payload: [command.payload],
      };
      if (this.pending.encodedBytes > KITTY_GRAPHICS_MAX_ENCODED_BYTES) {
        this.failPending("EFBIG:image payload exceeds limit", true);
      }
      return true;
    }
    return this.completeTransmission(command, command.payload);
  }

  private continueTransmission(command: KittyGraphicsCommand): boolean | Promise<boolean> {
    const pending = this.pending!;
    pending.payload.push(command.payload);
    pending.encodedBytes += command.payload.length;
    const more = kittyIntegerControl(command, "m") ?? 0;
    if (pending.encodedBytes > KITTY_GRAPHICS_MAX_ENCODED_BYTES) {
      this.failPending("EFBIG:image payload exceeds limit", more === 1);
      return true;
    }
    if (more === 1) return true;
    this.pending = undefined;
    return this.completeTransmission(pending.command, pending.payload.join(""));
  }

  private async completeTransmission(
    command: KittyGraphicsCommand,
    payload: string,
  ): Promise<boolean> {
    const imageId = kittyIntegerControl(command, "i");
    if (!validId(imageId) || payload.length === 0) {
      this.respond(command, false, "EINVAL:image id and payload are required");
      return true;
    }
    try {
      const source = await this.decodeImage(command, payload);
      this.storeImage(imageId, source, kittyIntegerControl(command, "I"));
      let placementCreated = true;
      if (command.action === "T") placementCreated = this.createPlacement(command);
      if (!placementCreated) {
        this.respond(command, false, "EINVAL:virtual placement dimensions are required");
      } else {
        this.respond(command, true);
      }
      this.renderer?.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.respond(command, false, `EINVAL:${message}`);
    }
    return true;
  }

  private storeImage(imageId: number, source: KittyImageSource, imageNumber?: number): void {
    this.images.get(imageId)?.source.close?.();
    this.images.delete(imageId);
    this.placements.delete(imageId);
    this.images.set(imageId, { imageNumber, source });
    while (this.images.size > KITTY_GRAPHICS_MAX_STORED_IMAGES) {
      const oldest = this.images.keys().next().value;
      if (oldest === undefined) break;
      this.removeImage(oldest);
    }
  }

  private createPlacement(command: KittyGraphicsCommand): boolean {
    const imageId = kittyIntegerControl(command, "i");
    const columns = kittyIntegerControl(command, "c");
    const rows = kittyIntegerControl(command, "r");
    if (!validId(imageId) || !this.images.has(imageId)) return false;
    if (!validDimension(columns) || !validDimension(rows)) return false;
    const placementId = kittyIntegerControl(command, "p") ?? 0;
    const placements = this.placements.get(imageId) ?? new Map();
    placements.set(placementId, {
      columns,
      imageId,
      placementId,
      rows,
      zIndex: kittyIntegerControl(command, "z") ?? 0,
    });
    this.placements.set(imageId, placements);
    return true;
  }

  private resolve(
    imageId: number,
    placementId: number,
  ): { image: KittyStoredImage; placement: KittyVirtualPlacement } | undefined {
    const image = this.images.get(imageId);
    const placements = this.placements.get(imageId);
    if (!image || !placements) return undefined;
    const placement =
      (placementId === 0 ? undefined : placements.get(placementId)) ??
      placements.values().next().value;
    return placement ? { image, placement } : undefined;
  }

  private delete(command: KittyGraphicsCommand): void {
    const selector = command.controls.d ?? "a";
    const freeImageData = selector === selector.toUpperCase();
    const normalized = selector.toLowerCase();
    if (normalized === "a") {
      this.placements.clear();
      if (freeImageData) {
        for (const imageId of [...this.images.keys()]) this.removeImage(imageId);
      }
    } else if (normalized === "i") {
      const imageId = kittyIntegerControl(command, "i");
      if (!validId(imageId)) return;
      const placementId = kittyIntegerControl(command, "p");
      if (placementId === undefined) {
        this.placements.delete(imageId);
      } else {
        const placements = this.placements.get(imageId);
        placements?.delete(placementId);
        if (placements?.size === 0) this.placements.delete(imageId);
      }
      if (freeImageData && !this.placements.has(imageId)) this.removeImage(imageId);
    } else if (normalized === "r") {
      const first = kittyIntegerControl(command, "x") ?? 0;
      const last = kittyIntegerControl(command, "y") ?? KITTY_GRAPHICS_IMAGE_ID_MAX;
      for (const imageId of [...this.images.keys()]) {
        if (imageId < first || imageId > last) continue;
        this.placements.delete(imageId);
        if (freeImageData) this.removeImage(imageId);
      }
    } else if (normalized === "n") {
      const imageNumber = kittyIntegerControl(command, "I");
      if (imageNumber === undefined) return;
      const matching = [...this.images.entries()].filter(
        ([, image]) => image.imageNumber === imageNumber,
      );
      const newest = matching.at(-1)?.[0];
      if (newest !== undefined) {
        const placementId = kittyIntegerControl(command, "p");
        if (placementId === undefined) {
          this.placements.delete(newest);
        } else {
          const placements = this.placements.get(newest);
          placements?.delete(placementId);
          if (placements?.size === 0) this.placements.delete(newest);
        }
        if (freeImageData && !this.placements.has(newest)) this.removeImage(newest);
      }
    }
    this.renderer?.refresh();
  }

  private removeImage(imageId: number): void {
    this.images.get(imageId)?.source.close?.();
    this.images.delete(imageId);
    this.placements.delete(imageId);
  }

  private failPending(message: string, discardUntilFinal: boolean): void {
    const command = this.pending?.command;
    this.pending = undefined;
    this.discardingTransmission = discardUntilFinal;
    if (command) this.respond(command, false, message);
  }

  private respond(command: KittyGraphicsCommand, success: boolean, error?: string): void {
    const quiet = kittyIntegerControl(command, "q") ?? 0;
    if ((success && quiet >= 1) || (!success && quiet >= 2)) return;
    const imageId = kittyIntegerControl(command, "i") ?? 0;
    const placementId = kittyIntegerControl(command, "p");
    const placement = placementId === undefined ? "" : `,p=${placementId}`;
    this.terminal?.input(
      `\x1b_Gi=${imageId}${placement};${success ? "OK" : (error ?? "EINVAL")}\x1b\\`,
      false,
    );
  }

  private reset(): void {
    this.discardingTransmission = false;
    this.pending = undefined;
    for (const image of this.images.values()) image.source.close?.();
    this.images.clear();
    this.placements.clear();
    this.renderer?.refresh();
  }
}
