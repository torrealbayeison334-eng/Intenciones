# Estado del proyecto Intenciones

Verificado el 15 de octubre de 2026.

- Repositorio: https://github.com/torrealbayeison334-eng/Intenciones, rama `main`.
- Proyecto Supabase: `nlfujsfwocdferdjxttm`, nombre del panel `intenciones prueba`.
- API: `https://nlfujsfwocdferdjxttm.supabase.co`.
- Base creada mediante la migración remota `misterio_initial_with_shared_inbox`, que reúne las tres migraciones locales existentes.
- Retención creada mediante `schedule_read_message_retention`: revisión cada cinco minutos y caducidad a las 48 horas de la primera lectura.
- Funciones `submit-intention` e `intercessor-auth` desplegadas, versión 1. Implementan validación propia; no exigen JWT en la puerta de entrada porque admiten envío público, registro con invitación e ingreso con contraseña.

## Verificación realizada

Una transacción de prueba comprobó alta de intercesor en la base, almacenamiento de petición y agradecimiento, lectura repetida sin modificar la primera fecha, incremento único del contador y eliminación del mensaje vencido conservando totales y mensajes no leídos. Se revirtió toda la transacción: no quedaron cuentas, mensajes ni contadores ficticios.

Todas las tablas tienen RLS. El rol anónimo no puede consultarlas ni ejecutar las funciones del proyecto. Los clientes autenticados no pueden insertar, actualizar ni borrar directamente; las operaciones privilegiadas requieren el servidor. Las únicas funciones del cliente son la comprobación de membresía y la apertura con autorización de intercesor.

Los avisos del asesor sobre tablas internas sin políticas son intencionales: no tienen permisos para clientes. También identifica las dos funciones `SECURITY DEFINER` autorizadas para el cliente; ambas comprueban la membresía vigente. Referencia: https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable . Los avisos de índices corresponden a la tabla heredada `access_requests`, fuera del circuito nuevo.

## Publicación y comprobación pendiente

Actualización del 15 de octubre, después de la primera publicación: el sitio nuevo está en `https://intenciones.torrealbayeison334.workers.dev`. El responsable confirmó la carga de los cuatro secretos, la configuración de las variables públicas, la desactivación del registro público de Auth y una compilación con `PUBLIC_DEMO_MODE=false`. Después de corregir los contadores, confirmó que pudo probar toda la funcionalidad completa desde el navegador real.

Se corrigió el fallo del alta mediante la migración remota `scope_community_counter_updates` (archivo local `20261016003904_scope_community_counter_updates.sql`). Los registros mostraban Auth creando y retirando la cuenta al fallar `register_intercessor` con SQLSTATE `21000`; las sesiones de `authenticator` precargan `safeupdate`. Ahora las tres funciones que incrementan contadores limitan la actualización a la fila `singleton = true`. Pasaron las pruebas locales y la transacción de prueba en la base remota; no quedaron cuentas ni totales de prueba. La herramienta SQL administrativa no permite cargar `safeupdate` manualmente, por lo que la comprobación completa a través de HTTP requiere el próximo intento de alta del responsable. No se desactivó esa protección.

1. Secretos de aplicación: el responsable confirmó `APP_ORIGIN`, `RATE_LIMIT_SECRET`, `INTERCESSOR_REGISTRATION_SECRET` y `TURNSTILE_SECRET_KEY` en el proyecto nuevo. Los valores privados no se consultan desde esta integración.
2. Auth: el responsable confirmó registro público deshabilitado y proveedor Email habilitado para las contraseñas; el alta autorizada usa Admin Auth desde la función.
3. Cloudflare: repositorio nuevo publicado con configuración estática de Workers. El responsable confirmó las variables públicas del proyecto, el widget y `PUBLIC_DEMO_MODE=false`.
4. Recorrido real confirmado por el responsable después de la corrección de los contadores. Cambio posterior: `intercessor-auth` versión 7 genera códigos de recuperación de 24 caracteres y admite los anteriores. La nueva vista del intercesor se valida localmente con Chromium y se publica mediante Git/Cloudflare.

Ver [DEPLOYMENT.md](DEPLOYMENT.md) para la configuración completa.

## Historial de migraciones

No volver a ejecutar las tres migraciones iniciales ni `supabase db push` directamente sobre este proyecto: su equivalente ya está aplicado con un nombre remoto combinado. Antes de usar el flujo CLI hay que reconciliar el historial local y remoto con las herramientas oficiales de migraciones y verificar el esquema. Mantener las migraciones iniciales para instalaciones nuevas.
