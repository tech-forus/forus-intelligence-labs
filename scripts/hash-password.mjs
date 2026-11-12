// Usage: node scripts/hash-password.mjs "<new admin password>"
// Prints a value for the ADMIN_PASSWORD_HASH env var on the Netlify site.
import { hashPassword } from "../netlify/lib/auth.mjs";

const pw = process.argv[2];
if (!pw || pw.length < 12) {
  console.error("Give a password of at least 12 characters.");
  process.exit(1);
}
console.log(hashPassword(pw));
