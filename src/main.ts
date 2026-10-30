import { NestFactory } from '@nestjs/core';
import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

/**
 * Carga `api/.env`.
 *
 * Se buscan dos rutas para que funcione tanto si el proceso arranca dentro de
 * `api/` (lo habitual) como desde la raíz del repositorio: el `cwd` y el
 * directorio del paquete (`dist/src` → `api/`).
 */
const envPath = [
  resolve(process.cwd(), '.env'),
  resolve(__dirname, '..', '..', '.env'),
].find((candidate) => existsSync(candidate));

config(envPath ? { path: envPath } : {});

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: process.env.WEB_ORIGIN || 'http://localhost:3000',
    credentials: true,
  });

  app.use(cookieParser());

  app.setGlobalPrefix('v1');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Naranja Pimienta API')
    .setDescription('API de sistema POS para cafetería')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  await app.listen(process.env.PORT ?? 3001);
}
bootstrap();
