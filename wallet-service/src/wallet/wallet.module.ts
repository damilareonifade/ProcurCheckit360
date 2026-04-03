import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { join } from 'path';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';
import { PrismaService } from '../prisma.service';

@Module({
  imports: [
    ClientsModule.register([
      {
        name: 'USER_PACKAGE',
        transport: Transport.GRPC,
        options: {
          package: 'user',
          protoPath: join(
            __dirname,
            '../../../../packages/proto/user.proto',
          ),
          url: 'localhost:50051',
        },
      },
    ]),
  ],
  controllers: [WalletController],
  providers: [WalletService, PrismaService],
})
export class WalletModule {}
