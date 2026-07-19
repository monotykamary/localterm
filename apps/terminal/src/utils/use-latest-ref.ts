import { useLayoutEffect, useRef } from "react";

export const useLatestRef = <Value>(value: Value) => {
  const valueRef = useRef(value);
  useLayoutEffect(() => {
    valueRef.current = value;
  }, [value]);
  return valueRef;
};
