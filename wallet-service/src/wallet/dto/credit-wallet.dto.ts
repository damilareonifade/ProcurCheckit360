import { IsInt, IsPositive } from 'class-validator';

export class CreditWalletDto {
  @IsInt()
  userId: string;

  @IsPositive()
  amount: number;
}
