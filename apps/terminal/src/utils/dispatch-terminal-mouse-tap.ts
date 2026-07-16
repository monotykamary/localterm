interface TerminalMouseTapCoordinates {
  clientX: number;
  clientY: number;
}

export const dispatchTerminalMouseTap = (
  target: HTMLElement,
  { clientX, clientY }: TerminalMouseTapCoordinates,
): void => {
  target.dispatchEvent(
    new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      clientX,
      clientY,
      button: 0,
      buttons: 1,
      detail: 1,
    }),
  );
  target.dispatchEvent(
    new MouseEvent("mouseup", {
      bubbles: true,
      cancelable: true,
      clientX,
      clientY,
      button: 0,
      buttons: 0,
      detail: 1,
    }),
  );
};
