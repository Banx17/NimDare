import { connectDatabase } from './config/database';
import { connectWallet } from './services/auth';
import { signToken } from './utils/jwt';

async function main() {
  console.log('Starting test token script...');
  await connectDatabase();
  const testWalletAddress = 'NQ00 TEST 0000 0000 0000 0000 0000 0000 0000';
  const user = await connectWallet(testWalletAddress);
  console.log('Test user id:', user._id);
  const token = signToken({ id: user._id, walletAddress: user.walletAddress });
  console.log('Test token:', token);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Script failed:', err);
    process.exit(1);
  });