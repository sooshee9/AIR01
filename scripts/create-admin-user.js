/*
Usage:
  node scripts/create-admin-user.js --uid <UID> --email <email> --role admin --serviceAccount ./serviceAccount.json

This script requires a Firebase service account JSON to run (Admin SDK).
It will create a `users/{uid}` document with the specified role and an empty `userData/{uid}` doc if missing.
*/

const fs = require('fs');
const path = require('path');
const yargs = require('yargs');

const argv = yargs.option('uid', { type: 'string', demandOption: true })
  .option('email', { type: 'string', demandOption: false })
  .option('role', { type: 'string', demandOption: true })
  .option('serviceAccount', { type: 'string', demandOption: true })
  .argv;

const admin = require('firebase-admin');

const saPath = path.resolve(argv.serviceAccount);
if (!fs.existsSync(saPath)) {
  console.error('Service account file not found:', saPath);
  process.exit(1);
}

const sa = require(saPath);
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

(async () => {
  const uid = argv.uid;
  const role = argv.role;
  const email = argv.email || '';

  // Create users/{uid}
  const userRef = db.collection('users').doc(uid);
  const userDoc = await userRef.get();
  if (!userDoc.exists) {
    await userRef.set({ email, role, displayName: email || 'Admin user', permissions: [], createdAt: admin.firestore.FieldValue.serverTimestamp() });
    console.log('Created users/' + uid);
  } else {
    await userRef.update({ role });
    console.log('Updated users/' + uid + ' role -> ' + role);
  }

  // Ensure userData exists
  const dataRef = db.collection('userData').doc(uid);
  const dataDoc = await dataRef.get();
  if (!dataDoc.exists) {
    await dataRef.set({});
    console.log('Initialized empty userData/' + uid);
  } else {
    console.log('userData/' + uid + ' already exists');
  }

  process.exit(0);
})();
