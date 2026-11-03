"use client";

import { useState } from "react";
import { MARCAS, SOURCES, MEDIUMS, CAMPAIGN_TYPES } from "../data";
import { sanitize, buildUtmUrl } from "../utils";
import type { UtmForm, UtmResult } from "../types";

const EMPTY: UtmForm = {
  baseUrl: "",
  marca: "",
  source: "",
  medium: "",
  campaignType: "",
  campaignName: "",
  adSet: "",
  adName: "",
};

type FormErrors = Partial<Record<keyof UtmForm, string>>;

const INPUT_BASE =
  "w-full border px-4 py-2.5 rounded-2xl text-sm outline-none transition focus:ring-2 focus:ring-red-100";

function inputCls(error?: string) {
  return `${INPUT_BASE} ${error ? "border-red-400" : "border-gray-300 focus:border-red-600"}`;
}

function Field({
  label,
  hint,
  required,
  error,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-medium text-gray-600">
        {label}
        {hint && (
          <span className="ml-1 font-normal text-gray-400">{hint}</span>
        )}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      {children}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}

function PreviewChip({
  param,
  value,
}: {
  param: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-3">
      <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
        {param}
      </p>
      <p className="mt-1 break-all font-mono text-xs text-red-700 leading-relaxed">
        {value}
      </p>
    </div>
  );
}

function InfoBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3">
      {children}
    </div>
  );
}

export function UtmBuilderModule() {
  const [form, setForm] = useState<UtmForm>(EMPTY);
  const [errors, setErrors] = useState<FormErrors>({});
  const [result, setResult] = useState<UtmResult | null>(null);
  const [copied, setCopied] = useState(false);

  function set(key: keyof UtmForm, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
    setResult(null);
  }

  function validate(): boolean {
    const e: FormErrors = {};
    if (!form.baseUrl.trim()) e.baseUrl = "La URL de destino es obligatoria";
    if (!form.marca) e.marca = "Selecciona una marca";
    if (!form.source) e.source = "Selecciona la fuente de tráfico";
    if (!form.medium) e.medium = "Selecciona el medio";
    if (!form.campaignType) e.campaignType = "Selecciona el tipo de campaña";
    if (!form.campaignName.trim())
      e.campaignName = "Ingresa el nombre de la campaña";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function generate() {
    if (!validate()) return;
    setResult(buildUtmUrl(form));
    setCopied(false);
  }

  function reset() {
    setForm(EMPTY);
    setErrors({});
    setResult(null);
    setCopied(false);
  }

  async function copy() {
    if (!result) return;
    await navigator.clipboard.writeText(result.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  const campaignPreview = [
    form.marca,
    form.campaignType,
    form.campaignName ? sanitize(form.campaignName) : "",
  ]
    .filter(Boolean)
    .join("_");

  const termPreview = form.adSet ? sanitize(form.adSet) : "";
  const contentPreview = form.adName ? sanitize(form.adName) : "";

  const paramOrder = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"] as const;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.35em] text-red-600">
          Analítica Digital · GA4
        </p>
        <h2 className="mt-1 text-2xl font-bold text-slate-900">
          Generador de UTMs
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          Crea URLs estandarizadas con parámetros UTM para clasificar
          correctamente el tráfico en Google Analytics 4.
        </p>
      </div>

      {/* 3-Column Form */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* ── Column 1: Campaign ── */}
        <div className="flex flex-col gap-5 rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="border-b border-gray-100 pb-3">
            <span className="text-xs font-bold uppercase tracking-[0.3em] text-red-600">
              Nivel 1
            </span>
            <h3 className="mt-0.5 text-sm font-semibold text-slate-800">
              Campaña
            </h3>
            <p className="text-xs text-gray-400">
              Configuración general de la campaña
            </p>
          </div>

          <Field
            label="URL de Destino"
            required
            error={errors.baseUrl}
          >
            <input
              type="url"
              placeholder="https://www.ejemplo.com/pagina"
              value={form.baseUrl}
              onChange={(e) => set("baseUrl", e.target.value)}
              className={inputCls(errors.baseUrl)}
            />
          </Field>

          <Field label="Marca" required error={errors.marca}>
            <select
              value={form.marca}
              onChange={(e) => set("marca", e.target.value)}
              className={`${inputCls(errors.marca)} bg-white`}
            >
              <option value="">Seleccionar marca…</option>
              {MARCAS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="Fuente de Tráfico"
            hint="(utm_source)"
            required
            error={errors.source}
          >
            <select
              value={form.source}
              onChange={(e) => set("source", e.target.value)}
              className={`${inputCls(errors.source)} bg-white`}
            >
              <option value="">Seleccionar fuente…</option>
              {SOURCES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="Medio"
            hint="(utm_medium)"
            required
            error={errors.medium}
          >
            <select
              value={form.medium}
              onChange={(e) => set("medium", e.target.value)}
              className={`${inputCls(errors.medium)} bg-white`}
            >
              <option value="">Seleccionar medio…</option>
              {MEDIUMS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="Tipo de Campaña"
            required
            error={errors.campaignType}
          >
            <select
              value={form.campaignType}
              onChange={(e) => set("campaignType", e.target.value)}
              className={`${inputCls(errors.campaignType)} bg-white`}
            >
              <option value="">Seleccionar tipo…</option>
              {CAMPAIGN_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="Nombre de la Campaña"
            required
            error={errors.campaignName}
          >
            <input
              type="text"
              placeholder="ej. verano 2025 colección"
              value={form.campaignName}
              onChange={(e) => set("campaignName", e.target.value)}
              className={inputCls(errors.campaignName)}
            />
          </Field>

          {campaignPreview && (
            <PreviewChip param="utm_campaign" value={campaignPreview} />
          )}
        </div>

        {/* ── Column 2: Ad Set ── */}
        <div className="flex flex-col gap-5 rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="border-b border-gray-100 pb-3">
            <span className="text-xs font-bold uppercase tracking-[0.3em] text-red-600">
              Nivel 2
            </span>
            <h3 className="mt-0.5 text-sm font-semibold text-slate-800">
              Conjunto de Anuncios
            </h3>
            <p className="text-xs text-gray-400">Segmentación de audiencia</p>
          </div>

          <Field label="Audiencia / Segmentación" hint="(utm_term)">
            <textarea
              placeholder="ej. mujeres 25 45 Lima intereses ropa"
              value={form.adSet}
              onChange={(e) => set("adSet", e.target.value)}
              rows={4}
              className="w-full resize-none rounded-2xl border border-gray-300 px-4 py-2.5 text-sm outline-none transition focus:border-red-600 focus:ring-2 focus:ring-red-100"
            />
          </Field>

          {termPreview && (
            <PreviewChip param="utm_term" value={termPreview} />
          )}

          <InfoBox>
            <p className="text-xs font-semibold text-blue-700">
              ¿Qué incluir aquí?
            </p>
            <p className="mt-1 text-xs leading-relaxed text-blue-600">
              Describe la segmentación del conjunto: género, edad, ubicación,
              intereses o tipo de audiencia (retargeting, prospección, LAL).
            </p>
          </InfoBox>
        </div>

        {/* ── Column 3: Ad ── */}
        <div className="flex flex-col gap-5 rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="border-b border-gray-100 pb-3">
            <span className="text-xs font-bold uppercase tracking-[0.3em] text-red-600">
              Nivel 3
            </span>
            <h3 className="mt-0.5 text-sm font-semibold text-slate-800">
              Anuncio
            </h3>
            <p className="text-xs text-gray-400">Creatividad y formato</p>
          </div>

          <Field label="Nombre / Formato del Anuncio" hint="(utm_content)">
            <textarea
              placeholder="ej. video 15s colección primavera carrusel"
              value={form.adName}
              onChange={(e) => set("adName", e.target.value)}
              rows={4}
              className="w-full resize-none rounded-2xl border border-gray-300 px-4 py-2.5 text-sm outline-none transition focus:border-red-600 focus:ring-2 focus:ring-red-100"
            />
          </Field>

          {contentPreview && (
            <PreviewChip param="utm_content" value={contentPreview} />
          )}

          <InfoBox>
            <p className="text-xs font-semibold text-blue-700">
              ¿Qué incluir aquí?
            </p>
            <p className="mt-1 text-xs leading-relaxed text-blue-600">
              Describe el creativo o variante: tipo de pieza (carrusel, video,
              estática), temática visual o versión A/B que estás probando.
            </p>
          </InfoBox>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={generate}
          className="rounded-2xl bg-red-700 px-8 py-3 text-sm font-semibold text-white transition hover:bg-red-600"
        >
          Generar Enlace UTM
        </button>
        <button
          type="button"
          onClick={reset}
          className="rounded-2xl border border-gray-300 px-6 py-3 text-sm font-medium text-gray-600 transition hover:bg-gray-50"
        >
          Limpiar
        </button>
      </div>

      {/* Result */}
      {result && (
        <div className="space-y-4 rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
          {/* Result header */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.3em] text-red-600">
                Resultado
              </p>
              <h3 className="mt-0.5 text-base font-semibold text-slate-900">
                URL con UTMs generada
              </h3>
            </div>
            <div className="flex shrink-0 gap-2">
              <a
                href={result.url}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-2xl border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
              >
                Abrir ↗
              </a>
              <button
                type="button"
                onClick={copy}
                className={`rounded-2xl border px-4 py-2 text-sm font-medium transition ${
                  copied
                    ? "border-green-200 bg-green-100 text-green-700"
                    : "border-gray-300 text-gray-700 hover:bg-gray-50"
                }`}
              >
                {copied ? "✓ Copiado" : "Copiar URL"}
              </button>
            </div>
          </div>

          {/* Full URL */}
          <div
            className="cursor-text select-all rounded-2xl border border-slate-200 bg-slate-50 p-4"
            onClick={copy}
            title="Clic para copiar"
          >
            <p className="break-all font-mono text-xs leading-relaxed text-slate-800">
              {result.url}
            </p>
          </div>

          {/* Params breakdown */}
          <div>
            <p className="mb-2 text-xs font-medium text-gray-400">
              Parámetros UTM generados
            </p>
            <div className="flex flex-wrap gap-2">
              {paramOrder
                .filter((k) => result.params[k])
                .map((k) => (
                  <div
                    key={k}
                    className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"
                  >
                    <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                      {k}
                    </p>
                    <p className="mt-0.5 max-w-[220px] break-all font-mono text-xs text-slate-700">
                      {result.params[k]}
                    </p>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
