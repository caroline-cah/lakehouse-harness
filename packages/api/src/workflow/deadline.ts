/**
 * Resolves with the promise, or rejects with `message` once `ms` have passed. The timer is always cleared, so a Lambda
 * never stays alive waiting on a deadline that no longer matters.
 */
export async function withDeadline<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  try {
    return await Promise.race([promise, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export const seconds = (ms: number): string => `${Math.round(ms / 1000)} s`;
