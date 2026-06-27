import { QRCodeCanvas } from "qrcode.react";
import { CameraOff, Check, Copy, QrCode, ScanLine, Share2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import {
  COMMAND_PALETTE_BACKDROP_CLASSES,
  COMMAND_PALETTE_PANEL_CLASSES,
  MODAL_PANEL_CLASSES,
} from "@/lib/animation-classes";
import {
  COPY_FEEDBACK_MS,
  QR_CODE_MARGIN_MODULES,
  QR_CODE_SIZE_PX,
  QR_MODAL_CLOSE_TRANSITION_MS,
} from "@/lib/constants";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { useQrScanner, type QrScannerStatus } from "@/hooks/use-qr-scanner";
import { buildSessionShareUrl } from "@/utils/build-session-share-url";
import { extractSessionIdFromQr } from "@/utils/extract-session-id-from-qr";

type QrMode = "share" | "ingest";

interface QrModalProps {
  open: boolean;
  liveSessionIdRef: RefObject<string | null>;
  switchSessionRef: RefObject<((sid: string) => void) | null>;
  onClose: () => void;
}

const MODES = ["share", "ingest"] as const satisfies readonly QrMode[];

const STATUS_COPY: Record<QrScannerStatus, string> = {
  idle: "Starting camera…",
  starting: "Starting camera…",
  scanning: "Point at another device's session QR.",
  denied: "Camera permission was denied.",
  unavailable: "No camera found on this device.",
  failed: "Couldn't start the camera.",
};

const ModeToggle = ({ mode, onChange }: { mode: QrMode; onChange: (mode: QrMode) => void }) => (
  <div
    role="tablist"
    aria-label="QR mode"
    className="flex gap-1 rounded-lg bg-muted/40 p-1 text-xs"
  >
    {MODES.map((value) => {
      const active = mode === value;
      const Icon = value === "share" ? Share2 : ScanLine;
      return (
        <button
          key={value}
          role="tab"
          type="button"
          aria-selected={active}
          onClick={() => onChange(value)}
          className={cn(
            "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 capitalize transition-colors",
            active
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon className="size-3.5" aria-hidden="true" />
          {value}
        </button>
      );
    })}
  </div>
);

interface SharePanelProps {
  shareUrl: string | null;
  hasCopied: boolean;
  onCopy: () => void;
}

const SharePanel = ({ shareUrl, hasCopied, onCopy }: SharePanelProps) => {
  if (!shareUrl) {
    return (
      <div className="flex flex-col items-center gap-2 px-2 py-8 text-center text-sm text-muted-foreground/70">
        <QrCode className="size-6 opacity-50" aria-hidden="true" />
        No live session to share yet.
        <span className="text-[11px] text-muted-foreground/60">
          A QR appears here once this tab's shell has started.
        </span>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="rounded-lg bg-white p-2 shadow-sm">
        <QRCodeCanvas
          value={shareUrl}
          size={QR_CODE_SIZE_PX}
          level="M"
          marginSize={QR_CODE_MARGIN_MODULES}
          bgColor="#ffffff"
          fgColor="#000000"
          className="block"
          aria-label="session share QR code"
        />
      </div>
      <p className="text-center text-[11px] text-muted-foreground/70">
        Scan with the localterm PWA on another device to take over this shell.
      </p>
      <InputGroup>
        <InputGroupInput
          readOnly
          value={shareUrl}
          aria-label="session share url"
          className="font-mono text-xs"
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            size="icon-xs"
            onClick={onCopy}
            aria-label={hasCopied ? "Copied" : "Copy share link"}
          >
            {hasCopied ? <Check /> : <Copy />}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </div>
  );
};

interface IngestPanelProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  status: QrScannerStatus;
}

const IngestPanel = ({ videoRef, status }: IngestPanelProps) => {
  const isError = status === "denied" || status === "unavailable" || status === "failed";
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative aspect-square w-full max-w-[240px] overflow-hidden rounded-lg bg-black/80">
        <video
          ref={videoRef}
          muted
          playsInline
          autoPlay
          className="size-full object-cover"
          aria-label="camera preview"
        />
        {isError ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/70">
            <CameraOff className="size-8 text-muted-foreground/60" aria-hidden="true" />
          </div>
        ) : null}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-3 rounded-lg border border-white/40"
        />
      </div>
      <div className="flex min-h-[1.25rem] items-center gap-1.5 text-[11px] text-muted-foreground/80">
        {status === "starting" || status === "idle" ? (
          <Spinner
            className="size-3"
            aria-hidden="true"
            role="presentation"
            aria-label={undefined}
          />
        ) : isError ? (
          <CameraOff className="size-3.5" aria-hidden="true" />
        ) : (
          <ScanLine className="size-3.5" aria-hidden="true" />
        )}
        <span>{STATUS_COPY[status]}</span>
      </div>
    </div>
  );
};

export const QrModal = ({ open, liveSessionIdRef, switchSessionRef, onClose }: QrModalProps) => {
  const [mounted, setMounted] = useState(false);
  const [settled, setSettled] = useState(false);
  const [mode, setMode] = useState<QrMode>("share");
  const [liveSessionId, setLiveSessionId] = useState<string | null>(null);
  const [hasCopiedShareUrl, setHasCopiedShareUrl] = useState(false);
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (open) {
      setMode("share");
      setLiveSessionId(liveSessionIdRef.current);
      setHasCopiedShareUrl(false);
      setMounted(true);
      const frame = requestAnimationFrame(() => setSettled(true));
      return () => cancelAnimationFrame(frame);
    }
    setSettled(false);
    if (mounted) {
      const timer = window.setTimeout(() => setMounted(false), QR_MODAL_CLOSE_TRANSITION_MS);
      return () => window.clearTimeout(timer);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [open, onClose]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    };
  }, []);

  const handleDetect = useCallback(
    (data: string) => {
      const sid = extractSessionIdFromQr(data);
      if (!sid) return;
      switchSessionRef.current?.(sid);
      onClose();
    },
    [switchSessionRef, onClose],
  );

  const { videoRef, status: scannerStatus } = useQrScanner({
    enabled: open && mounted && mode === "ingest",
    onDetect: handleDetect,
  });

  const shareUrl = liveSessionId ? buildSessionShareUrl(liveSessionId) : null;

  const handleCopyShareUrl = useCallback(async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setHasCopiedShareUrl(true);
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => setHasCopiedShareUrl(false), COPY_FEEDBACK_MS);
    } catch {
      /* clipboard blocked; the read-only field still allows a manual copy */
    }
  }, [shareUrl]);

  if (!mounted) return null;

  const isVisible = open && settled;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[18vh]">
      <div
        data-open={isVisible || undefined}
        data-closed={!isVisible || undefined}
        className={cn(COMMAND_PALETTE_BACKDROP_CLASSES)}
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-label="share or ingest a session via QR"
        aria-modal
        data-open={isVisible || undefined}
        data-closed={!isVisible || undefined}
        className={cn(
          "relative z-10 flex w-[420px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl origin-top",
          MODAL_PANEL_CLASSES,
          COMMAND_PALETTE_PANEL_CLASSES,
        )}
      >
        <div className="flex items-center justify-between gap-2 border-b border-border/40 px-4 py-2.5">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <QrCode className="size-4 text-muted-foreground" aria-hidden="true" />
            Session QR
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="close"
            className="hover:text-foreground"
            onClick={onClose}
          >
            <X />
          </Button>
        </div>
        <div className="px-4 pt-3">
          <ModeToggle mode={mode} onChange={setMode} />
        </div>
        <div className="px-4 py-3">
          {mode === "share" ? (
            <SharePanel
              shareUrl={shareUrl}
              hasCopied={hasCopiedShareUrl}
              onCopy={handleCopyShareUrl}
            />
          ) : (
            <IngestPanel videoRef={videoRef} status={scannerStatus} />
          )}
        </div>
        <div className="flex items-center border-t border-border/40 px-4 py-1.5 text-[10px] text-muted-foreground/60">
          <kbd className="rounded border border-border/40 bg-muted/30 px-1 font-mono text-[10px]">
            esc
          </kbd>
          <span className="ml-1.5">close</span>
          {mode === "ingest" ? (
            <span className="ml-auto">scans another device's session QR</span>
          ) : null}
        </div>
      </div>
    </div>
  );
};
