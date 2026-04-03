import { IsInt, IsPositive } from 'class-validator';

export class DebitWalletDto {
  @IsInt()
  userId: string;

  @IsPositive()
  amount: number;
}
