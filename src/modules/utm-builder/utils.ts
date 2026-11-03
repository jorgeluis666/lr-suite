import type { UtmForm, UtmParams, UtmResult } from "./types";

const ACCENT_MAP: Record<string, string> = {
  á: "a", à: "a", ä: "a", â: "a", ã: "a",
  é: "e", è: "e", ë: "e", ê: "e",
  í: "i", ì: "i", ï: "i", î: "i",
  ó: "o", ò: "o", ö: "o", ô: "o", õ: "o",
  ú: "u", ù: "u", ü: "u", û: "u",
  ñ: "n", ç: "c",
};

export function sanitize(text: string): string {
  return text
    .toLowerCase()
    .split("")
    .map((c) => ACCENT_MAP[c] ?? c)
    .join("")
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

export function buildUtmUrl(form: UtmForm): UtmResult {
  const campaign = [
    form.marca,
    form.campaignType,
    sanitize(form.campaignName),
  ].join("_");

  const params: UtmParams = {
    utm_source: form.source,
    utm_medium: form.medium,
    utm_campaign: campaign,
  };

  const term = sanitize(form.adSet);
  const content = sanitize(form.adName);
  if (term) params.utm_term = term;
  if (content) params.utm_content = content;

  const queryString = (Object.entries(params) as [string, string][])
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  const separator = form.baseUrl.includes("?") ? "&" : "?";

  return {
    url: `${form.baseUrl}${separator}${queryString}`,
    params,
  };
}
