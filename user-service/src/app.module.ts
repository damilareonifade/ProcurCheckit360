import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { UserModule } from './user/user.module';

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
    UserModule,
  ],
})
export class AppModule {}
