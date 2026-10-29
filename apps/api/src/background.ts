/**
 * 回了 HTTP 响应之后还在跑的活（渠道 webhook 先回 200 再跑模型）。
 * 关停时要等它们跑完再关连接池，否则会话存不进去、客人收不到回复，而 Meta 已经拿到 200 不会重发。
 * 每个任务自己兜错误；这里只记日志，不让一个任务的异常变成 unhandled rejection。
 */
export class BackgroundTasks {
  private readonly running = new Set<Promise<void>>();

  track(task: Promise<void>): void {
    const wrapped = task.catch((e: unknown) => console.error(`[background] ${(e as Error).message}`)).finally(() => this.running.delete(wrapped));
    this.running.add(wrapped);
  }

  /** 等当前所有任务结束，包括等待期间新加进来的 */
  async drain(): Promise<void> {
    while (this.running.size > 0) await Promise.all([...this.running]);
  }

  get size(): number {
    return this.running.size;
  }
}
