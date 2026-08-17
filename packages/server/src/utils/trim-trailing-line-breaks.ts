export const trimTrailingLineBreaks = (value: string): string => {
  let end = value.length;
  while (end > 0) {
    const character = value[end - 1];
    if (character !== "\r" && character !== "\n") break;
    end -= 1;
  }
  return end === value.length ? value : value.slice(0, end);
};
