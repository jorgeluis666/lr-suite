begin;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'lista_pendientes'
      and column_name = 'fecha_inicio'
      and data_type = 'date'
  ) then
    alter table public.lista_pendientes
      alter column fecha_inicio type timestamptz
      using fecha_inicio::timestamp at time zone 'America/Lima';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'lista_pendientes'
      and column_name = 'fecha_fin'
      and data_type = 'date'
  ) then
    alter table public.lista_pendientes
      alter column fecha_fin type timestamptz
      using fecha_fin::timestamp at time zone 'America/Lima';
  end if;
end $$;

update public.lista_pendientes
set
  fecha_inicio = case titulo
    when 'Revisar info de Pérdidas y Ganancias.' then '2026-06-15 09:00:00-05'::timestamptz
    when 'Invertir en Google Ads Search.' then '2026-06-15 11:30:00-05'::timestamptz
    when 'Implementar Webhooks Manychat + LR Suite.' then '2026-06-16 09:00:00-05'::timestamptz
    when 'Auditoría Manychat, analizar nuevo etiquetado.' then '2026-06-16 14:00:00-05'::timestamptz
    when 'Hacer revisión general de todas las marcas.' then '2026-06-17 09:00:00-05'::timestamptz
    when 'Optimizar Landing Pages más importantes.' then '2026-06-17 14:00:00-05'::timestamptz
    when 'Coordinar auditoría de RB y Casiopia (tercerizar).' then '2026-06-18 09:00:00-05'::timestamptz
    when 'Diseñar plan de contenidos Reels para LR y AA.' then '2026-06-18 11:00:00-05'::timestamptz
    when 'Continuar producción de videos para LR y AA.' then '2026-06-19 09:00:00-05'::timestamptz
    when 'Continuar con la generación de contenidos para el blog.' then '2026-06-19 14:30:00-05'::timestamptz
  end,
  fecha_fin = case titulo
    when 'Revisar info de Pérdidas y Ganancias.' then '2026-06-15 11:00:00-05'::timestamptz
    when 'Invertir en Google Ads Search.' then '2026-06-15 13:30:00-05'::timestamptz
    when 'Implementar Webhooks Manychat + LR Suite.' then '2026-06-16 12:00:00-05'::timestamptz
    when 'Auditoría Manychat, analizar nuevo etiquetado.' then '2026-06-16 16:00:00-05'::timestamptz
    when 'Hacer revisión general de todas las marcas.' then '2026-06-17 12:00:00-05'::timestamptz
    when 'Optimizar Landing Pages más importantes.' then '2026-06-17 16:00:00-05'::timestamptz
    when 'Coordinar auditoría de RB y Casiopia (tercerizar).' then '2026-06-18 10:30:00-05'::timestamptz
    when 'Diseñar plan de contenidos Reels para LR y AA.' then '2026-06-18 13:00:00-05'::timestamptz
    when 'Continuar producción de videos para LR y AA.' then '2026-06-19 13:00:00-05'::timestamptz
    when 'Continuar con la generación de contenidos para el blog.' then '2026-06-19 17:00:00-05'::timestamptz
  end,
  updated_at = now()
where responsable = 'Jorge Luis'
  and titulo in (
    'Revisar info de Pérdidas y Ganancias.',
    'Invertir en Google Ads Search.',
    'Implementar Webhooks Manychat + LR Suite.',
    'Auditoría Manychat, analizar nuevo etiquetado.',
    'Hacer revisión general de todas las marcas.',
    'Optimizar Landing Pages más importantes.',
    'Coordinar auditoría de RB y Casiopia (tercerizar).',
    'Diseñar plan de contenidos Reels para LR y AA.',
    'Continuar producción de videos para LR y AA.',
    'Continuar con la generación de contenidos para el blog.'
  );

commit;
