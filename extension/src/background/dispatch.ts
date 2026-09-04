/**
 * gateway dispatch{requestId,targetId,text} → forward into the content agent
 * living on the tab that owns that targetId. The content script answers with
 * a tomi-ack over runtime messaging (relayed to the gateway in sessions.ts);
 * if no tab is registered we ack immediately with an error so the console
 * gets a reason instead of waiting out the gateway's Ack clock.
 */
import { sendAck, type DispatchMsg } from './ws-client.js';
import { tabIdFor } from './sessions.js';

export function handleDispatch(msg: DispatchMsg): void {
  const { requestId, targetId, text } = msg;
  const tabId = tabIdFor(targetId);
  if (tabId === undefined) {
    sendAck({ type: 'ack', requestId, ok: false, error: '聊天页未在线' });
    return;
  }
  chrome.tabs
    .sendMessage(tabId, { type: 'tomihunt-dispatch', requestId, targetId, text })
    .catch(() => {
      // No receiver (tab gone or extension just reloaded) — fail fast.
      sendAck({ type: 'ack', requestId, ok: false, error: '聊天页已关闭或无插件' });
    });
}
