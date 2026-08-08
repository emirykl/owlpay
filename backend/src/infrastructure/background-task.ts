import { waitUntil } from '@vercel/functions';

export function runAfterResponse(task: Promise<unknown>) {
  if (process.env.VERCEL === '1') {
    waitUntil(task);
    return;
  }
  task.catch((error: unknown) => {
    console.error('[background-task] Unhandled rejection:', error);
  });
}
