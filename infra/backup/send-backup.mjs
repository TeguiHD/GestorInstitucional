import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const STATUS_LABELS = {
  PRESENT: 'Presente',
  ABSENT: 'Ausente',
  LATE: 'Atraso',
  JUSTIFIED: 'Justificado',
  WITHDRAWN: 'Retirado',
};

function loadEnv() {
  const paths = [
    path.resolve(__dirname, '../../.env.prod'),
    path.resolve(__dirname, '../../.env'),
    path.resolve(process.cwd(), '.env.prod'),
    path.resolve(process.cwd(), '.env'),
  ];

  for (const p of paths) {
    if (fs.existsSync(p)) {
      const env = {};
      const content = fs.readFileSync(p, 'utf8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const idx = trimmed.indexOf('=');
        if (idx === -1) continue;
        const key = trimmed.slice(0, idx).trim();
        let val = trimmed.slice(idx + 1).trim();
        if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
        else if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
        env[key] = val;
      }
      return env;
    }
  }
  return {};
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeSql(value) {
  return String(value ?? '').replaceAll("'", "''");
}

function statusLabel(status) {
  if (!status) return 'Sin registro';
  return STATUS_LABELS[status] ?? String(status);
}

function dbQuery(sql, env) {
  const user = process.env.DB_USER || env.DB_USER || 'asistencia_app';
  const password = process.env.DB_PASSWORD || env.DB_PASSWORD || '';
  const dbName = process.env.DB_NAME || env.DB_NAME || 'asistencia';
  const host = process.env.DB_HOST || env.DB_HOST || 'db';
  const useDocker = process.env.BACKUP_USE_DOCKER_DB === 'true';

  const args = ['-u', user, '-r', '-N'];
  if (password) args.push(`-p${password}`);
  args.push(dbName, '-e', sql);

  const result = useDocker
    ? spawnSync('docker', ['exec', '-i', 'asistencia_db', 'mariadb', ...args], {
        encoding: 'utf8',
      })
    : spawnSync('mariadb', ['-h', host, ...args], { encoding: 'utf8' });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'No se pudo consultar MariaDB');
  }
  return result.stdout;
}

function loadAttendanceChanges(env) {
  const since = process.env.BACKUP_LAST_SUCCESS_AT || '1970-01-01 00:00:00';
  const sql = `
SELECT DATE_FORMAT(createdAt, '%Y-%m-%d %H:%i:%s'), CAST(meta AS CHAR)
FROM audit_events
WHERE entity = 'AttendanceRecord'
  AND JSON_UNQUOTE(JSON_EXTRACT(meta, '$.attendanceChange')) = 'true'
  AND JSON_LENGTH(JSON_EXTRACT(meta, '$.changes')) > 0
  AND createdAt > '${escapeSql(since)}'
ORDER BY createdAt ASC
LIMIT 500;
`;

  const rows = dbQuery(sql, env)
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean);

  const changes = [];
  for (const row of rows) {
    const tab = row.indexOf('\t');
    if (tab === -1) continue;
    const createdAt = row.slice(0, tab);
    const rawMeta = row.slice(tab + 1);
    let meta;
    try {
      meta = JSON.parse(rawMeta);
    } catch {
      continue;
    }
    for (const change of meta.changes ?? []) {
      changes.push({
        createdAt,
        courseCode: change.courseCode ?? '',
        courseName: change.courseName ?? '',
        date: change.date ?? meta.date ?? '',
        studentName: change.studentName ?? 'Alumno',
        enrollmentNumber: change.enrollmentNumber ?? null,
        previousStatus: change.previousStatus ?? null,
        newStatus: change.newStatus ?? null,
        changedFields: Array.isArray(change.changedFields) ? change.changedFields : [],
      });
    }
  }

  return changes;
}

function renderChangesSummary(changes, error) {
  if (error) {
    return `
      <h3>Resumen de cambios de asistencia</h3>
      <p>No fue posible cargar el detalle de auditoria para este correo. Se adjunta el respaldo completo.</p>
    `;
  }

  if (changes.length === 0) {
    return `
      <h3>Resumen de cambios de asistencia</h3>
      <p>Prueba manual o respaldo forzado sin cambios auditados desde el ultimo respaldo exitoso.</p>
    `;
  }

  const groups = new Map();
  for (const change of changes) {
    const course = [change.courseCode, change.courseName].filter(Boolean).join(' - ') || 'Curso';
    const key = `${course}|${change.date}`;
    const group = groups.get(key) ?? { course, date: change.date, changes: [] };
    group.changes.push(change);
    groups.set(key, group);
  }

  const maxItems = 80;
  let rendered = 0;
  const sections = [];
  for (const group of groups.values()) {
    const items = [];
    for (const change of group.changes) {
      if (rendered >= maxItems) break;
      rendered++;
      const student = change.enrollmentNumber
        ? `${change.enrollmentNumber} - ${change.studentName}`
        : change.studentName;
      const fields = change.changedFields
        .filter((field) => field !== 'note')
        .join(', ');
      items.push(`
        <li>
          <strong>${escapeHtml(student)}</strong>:
          ${escapeHtml(statusLabel(change.previousStatus))} -> ${escapeHtml(statusLabel(change.newStatus))}
          ${fields ? `<span style="color:#666">(${escapeHtml(fields)})</span>` : ''}
        </li>
      `);
    }
    sections.push(`
      <h4>${escapeHtml(group.course)} · ${escapeHtml(group.date)}</h4>
      <ul>${items.join('')}</ul>
    `);
    if (rendered >= maxItems) break;
  }

  const remaining = Math.max(0, changes.length - rendered);
  return `
    <h3>Resumen de cambios de asistencia</h3>
    <p><strong>${changes.length}</strong> cambio${changes.length === 1 ? '' : 's'} auditado${changes.length === 1 ? '' : 's'} desde el ultimo respaldo exitoso.</p>
    ${sections.join('')}
    ${remaining > 0 ? `<p>Se omitieron ${remaining} cambios adicionales del correo para mantenerlo compacto. El respaldo SQL adjunto contiene el historial completo.</p>` : ''}
    <p style="color:#666">Este resumen no incluye RUT ni notas sensibles.</p>
  `;
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Uso: node send-backup.mjs <ruta_al_archivo_zip>');
    process.exit(1);
  }

  if (!fs.existsSync(filePath)) {
    console.error(`Archivo no encontrado: ${filePath}`);
    process.exit(1);
  }

  const env = loadEnv();
  const apiKey = process.env.BREVO_API_KEY || env.BREVO_API_KEY;
  const fromEmail =
    process.env.MAIL_FROM_EMAIL || env.MAIL_FROM_EMAIL || 'no-reply@asistencia.nicoholas.dev';
  const fromName = process.env.MAIL_FROM_NAME || env.MAIL_FROM_NAME || 'Asistencia CSSP';
  const backupEmailsRaw = process.env.BACKUP_EMAILS || env.BACKUP_EMAILS || '';

  if (!apiKey) {
    console.error('Error: BREVO_API_KEY no configurado en los archivos env.');
    process.exit(1);
  }

  const recipients = backupEmailsRaw
    .split(',')
    .map((email) => email.trim())
    .filter((email) => email.length > 0);

  if (recipients.length === 0) {
    console.error('Error: BACKUP_EMAILS no tiene correos configurados.');
    process.exit(1);
  }

  let changes = [];
  let summaryError = null;
  try {
    changes = loadAttendanceChanges(env);
  } catch (err) {
    summaryError = err;
    console.error(`No se pudo cargar resumen de cambios: ${err.message}`);
  }

  const fileName = path.basename(filePath);
  const fileContentBase64 = fs.readFileSync(filePath).toString('base64');
  const today = new Date().toISOString().split('T')[0];
  const changeCount = process.env.BACKUP_CHANGE_COUNT || String(changes.length);

  const payload = {
    sender: { name: fromName, email: fromEmail },
    to: recipients.map((email) => ({ email })),
    subject: `Respaldo por Cambios de Asistencia - CSSP [${today}]`,
    htmlContent: `
      <h2>Respaldo por Cambios de Asistencia</h2>
      <p>Se adjunta el respaldo SQL completo de la base de datos del sistema de asistencia.</p>
      <ul>
        <li><strong>Fecha:</strong> ${escapeHtml(today)}</li>
        <li><strong>Archivo:</strong> ${escapeHtml(fileName)}</li>
        <li><strong>Cambios detectados:</strong> ${escapeHtml(changeCount)}</li>
      </ul>
      ${renderChangesSummary(changes, summaryError)}
      <p>Si el adjunto esta cifrado, la clave debe mantenerse fuera del correo.</p>
      <p>Este es un correo automatico de seguridad.</p>
    `,
    attachment: [
      {
        content: fileContentBase64,
        name: fileName,
      },
    ],
  };

  console.log(`Enviando respaldo a: ${recipients.join(', ')}...`);

  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Brevo API Error (${res.status}): ${errorText}`);
    }

    const data = await res.json();
    console.log(`Respaldo enviado exitosamente. MessageID: ${data.messageId || 'N/A'}`);
  } catch (err) {
    console.error('Error al enviar email:', err.message);
    process.exit(1);
  }
}

main();
