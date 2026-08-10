import {
  tokenizeDocuments,
  type SyntaxWorkerRequest,
  type SyntaxWorkerResponse,
} from "../utils/syntax-tokenizer-core";

// This project compiles against the DOM lib only (no WebWorker lib), so the
// worker scope is narrowed structurally instead of via `self`.
interface WorkerScope {
  postMessage(message: SyntaxWorkerResponse): void;
}
const scope = globalThis as unknown as WorkerScope;

addEventListener("message", (event: MessageEvent<SyntaxWorkerRequest>) => {
  const { requestId, request } = event.data;
  void tokenizeDocuments(request)
    .then((result) => scope.postMessage({ requestId, result }))
    .catch(() => scope.postMessage({ requestId, result: null }));
});
