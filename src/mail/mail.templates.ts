interface BaseTemplate {
  title: string;
  intro: string;
  body: string;
  footer?: string;
}

function layout({ title, intro, body, footer }: BaseTemplate): string {
  return `<!doctype html>
<html lang="es">
  <body style="margin:0;padding:24px;background:#f6f6f6;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#1c1c1c">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px">
      <h1 style="margin:0 0 12px;font-size:20px">${title}</h1>
      <p style="margin:0 0 20px;line-height:1.5">${intro}</p>
      ${body}
      <hr style="margin:28px 0 16px;border:none;border-top:1px solid #e5e5e5" />
      <p style="margin:0;font-size:12px;color:#777">${
        footer ?? 'Naranja Pimienta · Sistema interno'
      }</p>
    </div>
  </body>
</html>`;
}

function codeBlock(code: string): string {
  return `<div style="margin:0 0 20px;padding:16px;border-radius:10px;background:#f1f1f1;text-align:center">
    <span style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:28px;font-weight:600;letter-spacing:6px">${code}</span>
  </div>`;
}

function actionLink(url: string, label: string): string {
  return `<p style="margin:0 0 20px;text-align:center">
    <a href="${url}" style="display:inline-block;padding:12px 20px;border-radius:10px;background:#e8622c;color:#ffffff;font-weight:600;text-decoration:none">${label}</a>
  </p>`;
}

export function verificationEmail(code: string, url?: string) {
  const subject = 'Verifica tu correo — Naranja Pimienta';
  const text = url
    ? `Confirma tu correo en Naranja Pimienta: ${url}\n\nTu código de verificación es ${code}. Caduca en 24 horas.`
    : `Tu código de verificación es ${code}. Caduca en 24 horas.`;
  return {
    subject,
    text,
    html: layout({
      title: 'Verifica tu correo',
      intro:
        'Usa este código para confirmar tu dirección de correo en Naranja Pimienta. Caduca en 24 horas.',
      body: `${url ? actionLink(url, 'Verificar mi correo') : ''}${codeBlock(code)}`,
    }),
  };
}

export function passwordResetEmail(
  code: string,
  expiresInMinutes: number,
  url?: string,
) {
  const subject = 'Recupera tu contraseña — Naranja Pimienta';
  const text = url
    ? `Elige una nueva contraseña aquí: ${url}\n\nTu código es ${code}. Caduca en ${expiresInMinutes} minutos.`
    : `Tu código para restablecer la contraseña es ${code}. Caduca en ${expiresInMinutes} minutos.`;
  return {
    subject,
    text,
    html: layout({
      title: 'Restablecer contraseña',
      intro: `Usa este enlace para elegir una nueva contraseña. Caduca en ${expiresInMinutes} minutos. Si no lo solicitaste, ignora este correo.`,
      body: `${url ? actionLink(url, 'Elegir nueva contraseña') : ''}${codeBlock(code)}`,
    }),
  };
}

export function twoFactorEmail(code: string, purpose: 'LOGIN' | 'ENABLE') {
  const isLogin = purpose === 'LOGIN';
  const subject = isLogin
    ? 'Tu código de acceso — Naranja Pimienta'
    : 'Activa la verificación en dos pasos — Naranja Pimienta';
  const text = `Tu código es ${code}. Caduca en 10 minutos.`;

  return {
    subject,
    text,
    html: layout({
      title: isLogin ? 'Código de acceso' : 'Activa la verificación en dos pasos',
      intro: isLogin
        ? 'Alguien está iniciando sesión con tu cuenta. Introduce este código para continuar. Caduca en 10 minutos.'
        : 'Introduce este código para activar la verificación en dos pasos. Caduca en 10 minutos.',
      body: codeBlock(code),
      footer:
        'Si no reconoces esta actividad, cambia tu contraseña de inmediato.',
    }),
  };
}

export function passwordChangedEmail() {
  const subject = 'Tu contraseña cambió — Naranja Pimienta';
  const text =
    'La contraseña de tu cuenta cambió y se cerraron todas las sesiones activas.';

  return {
    subject,
    text,
    html: layout({
      title: 'Contraseña actualizada',
      intro:
        'La contraseña de tu cuenta cambió y cerramos todas las sesiones activas. Si no fuiste tú, contacta al administrador inmediatamente.',
      body: '',
    }),
  };
}
