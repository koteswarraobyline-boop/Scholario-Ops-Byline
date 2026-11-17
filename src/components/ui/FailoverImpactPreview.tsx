import React, { useEffect, useState } from 'react';
import type { ImpactPreview } from '../../types';
import { api } from '../../services/api';
import { ImpactPreviewCard } from './ImpactPreviewCard';

/** Loads Impact Analysis for the environment we are leaving during a DNS failover. */
export const FailoverImpactPreview: React.FC<{
  applicationId: string;
  /** Direction of the switch: DR means leaving PRD; PRIMARY means leaving DR. */
  target: 'DR' | 'PRIMARY';
  isDark: boolean;
}> = ({ applicationId, target, isDark }) => {
  const [preview, setPreview] = useState<ImpactPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const sourceEnv = target === 'DR' ? 'PRD' : 'DR';

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.getImpactPreview({ applicationId, environment: sourceEnv })
      .then(p => { if (!cancelled) setPreview(p); })
      .catch(err => { if (!cancelled) { setPreview(null); setError(err instanceof Error ? err.message : 'Preview failed'); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [applicationId, sourceEnv]);

  return (
    <ImpactPreviewCard
      preview={preview}
      loading={loading}
      error={error}
      isDark={isDark}
      title={sourceEnv === 'PRD' ? 'What will break if Production goes down' : 'What will break if DR goes down'}
    />
  );
};
