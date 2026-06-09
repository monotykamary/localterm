// DECSET 1049 (Enter Alternate Screen Buffer) and DECRST 1049 (Exit Alternate
// Screen Buffer) detection from PTY output. These are emitted by TUIs like
// vim, less, htop when they take over the screen, and again when they return
// control to the shell.
//
// Formats:
//   DECSET: CSI ? 1049 h   →  ESC [ ? 1049 h
//   DECRST: CSI ? 1049 l   →  ESC [ ? 1049 l
//
// Returns true if the chunk contains a DECSET 1049h (enter), false if it
// contains a DECRST 1049l (exit), or null if neither is found. When both are
// present, the last one wins — matching the terminal's actual state.

const DECSET_1049 = "\x1b[?1049h";
const DECRST_1049 = "\x1b[?1049l";

export const parseAltScreenFromChunk = (data: string): boolean | null => {
  let result: boolean | null = null;
  let searchFrom = 0;

  while (searchFrom < data.length) {
    const setIndex = data.indexOf(DECSET_1049, searchFrom);
    const rstIndex = data.indexOf(DECRST_1049, searchFrom);

    if (setIndex === -1 && rstIndex === -1) break;

    if (setIndex !== -1 && (rstIndex === -1 || setIndex < rstIndex)) {
      result = true;
      searchFrom = setIndex + DECSET_1049.length;
    } else if (rstIndex !== -1) {
      result = false;
      searchFrom = rstIndex + DECRST_1049.length;
    } else {
      break;
    }
  }

  return result;
};
