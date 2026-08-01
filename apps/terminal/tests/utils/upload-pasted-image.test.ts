import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { PASTED_IMAGE_UPLOAD_TIMEOUT_MS } from "../../src/lib/constants";
import { uploadPastedImage } from "../../src/utils/upload-pasted-image";

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("uploadPastedImage", () => {
  it("uploads multipart image data and returns the path", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ path: "/tmp/pasted.png" }, 201));

    await expect(
      uploadPastedImage("session-id", new Blob(["png"], { type: "image/png" }), "shot.png"),
    ).resolves.toBe("/tmp/pasted.png");

    const requestUrl = new URL(String(fetchSpy.mock.calls[0]?.[0]));
    expect(requestUrl.searchParams.get("sid")).toBe("session-id");
    const requestOptions = fetchSpy.mock.calls[0]?.[1];
    expect(Reflect.get(requestOptions ?? {}, "method")).toBe("POST");
    expect(Reflect.get(requestOptions ?? {}, "body")).toBeInstanceOf(FormData);
    expect(Reflect.get(requestOptions ?? {}, "signal")).toBeInstanceOf(AbortSignal);
  });

  it("maps server error codes to user-facing messages", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ error: "unsupported_type" }, 415),
    );

    await expect(
      uploadPastedImage("session-id", new Blob(["svg"], { type: "image/svg+xml" })),
    ).rejects.toThrow("Unsupported image type");
  });

  it("rejects malformed successful responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({}, 201));

    await expect(
      uploadPastedImage("session-id", new Blob(["png"], { type: "image/png" })),
    ).rejects.toThrow("Invalid upload response");
  });

  it("aborts an upload that exceeds the timeout", async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_input, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );

    const upload = uploadPastedImage("session-id", new Blob(["png"], { type: "image/png" }));
    const expectation = expect(upload).rejects.toThrow("Image upload timed out");
    await vi.advanceTimersByTimeAsync(PASTED_IMAGE_UPLOAD_TIMEOUT_MS);
    await expectation;
  });

  it("forwards caller cancellation", async () => {
    const controller = new AbortController();
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_input, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );

    const upload = uploadPastedImage(
      "session-id",
      new Blob(["png"], { type: "image/png" }),
      "image.png",
      { signal: controller.signal },
    );
    const expectation = expect(upload).rejects.toThrow("Image upload canceled");
    controller.abort();
    await expectation;
  });
});
