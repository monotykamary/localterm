export const isScrolledToBottom = (element: HTMLElement, thresholdPx: number): boolean =>
  element.scrollHeight - element.scrollTop - element.clientHeight <= thresholdPx;
