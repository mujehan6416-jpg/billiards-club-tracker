import { initializeApp } from 'firebase/app'
import { getFirestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: "AIzaSyBmRT2KhBioKrYl-JjcpnauU2mZIrXavqQ",
  authDomain: "skkubilliards-club.firebaseapp.com",
  projectId: "skkubilliards-club",
  storageBucket: "skkubilliards-club.firebasestorage.app",
  messagingSenderId: "85121921256",
  appId: "1:85121921256:web:15c323d16787917a09995d"
}

const app = initializeApp(firebaseConfig)
export const db = getFirestore(app)
