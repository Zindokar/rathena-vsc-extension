# rAthena Script Tools — Plan de la extensión de VSCode

> Documento de diseño previo a la implementación. Decisiones tomadas en la sesión del 30/07/2026.

---

## 1. Resumen

Extensión de VSCode con **Language Server propio** para el ecosistema rAthena: scripts NPC (`.txt`), bases de datos YAML (`db/**/*.yml`) y ficheros de configuración (`conf/**/*.conf`).

**Identidad provisional:**

| Campo | Valor |
|---|---|
| `name` | `rathena-extension` |
| `displayName` | rAthenaExtension |
| `publisher` | `Zindokar` |
| Identificador | `Zindokar.rathena-extension` |
| Licencia | MIT (compatible con publicar y con usarlo en clase) |
| Repo | GitHub público |

> El campo `name` del `package.json` **debe** ir en minúsculas con guiones (`vsce` lo rechaza si no).
> El nombre bonito «rAthenaExtension» va en `displayName`, que es lo que se ve en el Marketplace.
> El `publisher` hay que registrarlo antes de publicar en https://marketplace.visualstudio.com/manage (requiere cuenta Microsoft + un Personal Access Token de Azure DevOps).

**Destino:** Visual Studio Marketplace (comunidad rAthena) + uso propio + material de ejemplo para alumnado de DAM.

---

## 2. Alcance de la v1

### Incluido

| Feature | NPC `.txt` | YAML `db/` | `.conf` |
|---|:--:|:--:|:--:|
| Resaltado de sintaxis | ✅ | ➖ (nativo) | ✅ |
| Autocompletado + snippets | ✅ | ✅ | ✅ |
| Hover con documentación | ✅ | ✅ | ✅ |
| Diagnósticos | ✅ | ✅ | ✅ |
| Formateo automático | ✅ | ➖ | ➖ |
| Go-to-definition / referencias | ✅ | ✅ | ➖ |
| Outline / breadcrumbs | ✅ | ✅ | ➖ |
| Rename simbólico | ✅ | ➖ | ➖ |
| Wizard de creación de NPC | ✅ | — | — |
| Panel de búsqueda de IDs | ✅ | ✅ | — |

### Fuera de la v1

- Integración con el servidor (`@reloadscript`, lanzar map-server).
- Depuración paso a paso de scripts.
- Soporte para Hercules / eAthena antiguo.

---

## 3. Arquitectura

```
rathena-script-tools/
├── package.json              # manifest: activationEvents, contributes, settings
├── client/
│   └── src/
│       ├── extension.ts      # activate(): arranca el LanguageClient
│       ├── wizards/          # webviews (NPC, warp, shop, mob spawn)
│       └── panels/           # panel de búsqueda de IDs
├── server/
│   └── src/
│       ├── server.ts         # conexión LSP, capabilities
│       ├── lexer.ts          # tokenizador del script engine
│       ├── parser.ts         # descenso recursivo → AST tolerante a errores
│       ├── ast.ts            # tipos de nodo
│       ├── analyzer/         # symbol table, scopes, diagnósticos
│       ├── features/         # completion, hover, definition, rename, format
│       └── data/
│           ├── commandDb.ts  # parseo de doc/script_commands.txt
│           ├── serverDb.ts   # parseo de db/**/*.yml (items, mobs, skills)
│           └── bundled/      # JSON de fallback generado en build
├── syntaxes/                 # TextMate grammars (.tmLanguage.json)
├── snippets/
└── scripts/
    └── generate-bundled-data.ts   # script de build: rAthena → JSON
```

**Comunicación:** LSP estándar sobre Node IPC (`vscode-languageclient` / `vscode-languageserver`).
**Bundling:** esbuild (arranque rápido; requisito de facto del Marketplace).

### 3.1 Estrategia del parser

Lexer + **parser de descenso recursivo escrito a mano en TypeScript**. Motivos:

- El scripting de rAthena no es un lenguaje limpio: mezcla sintaxis tipo C con separadores por tabulador en las cabeceras (`<map>,<x>,<y>,<dir>\tscript\t<nombre>\t<sprite>,{`), etiquetas de color `^FF0000`, y comandos con aridad variable. Una gramática formal pelea contra esto.
- **Tolerancia a errores obligatoria:** el editor recibe código a medio escribir constantemente. Un parser a mano permite insertar nodos `Error` y seguir, que es lo que sostiene el autocompletado.
- Sin build nativo → publicación y CI triviales.

**Pipeline por documento:**

```
texto → Lexer → tokens → Parser → AST (+ errores de sintaxis)
                                    ↓
                              SymbolTable (NPCs, labels, funciones, variables por scope)
                                    ↓
                              Analyzer → Diagnostics
```

Reparseo con *debounce* (~200 ms) en `onDidChangeContent`. Si el rendimiento lo pide, se pasa a reparseo incremental por rango de NPC (cada NPC es una unidad independiente, lo cual ayuda mucho).

### 3.2 Fuente de datos del servidor

> **Corregido tras inspeccionar el repo real.** El plan original decía sacar las firmas de `doc/script_commands.txt` y las constantes de `db/const.txt`. Ambas cosas eran erróneas.

Dos capas, con la primera pisando a la segunda:

1. **Repo rAthena local** (preferente). Setting `rathena.serverPath` — en esta máquina: `/Users/alejandro/rathena`. Con autodetección: buscar hacia arriba desde el workspace y en los directorios hermanos un directorio que contenga `conf/`, `db/`, `npc/` y `src/`.

   | Fichero | Qué aporta | Cantidad real |
   |---|---|---|
   | `src/map/script.cpp` | `BUILDIN_DEF(nombre,"args")` — **firmas autoritativas** | 671 comandos |
   | `src/map/script_constants.hpp` | macros `export_constant*` | 10 690 constantes |
   | `doc/script_commands.txt` | solo las descripciones en prosa | 544 documentados |
   | `db/<modo>/item_db*.yml` | id, AegisName, nombre, tipo | 29 356 ítems |
   | `db/<modo>/mob_db.yml` | id, AegisName, nombre, nivel | 2 675 mobs |
   | `db/map_index.txt` | nombres de mapa | 1 295 mapas |

2. **Datos empaquetados** (fallback). JSON de 3,5 MB generado por `npm run gen:data`. Garantiza que la extensión sirva de algo nada más instalarla.

**Por qué el source y no la documentación.** `doc/script_commands.txt` es prosa escrita para humanos y se desincroniza de la implementación. `BUILDIN_DEF` es lo que el servidor compila, así que no puede estar mal. Su gramática de firma, documentada en `add_buildin_func`, es `(v|s|i|r|l)*\?*\*?`: `v` valor, `s` string, `i` entero, `r` referencia a variable, `l` label, `?` un parámetro opcional, `*` cualquier número más. De ahí salen aridad mínima y máxima gratis.

**Tres trampas descubiertas al implementarlo:**

- **Las búsquedas son case-insensitive.** `calc_hash` en `script.cpp` pasa todo por `TOLOWER`. Los scripts escriben `Job_Novice` 168 veces mientras la constante exportada es `JOB_NOVICE`. Sin esto, miles de falsos positivos.
- **`export_constant_npc(JT_HIDDEN_NPC)` exporta `HIDDEN_NPC`.** Está definido como `export_constant_offset(a,3)`, que recorta los 3 primeros caracteres. Son 1 313 constantes de sprite que un parser ingenuo pierde enteras.
- **Las líneas `#define` del propio fichero se parsean como datos** si no se filtran, generando comandos fantasma llamados `x` y `x2`.

> Sobre el tamaño del bundle: `item_db` completo pasa de 60 000 líneas de YAML. En el JSON empaquetado guardamos solo `{id, aegisName, name, type}`; el detalle completo se lee del repo local cuando existe. Las YAML se escanean línea a línea con regex en vez de con un parser YAML real: solo necesitamos 4 campos por entrada y un parseo completo cuesta segundos y mucha memoria para nada.

### 3.3 Diagnósticos previstos

**Scripts NPC**

- Llaves / paréntesis sin cerrar.
- Cabecera de NPC malformada (tabuladores, coordenadas, mapa inexistente).
- Comando desconocido; número de argumentos incorrecto según `script_commands.txt`.
- Label duplicado dentro del mismo NPC; `goto` a label inexistente.
- ID de item / mob / skill que no existe en la BD indexada.
- Nombre de NPC duplicado en el proyecto (error clásico que revienta el arranque del map-server).
- Variable de scope dudoso: uso de `.@var` fuera de su bloque, `$var` global sin inicializar.
- `end`/`close` faltante al final de un label.

**YAML**

- Validación contra el esquema de cada BD (`Header.Type`, campos requeridos).
- IDs duplicados; referencias cruzadas rotas (p. ej. `Job` inexistente en `item_db`).

**`.conf`**

- Clave desconocida; valor fuera de rango o de tipo incorrecto.

### 3.4 Formatter

Formatter idempotente y conservador (nadie quiere un formatter que le reordene el `npc/` entero):

- Indentación configurable (tab por defecto, que es la convención de rAthena).
- **Tabuladores literales preservados** en cabeceras de NPC — son separadores sintácticos, no espaciado.
- Alineación de `mes` / `menu` / `switch-case`.
- Espaciado normalizado tras comas y alrededor de operadores.
- Respeta `// @formatter:off` … `// @formatter:on`.

---

## 4. Roadmap por fases

**Fase 0 — Preparación** ✅
rAthena clonado. Scaffolding manual (sin `yo code`): TypeScript, esbuild, ESLint, vitest, workspace multi-root, `launch.json` con compound para depurar cliente y servidor a la vez.

**Fase 1 — Highlighting y snippets** ✅
TextMate grammar para script NPC y `.conf`. 21 snippets. *Ya utilizable a diario.*

**Fase 1.5 — Base del LSP** ✅ *(adelantada)*
Lexer completo con scopes de variable y profundidad de llaves. Indexador de datos del servidor. Completion, hover, outline, y diagnósticos a nivel de token. 48 tests unitarios.

**Fase 1.6 — Port del parser del map-server** ✅ *(no estaba en el plan original)*
Port fiel de `parse_script` a TypeScript, con los mensajes de error exactos. Nos da gratis la validación de aridad, los `case` y labels duplicados, y las funciones no declaradas — todo lo que estaba planificado para la Fase 3.

**Fase 2 — Parser y AST propios** ⏳ *siguiente*
Ojo: el parser del map-server **no** sustituye a este. Aquel es de un solo error y no construye árbol; para go-to-definition, rename y formateo hace falta un AST tolerante a errores.

**Fase 3 — Diagnósticos semánticos restantes**
IDs de ítem/mob inexistentes por posición de argumento. Nombres de NPC duplicados en todo el workspace.

**Fase 4 — Navegación**
Go-to-definition, find references, document/workspace symbols, rename.

**Fase 5 — Formatter**

**Fase 6 — Wizards y panel de IDs**
Webviews con el toolkit de UI de VSCode.

**Fase 7 — Publicación**
README con GIFs, icono, CHANGELOG, GitHub Action con `vsce publish`.

---

## 5. Riesgos y decisiones abiertas

| Riesgo | Estado |
|---|---|
| El scripting de rAthena no tiene gramática formal documentada | **Mitigado.** Gramática derivada de `src/map/script.cpp`; `npm run verify` usa los 1 138 scripts oficiales como suite de regresión |
| `script_commands.txt` es prosa, no un formato estructurado | **Resuelto.** Ya no se usa para firmas, solo para descripciones |
| Indexar `db/` completo puede tardar en arrancar | **Medido.** El índice completo tarda menos de 2 s; el análisis de 26 MB de scripts, 1,2 s. Sin problema |
| Tamaño del `.vsix` | **Medido.** 3,5 MB de JSON con solo los campos necesarios |
| Resolución de funciones globales entre ficheros | **Resuelto.** El indexador escanea `npc/` buscando `function<TAB>script<TAB>nombre`. Cuidado: el nombre es un campo delimitado por tabulador, no un identificador C — hay uno llamado `seven_qset-3` con guion y otro `171_worker_talk` que empieza por dígito |

### Verificación

`npm run verify` pasa el lexer y todos los diagnósticos por el árbol `npc/` completo de rAthena. El listón es **cero diagnósticos**.

En rAthena `0c3ca757a` salen exactamente dos, y ambos vienen de un paréntesis de más en el código oficial:

```
npc/quests/quests_moscovia.txt:9923 — Expected '}' to close '{' opened on line 9920, found ')'
```

La línea 9923 tiene 5 paréntesis de apertura y 6 de cierre; la 9924, idéntica salvo por el índice, tiene 5 y 5. Merece un issue upstream.

### Por decidir

- [x] ~~Nombre definitivo y publisher~~ → `Zindokar.rathena-extension`
- [x] ~~Clonar rAthena~~ → `/Users/alejandro/rathena`
- [ ] Registrar el publisher `Zindokar` en el Marketplace (necesario solo en la Fase 7).
- [ ] ¿Soporte pre-renewal además de renewal? (afecta a qué carpeta de `db/` se indexa — probablemente un setting `rathena.mode: "re" | "pre-re"`).
- [ ] ¿Idioma de la UI: inglés (Marketplace) con localización al español?

---

## 6. Siguiente paso

Montar el scaffolding de la Fase 0 y el workspace multi-root.
