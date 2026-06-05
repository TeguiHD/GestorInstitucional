const BRAND = {
  name: 'Colegio San Sebastián de Paine',
  short: 'CSSP',
  primary: '#1e3a8a',
  accent: '#2563eb',
};

const SHARE_BLOCK_HTML = `
  <div style="margin-top:20px;padding:14px 16px;background:#eff6ff;border:1px dashed #93c5fd;border-radius:8px;font-size:13px;color:#1e40af;line-height:1.5">
    <strong>📣 Ayúdenos a llegar a toda la comunidad</strong><br/>
    Si conoce otros apoderados del curso que pudieran no haber recibido este mensaje, por favor reenvíeselo o coménteselo. Así aseguramos que la información llegue a todas las familias.
  </div>`;

const SHARE_BLOCK_TEXT =
  '\n\n---\nSi conoce otros apoderados del curso que no hayan recibido este aviso, por favor compártalo con ellos.';

function shell(title: string, bodyHtml: string, footerNote?: string): string {
  return `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px">
<tr><td align="center">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08)">
    <tr><td style="background:${BRAND.primary};padding:20px 28px;color:#fff">
      <div style="font-size:12px;opacity:.8;letter-spacing:.08em;text-transform:uppercase">Asistencia ${BRAND.short}</div>
      <div style="font-size:20px;font-weight:700;margin-top:4px">${BRAND.name}</div>
    </td></tr>
    <tr><td style="padding:28px">${bodyHtml}</td></tr>
    <tr><td style="padding:16px 28px;background:#f8fafc;border-top:1px solid #e2e8f0;font-size:11px;color:#64748b">
      ${footerNote ?? 'Este mensaje se envió desde el sistema oficial de asistencia. Para dudas contacte a dirección.'}
    </td></tr>
  </table>
</td></tr>
</table>
</body></html>`;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleDateString('es-CL', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

// ----- Templates -----

export function absenceDaily(p: {
  guardianName: string;
  studentName: string;
  courseName: string;
  date: Date | string;
  status: 'ABSENT' | 'LATE';
  lateMinutes?: number;
  portalUrl: string;
}): { subject: string; html: string; text: string } {
  const isLate = p.status === 'LATE';
  const accent = isLate ? '#f97316' : '#dc2626';
  const label = isLate ? `Atraso${p.lateMinutes ? ` (${p.lateMinutes} min)` : ''}` : 'Inasistencia';
  const subject = isLate
    ? `Atraso de ${p.studentName} — ${formatDate(p.date)}`
    : `Inasistencia de ${p.studentName} — ${formatDate(p.date)}`;

  const body = `
    <p style="margin:0 0 12px;font-size:15px">Estimado/a <strong>${escapeHtml(p.guardianName)}</strong>,</p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.5">
      Le informamos que su pupilo <strong>${escapeHtml(p.studentName)}</strong> (${escapeHtml(p.courseName)})
      registró <strong style="color:${accent}">${label}</strong> el <strong>${formatDate(p.date)}</strong>.
    </p>
    ${
      isLate
        ? ''
        : `
    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:14px;margin:16px 0;font-size:14px;color:#991b1b">
      Si la ausencia tiene justificación (médica, familiar), puede subir el certificado desde el portal de apoderados.
    </div>
    <div style="text-align:center;margin:20px 0">
      <a href="${p.portalUrl}/my-children" style="display:inline-block;background:${BRAND.accent};color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:14px">Subir justificación</a>
    </div>`
    }
    <p style="margin:16px 0 0;font-size:13px;color:#475569">Atentamente,<br/>Equipo ${BRAND.name}</p>`;

  const text = `${subject}\n\nEstimado/a ${p.guardianName},\n\n${p.studentName} (${p.courseName}) registró ${label} el ${formatDate(p.date)}.${isLate ? '' : `\n\nJustifique en: ${p.portalUrl}/my-children`}\n\n${BRAND.name}`;

  return { subject, html: shell(subject, body), text };
}

export function justificationResult(p: {
  guardianName: string;
  studentName: string;
  date: Date | string;
  decision: 'APPROVED' | 'REJECTED';
  notes?: string;
  portalUrl: string;
}): { subject: string; html: string; text: string } {
  const approved = p.decision === 'APPROVED';
  const accent = approved ? '#16a34a' : '#dc2626';
  const verb = approved ? 'APROBADA' : 'RECHAZADA';
  const subject = `Justificación ${verb.toLowerCase()} — ${p.studentName}`;

  const body = `
    <p style="margin:0 0 12px;font-size:15px">Estimado/a <strong>${escapeHtml(p.guardianName)}</strong>,</p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.5">
      La justificación presentada por la inasistencia de <strong>${escapeHtml(p.studentName)}</strong> del <strong>${formatDate(p.date)}</strong> ha sido
      <strong style="color:${accent}">${verb}</strong>.
    </p>
    ${
      p.notes
        ? `
    <div style="background:#f8fafc;border-left:3px solid ${accent};padding:12px 14px;margin:12px 0;font-size:14px;color:#334155">
      <div style="font-size:11px;color:#64748b;text-transform:uppercase;margin-bottom:4px">Observaciones</div>
      ${escapeHtml(p.notes)}
    </div>`
        : ''
    }
    ${
      approved
        ? `<p style="margin:12px 0 0;font-size:14px;color:#475569">La inasistencia ha sido reclasificada como <strong>justificada</strong> en el registro oficial.</p>`
        : `<p style="margin:12px 0 0;font-size:14px;color:#475569">Puede volver a enviar una nueva justificación desde el portal si dispone de antecedentes adicionales.</p>`
    }
    <div style="text-align:center;margin:20px 0">
      <a href="${p.portalUrl}/my-children" style="display:inline-block;background:${BRAND.accent};color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:14px">Ver historial</a>
    </div>`;

  const text = `${subject}\n\n${p.studentName} — ${formatDate(p.date)}\nDecisión: ${verb}${p.notes ? `\nObs: ${p.notes}` : ''}\n\n${p.portalUrl}/my-children`;

  return { subject, html: shell(subject, body), text };
}

const HOLIDAY_PERSONALITY: Array<{ keywords: string[]; message: string; emoji: string }> = [
  {
    keywords: ['año nuevo'],
    message: '¡Les deseamos un año lleno de aprendizajes, alegría y logros para toda la familia!',
    emoji: '🎆',
  },
  {
    keywords: ['trabajador'],
    message:
      'Un día para reconocer y agradecer a quienes, con su esfuerzo cotidiano, construyen nuestra comunidad y nuestro país.',
    emoji: '👷',
  },
  {
    keywords: ['glorias navales', 'iquique'],
    message:
      'Recordamos con orgullo y profundo respeto a quienes escribieron una de las páginas más heroicas de nuestra historia patria.',
    emoji: '⚓',
  },
  {
    keywords: ['pueblos indígenas', 'indígena'],
    message:
      'Los invitamos a conocer, valorar y celebrar la inmensa riqueza cultural de los pueblos originarios de nuestra tierra. Compartir su historia, su lengua y su sabiduría nos enriquece como comunidad.',
    emoji: '🌿',
  },
  {
    keywords: ['san pedro', 'san pablo'],
    message:
      '¡Que sea un tiempo de descanso y encuentro familiar! Celebramos esta festividad junto a nuestra comunidad escolar.',
    emoji: '⛵',
  },
  {
    keywords: ['virgen del carmen'],
    message:
      'Celebramos con fervor a la Patrona de Chile. ¡Que su luz y su amparo guíen a todas nuestras familias!',
    emoji: '🕯️',
  },
  {
    keywords: ['asunción'],
    message:
      'Una fecha de reflexión, fe y gratitud para nuestra comunidad. ¡Que sea un día de paz en familia!',
    emoji: '🌸',
  },
  {
    keywords: ['independencia', 'dieciocho', 'fiestas patrias'],
    message:
      '¡Felices Fiestas Patrias! Celebremos con orgullo nuestra identidad chilena: su música, su gente, su tierra y sus tradiciones. 🇨🇱 ¡Que el chilenito brille en cada hogar!',
    emoji: '🎊',
  },
  {
    keywords: ['glorias del ejército', 'ejército'],
    message:
      'Recordamos con respeto la dedicación y sacrificio de quienes han defendido y defienden nuestra soberanía y libertad.',
    emoji: '🎖️',
  },
  {
    keywords: ['encuentro de dos mundos', 'dos mundos'],
    message:
      'Una fecha para reflexionar sobre el encuentro de culturas que dio forma a nuestra rica identidad latinoamericana y a quienes somos hoy.',
    emoji: '🌎',
  },
  {
    keywords: ['evangélica', 'evangélicas', 'reforma'],
    message:
      'Saludamos con respeto y cariño a todas las familias que celebran este día de fe y reflexión espiritual.',
    emoji: '📖',
  },
  {
    keywords: ['todos los santos'],
    message:
      'Un día para recordar con amor y cariño a quienes ya no están físicamente con nosotros, pero viven siempre en nuestros corazones.',
    emoji: '🕯️',
  },
  {
    keywords: ['inmaculada', 'concepción'],
    message:
      'Celebramos esta festividad religiosa deseando paz, salud y bienestar a todas las familias de nuestra comunidad.',
    emoji: '🌼',
  },
  {
    keywords: ['navidad'],
    message:
      '¡Feliz Navidad a toda la comunidad escolar! Que esta época maravillosa llene de alegría, amor y unidad cada hogar. ¡Nos vemos el próximo año con las pilas puestas! 🎄',
    emoji: '🎁',
  },
];

function getHolidayPersonality(description: string): { message: string; emoji: string } | null {
  const lower = description.toLowerCase();
  for (const h of HOLIDAY_PERSONALITY) {
    if (h.keywords.some((k) => lower.includes(k))) return h;
  }
  return null;
}

export function classSuspension(p: {
  schoolName: string;
  date: Date | string;
  description: string;
  type: 'HOLIDAY' | 'SUSPENDED' | 'EVENT';
}): { subject: string; html: string; text: string } {
  const label =
    p.type === 'HOLIDAY'
      ? 'Feriado'
      : p.type === 'SUSPENDED'
        ? 'Suspensión de clases'
        : 'Evento escolar';
  const subject = `${label}: ${formatDate(p.date)} — ${p.description}`;
  const personality = p.type === 'HOLIDAY' ? getHolidayPersonality(p.description) : null;

  const body = `
    <p style="margin:0 0 12px;font-size:15px">Estimada Comunidad Escolar,</p>
    <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:8px;padding:16px;margin:16px 0">
      <div style="font-size:11px;color:#92400e;text-transform:uppercase;letter-spacing:.05em;font-weight:700">${label}</div>
      <div style="font-size:18px;font-weight:700;color:#78350f;margin-top:6px">${formatDate(p.date)}</div>
      <div style="font-size:14px;color:#78350f;margin-top:8px;line-height:1.5">${escapeHtml(p.description)}</div>
    </div>
    ${
      personality
        ? `
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:14px 16px;margin:12px 0;font-size:14px;color:#14532d;line-height:1.6">
      <span style="font-size:18px;margin-right:8px">${personality.emoji}</span>${escapeHtml(personality.message)}
    </div>`
        : ''
    }
    <p style="margin:12px 0 0;font-size:14px;color:#475569">
      Se informa oportunamente para la debida programación familiar. ${p.type === 'SUSPENDED' ? 'Este día no se registrará asistencia y no afectará los porcentajes oficiales.' : ''}
    </p>
    ${SHARE_BLOCK_HTML}
    <p style="margin:16px 0 0;font-size:13px;color:#475569">Atentamente,<br/>${escapeHtml(p.schoolName)}</p>`;

  const text = `${subject}\n\n${label}: ${formatDate(p.date)}\n${p.description}${personality ? `\n\n${personality.emoji} ${personality.message}` : ''}${SHARE_BLOCK_TEXT}\n\n${p.schoolName}`;

  return { subject, html: shell(subject, body), text };
}

export function weeklyDigest(p: {
  guardianName: string;
  studentName: string;
  courseName: string;
  weekStart: Date | string;
  weekEnd: Date | string;
  stats: {
    present: number;
    absent: number;
    late: number;
    justified: number;
    missing?: number;
    total?: number;
    rate: number;
  };
  absentDates: string[];
  portalUrl: string;
}): { subject: string; html: string; text: string } {
  const pct = (p.stats.rate * 100).toFixed(1);
  const rateColor = p.stats.rate >= 0.9 ? '#16a34a' : p.stats.rate >= 0.75 ? '#f59e0b' : '#dc2626';
  const subject = `Resumen semanal — ${p.studentName} (${pct}%)`;

  const kpi = (label: string, value: number | string, color: string) =>
    `<td align="center" style="padding:10px;background:#f8fafc;border-radius:8px">
      <div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.05em">${label}</div>
      <div style="font-size:22px;font-weight:700;color:${color};margin-top:2px">${value}</div>
    </td>`;

  const body = `
    <p style="margin:0 0 12px;font-size:15px">Estimado/a <strong>${escapeHtml(p.guardianName)}</strong>,</p>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.5">
      Resumen de asistencia de <strong>${escapeHtml(p.studentName)}</strong> (${escapeHtml(p.courseName)})
      del <strong>${formatDate(p.weekStart)}</strong> al <strong>${formatDate(p.weekEnd)}</strong>:
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="6" style="margin:12px 0">
      <tr>
        ${kpi('Asistencia', pct + '%', rateColor)}
        ${kpi('Presente', String(p.stats.present), '#16a34a')}
        ${kpi('Ausente', String(p.stats.absent), '#dc2626')}
        ${kpi('Atrasos', String(p.stats.late), '#f97316')}
        ${kpi('Justif.', String(p.stats.justified), '#eab308')}
        ${kpi('Total clases', String(p.stats.total ?? '—'), '#334155')}
      </tr>
    </table>
    <p style="margin:8px 0 0;font-size:12px;color:#64748b">
      Fórmula: (Presentes + Atrasos) / Total clases. Justificados y sin registro no suman asistencia.
      ${p.stats.missing ? `Sin registro: ${p.stats.missing}.` : ''}
    </p>
    ${
      p.absentDates.length
        ? `
    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px 14px;margin:12px 0;font-size:14px;color:#991b1b">
      <div style="font-size:11px;text-transform:uppercase;font-weight:700;margin-bottom:4px">Ausencias sin justificar</div>
      ${p.absentDates.map((d) => escapeHtml(d)).join(', ')}
    </div>`
        : ''
    }
    <div style="text-align:center;margin:20px 0">
      <a href="${p.portalUrl}/my-children" style="display:inline-block;background:${BRAND.accent};color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:14px">Ver historial completo</a>
    </div>
    <p style="margin:16px 0 0;font-size:13px;color:#475569">Atentamente,<br/>${BRAND.name}</p>`;

  const text = `${subject}\n\n${p.studentName} ${p.courseName}\nAsistencia: ${pct}%\nFórmula: (Presentes + Atrasos) / Total clases\nPresente ${p.stats.present} · Ausente ${p.stats.absent} · Atrasos ${p.stats.late} · Justif ${p.stats.justified} · Total clases ${p.stats.total ?? '—'}${p.stats.missing ? ` · Sin registro ${p.stats.missing}` : ''}${p.absentDates.length ? `\nAusencias: ${p.absentDates.join(', ')}` : ''}\n\n${p.portalUrl}/my-children`;

  return { subject, html: shell(subject, body), text };
}

export function broadcast(p: {
  schoolName: string;
  title: string;
  bodyText: string;
  shareable?: boolean;
}): { subject: string; html: string; text: string } {
  const subject = p.title;
  const paragraphs = p.bodyText
    .split(/\n\n+/)
    .map(
      (para) =>
        `<p style="margin:0 0 12px;font-size:15px;line-height:1.6">${escapeHtml(para).replace(/\n/g, '<br/>')}</p>`,
    )
    .join('');

  const shareHtml = p.shareable === false ? '' : SHARE_BLOCK_HTML;
  const shareText = p.shareable === false ? '' : SHARE_BLOCK_TEXT;

  const body = `
    <div style="font-size:18px;font-weight:700;color:#0f172a;margin-bottom:12px">${escapeHtml(p.title)}</div>
    ${paragraphs}
    ${shareHtml}
    <p style="margin:20px 0 0;font-size:13px;color:#475569">Atentamente,<br/>${escapeHtml(p.schoolName)}</p>`;

  return {
    subject,
    html: shell(subject, body),
    text: `${p.title}\n\n${p.bodyText}${shareText}\n\n${p.schoolName}`,
  };
}
