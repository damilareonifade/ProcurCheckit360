import { Controller } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import { WalletService } from './wallet.service';

@Controller()
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @GrpcMethod('WalletService', 'CreateWallet')
  async createWallet(data: { userId: string }) {
    return this.walletService.createWallet(data.userId);
  }

  @GrpcMethod('WalletService', 'GetWallet')
  async getWallet(data: { userId: string }) {
    return this.walletService.getWallet(data.userId);
  }

  @GrpcMethod('WalletService', 'CreditWallet')
  async creditWallet(data: { userId: string; amount: number }) {
    return this.walletService.creditWallet(data.userId, data.amount);
  }

  @GrpcMethod('WalletService', 'DebitWallet')
  async debitWallet(data: { userId: string; amount: number }) {
    return this.walletService.debitWallet(data.userId, data.amount);
  }

  @GrpcMethod('WalletService', 'DeleteWallet')
  async deleteWallet(data: { userId: string }) {
    return this.walletService.deleteWallet(data.userId);
  }

  @GrpcMethod('WalletService', 'CreateUserWithWallet')
  async createUserWithWallet(data: { email: string; name: string }) {
    return this.walletService.createUserWithWallet(data);
  }
}
