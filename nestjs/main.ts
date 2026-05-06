import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { ValidationPipe } from '@nestjs/common'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { AppModule } from './app.module'
import { CorsIoAdapter, parseCorsOrigins } from './cors-io-adapter'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)

  // CORS — applied to both REST (enableCors) and Socket.IO (custom adapter).
  // Comma-separated list in CORS_ORIGINS, or '*'/unset for wildcard.
  const origin = parseCorsOrigins(process.env.CORS_ORIGINS)
  app.enableCors({ origin: origin === true ? '*' : origin, credentials: true })
  app.useWebSocketAdapter(new CorsIoAdapter(app, origin))

  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }))

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Bridle Hub')
    .setDescription('AI chat relay — WebSocket hub between browsers and agents')
    .setVersion('0.1.0')
    .build()
  const document = SwaggerModule.createDocument(app, swaggerConfig)
  SwaggerModule.setup('api/docs', app, document)

  const port = process.env.PORT || 3333
  await app.listen(port)
  const url = `http://localhost:${port}`
  const corsLabel = origin === true ? '*' : origin.join(', ')
  console.log(`\n🐴 Bridle hub running`)
  console.log(`   BRIDLE_URL=${url}`)
  console.log(`   CORS:     ${corsLabel}`)
  console.log(`   Swagger:  ${url}/api/docs`)
  console.log(`   WS chat:  ws://localhost:${port}/ws/chat`)
  console.log(`   WS agent: ws://localhost:${port}/ws/agent\n`)
}

bootstrap()
