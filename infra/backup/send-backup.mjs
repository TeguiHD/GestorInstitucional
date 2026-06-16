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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status) {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function writeResult(result) {
  const resultFile = process.env.BACKUP_SEND_RESULT_FILE;
  if (!resultFile) return;
  fs.writeFileSync(resultFile, `${JSON.stringify(result)}\n`, 'utf8');
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

function renderChangesSummary(changes, error, deliveryMode) {
  const deliveryText =
    deliveryMode === 'download_link'
      ? 'Se preparo un respaldo completo y se envio un enlace temporal de descarga.'
      : 'Se adjunta el respaldo completo.';

  if (error) {
    return `
      <h3>Resumen de cambios de asistencia</h3>
      <p>No fue posible cargar el detalle de auditoria para este correo. ${deliveryText}</p>
    `;
  }

  if (changes.length === 0) {
    return `
      <h3>Resumen de cambios de asistencia</h3>
      <p>Prueba manual o respaldo forzado sin cambios auditados desde el ultimo respaldo exitoso. ${deliveryText}</p>
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
      const fields = change.changedFields.filter((field) => field !== 'note').join(', ');
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
    ${remaining > 0 ? `<p>Se omitieron ${remaining} cambios adicionales del correo para mantenerlo compacto. El respaldo SQL contiene el historial completo.</p>` : ''}
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
  const deliveryMode = process.env.BACKUP_DELIVERY_MODE || 'attachment';
  const downloadUrl = process.env.BACKUP_DOWNLOAD_URL || '';
  const downloadExpiresAt = process.env.BACKUP_DOWNLOAD_EXPIRES_AT || '';

  if (!apiKey) {
    console.error('Error: BREVO_API_KEY no configurado en los archivos env.');
    process.exit(1);
  }

  if (!['attachment', 'download_link'].includes(deliveryMode)) {
    console.error(`Error: BACKUP_DELIVERY_MODE invalido: ${deliveryMode}`);
    process.exit(1);
  }

  if (deliveryMode === 'download_link' && !downloadUrl) {
    console.error('Error: BACKUP_DOWNLOAD_URL requerido para envio con link temporal.');
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
  const fileSizeBytes = fs.statSync(filePath).size;
  const today = new Date().toISOString().split('T')[0];
  const changeCount = process.env.BACKUP_CHANGE_COUNT || String(changes.length);
  const deliveryBlock =
    deliveryMode === 'download_link'
      ? `
      <p>El respaldo supera el limite practico de adjunto del proveedor de correo. Por seguridad queda cifrado y disponible temporalmente en el servidor.</p>
      <p>
        <a href="${escapeHtml(downloadUrl)}" style="display:inline-block;padding:10px 14px;background:#0f766e;color:#fff;text-decoration:none;border-radius:6px;">
          Descargar respaldo cifrado
        </a>
      </p>
      <p><strong>Expira:</strong> ${escapeHtml(downloadExpiresAt || '7 dias')}</p>
      `
      : '<p>Se adjunta el respaldo SQL completo de la base de datos del sistema de asistencia.</p>';

  const payload = {
    sender: { name: fromName, email: fromEmail },
    to: recipients.map((email) => ({ email })),
    subject: `Respaldo Completo de Asistencia - CSSP [${today}]`,
    htmlContent: `
      <h2>Respaldo Completo de Asistencia</h2>
      ${deliveryBlock}
      <ul>
        <li><strong>Fecha:</strong> ${escapeHtml(today)}</li>
        <li><strong>Archivo:</strong> ${escapeHtml(fileName)}</li>
        <li><strong>Tamano:</strong> ${escapeHtml(fileSizeBytes)} bytes</li>
        <li><strong>Modo de entrega:</strong> ${deliveryMode === 'download_link' ? 'link temporal seguro' : 'adjunto'}</li>
        <li><strong>Cambios detectados:</strong> ${escapeHtml(changeCount)}</li>
      </ul>
      ${renderChangesSummary(changes, summaryError, deliveryMode)}
      <p>Si el archivo esta cifrado, la clave debe mantenerse fuera del correo.</p>
      <p>Este es un correo automatico de seguridad.</p>
    `,
  };

  if (deliveryMode === 'attachment') {
    payload.attachment = [
      {
        content: fs.readFileSync(filePath).toString('base64'),
        name: fileName,
      },
    ];
  }

  console.log(`Enviando respaldo a: ${recipients.join(', ')}...`);

  const maxAttempts = Number(process.env.BACKUP_SEND_ATTEMPTS || 3);
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
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
        const error = new Error(`Brevo API Error (${res.status}): ${errorText}`);
        error.retryable = isRetryableStatus(res.status);
        if (attempt < maxAttempts && error.retryable) {
          lastError = error;
          console.error(`Intento ${attempt}/${maxAttempts} fallo: ${error.message}`);
          await sleep(1500 * attempt);
          continue;
        }
        throw error;
      }

      const data = await res.json();
      if (!data.messageId || typeof data.messageId !== 'string') {
        const error = new Error('Brevo acepto la respuesta HTTP pero no retorno messageId.');
        error.retryable = false;
        throw error;
      }
      const result = {
        messageId: data.messageId,
        deliveryMode,
        recipients,
        fileName,
        fileSizeBytes,
        downloadExpiresAt: deliveryMode === 'download_link' ? downloadExpiresAt : null,
      };
      writeResult(result);
      console.log(`Respaldo enviado exitosamente. MessageID: ${data.messageId}`);
      return;
    } catch (error) {
      if (attempt < maxAttempts && error.retryable !== false) {
        lastError = error;
        console.error(`Intento ${attempt}/${maxAttempts} fallo: ${error.message}`);
        await sleep(1500 * attempt);
        continue;
      }
      lastError = error;
      break;
    }
  }

  console.error(
    'Error al enviar email:',
    (lastError ?? new Error('No se pudo enviar el respaldo')).message,
  );
  process.exit(1);
}

main();
