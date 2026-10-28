"use client";
import { useLocale } from "@/lib/i18n";
import type { BookingStatus } from "@/lib/types";

export function StatusPill({ status }: { status: BookingStatus }) {
  const { t } = useLocale();
  return <span className={`pill pill-${status}`}>{t(`status.${status}`)}</span>;
}
