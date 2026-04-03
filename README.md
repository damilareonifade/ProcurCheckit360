# Microservice-Based Wallet System

A microservice-based wallet system built with **NestJS**, **gRPC**, **Prisma ORM**, and **PostgreSQL** in a monorepo architecture. Each service owns its own database (database-per-service pattern) and cross-service consistency is maintained via the **Saga pattern**.

## Architecture

```
sourcemfb/
├── apps/
│   ├── user-service/          # Manages users (gRPC on port 50051)
│   │   ├── prisma/            # User schema + migrations (user_service_db)
│   │   └── src/
│   └── wallet-service/        # Manages wallets & transactions (gRPC on port 50052)
│       ├── prisma/            # Wallet schema + migrations (wallet_service_db)
│       └── src/
├── packages/
│   └── proto/                 # Shared .proto definitions
└── README.md
```

### Database-Per-Service

Each microservice has its **own PostgreSQL database**:

| Service        | Database           | Tables                    |
|----------------|--------------------|---------------------------|
| User Service   | `user_service_db`  | `users`                   |
| Wallet Service | `wallet_service_db`| `wallets`, `transactions` |

There are **no foreign keys** across databases. Data integrity across services is maintained through gRPC calls and the Saga pattern.

### Inter-Service Communication

```
Client
  │
  ├─ gRPC ──► User Service (port 50051) ──► user_service_db
  │
  └─ gRPC ──► Wallet Service (port 50052) ──► wallet_service_db
                    │
                    ├─ gRPC call ──► User Service (verify user exists)
                    └─ gRPC call ──► User Service (saga compensation)
```

## Saga Pattern

Since each service has its own database, operations that span both services cannot use a single database transaction. Instead, we use the **Saga pattern** (orchestration-based) to maintain consistency.

### CreateUserWithWallet Saga

The Wallet Service acts as the **saga orchestrator** for user+wallet creation:

```
Step 1: Create User (via User Service gRPC)
    ✓ Success → proceed to Step 2
    ✗ Failure → abort (nothing to compensate)

Step 2: Create Wallet (in local wallet_service_db)
    ✓ Success → return combined result
    ✗ Failure → COMPENSATE: Delete User via User Service gRPC
```

**How it works in code:**

```typescript
async createUserWithWallet(data: { email: string; name: string }) {
  // Step 1: Create user via gRPC
  const user = await firstValueFrom(this.userService.createUser(data));

  try {
    // Step 2: Create wallet locally
    const wallet = await this.prisma.wallet.create({
      data: { userId: user.id, balance: 0, currency: 'NGN' },
    });
    return { user, wallet };
  } catch (err) {
    // Compensation: roll back user creation
    await firstValueFrom(this.userService.deleteUser({ id: user.id }));
    throw new RpcException({ code: INTERNAL, message: 'Wallet creation failed. User rolled back.' });
  }
}
```

**Why Saga over 2PC (two-phase commit)?**
- Each service owns its own database — no distributed transaction coordinator needed
- Sagas are more resilient to partial failures
- Compensation actions are explicit and auditable via structured logging

## Database Schema

### User Service (`user_service_db`)

#### users
| Field     | Type         | Description    |
|-----------|--------------|----------------|
| id        | SERIAL (PK)  | Auto-increment |
| email     | VARCHAR(255) | Unique         |
| name      | VARCHAR(255) |                |
| created_at| TIMESTAMP    | Auto-generated |

### Wallet Service (`wallet_service_db`)

#### wallets
| Field      | Type         | Description                          |
|------------|--------------|--------------------------------------|
| id         | SERIAL (PK)  | Auto-increment                       |
| user_id    | INTEGER      | Unique, references user in User Service (no FK) |
| balance    | BIGINT       | Stored in minor units (kobo/cents)   |
| currency   | VARCHAR(10)  | Default 'NGN'                        |
| created_at | TIMESTAMP    | Auto-generated                       |
| updated_at | TIMESTAMP    | Auto-updated                         |

#### transactions
| Field               | Type         | Description              |
|---------------------|--------------|--------------------------|
| id                  | SERIAL (PK)  | Auto-increment           |
| wallet_id           | INTEGER (FK) | References wallets.id    |
| reference           | VARCHAR(100) | Unique UUID              |
| type                | VARCHAR(10)  | 'credit' or 'debit'     |
| amount              | BIGINT       | Minor units              |
| balance_after       | BIGINT       | Balance snapshot         |
| description         | VARCHAR(200) | Nullable                 |
| counterparty_account| VARCHAR(10)  | Nullable                 |
| created_at          | TIMESTAMP    | Auto-generated           |

## Prerequisites

- Node.js >= 18
- PostgreSQL running on localhost:5432
- npm >= 9

## Setup & Run

### 1. Install dependencies

```bash
npm install
```

### 2. Create the databases

```bash
psql -U postgres -c "CREATE DATABASE user_service_db;"
psql -U postgres -c "CREATE DATABASE wallet_service_db;"
```

### 3. Configure environment

Each service has its own `.env` file. Copy from the examples:

```bash
cp apps/user-service/.env.example apps/user-service/.env
cp apps/wallet-service/.env.example apps/wallet-service/.env
```

Update the `DATABASE_URL` in each `.env` if your PostgreSQL credentials differ.

### 4. Run database setup

Option A — Use the setup script:
```bash
bash setup_databases.sh
```

Option B — Use Prisma migrations:
```bash
# From each service directory
cd apps/user-service && npx prisma migrate dev --schema=prisma/schema.prisma --name init
cd apps/wallet-service && npx prisma migrate dev --schema=prisma/schema.prisma --name init
```

### 5. Generate Prisma clients

```bash
cd apps/user-service && npx prisma generate --schema=prisma/schema.prisma
cd apps/wallet-service && npx prisma generate --schema=prisma/schema.prisma
```

### 6. Seed test data (optional)

```bash
cd apps/user-service && npx prisma db seed
```

This creates 5 test users in `user_service_db`.

### 7. Start the services

Start **both services** in separate terminals:

```bash
# Terminal 1 - User Service (port 50051)
npm run start:user

# Terminal 2 - Wallet Service (port 50052)
npm run start:wallet
```

> **Important**: Start the User Service first, as the Wallet Service depends on it for user verification and saga operations.

## gRPC Endpoints

### User Service (port 50051)

| Method       | Request                        | Response           |
|--------------|--------------------------------|--------------------|
| CreateUser   | `{ email, name }`              | UserResponse       |
| GetUserById  | `{ id }`                       | UserResponse       |
| DeleteUser   | `{ id }`                       | DeleteUserResponse |

### Wallet Service (port 50052)

| Method               | Request                | Response                        |
|----------------------|------------------------|---------------------------------|
| CreateWallet         | `{ userId }`           | WalletResponse                  |
| GetWallet            | `{ userId }`           | WalletResponse                  |
| CreditWallet         | `{ userId, amount }`   | CreditDebitResponse             |
| DebitWallet          | `{ userId, amount }`   | CreditDebitResponse             |
| DeleteWallet         | `{ userId }`           | DeleteWalletResponse            |
| CreateUserWithWallet | `{ email, name }`      | CreateUserWithWalletResponse    |

## Testing with grpcurl

Install [grpcurl](https://github.com/fullstorydev/grpcurl):

```bash
brew install grpcurl   # macOS
```

### Full flow with saga

```bash
# Create user + wallet in one saga operation
grpcurl -plaintext -import-path packages/proto -proto wallet.proto \
  -d '{"email": "test@example.com", "name": "Test User"}' \
  localhost:50052 wallet.WalletService/CreateUserWithWallet

# Credit the wallet (50000 kobo = NGN 500)
grpcurl -plaintext -import-path packages/proto -proto wallet.proto \
  -d '{"userId": 1, "amount": 50000}' \
  localhost:50052 wallet.WalletService/CreditWallet

# Check balance
grpcurl -plaintext -import-path packages/proto -proto wallet.proto \
  -d '{"userId": 1}' \
  localhost:50052 wallet.WalletService/GetWallet

# Debit (10000 kobo = NGN 100)
grpcurl -plaintext -import-path packages/proto -proto wallet.proto \
  -d '{"userId": 1, "amount": 10000}' \
  localhost:50052 wallet.WalletService/DebitWallet
```

### Individual service operations

```bash
# Create user directly
grpcurl -plaintext -import-path packages/proto -proto user.proto \
  -d '{"email": "john@example.com", "name": "John Doe"}' \
  localhost:50051 user.UserService/CreateUser

# Get user
grpcurl -plaintext -import-path packages/proto -proto user.proto \
  -d '{"id": 1}' \
  localhost:50051 user.UserService/GetUserById

# Create wallet for existing user
grpcurl -plaintext -import-path packages/proto -proto wallet.proto \
  -d '{"userId": 1}' \
  localhost:50052 wallet.WalletService/CreateWallet
```

## Error Handling

| Scenario              | gRPC Status Code     | Message                                          |
|-----------------------|----------------------|--------------------------------------------------|
| Duplicate email       | ALREADY_EXISTS       | User with this email already exists              |
| User not found        | NOT_FOUND            | User with id X not found                         |
| Wallet already exists | ALREADY_EXISTS       | Wallet already exists for this user              |
| Wallet not found      | NOT_FOUND            | Wallet not found for user X                      |
| Insufficient balance  | FAILED_PRECONDITION  | Insufficient balance                             |
| Invalid amount        | INVALID_ARGUMENT     | Amount must be greater than 0                    |
| Saga wallet failure   | INTERNAL             | Failed to create wallet. User creation rolled back |

## Concurrency Handling

### Credit — Optimistic Lock Loop

```
1. Read wallet balance
2. Calculate new balance
3. UPDATE wallets SET balance = new WHERE balance = expected
4. If affected rows = 0 → retry from step 1
```

### Debit — Atomic Transaction + Optimistic Lock

```
1. Read wallet balance
2. Check balance >= amount (fail fast if insufficient)
3. Begin Prisma $transaction:
   a. CAS-UPDATE: SET balance = new WHERE balance = expected
   b. If affected = 0 → rollback, retry from step 1
   c. INSERT transaction record
   d. Commit
```

This guarantees no negative balances, even under concurrent debit requests.

## Structured Logging

Both services use **nestjs-pino** for structured JSON logging. Every operation is logged with contextual data:

```
INFO [UserService] Creating user { email: "john@example.com" }
INFO [WalletService] Saga step 1: user created { userId: 1 }
INFO [WalletService] Saga step 2: wallet created { userId: 1, walletId: 1 }
DEBUG [WalletService] Optimistic lock retry on credit { walletId: 1 }
```

Set `LOG_LEVEL` in `.env` to control verbosity: `debug`, `info` (default), `warn`, `error`.

## Trade-offs & Decisions

1. **Database-per-service** over shared database: Better service isolation and independent scalability, at the cost of losing FK constraints across services.

2. **Saga pattern** over distributed transactions (2PC): Simpler, more resilient to partial failures. Compensation is explicit and logged. Trade-off: eventual consistency window during saga execution.

3. **No FK from wallets to users**: Since they're in separate databases, `user_id` in `wallets` is just an integer — validated via gRPC, not a database constraint.

4. **Optimistic locking** over pessimistic locking: Better throughput under low contention. Uses compare-and-swap with retry loops instead of SELECT FOR UPDATE.

5. **Balance in minor units (kobo/cents)**: Avoids floating-point precision issues. All amounts stored as BigInt.
