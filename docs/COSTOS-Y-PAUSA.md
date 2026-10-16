# Costos y pausa durante un mes

Revisión del 15 de octubre de 2026. Importes en USD mensuales, antes de impuestos. La factura depende del plan contratado y de los consumos reales; no se consultaron facturas ni el panel privado de Cloudflare.

## Estado comprobado

La API de Supabase confirmó la organización `Intenciones` (`lcyzbsxrpqkvdyoqxcuu`) en plan **Free**, `tier_free`. No es una prueba temporal de Pro. El proyecto `nlfujsfwocdferdjxttm` estaba activo, con una base de unos 11 MB, una cuenta y nueve mensajes. El total histórico es 6 peticiones + 3 agradecimientos = 9.

La arquitectura usa Cloudflare para archivos estáticos, imágenes y Turnstile; Supabase para Auth, SQL, dos Edge Functions y cron. No utiliza correo de pago, Supabase Storage para las fotos, D1, KV ni servicios de IA en el sitio.

## Presupuesto

| Escenario | Cloudflare | Supabase | Total base |
| --- | --- | --- | --- |
| Configuración actual si Workers está en Free | $0 | $0, plan confirmado | $0/mes |
| Supabase Pro con un proyecto Micro, Cloudflare Free | $0 | Desde $25 | Desde $25/mes |
| Ambos de pago, un Micro | Desde $5 | Desde $25 | Desde $30/mes |

El primer escenario alcanza para las funciones desarrolladas con el uso de prueba actual. Hay que confirmar en Cloudflare → Billing / Subscriptions que Workers está en Free; una suscripción Paid contratada mantiene su cuota aunque el sitio sea estático.

Referencias: [Supabase Pricing](https://supabase.com/pricing), [Workers Pricing](https://developers.cloudflare.com/workers/platform/pricing/).

Los archivos estáticos y su almacenamiento en Workers no tienen costo por solicitud. Turnstile dispone de plan gratuito con verificaciones ilimitadas. Workers Builds Free incluye 3.000 minutos al mes. Fuentes: [Static Assets Billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/), [Turnstile Plans](https://developers.cloudflare.com/turnstile/plans/), [Builds Limits](https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/).

Supabase Free incluye 500 MB de base, 5 GB de salida, 50.000 usuarios activos mensuales y 500.000 invocaciones de Edge Functions. Las visitas anónimas a las oraciones no crean usuarios de Auth. Pro incluye créditos para un Micro; ampliar la instancia, agregar proyectos o superar cuotas cambia el importe. Ver la página de precios enlazada.

### Qué puede aumentar el consumo

La bandeja consulta tres endpoints cada 15 segundos mientras está visible: aproximadamente 720 solicitudes HTTP por hora de intercesor, más las operaciones de ingreso y apertura. Para 10 intercesores que la mantengan abierta una hora diaria durante 30 días, son unas 216.000 consultas. No son 216.000 invocaciones de Edge Functions: la actualización de la bandeja usa la API de datos directamente. Supabase no cobra cada consulta por separado, pero las respuestas consumen transferencia y recursos de la base.

El tráfico futuro no se deduce de nueve mensajes de prueba. Medir en Supabase → Usage la transferencia y las invocaciones; en Cloudflare, minutos de compilación y suscripción. Para presupuestar una comunidad mayor, registrar cantidad de intercesores, horas de uso y envíos diarios. Una mejora posible es actualizar la bandeja por eventos para evitar consultas innecesarias.

## Guardarlo y retomarlo dentro de un mes

No hace falta congelar una prueba de Supabase: el plan comprobado es Free. Puede pausarse el proyecto. La documentación actual indica pausa por baja actividad durante siete días y una ventana de restauración de hasta **un año** desde la pausa, con datos y configuración. La organización gratuita no necesita pasar a Pro para esperar un mes. Fuente: [Project Pausing](https://supabase.com/docs/guides/platform/free-project-pausing).

Procedimiento sugerido, todavía **no ejecutado**:

1. Conservar el código y la configuración de GitHub y guardar los secretos en un gestor. Si se quieren conservar cuentas y datos independientemente de Supabase, completar también el respaldo privado indicado en [CONTINUIDAD.md](CONTINUIDAD.md).
2. En Cloudflare → intenciones → Settings → Build → Variables and secrets, poner `PUBLIC_DEMO_MODE=true` y desplegar. El sitio queda en demostración identificada y no intenta realizar ingresos, altas ni envíos reales. No hace falta borrar el Worker ni el widget.
3. En Supabase → proyecto → Settings → General, usar **Pause project**. No eliminar el proyecto ni la organización. Mientras esté pausado, las funciones que requieren la base no operan.
4. Al volver, abrir el proyecto y usar **Resume project**. Esperar a que esté activo y comprobar el acceso.
5. Volver a `PUBLIC_DEMO_MODE=false` en las variables de compilación de Cloudflare y desplegar. Si se reanuda el mismo proyecto, se conservan su URL y configuración. Probar el ingreso y un envío nuevo.

La pausa del servicio no cambia `read_at`: los nueve mensajes ya leídos superarán las 48 horas durante ese mes. Al reanudar, quedarán fuera de la bandeja y la limpieza los eliminará. Los usuarios y los contadores acumulados permanecen. Ese vencimiento es una regla de la aplicación, no la caducidad de una prueba comercial.

Cloudflare Free no requiere una pausa para evitar una cuota de pago. Un plan Paid debe revisarse o cambiarse en Billing; pausar Supabase no cancela otras suscripciones ni detiene su calendario de facturación.
