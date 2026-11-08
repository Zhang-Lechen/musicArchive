import { useEffect, useState } from 'react';

export function useDebounced<T>(value: T, milliseconds = 200) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), milliseconds);
    return () => clearTimeout(timer);
  }, [value, milliseconds]);
  return debounced;
}
