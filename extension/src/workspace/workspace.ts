/**
 * 工作台页（workspace.html）入口 — 3 个 tab 各自挂载独立视图。
 * 所有求职者新功能均 direct-mode（chrome.storage.local + directChat）。
 */
import { mountBoard } from './board-view.js';
import { mountVersions } from './versions-view.js';
import { mountMock } from './mock-view.js';

function initWorkspace(): void {
  const tabs = document.querySelectorAll<HTMLButtonElement>('.tabs button[data-tab]');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const name = tab.dataset.tab ?? 'board';
      tabs.forEach((t) => t.classList.toggle('active', t === tab));
      document.querySelectorAll<HTMLElement>('.tab').forEach((el) => el.classList.toggle('active', el.id === `tab-${name}`));
    });
  });

  mountBoard();
  mountVersions();
  mountMock();
}

initWorkspace();
