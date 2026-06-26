import { useState, useEffect, useRef } from 'react';

/**
 * IntersectionObserver hook — 当元素进入可视区时 visible 变为 true
 * @param {{ rootMargin?: string, threshold?: number }} opts
 * @returns {{ ref: React.RefObject, visible: boolean }}
 */
export default function useLazyLoad(opts = {}) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: opts.rootMargin || '200px', threshold: opts.threshold || 0 },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [opts.rootMargin, opts.threshold]);

  return { ref, visible };
}
