import jsQR from "jsqr";
import { useEffect, useRef, useState, type RefObject } from "react";
import { QR_SCAN_DECODE_INTERVAL_MS, QR_SCAN_DECODE_MAX_EDGE_PX } from "@/lib/constants";

export type QrScannerStatus =
  | "idle"
  | "starting"
  | "scanning"
  | "denied"
  | "unavailable"
  | "failed";

interface UseQrScannerOptions {
  enabled: boolean;
  onDetect: (data: string) => void;
}

interface UseQrScannerResult {
  videoRef: RefObject<HTMLVideoElement | null>;
  status: QrScannerStatus;
}

// Camera-backed QR decoder for the ingest mode. Owns the getUserMedia stream,
// a hidden capture canvas, and a requestAnimationFrame loop that downscales
// each frame and hands it to jsQR. Only fires onDetect when the decoded text
// changes, so a QR held in view (valid or not) triggers once and the consumer
// can ignore non-session payloads without the loop spamming. Stops the stream
// and cancels the frame loop on disable/unmount so the camera light turns off
// the instant the modal closes or switches to Share.
export const useQrScanner = ({ enabled, onDetect }: UseQrScannerOptions): UseQrScannerResult => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [status, setStatus] = useState<QrScannerStatus>("idle");
  const onDetectRef = useRef(onDetect);
  useEffect(() => {
    onDetectRef.current = onDetect;
  }, [onDetect]);

  useEffect(() => {
    if (!enabled) {
      setStatus("idle");
      return;
    }
    let cancelled = false;
    let stream: MediaStream | null = null;
    let frameId: number | null = null;
    let lastData: string | null = null;
    let lastDecodeAt = 0;
    const captureCanvas = document.createElement("canvas");
    const captureContext = captureCanvas.getContext("2d", { willReadFrequently: true });
    setStatus("starting");

    const stop = () => {
      if (frameId !== null) cancelAnimationFrame(frameId);
      frameId = null;
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
    };

    const tick = () => {
      if (cancelled) return;
      const video = videoRef.current;
      if (video && stream && captureContext && video.readyState >= 2) {
        const now = performance.now();
        if (now - lastDecodeAt >= QR_SCAN_DECODE_INTERVAL_MS) {
          lastDecodeAt = now;
          const sourceWidth = video.videoWidth;
          const sourceHeight = video.videoHeight;
          if (sourceWidth && sourceHeight) {
            const scale = Math.min(
              1,
              QR_SCAN_DECODE_MAX_EDGE_PX / Math.max(sourceWidth, sourceHeight),
            );
            captureCanvas.width = Math.round(sourceWidth * scale);
            captureCanvas.height = Math.round(sourceHeight * scale);
            captureContext.drawImage(video, 0, 0, captureCanvas.width, captureCanvas.height);
            const imageData = captureContext.getImageData(
              0,
              0,
              captureCanvas.width,
              captureCanvas.height,
            );
            const code = jsQR(imageData.data, captureCanvas.width, captureCanvas.height);
            if (code?.data && code.data !== lastData) {
              lastData = code.data;
              onDetectRef.current(code.data);
            }
          }
        }
      }
      frameId = requestAnimationFrame(tick);
    };

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        if (!cancelled) setStatus("unavailable");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        const video = videoRef.current;
        if (!video) {
          stop();
          return;
        }
        video.srcObject = stream;
        await video.play().catch(() => {});
        if (cancelled) return;
        setStatus("scanning");
        frameId = requestAnimationFrame(tick);
      } catch (error) {
        if (cancelled) return;
        const name = error instanceof DOMException ? error.name : "";
        if (name === "NotAllowedError" || name === "SecurityError") {
          setStatus("denied");
        } else if (name === "NotFoundError" || name === "OverconstrainedError") {
          setStatus("unavailable");
        } else {
          setStatus("failed");
        }
      }
    };

    void start();

    return () => {
      cancelled = true;
      stop();
    };
  }, [enabled]);

  return { videoRef, status };
};
