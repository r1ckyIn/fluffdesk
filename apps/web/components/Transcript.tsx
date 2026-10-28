"use client";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useGroomer } from "@/lib/groomer-context";
import { useLocale } from "@/lib/i18n";
import type { ConversationView } from "@/lib/types";

/** 客人和 agent 的往来：文字 + 客人发的照片。图片接口要带令牌，所以取回来做成 blob URL，组件卸载时释放 */
export function Transcript({ conversationId, onImages }: { conversationId: string; onImages?: (urls: string[]) => void }) {
  const { session } = useGroomer();
  const { t } = useLocale();
  const [view, setView] = useState<ConversationView | null | undefined>(undefined);
  const [urls, setUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    let alive = true;
    const created: string[] = [];
    setView(undefined);
    setUrls({});
    api
      .conversation(session, conversationId)
      .then(async (v) => {
        if (!alive) return;
        setView(v);
        const next: Record<string, string> = {};
        for (const id of v.images) {
          try {
            const u = await api.imageBlob(session, conversationId, id);
            if (!alive) {
              URL.revokeObjectURL(u);
              return;
            }
            created.push(u);
            next[id] = u;
          } catch {
            /* 图片可能已清掉 */
          }
        }
        setUrls(next);
        onImages?.(Object.values(next));
      })
      .catch((e) => alive && setView(e instanceof ApiError && e.status === 404 ? null : null));
    return () => {
      alive = false;
      for (const u of created) URL.revokeObjectURL(u);
    };
    // onImages 每次渲染都是新函数，不进依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, conversationId]);

  if (view === undefined) return <p className="muted">{t("chat.loading")}</p>;
  if (view === null) return <p className="muted">{t("chat.gone")}</p>;
  return (
    <div className="chat">
      {view.entries.map((e, i) => {
        if (e.role === "tool") {
          return (
            <div key={i} className={`msg-tool${e.tool?.isError ? " is-error" : ""}`}>
              {t("chat.agent")} {t("chat.tool")} {e.tool?.name}: {e.text}
            </div>
          );
        }
        return (
          <div key={i} className={`msg msg-${e.role} text`}>
            {e.text}
            {e.imageIds && e.imageIds.length > 0 && (
              <div className="imgs">
                {e.imageIds.map((id) =>
                  urls[id] ? <img key={id} src={urls[id]} alt={t("chat.photo")} /> : <span key={id} className="pet-photos"><span className="gone">{t("chat.photoGone")}</span></span>,
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
