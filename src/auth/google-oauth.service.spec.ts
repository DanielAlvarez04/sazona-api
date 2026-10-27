import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { GoogleOauthService } from './google-oauth.service';

function configService(values: Record<string, string | undefined>) {
  return {
    get: (key: string) => values[key],
  } as unknown as ConfigService;
}

const configured = () =>
  new GoogleOauthService(
    configService({
      GOOGLE_CLIENT_ID: 'client-id.apps.googleusercontent.com',
      GOOGLE_CLIENT_SECRET: 'client-secret',
      API_PUBLIC_ORIGIN: 'http://localhost:3001',
    }),
  );

describe('GoogleOauthService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('detecta si falta configuración', () => {
    const service = new GoogleOauthService(configService({}));

    expect(service.isConfigured).toBe(false);
  });

  it('genera un state y un par PKCE S256 coherente', () => {
    const { state, verifier, challenge } = configured().createChallenge();

    expect(state).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(challenge).toBe(
      createHash('sha256')
        .update(verifier)
        .digest('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, ''),
    );
  });

  it('construye la URL de autorización con redirect y PKCE', () => {
    const service = configured();
    const url = new URL(
      service.authorizationUrl('state-123', 'challenge-456'),
    );

    expect(url.origin + url.pathname).toBe(
      'https://accounts.google.com/o/oauth2/v2/auth',
    );
    expect(url.searchParams.get('client_id')).toBe(
      'client-id.apps.googleusercontent.com',
    );
    expect(url.searchParams.get('redirect_uri')).toBe(
      'http://localhost:3001/v1/auth/google/callback',
    );
    expect(url.searchParams.get('state')).toBe('state-123');
    expect(url.searchParams.get('code_challenge')).toBe('challenge-456');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).toContain('email');
  });

  it('respeta GOOGLE_REDIRECT_URI si está definida', () => {
    const service = new GoogleOauthService(
      configService({
        GOOGLE_CLIENT_ID: 'id',
        GOOGLE_CLIENT_SECRET: 'secret',
        GOOGLE_REDIRECT_URI: 'https://api.naranjapimienta.com/v1/auth/google/callback',
      }),
    );

    expect(service.redirectUri()).toBe(
      'https://api.naranjapimienta.com/v1/auth/google/callback',
    );
  });

  it('intercambia el código y devuelve el perfil verificado', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'access-token' }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            sub: 'google-sub',
            email: 'Admin@NaranjaPimienta.local',
            email_verified: true,
            name: 'Admin',
          }),
          { status: 200 },
        ),
      );

    const profile = await configured().fetchProfile('code', 'verifier');

    expect(profile).toEqual({
      sub: 'google-sub',
      email: 'admin@naranjapimienta.local',
      emailVerified: true,
      name: 'Admin',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const tokenRequest = fetchMock.mock.calls[0];
    expect(String(tokenRequest[0])).toBe('https://oauth2.googleapis.com/token');
    expect(String((tokenRequest[1]?.body as URLSearchParams).toString())).toContain(
      'code_verifier=verifier',
    );
  });

  it('rechaza un código que Google no acepta', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: 'invalid_grant', error_description: 'Bad code' }),
        { status: 400 },
      ),
    );

    await expect(
      configured().fetchProfile('code', 'verifier'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('no intenta contactar con Google si no está configurado', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch');

    await expect(
      new GoogleOauthService(configService({})).fetchProfile('code', 'v'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
