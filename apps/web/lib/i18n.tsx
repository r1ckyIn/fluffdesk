"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Locale = "en" | "zh";

/** 美容师端全部文案。键名按"在哪里.说什么"起，中英都写全，缺一个 TypeScript 会报 */
const STRINGS = {
  "app.name": { en: "fluffdesk", zh: "fluffdesk" },
  "nav.inbox": { en: "Waiting for you", zh: "待确认" },
  "nav.history": { en: "Decided", zh: "已处理" },
  "nav.shop": { en: "Shop details", zh: "店铺资料" },
  "nav.signout": { en: "Sign out", zh: "退出" },
  "nav.language": { en: "中文", zh: "English" },
  "login.title": { en: "Sign in to your shop", zh: "登录你的店" },
  "login.lead": { en: "Paste the access token you were given. It stays in this browser only.", zh: "粘贴给你的访问令牌，只保存在这台浏览器里。" },
  "login.shop": { en: "Shop id", zh: "店铺 id" },
  "login.name": { en: "Your name", zh: "你的名字" },
  "login.token": { en: "Access token", zh: "访问令牌" },
  "login.submit": { en: "Sign in", zh: "登录" },
  "login.failed": { en: "That shop and token do not match.", zh: "店铺和令牌对不上。" },
  "login.offline": { en: "Cannot reach the server.", zh: "连不上服务器。" },
  "inbox.title": { en: "Waiting for you", zh: "待确认" },
  "inbox.empty": { en: "Nothing waiting. New requests appear here as soon as the agent holds them.", zh: "暂时没有待确认的。agent 一挂上新预约就会出现在这里。" },
  "inbox.pick": { en: "Choose a request on the left.", zh: "从左边选一条。" },
  "inbox.count": { en: "requests", zh: "条" },
  "inbox.count1": { en: "request", zh: "条" },
  "history.title": { en: "Decided", zh: "已处理" },
  "history.empty": { en: "Nothing decided yet.", zh: "还没有处理过的预约。" },
  "history.failed": { en: "Couldn't load the history.", zh: "已处理列表没加载出来。" },
  "error.retry": { en: "Retry", zh: "重试" },
  "correct.loading": { en: "Checking earlier corrections…", zh: "正在查之前的修正…" },
  "correct.loadError": { en: "Couldn't load earlier corrections, so the forms are hidden to avoid a duplicate.", zh: "之前的修正没加载出来，为避免重复提交先不显示表单。" },
  "detail.dayLoading": { en: "Checking that day's confirmed bookings…", zh: "正在查那天已确认的预约…" },
  "detail.dayError": { en: "Couldn't load that day's confirmed bookings, so clashes can't be checked and confirming is off until they load.", zh: "那天的已确认预约没加载出来，查不了冲突，加载出来之前不能确认。" },
  "list.back": { en: "Back to the list", zh: "返回列表" },
  "detail.customer": { en: "Customer", zh: "客人" },
  "detail.contact": { en: "Contact", zh: "联系方式" },
  "detail.channel": { en: "Came in via", zh: "来源" },
  "detail.pet": { en: "Pet", zh: "宠物" },
  "detail.breed": { en: "Breed guess", zh: "品种判断" },
  "detail.size": { en: "Size", zh: "体型" },
  "detail.coat": { en: "Coat", zh: "毛质" },
  "detail.weight": { en: "Weight", zh: "体重" },
  "detail.service": { en: "Service", zh: "服务" },
  "detail.when": { en: "Requested time", zh: "希望时间" },
  "detail.duration": { en: "Duration", zh: "时长" },
  "detail.quote": { en: "Quoted range", zh: "报价区间" },
  "detail.requested": { en: "Asked", zh: "提交于" },
  "detail.decidedBy": { en: "Decided by", zh: "处理人" },
  "detail.reason": { en: "Reason given", zh: "拒绝原因" },
  "detail.alternatives": { en: "Times offered instead", zh: "给的替代时间" },
  "detail.day": { en: "That day at the shop", zh: "当天的安排" },
  "detail.dayClosed": { en: "The shop is closed that day.", zh: "那天不营业。" },
  "detail.notes": { en: "Notes", zh: "备注" },
  "detail.min": { en: "min", zh: "分钟" },
  "detail.kg": { en: "kg", zh: "公斤" },
  "action.confirm": { en: "Confirm booking", zh: "确认预约" },
  "action.decline": { en: "Decline", zh: "拒绝" },
  "action.confirming": { en: "Confirming…", zh: "确认中…" },
  "action.confirmed": { en: "Confirmed. The customer will be told.", zh: "已确认，会通知客人。" },
  "action.declined": { en: "Declined. The customer will be told.", zh: "已拒绝，会通知客人。" },
  "action.gone": { en: "Someone already decided this one.", zh: "这条已经被处理过了。" },
  "decline.title": { en: "Decline this request", zh: "拒绝这条预约" },
  "decline.reason": { en: "Reason (the customer sees this)", zh: "原因（客人会看到）" },
  "decline.reasonHint": { en: "Fully booked that morning", zh: "那天上午排满了" },
  "decline.offer": { en: "Offer other times", zh: "给几个替代时间" },
  "decline.offerHint": { en: "Pick up to three free slots.", zh: "最多选三个空档。" },
  "decline.date": { en: "Day", zh: "日期" },
  "decline.noSlots": { en: "No free slots that day.", zh: "那天没有空档。" },
  "decline.send": { en: "Send decline", zh: "发送拒绝" },
  "decline.cancel": { en: "Keep it waiting", zh: "先不处理" },
  "correct.pet": { en: "Correct the pet", zh: "纠正识图" },
  "correct.quote": { en: "Correct the quote", zh: "纠正报价" },
  "correct.species": { en: "Species", zh: "种类" },
  "correct.dog": { en: "Dog", zh: "狗" },
  "correct.cat": { en: "Cat", zh: "猫" },
  "correct.other": { en: "Other", zh: "其他" },
  "correct.breed": { en: "Breed", zh: "品种" },
  "correct.size": { en: "Size tier", zh: "体型档" },
  "correct.min": { en: "From", zh: "最低" },
  "correct.max": { en: "To", zh: "最高" },
  "correct.note": { en: "Why (optional)", zh: "原因（可不填）" },
  "correct.save": { en: "Save correction", zh: "保存修正" },
  "correct.saved": { en: "Saved. It becomes a test case for the agent.", zh: "已保存，会成为 agent 的测试用例。" },
  "correct.already": { en: "Corrected", zh: "已纠正" },
  "chat.title": { en: "What the customer sent", zh: "客人说了什么" },
  "chat.loading": { en: "Loading the conversation…", zh: "正在读取对话…" },
  "chat.gone": { en: "This conversation is no longer stored.", zh: "这段对话已经不在了。" },
  "chat.error": { en: "Couldn't load the conversation. Try again.", zh: "对话没加载出来，再试一次。" },
  "chat.photo": { en: "Customer photo", zh: "客人发的照片" },
  "chat.photoGone": { en: "Photo removed after 24 hours", zh: "照片 24 小时后已清除" },
  "chat.agent": { en: "Agent", zh: "agent" },
  "chat.tool": { en: "looked up", zh: "查了" },
  "shop.title": { en: "Shop details", zh: "店铺资料" },
  "shop.lead": { en: "What the agent quotes and books from. Changes apply to the next conversation.", zh: "agent 报价和排期依据的资料。改完下一次对话就生效。" },
  "shop.basics": { en: "Basics", zh: "基本信息" },
  "shop.name": { en: "Shop name", zh: "店名" },
  "shop.phone": { en: "Phone", zh: "电话" },
  "shop.address": { en: "Address", zh: "地址" },
  "shop.website": { en: "Website", zh: "网站" },
  "shop.hours": { en: "Opening hours", zh: "营业时间" },
  "shop.closed": { en: "Closed", zh: "休息" },
  "shop.open": { en: "Open", zh: "营业" },
  "shop.tiers": { en: "Size tiers", zh: "体型档" },
  "shop.tier.id": { en: "Id", zh: "id" },
  "shop.tier.label": { en: "Label", zh: "名称" },
  "shop.tier.maxKg": { en: "Up to kg", zh: "上限公斤" },
  "shop.services": { en: "Services and prices", zh: "服务与价目" },
  "shop.service.id": { en: "Id", zh: "id" },
  "shop.service.name": { en: "Name", zh: "名称" },
  "shop.service.duration": { en: "Minutes", zh: "分钟" },
  "shop.price.size": { en: "Size", zh: "体型" },
  "shop.price.coat": { en: "Coat", zh: "毛质" },
  "shop.price.any": { en: "Any coat", zh: "不分毛质" },
  "shop.price.min": { en: "From $", zh: "最低 $" },
  "shop.price.max": { en: "To $", zh: "最高 $" },
  "shop.addPrice": { en: "Add a price", zh: "加一档价" },
  "shop.addService": { en: "Add a service", zh: "加一项服务" },
  "shop.addTier": { en: "Add a tier", zh: "加一档" },
  "shop.remove": { en: "Remove", zh: "删除" },
  "shop.policies": { en: "Policies", zh: "规则" },
  "shop.disclaimer": { en: "Quote disclaimer", zh: "报价免责声明" },
  "shop.notes": { en: "Notes the agent should know", zh: "要告诉 agent 的规矩" },
  "shop.en": { en: "English", zh: "英文" },
  "shop.zh": { en: "Chinese", zh: "中文" },
  "shop.save": { en: "Save changes", zh: "保存修改" },
  "shop.saving": { en: "Saving…", zh: "保存中…" },
  "shop.saved": { en: "Saved.", zh: "已保存。" },
  "shop.unchanged": { en: "No changes yet.", zh: "还没有改动。" },
  "shop.invalid": { en: "Could not save:", zh: "没能保存：" },
  "status.pending": { en: "Waiting", zh: "待确认" },
  "status.confirmed": { en: "Confirmed", zh: "已确认" },
  "status.declined": { en: "Declined", zh: "已拒绝" },
  "status.cancelled": { en: "Cancelled", zh: "已取消" },
  "coat.short": { en: "short", zh: "短毛" },
  "coat.double": { en: "double", zh: "双层毛" },
  "coat.curly": { en: "curly", zh: "卷毛" },
  "coat.wire": { en: "wire", zh: "刚毛" },
  "coat.long": { en: "long", zh: "长毛" },
  "day.mon": { en: "Monday", zh: "周一" },
  "day.tue": { en: "Tuesday", zh: "周二" },
  "day.wed": { en: "Wednesday", zh: "周三" },
  "day.thu": { en: "Thursday", zh: "周四" },
  "day.fri": { en: "Friday", zh: "周五" },
  "day.sat": { en: "Saturday", zh: "周六" },
  "day.sun": { en: "Sunday", zh: "周日" },
  "error.generic": { en: "Something went wrong. Try again.", zh: "出了点问题，再试一次。" },
  "error.unauthorized": { en: "Your access token no longer works. Sign in again.", zh: "访问令牌失效了，请重新登录。" },
} as const;

export type StringKey = keyof typeof STRINGS;

interface LocaleContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: StringKey) => string;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);
const KEY = "fluffdesk.locale";

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved === "zh" || saved === "en") setLocaleState(saved);
      else if (navigator.language.toLowerCase().startsWith("zh")) setLocaleState("zh");
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en-AU";
  }, [locale]);
  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try {
      localStorage.setItem(KEY, l);
    } catch {
      /* ignore */
    }
  }, []);
  const value = useMemo<LocaleContextValue>(() => ({ locale, setLocale, t: (key) => STRINGS[key][locale] }), [locale, setLocale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const v = useContext(LocaleContext);
  if (!v) throw new Error("useLocale outside LocaleProvider");
  return v;
}
