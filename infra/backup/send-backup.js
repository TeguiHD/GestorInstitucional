import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Uso: node send-backup.js <ruta_al_archivo_sql_gz>');
    process.exit(1);
  }

  if (!fs.existsSync(filePath)) {
    console.error(`Archivo no encontrado: ${filePath}`);
    process.exit(1);
  }

  const env = loadEnv();
  const apiKey = env.BREVO_API_KEY;
  const fromEmail = env.MAIL_FROM_EMAIL || 'no-reply@asistencia.nicoholas.dev';
  const fromName = env.MAIL_FROM_NAME || 'Asistencia CSSP';
  const backupEmailsRaw = env.BACKUP_EMAILS || '';

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

  const fileName = path.basename(filePath);
  const fileContentBase64 = fs.readFileSync(filePath).toString('base64');

  const today = new Date().toISOString().split('T')[0];
  const payload = {
    sender: { name: fromName, email: fromEmail },
    to: recipients.map((email) => ({ email })),
    subject: `Respaldo de Base de Datos - Asistencia CSSP [${today}]`,
    htmlContent: `
      <h2>Respaldo Diario Automático</h2>
      <p>Se adjunta el respaldo completo de la base de datos del sistema de asistencia.</p>
      <ul>
        <li><strong>Fecha:</strong> ${today}</li>
        <li><strong>Archivo:</strong> ${fileName}</li>
      </ul>
      <p>Este es un correo automático de seguridad.</p>
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
