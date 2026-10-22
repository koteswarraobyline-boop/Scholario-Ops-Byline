import { useEffect, useState } from 'react';
import { useOps } from '../../context/OpsContext';
import { api } from '../../services/api';
import type { NotificationDeliveryStats } from '../../types';

/** A cheap signature of channel delivery state: changes whenever any channel delivers (live via SSE) */
export const deliverySignature = (channels: Array<{ id: string; lastDeliveryAt: string; failureCount: number }>) =>
  channels.map(c => `${c.id}:${c.lastDeliveryAt}:${c.failureCount}`).join('|');

/** Delivered / failed per channel in the last 24 h (operators+), refreshed after every delivery */
export function useDeliveryStats(enabled: boolean): NotificationDeliveryStats | null {
  const { communicationChannels } = useOps();
  const [stats, setStats] = useState<NotificationDeliveryStats | null>(null);
  const sig = deliverySignature(communicationChannels);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    api.getNotificationStats().then(s => { if (alive) setStats(s); }).catch(() => { /* stats are optional */ });
    return () => { alive = false; };
  }, [enabled, sig]);
  return stats;
}

/** Fired after the user changes read state, so the sidebar badge updates without waiting for a delivery */
export const UNREAD_CHANGED = 'scholario:notifications-read-changed';

/** Unread notifications of the signed-in user (operators+); updates live after deliveries and read changes */
export function useUnreadNotifications(enabled: boolean): { unread: number; unreadFailed: number } | null {
  const { communicationChannels } = useOps();
  const [counts, setCounts] = useState<{ unread: number; unreadFailed: number } | null>(null);
  const [tick, setTick] = useState(0);
  const sig = deliverySignature(communicationChannels);
  useEffect(() => {
    const bump = () => setTick(t => t + 1);
    window.addEventListener(UNREAD_CHANGED, bump);
    return () => window.removeEventListener(UNREAD_CHANGED, bump);
  }, []);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    api.getUnreadNotifications().then(c => { if (alive) setCounts(c); }).catch(() => { /* badge is optional */ });
    return () => { alive = false; };
  }, [enabled, sig, tick]);
  return enabled ? counts : null;
}

