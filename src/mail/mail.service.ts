import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

interface ResendErrorBody {
  message?: string;
  name?: string;
}

/** Los TLD reservados para documentación/pruebas no se pueden verificar en Resend. */
function isDeliverableAddress(address: string): boolean {
  const domain = address.split('@')[1]?.toLowerCase() ?? '';
  return domain.length > 0 && !/\.(local|test|invalid|example)$/.test(domain);
}

/**
 * Envío de correo con Resend.
 *
 * En desarrollo, si `RESEND_API_KEY` está vacía, el correo se escribe en el log
 * del servidor (nunca en la respuesta HTTP). En producción la clave es
 * obligatoria y los códigos/enlaces no se registran en logs.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly config: ConfigService) {}

  async send(message: MailMessage): Promise<void> {
    const apiKey = this.config.get<string>('RESEND_API_KEY');
    const isProduction = this.config.get('NODE_ENV') === 'production';

    if (!isProduction) {
      await this.writeToOutbox(message);
    }

    if (!apiKey) {
      if (isProduction) {
        throw new ServiceUnavailableException(
          'El envío de correo no está configurado',
        );
      }

      this.logger.warn(
        `[dev] RESEND_API_KEY vacía. Correo simulado para ${message.to}: "${message.subject}"`,
      );
      this.logger.debug(`[dev] ${message.text}`);
      return;
    }

    const from =
      this.config.get<string>('RESEND_FROM_EMAIL') ??
      'no-reply@naranjapimienta.local';

    // En desarrollo no gastamos llamadas a Resend con remitentes imposibles
    // (`.local`, `.test`): el correo ya está en el buzón de desarrollo.
    if (!isProduction && !isDeliverableAddress(from)) {
      this.logger.warn(
        `[dev] RESEND_FROM_EMAIL="${from}" no es un dominio verificable; el correo queda en .mail-outbox`,
      );
      return;
    }

    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
        }),
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as ResendErrorBody;
        const detail = `Resend rechazó el envío (${response.status}): ${body.message ?? 'sin detalle'}`;

        if (isProduction) {
          this.logger.error(detail);
          throw new ServiceUnavailableException(
            'No se pudo enviar el correo. Intenta de nuevo más tarde.',
          );
        }

        this.logger.warn(`${detail} (desarrollo: correo en .mail-outbox)`);
        return;
      }
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        throw error;
      }

      const detail = `Error de red al enviar correo: ${(error as Error).message}`;

      if (isProduction) {
        this.logger.error(detail);
        throw new ServiceUnavailableException(
          'No se pudo enviar el correo. Intenta de nuevo más tarde.',
        );
      }

      this.logger.warn(`${detail} (desarrollo: correo en .mail-outbox)`);
    }
  }

  /**
   * Buzón de desarrollo: escribe los correos en `api/.mail-outbox/mails.jsonl`
   * para poder probar códigos sin proveedor externo. Nunca se usa en producción.
   */
  private async writeToOutbox(message: MailMessage) {
    try {
      const dir = join(process.cwd(), '.mail-outbox');
      await mkdir(dir, { recursive: true });
      await appendFile(
        join(dir, 'mails.jsonl'),
        `${JSON.stringify({
          at: new Date().toISOString(),
          to: message.to,
          subject: message.subject,
          text: message.text,
        })}\n`,
        'utf8',
      );
    } catch (error) {
      this.logger.warn(
        `No se pudo escribir el buzón de desarrollo: ${(error as Error).message}`,
      );
    }
  }
}
