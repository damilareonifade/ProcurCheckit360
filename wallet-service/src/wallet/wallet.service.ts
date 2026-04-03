import { Injectable, OnModuleInit, Inject } from '@nestjs/common';
import { ClientGrpc, RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { PinoLogger, InjectPinoLogger } from 'nestjs-pino';
import { Observable, firstValueFrom } from 'rxjs';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../prisma.service';

interface UserServiceGrpc {
  createUser(data: { email: string; name: string }): Observable<{
    id: string;
    email: string;
    name: string;
    createdAt: string;
  }>;
  getUserById(data: { id: string }): Observable<{
    id: string;
    email: string;
    name: string;
    createdAt: string;
  }>;
  deleteUser(data: { id: string }): Observable<{ success: boolean }>;
}

@Injectable()
export class WalletService implements OnModuleInit {
  private userService: UserServiceGrpc;

  constructor(
    @Inject('USER_PACKAGE') private readonly userClient: ClientGrpc,
    private readonly prisma: PrismaService,
    @InjectPinoLogger(WalletService.name) private readonly logger: PinoLogger,
  ) {}

  onModuleInit() {
    this.userService =
      this.userClient.getService<UserServiceGrpc>('UserService');
  }

  // Create wallet
  async createWallet(userId: string) {
    this.logger.info({ userId }, 'Creating wallet');

    // Verify user exists via gRPC call to User Service
    try {
      await firstValueFrom(this.userService.getUserById({ id: userId }));
    } catch {
      this.logger.warn({ userId }, 'User not found via gRPC');
      throw new RpcException({
        code: status.NOT_FOUND,
        message: `User with id ${userId} not found`,
      });
    }

    const existing = await this.prisma.client.wallet.findUnique({
      where: { userId },
    });

    if (existing) {
      this.logger.warn({ userId }, 'Wallet already exists');
      throw new RpcException({
        code: status.ALREADY_EXISTS,
        message: 'Wallet already exists for this user',
      });
    }

    const wallet = await this.prisma.client.wallet.create({
      data: { userId, balance: 0, currency: 'NGN' },
    });

    this.logger.info({ userId, walletId: wallet.id }, 'Wallet created');
    return this.serializeWallet(wallet);
  }

  // Get wallet
  async getWallet(userId: string) {
    this.logger.info({ userId }, 'Fetching wallet');
    const wallet = await this.prisma.client.wallet.findUnique({
      where: { userId },
    });

    if (!wallet) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: `Wallet not found for user ${userId}`,
      });
    }

    return this.serializeWallet(wallet);
  }

  // Credit Wallet
  async creditWallet(userId: string, amount: number) {
    this.logger.info({ userId, amount }, 'Crediting wallet');

    if (amount <= 0) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Amount must be greater than 0',
      });
    }

    const wallet = await this.prisma.client.wallet.findUnique({
      where: { userId },
    });

    if (!wallet) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: `Wallet not found for user ${userId}`,
      });
    }

    const amountMinor = BigInt(amount);
    const newBalance = await this.optimisticCredit(wallet.id, amountMinor);
    const reference = uuidv4();

    const txn = await this.prisma.client.transaction.create({
      data: {
        walletId: wallet.id,
        reference,
        type: 'credit',
        amount: amountMinor,
        balanceAfter: newBalance,
        description: 'Deposit',
        counterpartyAccount: null,
      },
    });

    this.logger.info({ userId, reference, amount: Number(amountMinor), newBalance: Number(newBalance) }, 'Wallet credited');

    return {
      wallet: {
        id: wallet.id,
        userId: wallet.userId,
        balance: Number(newBalance),
        balanceFormatted: (Number(newBalance) / 100).toFixed(2),
        currency: wallet.currency,
        createdAt: wallet.createdAt.toISOString(),
      },
      transaction: this.serializeTxn(txn),
    };
  }

  // Debit Wallet
  async debitWallet(userId: string, amount: number) {
    this.logger.info({ userId, amount }, 'Debiting wallet');

    if (amount <= 0) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Amount must be greater than 0',
      });
    }

    const wallet = await this.prisma.client.wallet.findUnique({
      where: { userId },
    });

    if (!wallet) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: `Wallet not found for user ${userId}`,
      });
    }

    const amountMinor = BigInt(amount);
    const reference = uuidv4();

    const { newBalance, txn } = await this.atomicDebit(
      wallet.id,
      amountMinor,
      reference,
    );

    this.logger.info({ userId, reference, amount: Number(amountMinor), newBalance: Number(newBalance) }, 'Wallet debited');

    return {
      wallet: {
        id: wallet.id,
        userId: wallet.userId,
        balance: Number(newBalance),
        balanceFormatted: (Number(newBalance) / 100).toFixed(2),
        currency: wallet.currency,
        createdAt: wallet.createdAt.toISOString(),
      },
      transaction: this.serializeTxn(txn),
    };
  }

  // Delete wallet (saga compensation helper)
  async deleteWallet(userId: string) {
    this.logger.info({ userId }, 'Deleting wallet (saga compensation)');

    const wallet = await this.prisma.client.wallet.findUnique({
      where: { userId },
    });

    if (!wallet) {
      this.logger.warn({ userId }, 'Wallet not found for deletion');
      return { success: true }; // idempotent — already gone
    }

    // Delete transactions first, then wallet
    await this.prisma.client.transaction.deleteMany({ where: { walletId: wallet.id } });
    await this.prisma.client.wallet.delete({ where: { id: wallet.id } });

    this.logger.info({ userId, walletId: wallet.id }, 'Wallet deleted');
    return { success: true };
  }

  // ── Saga: Create User + Wallet (orchestrated from wallet service) ──
  async createUserWithWallet(data: { email: string; name: string }) {
    this.logger.info({ email: data.email }, 'Saga: creating user with wallet');

    // Step 1: Create user via User Service
    let user: { id: string; email: string; name: string; createdAt: string };
    try {
      user = await firstValueFrom(this.userService.createUser(data));
      this.logger.info({ userId: user.id }, 'Saga step 1: user created');
    } catch (err) {
      this.logger.error({ email: data.email }, 'Saga step 1 failed: user creation failed');
      throw err; // nothing to compensate yet
    }

    // Step 2: Create wallet in local DB
    try {
      const wallet = await this.prisma.client.wallet.create({
        data: { userId: user.id, balance: 0, currency: 'NGN' },
      });

      this.logger.info({ userId: user.id, walletId: wallet.id }, 'Saga step 2: wallet created');

      return {
        user,
        wallet: this.serializeWallet(wallet),
      };
    } catch (err) {
      this.logger.error({ userId: user.id, error:err }, 'Saga step 2 failed: wallet creation failed, compensating');
      try {
        await firstValueFrom(this.userService.deleteUser({ id: user.id }));
        this.logger.info({ userId: user.id }, 'Saga compensation: user deleted');
      } catch (compensationErr) {
        this.logger.error({ userId: user.id, error:compensationErr }, 'Saga compensation failed: could not delete user');
      }

      throw new RpcException({
        code: status.INTERNAL,
        message: 'Failed to create wallet. User creation has been rolled back.',
      });
    }
  }

  // Concurrency-safe credit (optimistic lock loop)

  private async optimisticCredit(
    walletId: string,
    amountMinor: bigint,
  ): Promise<bigint> {
    let updated = false;
    let newBalance = BigInt(0);

    while (!updated) {
      const wallet = await this.prisma.client.wallet.findUnique({
        where: { id: walletId },
      });

      if (!wallet) {
        throw new RpcException({
          code: status.NOT_FOUND,
          message: 'Wallet not found',
        });
      }

      const expectedBalance = wallet.balance;
      newBalance = expectedBalance + amountMinor;

      // Compare-and-swap: only update if balance hasn't changed
      const result = await this.prisma.client.$executeRaw`
        UPDATE wallets
        SET balance = ${newBalance}, updated_at = NOW()
        WHERE id = ${walletId} AND balance = ${expectedBalance}
      `;

      updated = result > 0;
      if (!updated) {
        this.logger.debug({ walletId }, 'Optimistic lock retry on credit');
      }
    }

    return newBalance;
  }

  // ── Atomic debit (optimistic lock + Prisma transaction) 

  private async atomicDebit(
    walletId: string,
    amountMinor: bigint,
    reference: string,
  ): Promise<{
    newBalance: bigint;
    txn: {
      id: string;
      walletId: string;
      reference: string;
      type: string;
      amount: bigint;
      balanceAfter: bigint;
      description: string | null;
      counterpartyAccount: string | null;
      createdAt: Date;
    };
  }> {
    let done = false;
    let result: {
      newBalance: bigint;
      txn: {
        id: string;
        walletId: string;
        reference: string;
        type: string;
        amount: bigint;
        balanceAfter: bigint;
        description: string | null;
        counterpartyAccount: string | null;
        createdAt: Date;
      };
    } | null = null;

    while (!done) {
      const wallet = await this.prisma.client.wallet.findUnique({
        where: { id: walletId },
      });

      if (!wallet) {
        throw new RpcException({
          code: status.NOT_FOUND,
          message: 'Wallet not found',
        });
      }

      if (wallet.balance < amountMinor) {
        throw new RpcException({
          code: status.FAILED_PRECONDITION,
          message: 'Insufficient balance',
        });
      }

      const expectedBalance = wallet.balance;
      const newBalance = expectedBalance - amountMinor;

      // Use Prisma interactive transaction for atomicity
      try {
        result = await this.prisma.client.$transaction(async (tx) => {
          // CAS-UPDATE: debit with optimistic lock
          const affected = await tx.$executeRaw`
            UPDATE wallets
            SET balance = ${newBalance}, updated_at = NOW()
            WHERE id = ${walletId} AND balance = ${expectedBalance}
          `;

          if (affected === 0) {
            // Another request changed the balance — signal retry
            throw new Error('OPTIMISTIC_LOCK_RETRY');
          }

          // Write transaction log row
          const txn = await tx.transaction.create({
            data: {
              walletId,
              reference,
              type: 'debit',
              amount: amountMinor,
              balanceAfter: newBalance,
              description: 'Debit',
              counterpartyAccount: null,
            },
          });

          return { newBalance, txn };
        });

        done = true;
      } catch (err: unknown) {
        if (err instanceof Error && err.message === 'OPTIMISTIC_LOCK_RETRY') {
          this.logger.debug({ walletId }, 'Optimistic lock retry on debit');
          continue; // retry the loop
        }
        throw err;
      }
    }

    return result!;
  }

  private serializeWallet(wallet: {
    id: string;
    userId: string;
    balance: bigint;
    currency: string;
    createdAt: Date;
  }) {
    return {
      id: wallet.id,
      userId: wallet.userId,
      balance: Number(wallet.balance),
      balanceFormatted: (Number(wallet.balance) / 100).toFixed(2),
      currency: wallet.currency,
      createdAt: wallet.createdAt.toISOString(),
    };
  }

  private serializeTxn(txn: {
    id: string;
    walletId: string;
    reference: string;
    type: string;
    amount: bigint;
    balanceAfter: bigint;
    description: string | null;
    counterpartyAccount: string | null;
    createdAt: Date;
  }) {
    return {
      id: txn.id,
      walletId: txn.walletId,
      reference: txn.reference,
      type: txn.type,
      amount: Number(txn.amount),
      amountFormatted: (Number(txn.amount) / 100).toFixed(2),
      balanceAfter: Number(txn.balanceAfter),
      description: txn.description ?? '',
      counterpartyAccount: txn.counterpartyAccount ?? '',
      createdAt: txn.createdAt.toISOString(),
    };
  }
}
