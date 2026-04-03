import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { LoggerModule } from 'nestjs-pino';
import { join } from 'path';
import { WalletModule } from './wallet/wallet.module';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            singleLine: true,
          },
        },
        level: process.env.LOG_LEVEL || 'info',
      },
    }),
    ClientsModule.register([
      {
        name: 'USER_PACKAGE',
        transport: Transport.GRPC,
        options: {
          package: 'user',
          protoPath: join(__dirname, '../../../packages/proto/user.proto'),
          url: 'localhost:50051',
        },
      },
    ]),
    WalletModule,
  ],
})
export class AppModule {}
