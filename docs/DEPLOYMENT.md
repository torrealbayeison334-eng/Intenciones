# Activar Intención e Intercesor

Para el proyecto nuevo `nlfujsfwocdferdjxttm`, consultar primero [el estado de activación y su historial de migraciones](ACTIVACION-INTENCIONES.md). La base y las funciones ya están desplegadas; no repetir las migraciones iniciales.

El código permite demostración sin servicios externos. Aplicar estos pasos en el proyecto Supabase y el sitio Cloudflare del responsable; no introducir contraseñas ni claves privadas en el chat, GitHub o el navegador.

## 1. Actualizar la base de datos

Respaldar la base antes de migrar un servicio con datos reales. Para una instalación nueva, aplicar todas las migraciones de `supabase/migrations/` en orden. En una existente que ya tenga las dos de octubre 6, comenzar por:

`supabase/migrations/202610150001_intercessor_inbox.sql`

Después aplicar `20261016003904_scope_community_counter_updates.sql`. Esta corrección agrega `WHERE singleton = true` a las actualizaciones de los contadores. Es necesaria para las conexiones HTTP de PostgREST que cargan `safeupdate`; sin ella, el alta, el envío y la primera lectura fallan con SQLSTATE `21000`. No requiere cambiar secretos ni recompilar la web.

Esta migración elimina la cola de correos y los correos de contacto, desactiva las transiciones de asignar/completar/devolver y crea lectura compartida, contadores acumulados y credenciales de recuperación. Los mensajes existentes se conservan hasta la retención aplicable. Los asignados se consideran leídos desde la migración; los completados conservan `completed_at` como fecha de lectura. Los mensajes completados hace más de 48h vencen al activar la migración. Los históricos se inicializan con los registros todavía existentes.

RLS permanece activado. Visitantes sin sesión no pueden leer intenciones, totales, membresías ni credenciales. Intercesores vigentes solo tienen lectura y el RPC `open_intention`; no pueden actualizar, borrar, registrarse por SQL o consultar hashes de recuperación. El rol de servicio es exclusivo del servidor.

## 2. Configurar Auth y secretos del servidor

En Supabase Auth habilitar autenticación con contraseña y **mantener deshabilitado el registro público**. El alta pasa por una Edge Function que valida la invitación y usa Admin Auth. Cada usuario tiene un identificador interno derivado de su nombre (`SHA256_DEL_USUARIO@intercesor.misterio.invalid`), sin buzón real. No se pide ni valida correo; `email_confirm: true` evita enviar confirmaciones. No habilitar registro anónimo ni enlaces de alta públicos.

Configurar en Edge Functions:

| Secreto | Uso |
| --- | --- |
| `APP_ORIGIN` | Origen HTTPS exacto del sitio, por ejemplo `https://yeivt.torrealbaviktor.workers.dev`, sin barra final. |
| `TURNSTILE_SECRET_KEY` | Clave privada del widget de verificación de intenciones. |
| `RATE_LIMIT_SECRET` | Secreto aleatorio independiente, de al menos 32 bytes, para derivar identificadores de red mediante HMAC. |
| `INTERCESSOR_REGISTRATION_SECRET` | Clave aleatoria de invitación, de 32 a 256 caracteres; usar 64 caracteres hexadecimales. |

Supabase inyecta `SUPABASE_URL` y las claves privadas al servidor. Las funciones prefieren `SUPABASE_SECRET_KEYS.default` cuando existe, con respaldo en `SUPABASE_SERVICE_ROLE_KEY` para proyectos legados. Nunca deben incorporarse a archivos compilados como configuración pública. No se necesitan claves de Resend ni del antiguo trabajador de correo.

El servidor usa el último valor de `x-forwarded-for` observado por el ingreso de Supabase para los límites por red. Confirmar en el despliegue que el proxy proporciona esa cabecera sin registrar su contenido. Si falta, las solicitudes comparten un límite conservador. Hay 10 intenciones/hora por identificador de red, 5 intentos de alta/hora y 30 de ingreso o recuperación/hora; Auth añade sus propios límites.

## 3. Desplegar las funciones

Desplegar primero el endpoint de retirada del correo para detener trabajadores antiguos, después migrar y desplegar el nuevo circuito:

```sh
npx supabase functions deploy process-emails
npx supabase db push
npx supabase functions deploy submit-intention
npx supabase functions deploy intercessor-auth
npx supabase functions deploy request-access
```

`process-emails` y `request-access` ahora devuelven 410 sin ejecutar acciones. La migración también elimina las funciones de cola y desprograma el antiguo cron de correo, cuando existe. El panel administrativo legado puede conservarse, pero no participa en el alta de Intercesor. Antes de migrar, esperar a que no quede un trabajador antiguo en ejecución; un correo ya entregado al proveedor no puede retirarse.

## 4. Activar la retención

Ejecutar `supabase/schedule.sql` en el editor SQL. Reemplaza los cron de Misterio, elimina el cron de correo y ejecuta limpieza cada cinco minutos.

La base deniega el acceso al mensaje exactamente 48h después de `read_at`. La eliminación física ocurre en el siguiente barrido, como máximo cinco minutos después bajo funcionamiento normal. La fecha de lectura no se renueva al abrir de nuevo. Los no leídos permanecen hasta su primera apertura. Los totales no contienen nombres ni textos y no se reducen al limpiar.

Comprobar `cron.job` y `cron.job_run_details` después de activar. Las copias de respaldo del proveedor tienen una retención distinta de la base activa: completar ese plazo y el contacto del responsable en la página de privacidad.

## 5. Compilar y publicar el sitio

### Cloudflare Workers con Git

El repositorio incluye `wrangler.jsonc` para publicar los archivos estáticos de `dist/`. No requiere el adaptador de Astro para Cloudflare. La configuración explícita evita que Wrangler intente modificar el proyecto automáticamente con `astro add cloudflare`.

En Workers → proyecto → Settings → Build, usar:

- Repositorio `torrealbayeison334-eng/Intenciones`, rama `main`, directorio raíz del repositorio.
- Build command: `npm run build`.
- Deploy command: `npx wrangler deploy`.
- Nombre del Worker: `intenciones`, coincidente con `wrangler.jsonc`. Si se usa otro nombre, debe coincidir con la configuración o especificarse mediante `--name` en el comando de despliegue.
- Build variables: `NODE_VERSION=22` y las variables públicas indicadas a continuación. Para la primera publicación de demostración, basta `PUBLIC_DEMO_MODE=true`.

La dirección pública de Workers termina en `.workers.dev`; usar el origen real al configurar Supabase y el widget de Turnstile. Después de cambiar el repositorio, iniciar una compilación del último commit de `main`.

Referencia: https://developers.cloudflare.com/workers/ci-cd/builds/configuration/

En Cloudflare conservar el alojamiento existente y configurar únicamente estas variables públicas:

```text
PUBLIC_DEMO_MODE=false
PUBLIC_SUPABASE_URL=https://TU_PROYECTO.supabase.co
PUBLIC_SUPABASE_ANON_KEY=CLAVE_PUBLICA_DEL_PROYECTO
PUBLIC_TURNSTILE_SITE_KEY=CLAVE_PUBLICA_DEL_WIDGET
```

La variable `PUBLIC_SUPABASE_ANON_KEY` acepta tanto una clave publishable moderna como una anon legada. Las claves modernas se envían solo en `apikey`; las sesiones autenticadas agregan su JWT en `Authorization`. El widget Turnstile debe admitir el dominio real. Usar `npm ci --ignore-scripts` y `npm run build`; la salida es `dist/`. Hay que recompilar tras cambiar variables públicas. La configuración de demostración no guarda datos ni crea usuarios, aunque se suba el sitio a un dominio real.

Conservar los encabezados de `public/_headers`, especialmente CSP, `no-store` en rutas privadas y la política de referencias. El alojamiento de Workers debe aplicar esos encabezados; comprobarlo tras publicar. El contenido sensible de las API también usa `Cache-Control: no-store`. La PWA solo guarda recursos públicos y su versión cambia al publicar este rediseño.

## 6. Distribuir y reemplazar la invitación

Compartir de forma privada una URL con esta forma (el marcador no es una clave válida):

```text
https://TU_DOMINIO/intercesor/alta/#clave=CLAVE_CONFIGURADA_EN_EL_SERVIDOR
```

El fragmento no viaja al servidor al abrir la página y se retira de la barra al cargar. Solo se envía a la función de alta por HTTPS al completar el formulario. No hay enlaces de alta en el menú, pie ni panel de ingreso. La función verifica la clave aunque alguien abra directamente la ruta o manipule el navegador.

Para invalidar los enlaces anteriores, reemplazar `INTERCESSOR_REGISTRATION_SECRET` y distribuir la URL nueva. Los usuarios ya registrados conservan su acceso. La clave reutilizable permite crear cuentas a cualquiera que reciba el enlace; no es una invitación personal de un solo uso.

Al registrarse se entrega un código de recuperación de 96 bits: 24 caracteres hexadecimales, agrupados de seis en seis y descargables como texto privado. Los códigos anteriores de 48 caracteres siguen siendo válidos; al usarlos se reemplazan por uno corto. Solo se conserva su SHA-256. Recuperar requiere usuario, código y contraseña nueva; el código se reserva durante la operación y se reemplaza al terminar. Si Auth falla, se libera la reserva. Una interrupción entre Auth y el cierre de la reserva puede dejar la contraseña cambiada: conservar el código anterior y reintentar pasados dos minutos. Nunca registrar contraseñas, claves de invitación, códigos ni cuerpos de estas solicitudes en logs o analítica.

## 7. Verificar en el servicio real

Con cuentas de prueba y datos ficticios:

1. Enviar una petición y un agradecimiento sin correo; deben persistir al recargar.
2. Comprobar rechazo de un alta sin invitación, clave antigua, usuario con espacios y usuario duplicado.
3. Dar de alta dos intercesores y guardar sus códigos; ambas cuentas deben ingresar sin aprobación ni correo.
4. Abrir el mismo mensaje desde ambas sesiones: una sola primera lectura y el mismo estado compartido. Verificar actualización automática y filtros.
5. Recuperar contraseña, ingresar con la nueva y comprobar que el código anterior ya no sirve.
6. Sobre una intención ficticia, adelantar `read_at` desde administración a más de 48h: debe quedar inaccesible de inmediato y borrarse en el siguiente cron. Los totales deben conservarse.
7. Comprobar que ni anónimos ni cuentas sin membresía vigente leen datos y que no hay correo programado ni datos privados en CacheStorage.

Las pruebas locales validan el código y SQL en PostgreSQL embebido. No confirman por sí solas credenciales, límites, encabezados, Auth, cron ni publicación del servicio real.
