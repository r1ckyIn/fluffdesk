"use client";
import { createContext, useContext } from "react";
import type { GroomerSession } from "./session";
import type { Booking, ShopConfig } from "./types";

export interface GroomerContextValue {
  session: GroomerSession;
  shop: ShopConfig;
  setShop: (shop: ShopConfig) => void;
  /** 待确认队列，布局层每 30 秒拉一次；null = 还没拉到 */
  pending: Booking[] | null;
  refreshPending: () => Promise<void>;
  /** 本地先把决定过的那条拿掉，不等下一次轮询 */
  dropPending: (id: string) => void;
  /** 401 时调：清会话回登录页 */
  signOut: () => void;
}

export const GroomerContext = createContext<GroomerContextValue | null>(null);

export function useGroomer(): GroomerContextValue {
  const v = useContext(GroomerContext);
  if (!v) throw new Error("useGroomer outside the groomer layout");
  return v;
}
