import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport, RpcException } from '@nestjs/microservices';
import { ValidationPipe } from '@nestjs/common';
import { status } from '@grpc/grpc-js';
import { Logger } from 'nestjs-pino';
import { join } from 'node:path';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    AppModule,
    {
      transport: Transport.GRPC,
      options: {
        package: 'user',
        protoPath: join(__dirname, '../../../packages/proto/user.proto'),
        url: '0.0.0.0:50051',
      },
    },
  );

  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    transform: true,
    exceptionFactory: (errors) => new RpcException({
      code: status.INVALID_ARGUMENT,
      message: errors.map((e) => Object.values(e.constraints ?? {}).join(', ')).join('; '),
    }),
  }));
  app.useLogger(app.get(Logger));
  await app.listen();
  app.get(Logger).log('User Service is running on grpc://0.0.0.0:50051');
}
bootstrap();
