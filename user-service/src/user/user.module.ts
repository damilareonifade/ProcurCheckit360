import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { join } from 'node:path';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { PrismaService } from '../prisma.service';

@Module({
  imports: [
    ClientsModule.register([
      {
        name: 'WALLET_PACKAGE',
        transport: Transport.GRPC,
        options: {
          package: 'wallet',
          protoPath: join(__dirname, '../../../../packages/proto/wallet.proto'),
          url: 'localhost:50052',
        },
      },
    ]),
  ],
  controllers: [UserController],
  providers: [UserService, PrismaService],
})
export class UserModule {}
