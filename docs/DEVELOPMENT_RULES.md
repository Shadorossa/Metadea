# Reglas de desarrollo de Metadea

Versión 2 — reescritas a partir de la auditoría de 2026-09-23.

La versión anterior estaba copiada de una plantilla genérica de startup web. Exigía
`npm run test`, `npm run lint` y cobertura >80% cuando ninguno de esos comandos existía,
y un máximo de 200 líneas por archivo que el 30,3% del repositorio incumplía. Una regla
que nadie puede cumplir no se incumple: se ignora, y arrastra consigo a las que sí
importaban.

Estas reglas parten de lo que Metadea **es** y de lo que la auditoría **encontró**.

---

## Qué es Metadea (y por qué eso cambia las reglas)

Metadea es una aplicación de escritorio Tauri, estilo Playnite: un lanzador y
rastreador de biblioteca personal — juegos, anime, manga, series, cómics, novelas —
que funciona **mayoritariamente sin conexión**, sobre una base de datos SQLite local,
y que además consume un catálogo comunitario compartido vía pull requests a GitHub.

Tres consecuencias que ninguna regla genérica de backend web recoge:

1. **La base de datos local es irreemplazable.** No hay servidor con una copia. Si una
   escritura parcial corrompe la biblioteca de alguien, esos datos no existen en
   ningún otro sitio. Esto es más grave que cualquier caída de servicio.
2. **Offline es el caso normal, no el degradado.** Cada llamada de red es opcional por
   definición. La aplicación tiene que ser completamente usable con el cable
   desenchufado.
3. **El catálogo comunitario es entrada no confiable.** Sinopsis, biografías y URLs de
   imagen llegan de PRs de terceros y se renderizan en un webview con acceso al sistema
   de archivos. Se tratan como entrada hostil, siempre.

---

## Nivel 0 — Innegociables

Se violan y se revierte el cambio. Sin discusión, sin "lo arreglo en el siguiente PR".

### 0.1 Toda escritura multi-sentencia va en una transacción

La auditoría encontró tres rutas destructivas sin transacción, incluida
`sync_community_catalog` (`src-tauri/src/community_sync.rs:52-438`), que ejecuta ~25
sentencias con cinco `DELETE` y sus reinserciones, sin `BEGIN`, sin rollback. Un corte
de luz a mitad borra el grafo de sagas del usuario y no lo restaura.

```rust
// MAL — un fallo a mitad deja datos borrados y no reinsertados
conn.execute("DELETE FROM user_list_items WHERE list_key = ?1", [&fav_key])?;
for (pos, id) in ids.iter().enumerate() {
    conn.execute("INSERT OR IGNORE INTO user_list_items ...", ...)?;
}

// BIEN
let tx = conn.transaction()?;
tx.execute("DELETE FROM user_list_items WHERE list_key = ?1", [&fav_key])?;
for (pos, id) in ids.iter().enumerate() {
    tx.execute("INSERT OR IGNORE INTO user_list_items ...", ...)?;
}
tx.commit()?;
```

El patrón correcto ya se usa en 24 de 30 rutas de escritura. Las excepciones son
olvidos, no decisiones.

**Aplica igual a las migraciones.** Cada bloque `if v < N` va en su propia transacción y
`mark_migration` solo se ejecuta tras el `commit`. Hoy hay 78 `let _ = conn.execute(...)`
en `db.rs` que marcan la migración como aplicada aunque haya fallado.

### 0.2 Un fallo de escritura aborta la operación, nunca se traga

```ts
// MAL — la escritura local falla, y aun así se envía la propuesta a GitHub.
// La BD local y el PR quedan divergiendo en silencio.
await saveMediaRelations(externalId, rows)
  .catch(err => console.error('Failed to save relations:', err));

// BIEN — que propague; quien llama ya tiene try/catch y superficie de error
await saveMediaRelations(externalId, rows);
```

Regla operativa: `.catch(() => fallback)` es aceptable en una **lectura** cuya ausencia
la UI ya sabe representar. **Nunca** en una escritura.

Corolario: si una lectura fallida produce un valor *incorrecto* en vez de uno *ausente*,
tampoco vale. `useState<boolean | null>(null)` y renderizar un estado neutro, no
`false` por defecto (ver `LocalMediaDetailPanel.tsx:152-167`).

### 0.3 Nada de secretos en el repositorio

`frontend/.tauri-keys` — la clave privada de firma del updater — está versionada desde
tres commits atrás. Estar en `.gitignore` no desversiona un archivo ya rastreado.

Antes de cada commit que toque configuración o credenciales: `git status` y mirar qué
entra de verdad. Si un secreto llega a la historia, se considera comprometido: se rota,
no se borra y ya está.

### 0.4 Toda entrada del catálogo comunitario es hostil

Llega de PRs de terceros y acaba en un webview. Las tres reglas concretas:

- Ninguna ruta de archivo derivada de entrada externa se usa sin normalizar. El
  extractor de CBR (`comic_reader.rs:91-110`) acepta hoy `..\..\` en nombres de
  entrada. El de ZIP lo hace bien (`enclosed_name()`), y `backup.rs:112` ya tiene el
  helper correcto: `safe_zip_path`.
- Ninguna URL externa se descarga sin esquema permitido, timeout y límite de tamaño.
  `fetch_image_data_url` (`share_image.rs:18-32`) no tiene ninguno de los tres.
- Todo HTML de terceros pasa por `lib/shared/sanitize-html.ts`, y toda URL por
  `safeUrl()`. Los 40 `dangerouslySetInnerHTML` de React lo cumplen; tres
  `.innerHTML` de `lib/settings/` no (`auth-status.ts:22`, `avatar.ts:25,58`).

### 0.5 El scope de capacidades de Tauri es mínimo y explícito

`tauri.conf.json` tiene hoy `assetProtocol.scope: [..., "**"]`, que concede al webview
lectura de todo el disco y anula las dos entradas específicas que lo preceden. Cada
entrada del scope se justifica en el PR que la añade.

---

## Nivel 1 — Se ejecuta en cada commit

Estos comandos existen **hoy** y pasan hoy. Esa es la diferencia con la versión anterior.

```bash
cd frontend
npm run lint        # eslint — 0 errores (warnings en trinquete, ver 1.2)
npm run typecheck   # astro sync && tsc --noEmit
npm run test        # vitest run — unitarios junto a cada módulo + tests/ transversales
npm run build       # astro build
```

Activación del hook, una vez por clon:

```bash
git config core.hooksPath .husky
```

CI (`.github/workflows/ci.yml`) ejecuta lo mismo más cobertura, y un job de Rust con
`cargo clippy` y `cargo test`.

### 1.1 Los tests cubren lógica, no pantallas

No perseguimos un porcentaje global — sería mentira en una app con esta proporción de
UI. Se exige cobertura en los módulos **puros**, que son los que se rompen en silencio:

- Helpers y derivaciones (`media-editor-helpers.ts`, `media-editor-derived.ts`,
  `media-page-format.tsx`, `saga/saga-grouping.ts`)
- Reconstrucción de sagas / union-find
- Parsers y normalizadores (`biography-parser.ts`, `fandom-importer.ts`, `lib/local/folder-match.ts`)
- Integridad de i18n (`tests/i18n-parity.test.ts`)
- En Rust: `build_emulator_args`, `natural_cmp`, `safe_zip_path`, `extract_episode_label`

El umbral configurado en `vitest.config.ts` se aplica solo a esa lista, y esa lista
crece con cada módulo puro nuevo.

**Cuando un test encuentra un fallo real, se arregla el código, no el test.** Y cuando el
test estaba mal, se documenta por qué en el propio test. Ejemplo real de esta auditoría:
el umbral de 2 caracteres de `formatSeasonTabLabel` aplica también tras quitar el
prefijo; la expectativa inicial era incorrecta.

### 1.2 Trinquete, no amnistía

ESLint entró con 0 errores y 455 warnings (258 al escribir esto). Los warnings **no** se silencian con
`eslint-disable`; se van eliminando por categorías y la regla sube a `error` cuando su
contador llega a cero.

Orden acordado: `no-explicit-any` (9, eran 101) → `react-hooks/exhaustive-deps` (11, eran 22) →
`no-non-null-assertion` (128, eran 162) → reglas del React Compiler (`set-state-in-effect` 78,
`refs` 24, `purity` 2).

Regla dura: **un `eslint-disable` nuevo necesita un comentario con el motivo**. Los 18
que existían (15 hoy) se escribieron cuando no había linter instalado y no significan nada.

### 1.3 Cada `#[tauri::command]` nuevo va en `permissions/*.toml`

Un comando registrado en `generate_handler!` (`src-tauri/src/lib.rs`) pero ausente de
`permissions/default.toml` (o `player.toml`) no falla al compilar: la ACL de Tauri rechaza
la llamada en tiempo de ejecución con un error genérico que los `.catch(() => [])` del
frontend se tragan — el perfil llegó a renderizar una biblioteca vacía por esto.
`src-tauri/src/acl_coverage.rs` comprueba en `cargo test` que ambas listas son idénticas
en los dos sentidos (registrado ⇔ permitido), así que un comando nuevo se añade en los
dos sitios en el mismo commit, y un comando borrado se quita de los dos.

Antes de borrar un comando por "sin uso": `grep` del nombre en `frontend/src` — los
comandos se invocan por cadena (`invoke('nombre')`, `tauriCmd('nombre', …)`), no por
símbolo, así que `knip` no los ve.

### 1.4 Rust devuelve códigos de error estables, nunca texto

Un comando mantiene `Result<T, String>` por compatibilidad IPC, pero esa `String` es un
código `E_*` de `src-tauri/src/error_codes.rs` — a secas o como `"E_CODE: detalle técnico"`
vía `error_codes::with_detail`. Nada de prosa en ningún idioma. El frontend lo traduce con
`formatAppError(err, getT())` (`lib/errors/format-error.ts`), que busca `t.errors.<CODE>` y
añade el detalle; una cadena sin código conocido se muestra tal cual.

Al añadir un código: constante en `error_codes.rs` (+ `ALL`), clave `errors.<CODE>` en las 8
locales, entrada en `lib/errors/error-codes.ts`. Tres tests lo vigilan: en Rust, que cada
literal `"E_…"` del crate esté en `ALL`; en vitest, que `error-codes.ts` coincida con el
`.rs` y que `es.errors` tenga exactamente esas claves. Un código sin traducción es error
de compilación (`t.errors[code]`), así que el usuario nunca ve un `E_…` desnudo.

---

## Nivel 2 — Diseño

### 2.1 Offline primero, de verdad

- Ninguna funcionalidad núcleo (abrir la biblioteca, lanzar un juego, marcar progreso,
  leer un cómic) puede depender de una llamada de red.
- Toda llamada de red lleva timeout. Sin excepción.
- Los datos remotos se cachean en local y la UI distingue tres estados: **fresco**,
  **cacheado** y **no disponible**. No dos.
- Un fallo de red degrada, nunca bloquea; y se nota en la interfaz, no solo en la consola.

### 2.2 Una responsabilidad por archivo, con límite realista

El límite de 200 líneas se sustituye por esto:

| Umbral | Regla |
|---|---|
| > 400 líneas | Se justifica en la descripción del PR |
| > 700 líneas | No se acepta en código nuevo; si es un archivo existente, el PR no puede hacerlo crecer |
| Función > 150 líneas | Se parte |
| Parámetros > 5 | Objeto de opciones con nombres |

Y una regla de dirección, que es la que de verdad importa: **ningún archivo existente
por encima de 700 líneas puede crecer**. Un PR que toca `MediaPage.tsx` (1.940) o
`db.rs` (1.850) lo deja igual o más pequeño.

### 2.3 Dirección de dependencias en una sola dirección

```
pages  →  components  →  lib
```

`lib/` no importa de `components/`. Hoy hay 13 violaciones, nueve de ellas la familia
`lib/profile/render-*.ts`, que son puntos de montaje de React viviendo bajo `lib/`.

Los tipos compartidos van en un módulo hoja (`pr-editor-types.ts`, `lib/search/types.ts`),
no en el componente grande — eso es lo que crea los 19 ciclos de importación actuales.

Y los providers importan del módulo concreto (`lib/tauri/igdb`), nunca del barrel
(`lib/tauri`), que arrastra 30 módulos para usar tres funciones.

### 2.4 Nada de bus de eventos sin tipar

Hay hoy 5 globales colgadas de `window` y 11 canales de `CustomEvent`, todos con
literales de cadena en ambos extremos y **cero** declaraciones de tipo. 38 `(window as any)`.

Contrato nuevo: un único módulo declara los tipos de eventos y globales, y todo el
mundo pasa por sus helpers `emit`/`on`. Un canal sin entrada en ese mapa no existe.

### 2.5 Componentes de escritura: el estado emparejado va en un reducer

El patrón `x` + `originalX` repetido 16 veces (`PrEditorModal`) y 11 veces
(`CharacterPrEditorModal`) obliga a recorrer todos los pares a mano en cada diff, reset
y submit. `MediaEditorModal` ya demuestra la alternativa: un `useReducer` sobre
`{ draft, baseline }`. `hasChanges()` pasa a ser una comparación; `reset()`, una
asignación.

---

## Nivel 3 — Interfaz

### 3.1 Cero texto visible al usuario en el código

Toda cadena que el usuario lee pasa por `frontend/src/i18n/`, en **las 8 locales**.
Desde esta auditoría, `tsc` lo verifica: cada locale está anotada `: Translations`, así
que una clave que falte es error de compilación, no un fallback silencioso al español.

Excepción legítima, y solo esta: **tablas de alias que emparejan etiquetas entrantes**
de Fandom o AniList (`fandomImporter.ts`, `sagaTypes.ts`). Eso es *dato*, no interfaz.
Se marca con un comentario que lo diga.

Esto incluye `aria-label`, `title` y `placeholder` — hoy hay ~32 sin traducir — y
**también los mensajes de error de Rust**: 40 devolvían español literal a una UI que se
distribuye en 8 idiomas. Hoy Rust devuelve un código estable (`error_codes.rs`) y el
frontend lo traduce (`lib/errors/format-error.ts`, namespace `errors.*`); ver 1.4.

Nunca se borra una clave i18n "no usada" sin comprobar antes si lo que pasa es que el
componente la ignora y tiene el texto incrustado. En ese caso el arreglo es adoptar la
clave. (`RichTextEditor.tsx:206-210` ignora cinco claves traducidas en las 8 locales.)

### 3.2 Accesible por teclado o no se entrega

- Nada interactivo en un `<div onClick>`. Es `<button type="button">` con el estilo
  encima, o lleva `role` + `tabIndex` + `onKeyDown`.
- Todo modal: `role="dialog"`, `aria-modal`, cierre con `Escape`, foco atrapado dentro
  y devuelto al disparador al cerrar. Hoy 0 de 12 lo cumplen y cada uno lo implementa a
  su manera — esto pide un `ModalShell` compartido, no doce arreglos.
- Todo botón con solo un icono lleva `aria-label`. `data-tooltip` no es accesible.
- Toda interacción de arrastrar tiene equivalente por teclado. `useDragReorder` no
  tiene ninguno, así que la ordenación de sagas y relaciones es hoy imposible sin ratón.

### 3.3 CSS: tokens, y el orden de la cascada se arregla, no se pisa

`newspaper-dark.css` tiene 480 `!important` — el 45% del repositorio — porque los temas
se importan *antes* que el CSS de página en `BaseLayout.astro`, y en vez de corregir el
orden se escaló. El CSS de página respondió con más `!important`. Ninguno de los 1.074
pelea contra una hoja de terceros: todos pelean contra este mismo repositorio.

- Colores, radios y tipografías salen de tokens. Nada de hex sueltos fuera de
  `core/themes/` (excepción: colores de marca — Nintendo, PlayStation, Xbox).
- Un tema define tokens. Si necesita reescribir componentes, faltan tokens.
- `!important` necesita justificación escrita en el propio PR.
- `var(--token, #fallback)` solo si el token puede no existir. Hoy hay 645 fallbacks
  inalcanzables congelados en una paleta vieja, y 32 `var()` a tokens que no existen.

### 3.4 Los scripts de página viven en `lib/`

Esto **deroga** la regla de `docs/CLAUDE.md` que decía que los scripts de página van
inline en el `.astro`. Esa regla produjo `character.astro`: 1.126 líneas, 992 dentro de
un `<script>`, con 13 puntos de `innerHTML` escapados a mano.

El patrón correcto ya existe en el repositorio: `media.astro` son 16 líneas que montan
una isla de React. Un `.astro` es estructura; la lógica va en `lib/` o en un componente.

---

## Nivel 4 — Proceso

### 4.1 Deuda técnica: con fecha o no existe

Un `TODO` sin issue enlazado se borra. La auditoría encontró un listener muerto cuyo
único contenido era un `console.log` y un `TODO`, mientras la funcionalidad real ya
estaba implementada en otro archivo para el mismo selector.

### 4.2 El commit explica el porqué

El qué ya está en el diff. Y los cambios generados (propuestas de catálogo) van con su
propio prefijo, separados del código.

### 4.3 Antes de borrar algo por "no usado"

`grep` en **todo** el repositorio: `.ts`, `.tsx`, `.astro`, `.rs`, y los workers. Una
clave i18n puede leerse desde un `.astro`; un comando de Tauri, desde Rust; una clase
CSS puede construirse como plantilla (`` `card--${kind}` ``). `knip` está instalado y
ayuda, pero no ve construcciones dinámicas.

### 4.4 Lo que sale de una refactorización se verifica, no se supone

`tsc` y el build verdes no significan que el comportamiento se conserve. En esta
auditoría, al mover un helper, la regex `/\b\d+\b/` se convirtió en `/\x08\d+\x08/` —
caracteres de retroceso invisibles. `tsc` pasaba, el build pasaba y `grep` la mostraba
correcta. Habría roto el salto de tema a episodios en silencio.

Para movimientos de código: comparar el conjunto de literales de cadena antes y
después, y ejecutar lo que se ha tocado.

---

## Cuando las reglas compiten

1. **Integridad de los datos del usuario** — su biblioteca no existe en ningún otro sitio
2. **Seguridad**
3. **Corrección**
4. **Funcionar sin conexión**
5. **Accesibilidad**
6. **Rendimiento**
7. **Mantenibilidad**
8. **Velocidad de entrega**

La versión anterior ponía seguridad primero y no mencionaba los datos locales. En una
aplicación de escritorio sin servidor, perder la biblioteca de alguien es el peor
resultado posible.

---

## Estado al escribir estas reglas

| | |
|---|---|
| Tests | 704 JS en 56 archivos + 136 Rust (3 `#[ignore]` de medición) |
| ESLint | 0 errores, 258 warnings (en trinquete; eran 455) |
| `as any` | 8 (eran 51); `(window as any)` 1 (eran 38) |
| Typecheck | limpio |
| Build | correcto |
| Archivos > 200 líneas | 118 de 572 (20,6%) |
| Archivos > 1000 líneas | 7, ninguno TS/Astro (eran 19): 5 CSS (`settings.css` 1.779, `media/base.css` 1.438, `newspaper-dark.css` 1.379, `profile/base/navigation.css` 1.248, `media/relations.css` 1.033) y 2 Rust (`migrations/mod.rs` 1.363, `db.rs` 1.002); `character.astro` tiene 16 líneas; `providers/anilist.ts` (1.002) se partió en `providers/anilist/` |
| `lib/` → `components/` | 0 importaciones (eran 13); `lib/` sin React |
| Claves i18n | paridad y placeholders verificados por test en las 8 locales; tipo `Translations` aplicado a cada locale; `errors.*` cubre los 36 códigos de Rust |
| Comandos Tauri | `generate_handler!` ⇔ `permissions/*.toml` verificado por `acl_coverage.rs`; 8 comandos sin llamadas borrados |
| Clippy | 0 errores, 0 warnings (`-D warnings`); `cargo fmt` pendiente en un commit propio |

Esta tabla se actualiza cuando cambie. Si lleva meses sin tocarse, o nadie está
trabajando en el proyecto o las reglas han vuelto a ser decorativas.
