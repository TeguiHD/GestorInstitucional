# Mapa de datos personales - CSSP

Fecha base: 2026-05-05.

## Finalidad

El sistema trata datos para gestionar asistencia escolar, justificar ausencias, emitir reportes, informar a apoderados y dejar evidencia operativa del colegio.

## Categorias de datos

- Alumnos: nombre, apellidos, RUT, curso, matricula, asistencia, atrasos, justificaciones y reportes asociados.
- Apoderados: nombre, correo, telefono, relacion con el alumno y preferencias/contactos operativos.
- Funcionarios: nombre, correo, rol, accesos, acciones administrativas y registros de auditoria.
- Seguridad: hash de contrasena, intentos fallidos, bloqueo, tokens de sesion, 2FA cifrado, dispositivos confiables, IP y user-agent.
- Archivos: certificados de justificacion en PDF/PNG/JPG/WEBP.

## Base operacional

- Minimizar: no cargar datos que no se usen para asistencia, comunicacion o cumplimiento.
- Segregar por colegio: todo acceso debe validar `schoolId` y rol.
- Menores de edad: tratar asistencia y justificaciones como informacion sensible operacional; limitar descargas y exposicion.
- Trazabilidad: registrar cambios de usuarios, roles, asistencia, justificaciones, reportes y eventos de seguridad.

## Derechos y atencion de solicitudes

Preparar respuesta para acceso, rectificacion, supresion, oposicion, portabilidad y bloqueo cuando corresponda bajo Ley 21.719 desde el 2026-12-01.

Flujo minimo:

1. Recibir solicitud por canal institucional.
2. Verificar identidad del solicitante y relacion con el alumno.
3. Clasificar dato solicitado y base de conservacion.
4. Responder con exportacion, correccion o negativa fundada.
5. Registrar evidencia en auditoria operativa.

## Controles

- MFA obligatorio para SUPER_ADMIN, DIRECTOR y UTP.
- Contraseñas con Argon2id y bloqueo por intentos.
- Archivos limitados a tipos permitidos y 8 MB.
- Logs con redaccion de secretos.
- Backups antes de migraciones/importaciones.
- CI bloqueando vulnerabilidades high/critical.
