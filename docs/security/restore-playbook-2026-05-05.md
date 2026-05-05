# Playbook de restore - CSSP

Fecha base: 2026-05-05.

## Objetivo

Probar mensualmente que los backups permiten recuperar base de datos y archivos operativos sin depender de memoria humana.

## Evidencia requerida

- Archivo backup usado.
- Hash SHA-256 del backup.
- Fecha/hora de inicio y termino.
- Ambiente de prueba usado.
- Conteos de tablas principales.
- Resultado de smoke test.

## Procedimiento de prueba

1. Crear ambiente temporal aislado.
2. Restaurar dump MariaDB.
3. Montar uploads si la prueba incluye certificados.
4. Ejecutar migraciones Prisma.
5. Verificar:
   - login
   - cursos
   - alumnos
   - asistencia
   - justificaciones
   - reportes
6. Destruir ambiente temporal.
7. Guardar evidencia en `docs/security/restore-evidence/`.

## Criterios de exito

- La API inicia sin errores.
- Conteos esperados coinciden.
- Los archivos de justificacion abren.
- Un usuario autorizado puede consultar cursos y reportes.
- No se exponen secretos en logs.
