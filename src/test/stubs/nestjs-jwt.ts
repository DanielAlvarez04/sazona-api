/**
 * Stub de `@nestjs/jwt` para Jest.
 *
 * La versión instalada (v12) publica ESM puro y el runtime de Jest no puede
 * `require()` ese módulo en Node 22. Los tests inyectan su propio mock, así que
 * basta con exponer la clase con la misma forma.
 */
export class JwtService {
  signAsync(): Promise<string> {
    return Promise.resolve('');
  }

  verifyAsync(): Promise<unknown> {
    return Promise.resolve({});
  }
}
