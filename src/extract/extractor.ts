/**
 * Queue in front of the hidden extractor WebView (see ExtractorHost). Readability
 * runs in Chromium's V8 with a real DOMParser instead of on the Hermes JS thread,
 * so large pages never stall scrolling or gestures.
 */
export type Extracted = { title: string | null; byline: string | null; content: string; length: number };

type Job = {
  id: string;
  html: string;
  url: string;
  resolve: (value: Extracted | null) => void;
  timer?: ReturnType<typeof setTimeout>;
};

type Runner = (job: { id: string; html: string; url: string }) => void;

const MAX_HTML = 2 * 1024 * 1024;
const JOB_TIMEOUT = 20000;

let runner: Runner | null = null;
const queue: Job[] = [];
let active: Job | null = null;
let seq = 0;

const readyWaiters = new Set<() => void>();

export function attachRunner(next: Runner | null) {
  runner = next;
  if (runner) {
    for (const wake of [...readyWaiters]) wake();
    pump();
  }
}

/**
 * Resolves true once the hidden extractor WebView is attached, or false after
 * `timeoutMs`. It never attaches in a headless (background) run, and briefly
 * not at all during a cold start or a WebView reload.
 */
export function whenExtractorReady(timeoutMs: number): Promise<boolean> {
  if (runner) return Promise.resolve(true);
  return new Promise((resolve) => {
    const done = (ready: boolean) => {
      readyWaiters.delete(wake);
      clearTimeout(timer);
      resolve(ready);
    };
    const wake = () => done(true);
    const timer = setTimeout(() => done(false), timeoutMs);
    readyWaiters.add(wake);
  });
}

/** Called by the host when the WebView posts a result. */
export function completeJob(id: string, result: Extracted | null) {
  if (!active || active.id !== id) return;
  const job = active;
  active = null;
  clearTimeout(job.timer);
  job.resolve(result && result.length > 0 ? result : null);
  pump();
}

/** Called by the host if the WebView crashes or reloads mid-job. */
export function failActiveJob() {
  if (active) completeJob(active.id, null);
}

function pump() {
  if (active || !runner) return;
  const job = queue.shift();
  if (!job) return;
  active = job;
  job.timer = setTimeout(() => completeJob(job.id, null), JOB_TIMEOUT);
  runner({ id: job.id, html: job.html, url: job.url });
}

/** `priority` puts the job at the front: the user is waiting for this article. */
export function extractArticle(html: string, url: string, opts: { priority?: boolean } = {}): Promise<Extracted | null> {
  if (html.length > MAX_HTML) html = html.slice(0, MAX_HTML);
  return new Promise((resolve) => {
    const job = { id: String(++seq), html, url, resolve };
    if (opts.priority) queue.unshift(job);
    else queue.push(job);
    pump();
  });
}
