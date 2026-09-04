/**
 * Extension agent service worker (MV3).
 *
 * Bootstraps the /agent gateway client (role 'agent'), the chat-session
 * registry, dispatch forwarding into chat tabs, and the heartbeat alarm.
 * On every socket (re)open we hello with the current sessionIds — the gateway
 * re-binds those sessions to this connection and flushes any offline-buffered
 * sends, which is the whole wake-the-extension-send loop.
 */
import { onMessage, open, sendHello, setOpenHandler } from './ws-client.js';
import {
  installMessageListener,
  installTabListeners,
  listSessionIds,
  loadSessions,
  pruneClosedTabs,
  syncChatTabs,
} from './sessions.js';
import { handleDispatch } from './dispatch.js';
import { startHeartbeat } from './heartbeat.js';

function boot(): void {
  onMessage((msg) => {
    if (msg.type === 'dispatch') handleDispatch(msg);
    // pong is a heartbeat echo — nothing to do.
  });

  installMessageListener();
  installTabListeners();
  setOpenHandler(() => sendHello(listSessionIds()));
  startHeartbeat();

  // Re-register after a cold SW start / extension update / browser launch:
  // restore the persisted session map, drop tabs that are gone, reconnect
  // (hello re-registers survivors), then ask chat tabs to re-announce in case
  // they reported into a previous SW lifetime.
  const resync = (): void => {
    void (async () => {
      await loadSessions();
      await pruneClosedTabs();
      open();
      await syncChatTabs();
    })();
  };

  chrome.runtime.onStartup.addListener(resync);
  chrome.runtime.onInstalled.addListener(resync);
  resync();
}

boot();
