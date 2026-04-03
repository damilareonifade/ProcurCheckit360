import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { Logger } from 'nestjs-pino';
import { join } from 'path';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    AppModule,
    {
      transport: Transport.GRPC,
      options: {
        package: 'wallet',
        protoPath: join(__dirname, '../../../packages/proto/wallet.proto'),
        url: '0.0.0.0:50052',
      },
    },
  );

  app.useLogger(app.get(Logger));
  await app.listen();
  app.get(Logger).log('Wallet Service is running on grpc://0.0.0.0:50052');
}
bootstrap();
