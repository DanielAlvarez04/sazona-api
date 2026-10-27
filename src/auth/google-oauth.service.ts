import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const REQUEST_TIMEOUT_MS = 10_000;

export interface OAuthChallenge {
  state: string;
  verifier: string;
  challenge: string;
}

export interface GoogleProfile {
  sub: string;
  email: string;
  emailVerified: boolean;
  name?: string;
}

interface TokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

interface UserInfoResponse {
  sub?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
}

function base64url(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * OAuth 2.0 con Google usando el flujo de código de autorización + PKCE.
 *
 * Se implementó con `fetch` en lugar de `passport-google-oauth20` para no añadir
 * dependencias: sólo se necesitan tres llamadas HTTP y el flujo queda explícito
 * (plan.md §4.3 pide justificar cada dependencia de OAuth).
 */
@Injectable()
export class GoogleOauthService {
  private readonly logger = new Logger(GoogleOauthService.name);

  constructor(private readonly config: ConfigService) {}

  get isConfigured(): boolean {
    return Boolean(this.clientId() && this.clientSecret());
  }

  /** Genera `state` y el par PKCE para una nueva autorización. */
  createChallenge(): OAuthChallenge {
    const verifier = base64url(randomBytes(32));
    const challenge = base64url(
      createHash('sha256').update(verifier).digest(),
    );

    return { state: base64url(randomBytes(24)), verifier, challenge };
  }

  authorizationUrl(state: string, codeChallenge: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId(),
      redirect_uri: this.redirectUri(),
      response_type: 'code',
      scope: 'openid email profile',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      prompt: 'select_account',
    });

    return `${AUTHORIZE_URL}?${params.toString()}`;
  }

  async fetchProfile(code: string, verifier: string): Promise<GoogleProfile> {
    const tokenResponse = await this.request(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: this.clientId(),
        client_secret: this.clientSecret(),
        redirect_uri: this.redirectUri(),
        grant_type: 'authorization_code',
        code_verifier: verifier,
      }).toString(),
    });

    const tokens = (await tokenResponse.json().catch(() => ({}))) as
      | TokenResponse
      | undefined;

    if (!tokenResponse.ok || !tokens?.access_token) {
      this.logger.warn(
        `Google rechazó el código de autorización (${tokenResponse.status}): ${
          tokens?.error_description ?? tokens?.error ?? 'sin detalle'
        }`,
      );
      throw new UnauthorizedException('No se pudo validar la cuenta de Google');
    }

    const userInfoResponse = await this.request(USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    const profile = (await userInfoResponse.json().catch(() => ({}))) as
      | UserInfoResponse
      | undefined;

    if (!userInfoResponse.ok || !profile?.sub || !profile.email) {
      this.logger.warn(
        `No se pudo leer el perfil de Google (${userInfoResponse.status})`,
      );
      throw new UnauthorizedException('No se pudo leer el perfil de Google');
    }

    return {
      sub: profile.sub,
      email: profile.email.toLowerCase(),
      emailVerified: profile.email_verified === true,
      name: profile.name,
    };
  }

  /** URI registrada en Google Cloud Console. */
  redirectUri(): string {
    const configured = this.config.get<string>('GOOGLE_REDIRECT_URI');
    if (configured) {
      return configured;
    }

    const apiOrigin =
      this.config.get<string>('API_PUBLIC_ORIGIN') ??
      `http://localhost:${this.config.get<string>('PORT') ?? '3001'}`;

    return `${apiOrigin.replace(/\/$/, '')}/v1/auth/google/callback`;
  }

  private clientId(): string {
    return this.config.get<string>('GOOGLE_CLIENT_ID') ?? '';
  }

  private clientSecret(): string {
    return this.config.get<string>('GOOGLE_CLIENT_SECRET') ?? '';
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    if (!this.isConfigured) {
      throw new ServiceUnavailableException(
        'El inicio de sesión con Google no está configurado',
      );
    }

    try {
      return await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      this.logger.error(
        `Error de red con Google: ${(error as Error).message}`,
      );
      throw new ServiceUnavailableException(
        'No se pudo contactar con Google. Intenta de nuevo más tarde.',
      );
    }
  }
}
