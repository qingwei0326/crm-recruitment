import { useEffect, useRef } from 'react';

/**
 * 保存一个"最新值"的 ref，用于在 effect 中读取最新函数/状态而不把值本身
 * 变成 effect 依赖。典型场景：挂载时加载一次的 effect 需要调用定义在组件里的
 * fetch 函数——该函数每次渲染都是新引用，直接放进 deps 会导致 effect 反复重跑。
 */
export default function useLatestRef(value) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}
