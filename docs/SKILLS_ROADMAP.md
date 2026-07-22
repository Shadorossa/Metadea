# Roadmap de skills para Metadea

Seguimiento de qué skills instaladas en `~/.claude/skills` ya se han aplicado a
este repo, cuáles quedan pendientes con una acción concreta, y cuáles no
aplican a un proyecto Tauri v2 + Astro + React de escritorio sin
infraestructura cloud.

Última actualización: 2026-07-22.

## Ya aplicadas en este proyecto

| Skill | Qué se hizo | Resultado |
|---|---|---|
| `code-reviewer` | `code_quality_checker.py` sobre `frontend/src/lib/media`, `components/`, `src-tauri/src` | Identificó `mediaService.ts`, `PrEditorModal.tsx`, `igdb.rs`, `media_catalog.rs` como peores archivos |
| `senior-architect` | `project_architect.py` sobre todo el repo | Jerarquía de carpetas correcta; el problema real son "God files", no la organización |
| `karpathy-coder` | `complexity_checker.py` / `diff_surgeon.py` | Detectados varios falsos positivos (funciones anidadas medidas mal) — ver nota abajo |
| `minimalist` / `strict-api` | Aplicados como disciplina inline durante el refactor de `mediaService.ts` y el split de `igdb.rs` | Sin abstracciones nuevas no pedidas, sin APIs inventadas |
| `data-quality-auditor` | Auditoría de `database/*.json` (67 archivos de propuestas de catálogo comunitario) | DQS 86.9/100. 16 archivos con relaciones duplicadas en el JSON fuente (mismo `related_media_external_id` + `relation_type`, solo difiere la URL de `cover`) — investigado a fondo, ver sección de hallazgos abajo |
| `code-tour` | Generado `.tours/refactorer-god-file-split.tour` documentando el split de `igdb.rs` y `PrEditorModal.tsx` | Tour de 11 pasos, persona "refactorer", para quien continúe el split |

**Nota sobre `karpathy-coder`**: su `complexity_checker.py` es regex/brace-based,
no un parser AST real. Falso positivo confirmado: mide una función anidada
(`const fn = () => {}` dentro de otra función) desde su propia declaración
hasta el cierre de la función *contenedora*, no la suya. Verificar siempre
leyendo el código antes de aceptar un hallazgo de este script.

## Hallazgo de la auditoría de datos (investigado a fondo — no es un bug en producción)

Archivos afectados (relación duplicada, mismo tipo y destino, cover distinta):
`game-375.json`, `game-376.json`, `game-379.json`, `game-380.json`,
`game-482.json`, `game-483.json`, `game-5328.json`, `game-96246.json`,
`game-136889.json`, `game-222295.json`, `game-222341.json`, `game-22686.json`,
`game-228528.json`, `vnovel-272082.json` a `vnovel-272087.json`.

**No afecta a ningún usuario real.** `db.rs:93-119` (migración 5) reconstruyó
`media_relations` con PK `(media_external_id, related_media_external_id)` —
sin `relation_type` — precisamente para colapsar esta clase de duplicado; el
propio comentario de esa migración describe el mismo síntoma. `build-database.js`
usa la misma PK de 2 columnas con `INSERT OR REPLACE`. Tanto la DB local de
cada usuario como el `database.db` distribuido descartan el duplicado solos.

**Causa raíz identificada** (con alta confianza, no reproducida en vivo):
`pr-editor-submit.ts:235` concatena `[...editableDbRelations, ...bundledDbRelations,
...containedDbRelations, ...currentChainRows]` sin dedupe por
`(related_media_external_id, relation_type)`. `editableDbRelations` excluye
relaciones cuyo destino ya es miembro de saga vía `sagaMemberIds`
(`PrEditorModal.tsx:215`), y `sagaMemberIds` lo calcula
`get_transitive_relation_ids` (Rust) caminando *solo aristas salientes*
PREQUEL/SEQUEL desde la entrada actual. Si la arista recíproca local es
asimétrica (existe `X→actual` pero no `actual→X`, posible porque la
recíproca se escribe con `INSERT OR IGNORE`), `X` no aparece en
`sagaMemberIds`, la relación antigua hacia `X` sobrevive en
`editableRelations` con su cover viejo, y `currentChainRows` vuelve a
generar la misma arista con un cover recién resuelto → duplicado. El mismo
riesgo para el path de "otros miembros de la cadena" (`otherId`, línea 267)
ya está mitigado con `ALL_CHAIN_RELATION_TYPES` (ver comentario en
`sagaTypes.ts:18-22`); al path de la entrada actual le falta esa misma
protección o, más simple, un dedupe al construir `currentFinalRelations`.

**Impacto real**: solo ensucia los JSON versionados en `database/` y hace
más ruidosos los diffs de PR que revisan los curadores — cero impacto en
runtime. Arreglo sugerido (no aplicado, pendiente de decisión): dedupe por
`(related_media_external_id, relation_type)` en `currentFinalRelations`
(pr-editor-submit.ts:235) y en `otherRelations` (línea 272), quedándose con
la fila calculada por la cadena de saga cuando hay colisión. Limpieza de los
16 archivos ya versionados es un cambio aparte, cosmético.

## Pendientes con encaje real en este proyecto

| Skill | Acción concreta propuesta | Prioridad |
|---|---|---|
| `run` | Lanzar `frontend` con Tauri dev y probar en vivo los cambios ya hechos en `igdb.rs`, `mediaService.ts` y `PrEditorModal.tsx` — no se ha verificado ninguno de los refactors de esta sesión contra la app real, solo `tsc`/`cargo check` | Alta — es la única verificación que falta a todo el trabajo de refactor hecho hasta ahora |
| `simplify` | Pasarlo sobre el diff acumulado de esta sesión (mediaService.ts, PrEditorModal.tsx, igdb.rs) buscando reuse/simplificación que el code-reviewer no cubre | Media |
| Continuar split de `igdb.rs` / `media_catalog.rs` | Bloque de imágenes/metadata en igdb.rs, o migrar a `media_catalog.rs` (2010 líneas, 17/100) — decisión pendiente del usuario | Alta (trabajo en curso) |
| `fewer-permission-prompts` | Escanear transcripts de esta sesión y proponer allowlist para `frontend/.claude/settings.json` (muchos `cargo check`, `tsc --noEmit`, lecturas repetidas) | Baja — comodidad, no calidad de código |
| `security-review` / `senior-secops` (`security_scanner.py`) | Escaneo de secretos/SQLi/XSS sobre `src-tauri/src` y `frontend/src` — nunca se ha corrido, y el proyecto maneja API keys (IGDB/Steam/TMDB/AniList/ComicVine) vía `app_env` en SQLite | Media |
| `dataviz` / `artifact-design` | Si se quiere un dashboard visual del estado de calidad (puntuaciones por archivo a lo largo del tiempo) | Baja — nice-to-have |

## No aplican a este proyecto (sin acción)

Descartadas porque no encajan con un desktop app Tauri sin cloud/CI complejo
ni documentos ofimáticos como entregable:

- `anthropic-skills:docx`, `pptx`, `xlsx`, `pdf`, `canvas-design` — no hay
  entregables de documento/hoja de cálculo/imagen en este proyecto.
- `anthropic-skills:morning`, `schedule`, `setup-cowork`,
  `consolidate-memory`, `claude-api` — utilidades de sesión/cuenta, no de
  este código.
- `senior-devops` (Terraform/K8s/Docker) — la app no tiene infraestructura
  cloud; el único CI son 3 workflows simples en `.github/workflows/`
  (`cleanup-branches`, `release`, `update-database`), ya funcionales.
- `senior-security` (STRIDE/DREAD threat modeling) — sobredimensionado para
  una app de escritorio de un usuario; más relevante sería el escaneo
  concreto de `senior-secops` listado arriba si se quiere algo de seguridad.
- `zero-hallucination-coder` — es una disciplina a aplicar *durante* la
  próxima tarea de código no trivial, no algo que se "ejecute" una vez;
  aplicar cuando se retome el split de `media_catalog.rs`.
- `keybindings-help`, `update-config` — configuración del harness, no del
  repo.
- `skill-creator` — solo si se decide crear una skill propia para este
  proyecto (p.ej. un checker específico del patrón Tauri command/module).

## Cómo retomar esto

1. Decidir el siguiente paso del refactor Rust (bloque imágenes/metadata en
   `igdb.rs` vs. empezar `media_catalog.rs`) — pendiente de respuesta del
   usuario a fecha de esta nota.
2. Antes de seguir apilando extracciones sin probar nada en vivo, correr
   `run` una vez para confirmar que la app arranca y que IGDB/comic
   search/PrEditorModal siguen funcionando tras los cambios de esta sesión.
3. Revisar el hallazgo de relaciones duplicadas en `database/*.json` (arriba)
   y decidir si se corrige en el JSON fuente, en el generador, o con un
   dedupe en `media_catalog.rs`.
