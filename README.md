# Misterio

Web mariana y PWA para orar y compartir peticiones y agradecimientos privados. Inicio con una ilustración propia de María, oraciones en una lista compacta y templos en su página independiente.

El formulario pide **nombre o alias, tipo y texto**. No solicita correo ni envía notificaciones. La sección tiene las solapas **Intención | Intercesor**.

## Desarrollo y validación

Node.js 22.12 o posterior:

```sh
npm ci --ignore-scripts
npm run dev
npm run check
npm test
npm run build
CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e
```

Sin configuración externa hay una **demostración identificada**. Los formularios no guardan datos ni crean cuentas. La bandeja usa ejemplos en memoria que se reinician al recargar. Para un Chromium instalado por Playwright, omitir `CHROMIUM_PATH`.

## Intercesor

- Ingreso con usuario sin espacios y contraseña. Usuarios de 3–32 caracteres: letras sin tilde, números, punto, guion y guion bajo; no distingue mayúsculas. Contraseñas de 12–128 caracteres.
- Alta inmediata con un enlace de invitación que contiene una clave comprobada en el servidor. No hay enlace público al registro, aprobación manual ni correo de validación. La dirección por sí sola no concede acceso.
- Código de recuperación aleatorio de 24 caracteres, entregado una sola vez con descarga opcional. Los códigos anteriores de 48 caracteres también funcionan. Se conserva solo su SHA-256. Usarlo cambia la contraseña y reemplaza el código.
- Bandeja compartida: todos los intercesores vigentes ven todos los mensajes disponibles, también los anteriores al alta. Al abrir uno queda leído para todos. La primera lectura se registra atómicamente una sola vez.
- Los mensajes leídos permanecen disponibles 48 horas **desde la primera apertura**. Volver a abrir no extiende el plazo. No hay acciones para archivar, mover, eliminar o completar.
- Se puede filtrar por Sin leer, Todos y Leídos. La bandeja se actualiza cada 15 segundos mientras está visible y al regresar a la pestaña; cada apertura consulta el estado del servidor.
- Los contadores de peticiones, agradecimientos, primeras lecturas por tipo e intercesores registrados son acumulados y sobreviven al borrado de los mensajes. Una lectura no acredita que alguien haya rezado. Los contadores se muestran dentro del panel privado.

## Conectar la versión real

Ver [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Requiere Supabase (Auth, PostgreSQL y Edge Functions), un widget Turnstile y el alojamiento estático existente en Cloudflare. No requiere Resend ni SMTP para las nuevas cuentas de Intercesor.

La migración nueva se aplica **después** de las dos anteriores. Retira la cola y los contactos de correo, transforma el panel de asignación en bandeja compartida y conserva los datos disponibles. Los mensajes previamente asignados pasan a leídos desde la migración; los completados conservan su fecha. Los contadores históricos arrancan con los registros existentes; no se pueden reconstruir mensajes que ya se hubieran borrado.

La eliminación física requiere ejecutar `supabase/schedule.sql`: barrido cada cinco minutos. Los mensajes vencidos quedan excluidos por permisos de base de datos exactamente a las 48h, incluso si se demora el barrido. Las intenciones sin leer no caducan automáticamente.

No subir secretos al repositorio ni colocarlos en variables `PUBLIC_*`. La clave de invitación es reemplazable desde la configuración del servidor.

## Organización

```text
src/pages/index.astro                 Inicio y solapas
src/components/Intercessor.astro      Acceso y bandeja
src/pages/intercesor/                 Alta y recuperación (no indexadas)
src/scripts/intercessor.ts            Sesión, filtros y lectura
src/scripts/enrollment.ts             Alta y recuperación
src/styles/community.css             Diseño del inicio y panel
public/images/maria-esperanza.svg     Ilustración propia del inicio
supabase/migrations/                  Esquema, permisos, contadores y lectura
supabase/functions/intercessor-auth/  Registro, ingreso y recuperación
supabase/functions/submit-intention/  Envío privado sin correo
supabase/schedule.sql                 Borrado automático
```

Las fotografías existentes se mantienen en las oraciones y los templos, con sus créditos y licencias. El cambio de imagen afecta solamente al inicio. Las páginas antiguas de sacerdotes redirigen a la solapa Intercesor. El panel `/admin/` se conserva para cuentas administrativas previas; no interviene en las nuevas altas.

La PWA almacena páginas y recursos públicos. No almacena mensajes privados, respuestas de API, altas ni recuperaciones. La lectura de oraciones funciona sin conexión; los formularios y el panel real requieren internet.
