import { createDatabaseActivation } from '../lib/platform/activation.js';
import { createControlStore } from '../lib/platform/control-store.js';
import { closeDatabase } from '../lib/database.js';
import { collectPlatformStatus } from '../lib/platform/status.js';

// Invoked by the fixed host collector inside the API container; no HTTP control
// or database endpoint is exposed. Restore the authoritative database selection.
let control;
try{
  control=createControlStore();
  const activation=createDatabaseActivation({getSelection:control.getSelection,persistSelection:control.persistSelection});
  await activation.bootstrap();
  console.log(JSON.stringify(await collectPlatformStatus()));
}catch{console.log(JSON.stringify({database:false,provider:'unknown',files:false,email:false,estimates:false,jobs:false}));}
finally{await Promise.all([closeDatabase(),control?.close()]);}
