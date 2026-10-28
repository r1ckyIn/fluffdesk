/**
 * 进程内按 key 串行。同一会话两条消息同时到，第二轮要等第一轮存完再读，
 * 否则两轮各自读到同一份历史，后保存的把先保存的盖掉。
 * 单实例够用；多实例时要换成数据库里的锁，接口不变。队列长度由每会话限流兜底。
 */
const tails = new Map<string, Promise<void>>();

export async function withSessionLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = tails.get(key) ?? Promise.resolve();
  const run = prev.then(fn);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  tails.set(key, tail);
  try {
    return await run;
  } finally {
    if (tails.get(key) === tail) tails.delete(key);
  }
}
