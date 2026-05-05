# Politica de retencion - CSSP

Fecha base: 2026-05-05.

## Principios

- Conservar solo lo necesario para operacion escolar, auditoria y cumplimiento.
- Evitar borrados fisicos prematuros cuando existan obligaciones administrativas.
- Usar soft-delete para usuarios y trazabilidad de acciones criticas.

## Retencion sugerida

- Asistencia diaria: ano escolar vigente + 5 anos.
- Justificaciones y certificados: ano escolar vigente + 5 anos, salvo instruccion institucional distinta.
- Reportes exportados generados bajo demanda: no persistir salvo evidencia explicita.
- Auditoria de seguridad y cambios administrativos: 2 anos minimo; 5 anos para acciones criticas.
- Refresh tokens y dispositivos confiables: hasta expiracion o revocacion.
- Usuarios inactivos: mantener soft-delete mientras existan referencias de auditoria.
- Backups: diarios por 30 dias, semanales por 3 meses, mensuales por 12 meses.

## Borrado y revision

1. Generar inventario de registros candidatos.
2. Validar con direccion/UTP si hay proceso administrativo abierto.
3. Exportar evidencia minima si corresponde.
4. Ejecutar borrado o anonimización controlada.
5. Registrar fecha, responsable y alcance.

## Excepciones

No borrar informacion asociada a incidentes, reclamos, auditorias, obligaciones legales o solicitudes en curso hasta su cierre formal.
