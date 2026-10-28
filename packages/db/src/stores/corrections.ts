import { asc, eq } from "drizzle-orm";
import type { Correction, CorrectionStore } from "@fluffdesk/core";
import type { Db } from "../client.js";
import { corrections } from "../schema.js";

export class PgCorrectionStore implements CorrectionStore {
  constructor(private readonly db: Db) {}

  async add(c: Correction): Promise<void> {
    await this.db.insert(corrections).values({
      id: c.id,
      shopSlug: c.shopSlug,
      conversationId: c.conversationId,
      traceId: c.traceId ?? null,
      kind: c.kind,
      original: c.original ?? null,
      corrected: c.corrected ?? null,
      note: c.note ?? null,
      correctedBy: c.by,
      createdAt: new Date(c.createdAt),
    });
  }

  async list(shopSlug: string): Promise<Correction[]> {
    const rows = await this.db.select().from(corrections).where(eq(corrections.shopSlug, shopSlug)).orderBy(asc(corrections.createdAt));
    return rows.map((r) => ({
      id: r.id,
      shopSlug: r.shopSlug,
      conversationId: r.conversationId,
      traceId: r.traceId ?? undefined,
      kind: r.kind,
      original: r.original,
      corrected: r.corrected,
      note: r.note ?? undefined,
      by: r.correctedBy,
      createdAt: r.createdAt.toISOString(),
    }));
  }
}
