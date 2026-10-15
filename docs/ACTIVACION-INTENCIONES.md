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

## Pendiente antes de publicar

1. Guardar los cuatro secretos de aplicación en este proyecto nuevo: `APP_ORIGIN`, `RATE_LIMIT_SECRET`, `INTERCESSOR_REGISTRATION_SECRET` y `TURNSTILE_SECRET_KEY`. Los secretos de los proyectos anteriores no se trasladan automáticamente.
2. Revisar Auth: contraseña habilitada, registro público deshabilitado; el alta autorizada usa Admin Auth desde la función.
3. Conectar el despliegue de Cloudflare al nuevo repositorio y configurar las variables públicas de este proyecto, el widget y `PUBLIC_DEMO_MODE=false`. Confirmar el dominio final y usarlo también en `APP_ORIGIN` y Turnstile.
4. Probar registro, ingreso, recuperación y envío desde el navegador real. El despliegue de las funciones por sí solo no verifica secretos ni Auth ni publica el sitio.

Ver [DEPLOYMENT.md](DEPLOYMENT.md) para la configuración completa.

## Historial de migraciones

No volver a ejecutar las tres migraciones iniciales ni `supabase db push` directamente sobre este proyecto: su equivalente ya está aplicado con un nombre remoto combinado. Antes de usar el flujo CLI hay que reconciliar el historial local y remoto con las herramientas oficiales de migraciones y verificar el esquema. Mantener las migraciones iniciales para instalaciones nuevas.
