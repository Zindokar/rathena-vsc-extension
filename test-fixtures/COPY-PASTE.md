# Snippets de copiar y pegar

Para probar la extensión sin tener que inventar nada. Cada bloque se pega en un fichero `.txt` **dentro de una carpeta `npc/`** (si no, VSCode no activa el lenguaje).

La forma más cómoda: abre `test-fixtures/npc/scratch.txt`, borra lo que haya y pega el bloque que quieras probar.

> ⚠️ **Los tabuladores importan.** Las líneas de cabecera de rAthena van separadas por tabuladores, no espacios. Si al copiar de aquí se te convierten en espacios, la extensión te lo dirá con `header-needs-tabs` — que también es una forma de comprobar que funciona. Activa `View → Render Whitespace` para verlos.
>
> Todos los resultados de abajo están verificados contra la versión 0.1.0.

---

## A. Diagnósticos rápidos (aparecen al teclear)

### A1 — Falta el punto y coma

```
prontera,150,180,4	script	A1	100,{
	mes "hola"
	end;
}
```

`[rápido]` L2 — `Missing ';' at the end of the statement.`
`[estricto]` L3 — `parse_line: expected ';'`

Fíjate en que señalan líneas distintas: el rápido marca donde falta, el del map-server marca donde se atragantó.

### A2 — Cabecera con espacios en vez de tabuladores

```
prontera,150,180,4 script A2 100,{
	end;
}
```

`[rápido]` L1 — `Fields in a 'script' definition must be separated by tabs, not spaces.`

El parser estricto no dice nada aquí, y es correcto: quien rechaza esta línea es el cargador de ficheros del servidor, no `parse_script`.

### A3 — Comando mal escrito

```
prontera,150,180,4	script	A3	100,{
	mees "hola";
	end;
}
```

`[rápido]` L2 — `Unknown script command 'mees'.`
`[estricto]` L2 — `parse_line: expect command, missing function name or calling undeclared function`

### A4 — Cadena sin cerrar

```
prontera,150,180,4	script	A4	100,{
	mes "sin cerrar;
	end;
}
```

`[rápido]` L2 — `Unterminated string literal.` y `Missing ';'` (arrastre: al comerse la comilla se come el `;`)
`[estricto]` L2 — `parse_simpleexpr: unexpected newline @ string`

### A5 — Llave sin cerrar

```
prontera,150,180,4	script	A5	100,{
	end;
```

`[rápido]` L1 — `'{' is never closed.`
`[estricto]` L2 — `unexpected end of script`

### A6 — Corchete cerrado con paréntesis

```
prontera,150,180,4	script	A6	100,{
	.@v = .@a[0);
	end;
}
```

`[rápido]` L2 — `Expected ']' to close '[' opened on line 2, found ')'.`
`[estricto]` L4 — `Missing right expression or closing bracket for variable.`

---

## B. Solo los caza el parser del map-server

Estos **no** producen nada al teclear. Guarda el fichero (<kbd>Cmd</kbd>+<kbd>S</kbd>) o pulsa <kbd>Cmd</kbd>+<kbd>Alt</kbd>+<kbd>C</kbd>.

Pasa el ratón por el subrayado para ver el informe completo en el formato de rAthena, con cinco líneas de contexto a cada lado y el carácter culpable entre comillas.

> <kbd>Cmd</kbd>+<kbd>Alt</kbd>+<kbd>C</kbd> es **rAthena: Check Syntax**. Analiza solo el fichero abierto, tarda milisegundos y no necesita nada instalado.

### B1 — Faltan argumentos

```
prontera,150,180,4	script	B1	100,{
	percentheal 100;
	end;
}
```

L2 — `parse_callfunc: not enough arguments, expected ','`

`percentheal` tiene firma `ii?`: dos enteros obligatorios. Esta es la validación de aridad, y sale gratis de las firmas `BUILDIN_DEF`.

### B2 — `if` sin paréntesis

```
prontera,150,180,4	script	B2	100,{
	if .@a == 1 end;
}
```

L2 — `need '('`

### B3 — `case` duplicado

```
prontera,150,180,4	script	B3	100,{
	switch (1) {
	case 1:
		break;
	case 1:
		break;
	}
	end;
}
```

L5 — `parse_syntax: dup 'case'`

### B4 — `default` duplicado

```
prontera,150,180,4	script	B4	100,{
	switch (1) {
	default:
		break;
	default:
		break;
	}
	end;
}
```

L5 — `parse_syntax: dup 'default'`

### B5 — Label duplicado

```
prontera,150,180,4	script	B5	100,{
L_A:
	end;
L_A:
	end;
}
```

L4 — `set_label: dup label L_A`

### B6 — `break` fuera de un bucle

```
prontera,150,180,4	script	B6	100,{
	break;
}
```

L2 — `parse_syntax: unexpected 'break'`

### B7 — Ternario sin los dos puntos

```
prontera,150,180,4	script	B7	100,{
	.@a = 1 ? 2;
	end;
}
```

L2 — `parse_subexpr: expected ':'`

### B8 — `do` sin `while`

```
prontera,150,180,4	script	B8	100,{
	do {
		.@i++;
	}
	end;
}
```

L5 — `parse_syntax: expected 'while'`

### B9 — Función declarada y nunca definida

```
prontera,150,180,4	script	B9	100,{
	function SF_X;
	end;
}
```

L4 — `parse_script: unresolved function references (function 'SF_X' declared but not defined)`

### B10 — Asignar a un nombre de comando

```
prontera,150,180,4	script	B10	100,{
	mes = 1;
	end;
}
```

L2 — `Cannot modify a variable which has the same name as a function or label.`

---

## C. Esto NO debe dar ni un aviso

Son los casos que más fácilmente provocan falsos positivos. Si alguno se subraya, es un bug.

### C1 — Mezcla de construcciones correctas

```
prontera,150,180,4	script	C1	100,{
	if (Zeny < 100)
		close;
	for (.@i = 0; .@i < 3; .@i++) {
		dispbottom "x";
	}
	.@t$ = "parte " +
		"y parte";
	mes sprintf("%d %d",
		1,
		2);
	switch (select("A:B")) {
	case 1:
		break;
	default:
		break;
	}
	end;

OnInit:
	end;
}
```

Un `if` sin llaves, una cabecera de `for` en su línea, una cadena partida con `+` al final, argumentos repartidos en tres líneas, `case`, `default` y un label de evento. **Cero avisos.**

### C2 — `do-while` correcto

```
prontera,150,180,4	script	C2	100,{
	.@i = 0;
	do {
		.@i++;
	} while (.@i < 3);
	end;
}
```

Este lleva `;` al final y B8 no. Distinguirlos obliga a mirar si el token anterior al `while` es una `}`.

### C3 — Función local declarada y definida

```
prontera,150,180,4	script	C3	100,{
	function SF_Hola;
	SF_Hola();
	end;

	function SF_Hola {
		mes "hola";
		return;
	}
}
```

La declaración adelantada es obligatoria en rAthena si llamas antes de definir. Quítala y verás saltar B9 al revés.

### C4 — Los nueve scopes de variable

```
prontera,150,180,4	script	C4	100,{
	.@a = 1;
	.b = 2;
	'c = 3;
	@d = 4;
	e = 5;
	#f = 6;
	##g = 7;
	$h = 8;
	$@i = 9;
	.@j$ = "texto";
	Zeny -= 10;
	end;
}
```

Cada sigilo debe salir de un color distinto, y `Zeny` distinto de una variable normal.

---

## D. Lo que hay que probar a mano

Pega este bloque y pasa el ratón o pulsa <kbd>Ctrl</kbd>+<kbd>Espacio</kbd> donde se indica:

```
prontera,150,180,4	script	D1	100,{
	percentheal 100,100;
	sc_start SC_INCREASEAGI,240000,10;
	getitem 501,10;
	getitem "Apple",1;
	.@precio = 5000;
	.@nombre$ = "texto";
	if (Class == Job_Novice) end;
	end;
}
prt_fild00,0,0	monster	Poring	1002,10,5000
```

| Dónde | Qué esperar |
|---|---|
| Ratón sobre `percentheal` | Firma, `Arity: 2–3 · signature "ii?"` y descripción |
| Ratón sobre `SC_INCREASEAGI` | Lo reconoce como constante |
| Ratón sobre `Job_Novice` | Avisa de que está definida como `JOB_NOVICE` |
| Ratón sobre el `501` | **Red Potion** |
| Ratón sobre el `1002` | **Poring** |
| Ratón sobre `.@nombre$` | Scope `scope`, tipo cadena |
| Escribe `getit` + <kbd>Ctrl</kbd>+<kbd>Espacio</kbd> | `getitem`, `getitem2`, `getitembound`… |
| Escribe `SC_INC` + <kbd>Ctrl</kbd>+<kbd>Espacio</kbd> | Constantes `SC_INCREASEAGI`, `SC_INCSTR`… |
| Escribe una sola letra | Salen comandos pero **no** constantes (a propósito) |
| <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>O</kbd> | Outline con `D1` y sus labels |

### Snippets

En un hueco vacío, escribe el prefijo y pulsa <kbd>Tab</kbd>:

`npc` · `npctouch` · `npcfloat` · `func` · `dup` · `warp` · `shop` · `cashshop` · `monster` · `bossmonster` · `mapflag` · `oninit` · `onevent` · `select` · `mesblock` · `ifelse` · `for` · `foreach` · `checkweight` · `questguard` · `header`

Los interesantes: `mapflag` y `onevent` abren un **desplegable** de valores posibles, y `header` te suelta la cabecera estándar de fichero de rAthena.
