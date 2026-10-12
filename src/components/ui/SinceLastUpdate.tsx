import React, { useEffect, useState } from 'react';
import { useOps } from '../../context/OpsContext';

/**
 * "12s ago" since the last realtime event. Ticks on its own once a second, so only this text
 * re-renders — the time used to live in the shared context and re-rendered every view each second.
 */
export const SinceLastUpdate: React.FC = () => {
  const { lastEventAtRef } = useOps();
  const read = () => Math.max(0, Math.floor((Date.now() - (lastEventAtRef.current ?? Date.now())) / 1000));
  const [seconds, setSeconds] = useState(read);
  useEffect(() => {
    const t = setInterval(() => setSeconds(read()), 1000);
    return () => clearInterval(t);
  }, []);
  return <>{seconds}s ago</>;
};
