// Firebase project wiring. The web config is public by design (it only identifies the project);
// hosting is the only Firebase product the simulator uses.
import { initializeApp } from 'firebase/app';

const firebaseConfig = {
  apiKey: 'AIzaSyCviExYQngymlHnEZ7coKi75YTxjok3tYM',
  authDomain: 'takeoff-flight-sim.firebaseapp.com',
  projectId: 'takeoff-flight-sim',
  storageBucket: 'takeoff-flight-sim.firebasestorage.app',
  messagingSenderId: '590934716677',
  appId: '1:590934716677:web:a1dac68da4478262aac76c',
};

let app = null;
export function initFirebase() {
  if (!app) app = initializeApp(firebaseConfig);
  return app;
}
