# Plan de pruebas manual — rAthenaExtension v0.4.0

Cobertura completa de todo lo implementado. El análisis es **siempre de un solo fichero**: ni el parser rápido ni el del map-server miran otros archivos, así que puedes probar cada bloque de forma aislada.

## Preparación

```bash
cd ~/rathena_ext
npm install
npm run package:full
"/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" --install-extension rathena-extension-0.4.0.vsix
```

O abre `rathena-extension.code-workspace` y pulsa <kbd>F5</kbd>.

**Ficheros de prueba** en `test-fixtures/npc/`:

| Fichero | Para qué |
|---|---|
| `smoke-test.txt` | Todo correcto. **Cero** subrayados |
| `errors-test.txt` | Seis fallos aislados → **ocho** subrayados |
| `broken-test.txt` | Trece fallos mezclados con código correcto → **quince** subrayados |
| `scratch.txt` | Vacío, para pegar los bloques de `COPY-PASTE.md` |

> El lenguaje se activa con el patrón `**/npc/**/*.txt`. Por eso están dentro de una carpeta `npc/`.

**Números de referencia** tras indexar: 671 comandos, 10 690 constantes, 29 356 ítems, 2 675 mobs, 1 635 skills, 1 295 mapas, 70 mapflags, 1 312 sprites.

---

## 1. Arranque e indexado

- [ ] La barra de estado pone **`rAthena Script`** al abrir `smoke-test.txt`.
- [ ] `View → Output` → canal **`rAthena Language Server`** → `Indexed 671 commands, 10690 constants, 29356 items and 2675 mobs in ~N ms`.
- [ ] **`rAthena: Show Detected Server Path`** → `/Users/alejandro/rathena`.
- [ ] **`rAthena: Re-index Server Database`** → sin error, y las cachés de los selectores se vacían.
- [ ] **`rAthena: Restart Language Server`** → se reinicia y sigue funcionando.
- [ ] Pon `rathena.serverPath` a una ruta inválida → el Output avisa y el autocompletado cae a los datos empaquetados.
- [ ] Bórralo del todo → la autodetección lo encuentra solo (sube desde el workspace y mira las carpetas hermanas).

---

## 2. Resaltado de sintaxis

Sobre `smoke-test.txt`:

- [ ] **Cabecera**: mapa, coordenadas, `script` y nombre, cada uno de un color.
- [ ] **Códigos de color**: `^0055FF` y `^000000` se distinguen dentro de la cadena.
- [ ] **Los nueve scopes**: `.@` `.` `'` `@` plano `#` `##` `$` `$@` por familias.
- [ ] **Sufijo `$`**: `.@nombre$` se ve como cadena.
- [ ] **Parámetros integrados**: `Zeny`, `BaseLevel` distintos de una variable normal.
- [ ] **Constantes**: `SC_INCREASEAGI`, `EF_HEAL2`, `Job_Novice`, `HIDDEN_NPC`.
- [ ] **Labels**: `OnInit:` y `OnPCLoginEvent:` distintos de `L_EtiquetaPropia:`.
- [ ] **Hexadecimal**: `0xFF00`.
- [ ] **Comentarios**: la banda `//===== =====` distinta de un `//` suelto.
- [ ] **Definiciones**: `duplicate(...)`, `warp`, `shop`, `monster`, `boss_monster`, `mapflag`.
- [ ] **`.conf`**: abre `~/rathena/conf/battle/skill.conf` — claves, `yes/no` y números coloreados.

---

## 3. Diagnósticos rápidos (al teclear)

### 3a. `errors-test.txt` — ocho

| Línea | Código |
|---|---|
| 9 | `header-needs-tabs` |
| 15 | `unknown-command` |
| 21 | `unterminated-string` |
| 21 | `missing-semicolon` *(arrastre)* |
| 28 | `mismatched-bracket` |
| 30 | `unmatched-close` *(arrastre)* |
| 35 | `mismatched-bracket` |
| 42 | `unclosed-bracket` |

### 3b. `broken-test.txt` — quince

| Línea | Código | Fallo |
|---|---|---|
| 14 | `missing-semicolon` | tras un `mes` |
| 18 | `missing-semicolon` | en una asignación |
| 42 | `missing-semicolon` | en `sc_start` dentro de un `case` |
| 46 | `missing-semicolon` | en una llamada |
| 50 | `missing-semicolon` | dentro de `OnInit` |
| 56 | `unknown-command` | `mees` |
| 57 | `unknown-command` | `dispbotom` |
| 66 | `missing-semicolon` | cierre de `do-while` |
| 72 | `unterminated-string` | |
| 72 | `missing-semicolon` | *(arrastre)* |
| 79 | `mismatched-bracket` | paréntesis de más |
| 81 | `unmatched-close` | *(arrastre)* |
| 86 | `mismatched-bracket` | `[` cerrado con `)` |
| 91 | `header-needs-tabs` | |
| 98 | `unclosed-bracket` | |

### 3c. Falsos positivos — lo más importante

Ninguno de estos debe avisar:

- [ ] `if (cond)` con el cuerpo debajo, sin llaves.
- [ ] Cabecera de `for` en una línea, cuerpo en otra.
- [ ] Cadena partida con `+` al final de línea.
- [ ] Cadena partida con `+` al principio de la siguiente.
- [ ] `sprintf(...)` con argumentos en tres líneas.
- [ ] Subíndice de array repartido en varias líneas.
- [ ] `case 1:`, `default:`, `OnInit:`, `L_Mia:`.
- [ ] `} while (x);` correcto (compáralo con el `do` sin `while` de `broken-test`).
- [ ] Líneas de definición de nivel superior: `warp`, `monster`, `shop`, `mapflag`.
- [ ] `Zeny -= 100;`, `contador++;`, `array[0] = 1;`.
- [ ] Función local con declaración adelantada.

### 3d. Comportamiento

- [ ] Aparecen en **Problems** (<kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>M</kbd>).
- [ ] Se actualizan mientras escribes, sin guardar.
- [ ] Al arreglar el error, el subrayado desaparece.
- [ ] `"rathena.diagnostics.enable": false` → desaparecen todos.
- [ ] `"rathena.diagnostics.unknownIds": false` → desaparece solo `unknown-command`.

### 3e. Scripts oficiales

- [ ] `~/rathena/npc/custom/healer.txt` → cero.
- [ ] Tres o cuatro scripts al azar → cero.
- [ ] `quests_moscovia.txt:9923` → sí avisa. Es un bug real de rAthena: cinco paréntesis de apertura y seis de cierre.
- [ ] `pre-re/jobs/novice/novice.txt:2741` → sí avisa. Un `return` sin `;`.

---

## 4. Parser del map-server (fichero actual)

Port fiel de `parse_script`. Da el mensaje exacto de rAthena y **solo mira el fichero abierto**. Corre al guardar o con <kbd>Cmd</kbd>+<kbd>Alt</kbd>+<kbd>C</kbd>.

### 4a. Lo que solo detecta este

Pega cada uno en `scratch.txt` y guarda:

| Escribe | Debe decir |
|---|---|
| `percentheal 100;` | `parse_callfunc: not enough arguments, expected ','` |
| `if .@a == 1 end;` | `need '('` |
| `switch 1 { }` | `need '('` |
| `while .@a { }` | `need '('` |
| `switch(1){ case 1: case 1: }` | `parse_syntax: dup 'case'` |
| `switch(1){ default: default: }` | `parse_syntax: dup 'default'` |
| `case 1:` fuera de un switch | `parse_syntax: unexpected 'case'` |
| `default:` fuera de un switch | `parse_syntax: unexpected 'default'` |
| `break;` fuera de bucle | `parse_syntax: unexpected 'break'` |
| `continue;` fuera de bucle | `parse_syntax: unexpected 'continue'` |
| `L_A:` dos veces | `set_label: dup label L_A` |
| `.@a = 1 ? 2;` | `parse_subexpr: expected ':'` |
| `do { }` sin `while` | `parse_syntax: expected 'while'` |
| `function SF_X;` sin definir | `unresolved function references` |
| `function ;` | `function name is missing or invalid` |
| `function SF_A end;` | `expect ';' or '{' at function syntax` |
| `mes = 1;` | `Cannot modify a variable which has the same name as a function or label.` |
| `mes "a"` sin `;` | `parse_line: expected ';'` |
| `mes "abc;` | `parse_simpleexpr: unexpected newline @ string` |
| Cuerpo sin cerrar | `unexpected end of script` |

### 4b. Lo que debe aceptar sin rechistar

- [ ] `if` / `else if` / `else` encadenados.
- [ ] `for`, `while`, `do-while` correctos.
- [ ] `switch` con `case` y `default`.
- [ ] Labels y `goto`.
- [ ] Función local declarada y definida.
- [ ] Los nueve scopes de variable.
- [ ] Asignaciones compuestas: `+=`, `<<=`, `++`, `--` pre y post.
- [ ] Ternarios y subíndices de array.
- [ ] Constantes en cualquier caja: `job_novice` y `JOB_NOVICE`.
- [ ] `smoke-test.txt` entero → cero errores.
- [ ] `~/rathena/npc/custom/healer.txt` → cero errores.

### 4c. El informe completo

- [ ] Pasa el ratón por un subrayado → sale el bloque en formato rAthena: cabecera con fichero y línea, mensaje indentado, cinco líneas de contexto a cada lado, la culpable marcada con `*` y el carácter entre comillas simples.
- [ ] <kbd>Cmd</kbd>+<kbd>Alt</kbd>+<kbd>C</kbd> → notificación con fichero y línea, botones *Go to error* y *Show details*.
- [ ] *Go to error* → el cursor salta al sitio exacto.
- [ ] *Show details* → canal **rAthena Script Check** con todos los informes.
- [ ] Un fichero con tres NPCs rotos → **tres** errores, uno por NPC. El servidor parsea cada uno por separado, así que un fallo no tapa el siguiente.

### 4d. Modos

- [ ] `"rathena.strictParser": "onSave"` (por defecto) → solo al guardar.
- [ ] `"onType"` → al teclear, y parpadea con código a medias. Por eso no es el defecto.
- [ ] `"off"` → nada automático, pero <kbd>Cmd</kbd>+<kbd>Alt</kbd>+<kbd>C</kbd> sigue funcionando.

### 4e. Discrepancia deliberada entre los dos analizadores

- [ ] `quests_moscovia.txt:9923` → el rápido avisa, el del map-server **no**.

No es un fallo. `parse_line` remata una asignación con `parse_syntax_close(p2 + 1)`, y ese `+ 1` se traga un carácter sin comprobar que sea un `;`. El `)` sobrante cae ahí. Es una errata que conviene arreglar, y al servidor le da igual. Por eso mantengo los dos.

---

## 5. Autocompletado contextual

Lo que se ofrece depende de dónde esté el cursor. <kbd>Ctrl</kbd>+<kbd>Espacio</kbd> lo fuerza; también salta solo tras una coma, un espacio o una comilla.

### 5a. Argumentos de comandos

| Escribe y pulsa <kbd>Ctrl</kbd>+<kbd>Espacio</kbd> | Debe ofrecer |
|---|---|
| `getitem ` | **IDs de ítem** ordenados por número, con el nombre al lado |
| `getitem "` | **AegisNames** (`Red_Potion`), con el nombre visible como detalle |
| `getitem "Red_` | Filtrado: solo los que contienen `Red_` |
| `getitem 501,` | Genérico (el argumento es una cantidad, no tiene semántica) |
| `delitem `, `countitem(`, `makeitem `, `rentitem ` | IDs de ítem |
| `monster "` | **Nombres de mapa** |
| `monster "prt_fild00",0,0,"x",` | **IDs de mob** |
| `areamonster ` | Mapa en el argumento 0, mob en el 6 |
| `sc_start ` | Constantes **`SC_`** |
| `specialeffect `, `specialeffect2 ` | Constantes **`EF_`** |
| `skill ` | **IDs de skill** con su nombre |
| `skill "` | **Nombres de skill** (`SM_BASH`) |
| `warp "` | Nombres de mapa |
| `savepoint "` | Nombres de mapa |

- [ ] Busca por número: `getitem 50` → filtra por ID.
- [ ] Busca por nombre visible: `getitem "potion` → encuentra `Red_Potion`, `Orange_Potion`…
- [ ] Busca por AegisName: `getitem "Red_Pot` → `Red_Potion`.
- [ ] **Anidado**: en `getitem getarg(0),|` el cursor es el argumento **1 de `getitem`**, no un argumento de `getarg`.
- [ ] Tras un `;`, el siguiente comando empieza de cero.

### 5b. Líneas de definición

| Dónde | Debe ofrecer |
|---|---|
| Primer campo (`pro`) | **Nombres de mapa** |
| Segundo campo | `script`, `shop`, `cashshop`, `warp`, `monster`, `mapflag`, `duplicate`… con su descripción |
| Cuarto campo de un `script` | **Sprites**, con `-1` (invisible) y `HIDDEN_NPC` los primeros |
| Cuarto campo de un `shop` o un `duplicate` | Sprites |
| Tras `mapflag` | Los **70 mapflags** |

### 5c. Cordura

- [ ] Escribiendo el nombre de un comando (`ge`) → salen **comandos**, no argumentos de un comando llamado `ge`.
- [ ] Con una sola letra → comandos pero **no** constantes. Con 10 690, una lista sin filtrar no sirve de nada.
- [ ] Con dos letras o más → también constantes.
- [ ] Dentro de un comentario → no molesta.
- [ ] Las listas se cortan en 300 entradas; VS Code sigue fluido con 29 356 ítems indexados.

---

## 6. Selectores rápidos

Para cuando no recuerdas el nombre. Buscador difuso sobre la base entera.

| Atajo | Comando | Inserta |
|---|---|---|
| <kbd>Cmd</kbd>+<kbd>Alt</kbd>+<kbd>I</kbd> | Insert Item | ID o AegisName |
| <kbd>Cmd</kbd>+<kbd>Alt</kbd>+<kbd>B</kbd> | Insert Monster | ID o AegisName |
| <kbd>Cmd</kbd>+<kbd>Alt</kbd>+<kbd>K</kbd> | Insert Skill | ID o nombre |
| <kbd>Cmd</kbd>+<kbd>Alt</kbd>+<kbd>G</kbd> | Insert NPC Sprite | Siempre el nombre |
| <kbd>Cmd</kbd>+<kbd>Alt</kbd>+<kbd>L</kbd> | Insert Map Name | Siempre el nombre |

- [ ] <kbd>Cmd</kbd>+<kbd>Alt</kbd>+<kbd>I</kbd> con el cursor **fuera** de comillas → inserta el **número**. El título lo anuncia: *"inserting the ID"*.
- [ ] Con el cursor **dentro** de comillas → inserta el **AegisName**. Título: *"inserting the name"*.
- [ ] Busca por nombre visible (`red potion`), por AegisName (`Red_Potion`) y por ID (`501`).
- [ ] <kbd>Cmd</kbd>+<kbd>Alt</kbd>+<kbd>B</kbd> → busca `poring`, inserta `1002`.
- [ ] <kbd>Cmd</kbd>+<kbd>Alt</kbd>+<kbd>G</kbd> en el campo sprite → busca `kafra`.
- [ ] <kbd>Cmd</kbd>+<kbd>Alt</kbd>+<kbd>L</kbd> → busca `prontera`.
- [ ] La primera vez tarda un poco (carga la lista); a partir de ahí es instantáneo.
- [ ] Tras **Re-index**, la caché se vacía y vuelve a cargar.
- [ ] <kbd>Esc</kbd> → no inserta nada.
- [ ] Con selección activa → la reemplaza.

Si algún atajo choca con otro tuyo, cámbialo en *Keyboard Shortcuts*. Solo se activan con un fichero de rAthena enfocado.

---

## 7. Hover

Sobre `smoke-test.txt`:

- [ ] Comando `percentheal` → firma, `Arity: 2–3 · signature "ii?"` y descripción.
- [ ] Comando variádico `mes` → `Arity: 1+`.
- [ ] Comando sin documentar → al menos la firma derivada.
- [ ] Constante `SC_INCREASEAGI` → la reconoce.
- [ ] Constante en otra caja `Job_Novice` → avisa de que está definida como `JOB_NOVICE`.
- [ ] Sprite `HIDDEN_NPC` → constante.
- [ ] ID de ítem `501` → **Red Potion**.
- [ ] Nombre de ítem `"Apple"`.
- [ ] ID de mob `1002` → **Poring**; `1039` → **Baphomet, nivel 81**.
- [ ] Variable `.@precio` → scope `scope`, entero.
- [ ] Variable `.@nombre$` → cadena.
- [ ] Variable `##puntos_globales` → `account-global`.

---

## 8. Outline y navegación

- [ ] <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>O</kbd> en `smoke-test.txt` → `Zindokar Test`, `Flotante Test`, `F_TestGlobal`, `warp_test`, `Tienda Test`…
- [ ] Cada NPC despliega sus labels.
- [ ] Los labels de evento (`On*`) con icono distinto de los propios.
- [ ] Breadcrumbs correctos al hacer scroll.
- [ ] Pruébalo en un fichero grande: `~/rathena/npc/re/merchants/shops.txt`.

---

## 9. Snippets

Prefijo + <kbd>Tab</kbd>:

`npc` · `npctouch` · `npcfloat` · `func` · `dup` · `warp` · `shop` · `cashshop` · `monster` · `bossmonster` · `mapflag` · `oninit` · `onevent` · `select` · `mesblock` · `ifelse` · `for` · `foreach` · `checkweight` · `questguard` · `header`

- [ ] `npc` → cabecera con placeholders navegables por <kbd>Tab</kbd>.
- [ ] `mapflag` → desplegable de mapflags en el segundo campo.
- [ ] `onevent` → desplegable de labels de evento.
- [ ] `select` → menú `switch` completo.
- [ ] `header` → cabecera estándar de fichero.
- [ ] **Los tabuladores son tabuladores de verdad** en las cabeceras generadas. Actívalo con `View → Render Whitespace`. Si salieran espacios, el map-server no cargaría el NPC.

---

## 10. Ajustes

- [ ] `rathena.serverPath` — ruta inválida y ruta correcta.
- [ ] `rathena.mode` — `pre-renewal` y re-indexar → cambia el número de ítems.
- [ ] `rathena.diagnostics.enable`
- [ ] `rathena.diagnostics.unknownIds`
- [ ] `rathena.strictParser` — los tres modos.
- [ ] `rathena.trace.server` — `verbose` llena el Output de mensajes LSP.

---

## 11. Rendimiento

- [ ] Abre `~/rathena/npc/re/quests/quests_17_1.txt` (de los más gordos) → sin tirones al escribir.
- [ ] Guarda → el parser estricto tarda un parpadeo.
- [ ] `npm run verify` → 1 139 ficheros, ~26 MB, unos 3 s, **3 diagnósticos** (los dos bugs reales de rAthena).
- [ ] `npm test` → **151 tests** en verde.

---

## Lo que todavía NO funciona

| Cosa | Estado |
|---|---|
| **Formateo automático** | El ajuste `rathena.format.indentStyle` existe pero no hay formatter. <kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>F</kbd> no hace nada |
| **Ir a definición / referencias / renombrar** | Necesitan el AST propio |
| **Validación de YAML** | Los `db/**/*.yml` no se analizan |
| **`.conf`** | Solo resaltado |
| **IDs inexistentes** | El autocompletado los ofrece, pero usar un ID que no existe no se marca todavía |

---

## Si algo falla

1. `View → Output` → **rAthena Language Server** para errores del servidor.
2. `Help → Toggle Developer Tools` → Console para errores del cliente.
3. F5 con la configuración **Extension + Server** para poner breakpoints en el parser.

Apunta **fichero y línea** y lo miramos.
