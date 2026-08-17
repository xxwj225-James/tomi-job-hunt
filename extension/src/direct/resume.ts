/**
 * Resume storage for direct mode — pasted once in the options page, kept in
 * chrome.storage.local (never leaves the browser). Core mode instead reads
 * ~/.tomi-job-hunt/resume.md on the Core side.
 */

export const RESUME_KEY = 'tomihunt-resume';

export async function loadResume(): Promise<string | undefined> {
  const data = await chrome.storage.local.get(RESUME_KEY);
  const resume = data[RESUME_KEY] as string | undefined;
  return resume?.trim() || undefined;
}

export async function saveResume(resume: string): Promise<void> {
  await chrome.storage.local.set({ [RESUME_KEY]: resume });
}
