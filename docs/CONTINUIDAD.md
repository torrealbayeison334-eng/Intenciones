# Continuar o reconstruir Intenciones

GitHub conserva el código, las imágenes, las funciones, el esquema y los permisos de la base. La aplicación puede reconstruirse en otro proyecto Supabase. Este repositorio público **no es un respaldo de las cuentas ni de los mensajes reales**.

## Ubicaciones vigentes

- Repositorio: https://github.com/torrealbayeison334-eng/Intenciones, rama `main`, cuenta `torrealbayeison334-eng`.
- Sitio: https://intenciones.torrealbayeison334.workers.dev . Cloudflare Worker: `intenciones`.
- Supabase: https://supabase.com/dashboard/project/nlfujsfwocdferdjxttm, nombre `intenciones prueba`.
- Configuración pública: [configuracion-publica.json](configuracion-publica.json). Las claves publishable y la Site key de Turnstile son públicas; los secretos privados no están en ese archivo.
- Los proyectos `pgyvnfgxynlodfuzdzbx` y `bmdofvnwptrwbjqfmyhl` y el repositorio `Yeivt/Yeivt` son históricos. No aplicar cambios allí.

## Archivos que permiten reconstruir la aplicación

| Contenido | Ubicación |
| --- | --- |
| Sitio y bandeja | `src/` |
| Imágenes, fuentes empaquetadas y PWA | `public/`, dependencias fijadas y `package-lock.json` |
| Esquema, RLS, permisos y funciones SQL | `supabase/migrations/` |
| Instalación SQL en una base vacía | `supabase/bootstrap.sql` |
| Registro, ingreso, recuperación y envío | `supabase/functions/` |
| Borrado automático y comprobaciones | `supabase/schedule.sql`, `supabase/verify.sql` |
| Alojamiento estático de Workers | `wrangler.jsonc` |
| Pruebas y capturas ficticias | `tests/`, `docs/VALIDATION.md`, `docs/screenshots/` |
| Decisiones y operación | `docs/PROJECT.md`, `docs/DEPLOYMENT.md`, `docs/ACTIVACION-INTENCIONES.md` |

## Conservar de forma privada antes de perder acceso

Guardar en un gestor de contraseñas o copia cifrada:

- Acceso y métodos de recuperación de las cuentas nuevas de GitHub, Cloudflare y Supabase.
- Contraseña de la base de datos Supabase.
- `RATE_LIMIT_SECRET` e `INTERCESSOR_REGISTRATION_SECRET`: los valores del generador local.
- Secret key de Turnstile, guardada como `TURNSTILE_SECRET_KEY`.
- El enlace completo de alta, cuya clave debe coincidir con `INTERCESSOR_REGISTRATION_SECRET`.

`APP_ORIGIN` es público: `https://intenciones.torrealbayeison334.workers.dev`. Los valores privados se guardaron en el panel y no se copiaron al código. Si se pierde la clave de invitación, se puede generar otra y distribuir un enlace nuevo. El proyecto Supabase nuevo debe usar sus propias claves de servicio, inyectadas en las funciones; nunca una variable `PUBLIC_*`.

### Copia privada de datos y cuentas

**No se realizó una exportación privada de datos durante el guardado en GitHub.** Para conservar las cuentas también se necesitan los registros de Auth; exportar solo `public.members` no alcanza.

Seguir la guía oficial de [Backup and Restore using the CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore). Requiere la conexión **Session pooler** de Connect, su contraseña, Supabase CLI y Docker. La guía exporta roles, esquema y datos con estos comandos (el marcador no es una credencial real):

```sh
supabase db dump --db-url '[CONEXION_PRIVADA]' -f roles.sql --role-only
supabase db dump --db-url '[CONEXION_PRIVADA]' -f schema.sql
supabase db dump --db-url '[CONEXION_PRIVADA]' -f data.sql --use-copy --data-only -x storage.buckets_vectors -x storage.vector_indexes
```

Ejecutarlos desde una carpeta privada fuera del repositorio, no pegar la conexión en el chat y no guardar la contraseña literal en un script compartido. Verificar que la copia incluya `auth.users`, `auth.identities` y las tablas de la aplicación antes de depender de ella. La misma guía explica cómo conservar el historial `supabase_migrations` y restaurar en otro proyecto.

Los SQL de datos contienen nombres, mensajes y hashes de contraseñas o recuperación: no subirlos a GitHub, issues o releases públicos. `private-backups/` y los nombres habituales de los dumps están ignorados como precaución adicional. El respaldo SQL no incluye los secretos de Edge Functions ni la configuración de Cloudflare/Turnstile. Las fotografías están en Git, no en Supabase Storage.

La copia privada tiene una retención distinta de los mensajes de la base activa: definir cuánto tiempo conservarla y eliminarla cuando corresponda. No hace falta conservar textos para mantener los contadores acumulados.

## Reconstruir desde el código en un proyecto nuevo

Este recorrido crea una instalación vacía. Si existe un respaldo privado completo, usar la restauración de la guía oficial y no superponerla sin revisar el esquema.

1. Crear el proyecto Supabase nuevo y obtener su URL y su clave pública publishable.
2. En SQL Editor, ejecutar [supabase/bootstrap.sql](../supabase/bootstrap.sql). Reúne las cuatro migraciones locales, en orden y dentro de una transacción. Se rechaza si detecta las tablas principales. **No ejecutarlo en el proyecto actual.**
3. Ejecutar [supabase/schedule.sql](../supabase/schedule.sql) para programar la limpieza cada cinco minutos.
4. Guardar los cuatro secretos de aplicación en el proyecto nuevo. Usar el origen real del sitio en `APP_ORIGIN` y autorizar ese hostname en Turnstile.
5. En Authentication → Sign In / Providers, mantener Email habilitado para contraseñas y desactivar **Allow new users to sign up**. La función de alta usa Admin Auth, sin aprobación ni correo.
6. Desplegar `intercessor-auth` y `submit-intention` desde este repositorio. `supabase/config.toml` configura `verify_jwt=false` porque las funciones implementan validación propia del origen, la invitación, la contraseña o el captcha. Las funciones antiguas de solicitudes y correo ya no participan.
7. En Cloudflare → Settings → Build: `npm run build`, `npx wrangler deploy`, rama `main`, `NODE_VERSION=22`. Actualizar `PUBLIC_SUPABASE_URL` y `PUBLIC_SUPABASE_ANON_KEY`, mantener la Site key correcta y establecer `PUBLIC_DEMO_MODE=false`. Compilar y publicar otra vez.
8. Cerrar la sesión anterior en la web. Si se restauró Auth, volver a ingresar. Sin respaldo de Auth, las cuentas deben darse de alta nuevamente mediante el enlace privado. Las sesiones del proyecto anterior pueden no servir en el nuevo.
9. Ejecutar `supabase/verify.sql` y comprobar registro, ingreso, recuperación, envío, lectura compartida y retención con datos ficticios.

Para actualizar el SQL de instalación después de agregar migraciones:

```sh
node scripts/prepare-bootstrap.mjs
```

El proyecto vigente tiene un historial remoto combinado: ver [ACTIVACION-INTENCIONES.md](ACTIVACION-INTENCIONES.md). El bootstrap no registra ni reconcilia ese historial. Antes de ejecutar `supabase db push` sobre una instalación creada con él, reconciliarlo con las herramientas oficiales.

El instalador se verificó en una base PostgreSQL embebida nueva: creó las seis tablas con RLS, permitió el alta y los contadores, denegó el acceso anónimo y rechazó una segunda ejecución sin perder los datos de prueba. Esto comprueba la reconstrucción del esquema; no equivale a restaurar un dump de las cuentas reales ni a probar un proyecto remoto nuevo.

## Estado funcional que hay que preservar

- Formulario: nombre o alias, petición/agradecimiento y texto. Sin correo ni notificaciones por lectura.
- Alta inmediata mediante enlace privado revocable, usuario sin espacios y contraseña; sin aprobación. El enlace no se publica en la navegación.
- Recuperación: códigos nuevos de 24 caracteres en cuatro grupos de seis; los anteriores de 48 siguen funcionando. Solo se guarda SHA-256 y cada recuperación rota el código.
- Todos los intercesores habilitados ven los mensajes disponibles. Abrir marca leído globalmente y de forma atómica. Releer no duplica el contador ni extiende el plazo.
- Los leídos caducan a las 48 horas de la primera apertura y se eliminan en el siguiente barrido. Los no leídos permanecen disponibles.
- Los contadores acumulados sobreviven a la limpieza. El total visible es **peticiones + agradecimientos**; para los últimos valores comprobados de 6 y 3, el total correcto es 9.
- Con sesión iniciada se ocultan las solapas, el formulario y las oraciones; se muestran bandeja, saludo destacado e imagen simbólica de María. Cerrar sesión restaura el inicio público.
- El enlace Intercesor del pie funciona al repetirlo y desde páginas internas. Se retiró el aviso editorial general del pie.
- Sin archivar, mover, borrar, asignar ni confirmar oración: basta abrir y leer.
- La sumatoria corregida está en `main`. Si se ve «Total de peticiones / Recibidas en la comunidad», revisar el despliegue: es una versión anterior.

## Sugerencias pendientes, todavía no implementadas

- Dar prioridad a los mensajes sin leer más antiguos.
- Actualización de lecturas en tiempo real; hoy se consulta cada 15 segundos y al volver a la pestaña.
- Completar Privacidad con nombre y contacto del responsable y el plazo de conservación de respaldos.

La API confirmó que la organización está en **Free**, no en una prueba temporal de Pro. Ver [COSTOS-Y-PAUSA.md](COSTOS-Y-PAUSA.md) para los precios consultados y el procedimiento para retomarlo en un mes. Los servicios no se pausaron durante este respaldo.
