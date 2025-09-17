import { Injectable, inject, signal, computed, effect } from '@angular/core';
import {
  Auth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  User
} from '@angular/fire/auth';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private auth = inject(Auth);

  // Signal to track the current user
  private _currentUser = signal<User | null>(null);

  // Computed signal for authentication state
  public isAuthenticated = computed(() => this._currentUser() !== null);

  constructor() {
    // Listen for authentication state changes
    onAuthStateChanged(this.auth, (user) => {
      this._currentUser.set(user);
    });

    // Optional: Effect to log authentication changes
    effect(() => {
      const user = this._currentUser();
      if (user) {
        console.log('Auth state changed - User logged in:', {
          email: user.email,
          displayName: user.displayName,
          uid: user.uid
        });
      } else {
        console.log('Auth state changed - No user logged in');
      }
    });
  }

  async signInWithGoogle() {
    const provider = new GoogleAuthProvider();
    return signInWithPopup(this.auth, provider);
  }

  async signOut() {
    return signOut(this.auth);
  }

  // Getter for current user (returns signal value)
  get currentUser() {
    return this._currentUser();
  }

  // Signal getter for reactive use
  get currentUser$() {
    return this._currentUser;
  }

  // Utility method to log current user details
  logCurrentUser() {
    const user = this.currentUser;
    if (user) {
      console.log('Current user:', {
        email: user.email,
        displayName: user.displayName,
        uid: user.uid,
        photoURL: user.photoURL
      });
    } else {
      console.log('No user logged in');
    }
  }
}
