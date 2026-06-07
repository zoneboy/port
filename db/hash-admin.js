// Generate a bcrypt hash for the admin password.
// Usage:  node db/hash-admin.js 'your-password-here'
import bcrypt from 'bcryptjs';

const pw = process.argv[2];
if (!pw) {
  console.error("Usage: node db/hash-admin.js 'your-password'");
  process.exit(1);
}
const hash = bcrypt.hashSync(pw, 10);
console.log('\nADMIN_PASSWORD_HASH (copy into your environment):\n');
console.log(hash + '\n');
