# Plan de testeo — rAthenaExtension

Documento maestro de la estrategia de pruebas. El checklist manual paso a paso vive en [TESTING.md](TESTING.md); los snippets listos para pegar, en [test-fixtures/COPY-PASTE.md](test-fixtures/COPY-PASTE.md). Este documento define **qué** se prueba, **cómo**, y **cuándo se considera aprobado**.

---

## 1. Estrategia

La extensión tiene una propiedad que condiciona todo el plan: su corrección se define **contra un programa externo** (el map-server de rAthena), no contra una especificación escrita. De ahí las tres capas:

| Capa | Qué garantiza | Cuándo corre | Coste |
|---|---|---|---|
| **Tests unitarios** (184) | Cada módulo hace lo que dice, incluidos los casos borde | `npm test`, en cada cambio | < 1 s |
| **Corpus de regresión** | Cero falsos positivos sobre los 1 139 scripts oficiales | `npm run verify`, antes de cada release | ~3 s |
| **Checklist manual** | Lo que no se puede automatizar: UI, colores, atajos, selectores | TESTING.md, antes de publicar | ~30 min |

El principio rector, en orden de prioridad:

1. **Un falso positivo es peor que un falso negativo.** Un analizador que subraya código correcto se desinstala en una tarde. Por eso el corpus manda: cualquier diagnóstico nuevo debe pasar por los 26 MB de scripts oficiales antes de entrar.
2. **Los mensajes del parser estricto son contrato.** Son los de rAthena, literales. Un test que espera `"parse_line: expected ';'"` no se "arregla" cambiando el mensaje.
3. **Todo bug corregido deja un test.** El regex de `BUILDIN_DEF_DEPRECATED`, las funciones con guion, el `#define` fantasma, la capability `save` — cada uno tiene hoy un test que lo habría cazado.

---

## 2. Matriz de cobertura por módulo

| Módulo | Tests | Fichero de test | Qué cubre | Huecos conocidos |
|---|---|---|---|---|
| `lexer.ts` | 27 | `lexer.test.ts` | 9 scopes de variable, cadenas con escapes y colores, profundidad de llaves, CRLF, comentarios sin cerrar, posiciones LSP | — |
| `parseSource.ts` | 21 | `parseSource.test.ts` | Las 4 formas de `BUILDIN_DEF`, las 4 de `export_constant`, aridad, docs, item/mob/skill db, líneas `#define` | `parseMapFlags` sin test directo |
| `quickCheck.ts` | 25 | `quickCheck.test.ts` | Punto y coma (6 positivos, 14 exenciones legítimas), llaves, cadenas, tabuladores, comandos desconocidos | — |
| `mapServerParser.ts` | 38 | `mapServerParser.test.ts` | 16 construcciones aceptadas + 21 errores con mensaje literal + posición del error | Los mensajes de `case` con constante como label |
| `rathenaReport.ts` | 11 | `rathenaReport.test.ts` | Formato `% 5d`, marca `*`, comillas en el carácter, primera línea, offset fuera de rango | — |
| `paramSemantics.ts` | 12 | `paramSemantics.test.ts` | Vocabulario de placeholders, formas con/sin comillas, grupos opcionales anidados, posiciones | — |
| `completionContext.ts` | 17 | `completionContext.test.ts` | Argumentos con y sin paréntesis, anidamiento, cabeceras campo a campo, dentro-de-cadena, prefijo | — |
| `completionProvider.ts` | 15 | `completionProvider.test.ts` | Ítems/AegisNames según comillas, mobs, mapas, SC_, sprites con `-1` primero, mapflags, umbral de constantes | Orden de resultados |
| `strictCheck.ts` | 10 | `strictCheck.test.ts` | Troceo en bloques, nombres de NPC, multi-NPC con error por bloque, informe embebido, BD vacía | — |
| `serverPath.ts` | 8 | `serverPath.test.ts` | Detección por ascenso y por hermanos, layouts parciales, `~` | — |
| `database.ts` | *indirecto* | vía `testDatabase.ts` y el corpus | Case-insensitivity, sprites, funciones globales | Sin test directo de `index()` |
| `server.ts` (LSP) | *manual* | TESTING.md §1, §7 | Arranque, settings, hover, outline | No automatizado (necesita host LSP) |
| `client/*` (VSCode) | *manual* | TESTING.md §4c, §6 | Comandos, atajos, selectores, runner del map-server | No automatizado (necesita VSCode) |

**Total automatizado: 184 tests en 10 ficheros, más el corpus.**

### Huecos asumidos y por qué

- **`server.ts` y el cliente no tienen tests automatizados.** Probarlos requiere `@vscode/test-electron`, que arranca un VSCode entero por test. El coste no compensa mientras la lógica de negocio esté toda en módulos puros (que es el caso: `server.ts` solo cablea). Si crecen los bugs de cableado, reconsiderar.
- **La grammar TextMate solo se prueba a ojo.** Existe tooling (`vscode-tmgrammar-test`) pero la grammar cambia poco; queda anotado como mejora.
- **El runner del map-server real** se prueba manualmente y solo si tienes el binario compilado. Es opcional por diseño.

---

## 3. El corpus de regresión

`npm run verify` pasa **los dos analizadores** por todo `npc/` de rAthena: 1 139 ficheros, ~26 MB, 5 millones de tokens.

**Criterio de aceptación: exactamente 3 diagnósticos**, todos defectos reales del código oficial, verificados a mano:

```
npc/quests/quests_moscovia.txt:9923 — mismatched-bracket   (paréntesis 5 abren / 6 cierran)
npc/quests/quests_moscovia.txt:9993 — unmatched-close      (cascada del anterior)
npc/pre-re/jobs/novice/novice.txt:2741 — missing-semicolon (return sin ;)
```

- Si salen **más**: hay un falso positivo nuevo. Se arregla el analizador, nunca se sube el umbral.
- Si salen **menos**: o rAthena arregló sus bugs (verificar el commit y actualizar esta lista) o un analizador dejó de detectar algo.
- El umbral está codificado en el flag `--max 3` y el script sale con código ≠ 0 si se supera, listo para CI.

Al actualizar el submódulo/clon de rAthena, correr el corpus es **obligatorio** antes de regenerar los datos empaquetados.

---

## 4. Criterios de aceptación por feature

### 4.1 Diagnósticos rápidos
- Los fixtures dan exactamente lo tabulado: `smoke-test.txt` **0**, `errors-test.txt` **8**, `broken-test.txt` **15**.
- Corpus limpio (§3).
- Responden al teclear sin guardar; desaparecen al corregir.

### 4.2 Parser del map-server
- Los 21 errores de la tabla de TESTING.md §4a salen con el **mensaje literal** de rAthena.
- Las 16 construcciones de §4b se aceptan sin ruido.
- Un fichero con N NPCs rotos da N errores, uno por bloque.
- El hover muestra el informe completo con contexto de ±5 líneas y el carácter entre comillas.
- Solo analiza el fichero abierto. La única información externa es la tabla de símbolos (comandos, constantes, nombres de funciones globales).

### 4.3 Autocompletado contextual
- La tabla de TESTING.md §5a: cada posición ofrece su tipo de valor.
- Dentro de comillas AegisName, fuera ID — en `getitem`, `delitem`, `countitem`, `monster`, `skill`.
- Anidamiento correcto (`getitem getarg(0),|` → argumento 1 de `getitem`).
- Nunca más de 300 entradas por lista.
- Escribir el nombre de un comando no lo convierte en su propio argumento.

### 4.4 Selectores rápidos
- Los cinco atajos abren su selector con la base completa.
- El título anuncia qué se va a insertar y coincide con lo insertado.
- Búsqueda por nombre visible, AegisName e ID indistintamente.
- Cache: primera carga lenta, siguientes instantáneas, `Re-index` la invalida.

### 4.5 Build y paquete
- `tsc --noEmit`, `eslint` y `vitest` limpios.
- `npm run package:full` produce un `.vsix` < 1 MB con `server-data.json` dentro.
- El `.vsix` instala y activa en VSCode y Antigravity.

---

## 5. Procedimientos

### En cada cambio (pre-commit)

```bash
npm run check && npm run lint && npm test
```

### Antes de cada release

```bash
npm run check && npm run lint && npm test     # 184 en verde
npm run verify                                 # exactamente 3
npm run package:full                           # .vsix con datos
```

Después, instalar el `.vsix` y pasar el checklist manual de TESTING.md — como mínimo las secciones marcadas críticas: **§3c falsos positivos**, **§4a mensajes del parser**, **§5a autocompletado por argumento**, **§6 selectores**.

### Al actualizar el clon de rAthena

1. `npm run verify` — si los 3 diagnósticos conocidos cambian, investigar antes de seguir.
2. `npm run gen:data` — regenerar el bundle.
3. Revisar los contadores del README si bailan mucho (comandos/constantes/ítems).

### Al añadir un diagnóstico nuevo

1. Tests unitarios: positivos **y** las exenciones donde no debe saltar.
2. Corpus: cero apariciones nuevas (o defectos reales verificados a mano, que se documentan en §3).
3. Añadir el caso a `broken-test.txt` y su fila a TESTING.md.

---

## 6. Deuda de pruebas (ordenada por valor)

1. **Snapshot del bundle**: un test que regenere `server-data.json` contra un mini-árbol rAthena de fixtures y compare contadores. Cazaría regresiones del generador que hoy solo se ven a mano.
2. **`parseMapFlags`** y **`database.index()`** con un árbol de fixtures en disco.
3. **Grammar TextMate** con `vscode-tmgrammar-test` sobre `smoke-test.txt`.
4. **Tests de integración LSP** con `@vscode/test-electron`, empezando por hover y completion de extremo a extremo.
5. **CI en GitHub Actions**: `check + lint + test` en cada push; `verify` requiere el clon de rAthena (cachearlo o clonarlo shallow en el job).

---

## Historial de bugs con test de regresión

Referencia rápida de por qué existen ciertos tests "raros":

| Bug | Test que lo cubre |
|---|---|
| El regex de `BUILDIN_DEF_DEPRECATED` asignaba la firma a la fecha | `parseSource` › *records the deprecation date without eating the signature* |
| Las líneas `#define` se parseaban como comandos `x`/`x2` | `parseSource` › *ignores the #define lines* |
| `export_constant_npc` perdía 1 312 sprites por el prefijo `JT_` | `parseSource` › *strips the JT_ prefix* |
| Búsquedas case-sensitive rompían `Job_Novice` | `mapServerParser` › *accepts constants in any letter case* |
| Nombres de función con guion (`seven_qset-3`) truncados | `strictCheck` › *accepts calls to indexed global functions* |
| `} while (x);` confundido con cabecera de `while` | `quickCheck` › *flags the tail of a do-while* |
| Comando en escritura tomado como su propio argumento | `completionContext` › *does not treat the command name being typed…* |
| `textDocumentSync` numérico no declara `save` → `onSave` muerto | Manual: TESTING.md §4d *(no automatizable sin host LSP)* |
| ESC literal invisible en el regex ANSI | Lo caza `eslint` (`no-control-regex`) en cada `npm run lint` |
