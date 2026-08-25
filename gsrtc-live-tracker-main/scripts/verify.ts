// Credentials come from .env (gitignored); see .env.example.
try { process.loadEnvFile(); } catch { /* rely on the real environment */ }

import { getVehicleStatus, getVehicleLatLng, buildAuthToken } from '../src/api/gsrtc';

(async () => {
  console.log('auth token sample:', buildAuthToken().slice(0, 40), '...');
  const plate = process.argv[2] || 'GJ-18-ZT-1028';
  console.log(`\nGetVehicleCurrentStatus_V1 for ${plate}:`);
  const raw = await getVehicleStatus(plate);
  console.log(JSON.stringify(raw, null, 2));
  const ll = await getVehicleLatLng(plate);
  console.log('\nparsed lat/lng:', ll ? `${ll.lat}, ${ll.lng}` : 'no live fix');
})().catch(e => { console.error('ERROR', e); process.exit(1); });
