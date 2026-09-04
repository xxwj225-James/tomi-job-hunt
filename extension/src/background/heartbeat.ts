/**
 * MV3 SW lifetime management. A chrome.alarms tick wakes the service worker
 * on the minimum ~30s cadence even when idle: while the gateway socket is
 * open we ping (keeps lastSeen fresh), and if it dropped (SW was killed /
 * core restarted) we reconnect — re-registering sessions via hello so the
 * gateway can flush anything buffered for us.
 */
import { isOpen, open, ping } from './ws-client.js';

const ALARM_NAME = 'tomi-agent-hb';

export function startHeartbeat(): void {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== ALARM_NAME) return;
    if (isOpen()) ping();
    else open();
  });
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 0.5 });
}
