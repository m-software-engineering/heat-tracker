import { useEffect, useState } from "react";
import { COPY, pickLocale, type Locale } from "./copy";

/** Browser locale (EN until mounted, so server and first client render match); also sets `<html lang>`. */
export const useLocale = () => {
  const [locale, setLocale] = useState<Locale>("en");
  useEffect(() => {
    const next = pickLocale(navigator.language);
    setLocale(next);
    document.documentElement.lang = next;
  }, []);
  return { locale, copy: COPY[locale], number: (n: number) => new Intl.NumberFormat(locale).format(n) };
};
