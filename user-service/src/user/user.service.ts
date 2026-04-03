import { Injectable, OnModuleInit, Inject } from '@nestjs/common';
import { ClientGrpc, RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { PinoLogger, InjectPinoLogger } from 'nestjs-pino';
import { Observable, firstValueFrom } from 'rxjs';
import { PrismaService } from '../prisma.service';

interface WalletServiceGrpc {
  createWallet(data: { userId: string }): Observable<{ id: string; userId: string; balance: number; currency: string; createdAt: string }>;
}

@Injectable()
export class UserService implements OnModuleInit {
  private walletService: WalletServiceGrpc;

  constructor(
    @Inject('WALLET_PACKAGE') private readonly walletClient: ClientGrpc,
    private readonly prisma: PrismaService,
    @InjectPinoLogger(UserService.name) private readonly logger: PinoLogger,
  ) {}

  onModuleInit() {
    this.walletService = this.walletClient.getService<WalletServiceGrpc>('WalletService');
  }

  async createUser(data: { email: string; name: string }) {
    this.logger.info({ email: data.email }, 'Creating user');

    const existing = await this.prisma.client.user.findUnique({
      where: { email: data.email },
    });

    if (existing) {
      this.logger.warn({ email: data.email }, 'User already exists');
      throw new RpcException({
        code: status.ALREADY_EXISTS,
        message: 'User with this email already exists',
      });
    }

    const user = await this.prisma.client.user.create({
      data: {
        email: data.email,
        name: data.name,
      },
    });

    this.logger.info({ userId: user.id, email: user.email }, 'User created');

    // Create wallet for the new user; compensate by deleting the user if it fails
    try {
      await firstValueFrom(this.walletService.createWallet({ userId: user.id }));
      this.logger.info({ userId: user.id }, 'Wallet created for user');
    } catch (err) {
      this.logger.error({ userId: user.id, err }, 'Wallet creation failed — rolling back user');
      await this.prisma.client.user.delete({ where: { id: user.id } });
      throw new RpcException({
        code: status.INTERNAL,
        message: 'Failed to create wallet. User registration has been rolled back.',
      });
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      createdAt: user.createdAt.toISOString(),
    };
  }

  async getUserById(id: string) {
    this.logger.info({ userId: id }, 'Fetching user by ID');

    const user = await this.prisma.client.user.findUnique({
      where: { id },
    });

    if (!user) {
      this.logger.warn({ userId: id }, 'User not found');
      throw new RpcException({
        code: status.NOT_FOUND,
        message: `User with id ${id} not found`,
      });
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      createdAt: user.createdAt.toISOString(),
    };
  }

  async deleteUser(id: string) {
    this.logger.info({ userId: id }, 'Deleting user (saga compensation)');

    const user = await this.prisma.client.user.findUnique({ where: { id } });

    if (!user) {
      this.logger.warn({ userId: id }, 'User not found for deletion');
      throw new RpcException({
        code: status.NOT_FOUND,
        message: `User with id ${id} not found`,
      });
    }

    await this.prisma.client.user.delete({ where: { id } });
    this.logger.info({ userId: id }, 'User deleted');

    return { success: true };
  }
}
