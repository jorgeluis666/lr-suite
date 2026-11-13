# BBDD · Agentes IA

Las migraciones viven en `supabase/migrations` y se aplican a mano en el editor SQL del panel de
Supabase (pegar entera → Run). El aviso de RLS que sale al final es falso: lo dispara el bloque DO,
no la tabla.

| Migración                                  | Qué trae                                                     |
| ------------------------------------------ | ------------------------------------------------------------ |
| `20261111093000_agentes_uso.sql`            | `lr_suite_agente_uso` (una fila por llamada) y su resumen.   |
| `20261112093000_agentes_catalogo.sql`       | `lr_suite_agente`, `lr_suite_agente_recurso` y el tablero.    |

## Tablas

- **`lr_suite_agente`** — el catálogo. La clave es la misma que la Edge Function escribe en el
  registro de uso, para que recibo y ficha hablen del mismo agente sin tabla intermedia.
- **`lr_suite_agente_recurso`** — prompts, documentos y enlaces de cada agente. Un recurso vacío no
  se guarda: el prompt necesita texto, el enlace necesita URL, el documento vale con cualquiera.

Ninguna de las dos la toca el navegador: ni `SELECT`. Todo pasa por funciones `SECURITY DEFINER`.

## Funciones

| Función                                  | Para qué                                                        |
| ---------------------------------------- | --------------------------------------------------------------- |
| `lr_suite_agentes_panel(p_dias)`          | La lista: catálogo + conteo de recursos + gasto. Sin el texto.  |
| `lr_suite_agente_ficha(p_clave, p_dias)`  | La ficha: recursos completos, gasto por tipo de llamada y las últimas diez. |
| `lr_suite_agente_guardar(p_datos)`        | Alta y edición de un agente del catálogo.                        |
| `lr_suite_agente_recurso_op(p_accion, p_datos)` | `crear`, `editar`, `alternar` y `borrar` un recurso.       |

El nombre de la última lleva `_op` a propósito: una función que se llamara igual que la tabla puede
chocar con el tipo compuesto que la tabla crea.

Las Edge Functions leen `lr_suite_agente_recurso` directamente con la `service_role`, que no pasa
por RLS, desde `supabase/functions/_shared/recursos.ts`.

## Comprobación después de aplicar

```sql
SELECT jsonb_pretty(public.lr_suite_agentes_panel(30));
SELECT jsonb_pretty(public.lr_suite_agente_ficha('pendientes', 30));
```
