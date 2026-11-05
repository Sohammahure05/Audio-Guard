import { useCallback, useEffect, useState } from "react";

export default function useLoad(fn) {
  const [state, set] = useState({ data: null, error: null, loading: true });
  const run = useCallback(() => {
    fn()
      .then((data) => set({ data, error: null, loading: false }))
      .catch((e) => set({ data: null, error: e.message, loading: false }));
  }, []);
  useEffect(run, [run]);
  return { ...state, reload: run };
}
