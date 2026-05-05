# Playbook de incidentes - CSSP

Fecha base: 2026-05-05.

## Clasificacion inicial

- Disponibilidad: sitio caido, DB inaccesible, errores masivos.
- Confidencialidad: exposicion de datos personales, certificados, credenciales o tokens.
- Integridad: asistencia alterada, reportes incorrectos, roles modificados sin autorizacion.
- Cuenta comprometida: login sospechoso, MFA omitido, reset no reconocido.

## Respuesta

1. Contener:
   - revocar sesiones
   - bloquear usuario afectado
   - aislar servicio si hay exfiltracion activa
   - congelar exportaciones si corresponde
2. Preservar evidencia:
   - logs de contenedores
   - registros `audit_events`
   - backup DB
   - hash de artefactos
3. Erradicar:
   - parchear vulnerabilidad
   - rotar secretos comprometidos
   - revisar roles y permisos
4. Recuperar:
   - restaurar servicio
   - ejecutar smoke test
   - monitorear recurrencia
5. Comunicar:
   - direccion del colegio
   - proveedor tecnico
   - afectados si corresponde
   - CSIRT/ANCI si aplica Ley 21.663

## Linea de tiempo minima

- T0 deteccion.
- T0 + 30 min: responsable asignado y alcance preliminar.
- T0 + 2 h: contencion aplicada o decision documentada.
- T0 + 24 h: informe interno preliminar.
- Cierre: causa raiz, impacto, controles nuevos y evidencia.
