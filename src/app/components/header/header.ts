import { Component, signal, inject, effect } from '@angular/core';
import { RouterModule } from '@angular/router';
import { Auth, User } from '@angular/fire/auth';
import { AuthService } from '../../services/auth';
import { Firestore, doc, getDoc, setDoc, serverTimestamp } from '@angular/fire/firestore';

@Component({
  selector: 'app-header',
  imports: [RouterModule],
  templateUrl: './header.html',
  styleUrl: './header.css'
})
export class Header {
  //protected readonly title = signal('ʎɛɱмɐтıQ');
  protected readonly title = signal('LemmatiQ');
  private auth = inject(Auth);
  private firestore = inject(Firestore);
  private authService = inject(AuthService);
  protected readonly user = signal<User | null>(null);

  constructor() {
  // Listen for auth changes reactively
  effect(() => {
    const u: User | null = this.authService.currentUser$();
    this.user.set(u);
  });
}


  async handleLogin() {
    try {
      // Sign in with Google
      const result = await this.authService.signInWithGoogle();
      const user = result.user;

      console.log('User signed in:', user.uid);

      // Create Firestore user doc if first-time login
      await this.createUserDocumentIfNotExists(user);

    } catch (error) {
      console.error('Login failed:', error);
    }
  }

  async handleLogout() {
    try {
      await this.authService.signOut();
      console.log('Signout successful');
    } catch (error) {
      console.error(error);
    }
  }

  /**
   * Create Firestore document for first-time login
   */
  private async createUserDocumentIfNotExists(user: User) {
    const userDocRef = doc(this.firestore, `users/${user.uid}`);
    const userDocSnap = await getDoc(userDocRef);

    if (!userDocSnap.exists()) {
      // First-time login: create document
      await setDoc(userDocRef, {
        displayName: user.displayName || '',
        email: user.email || '',
        createdAt: serverTimestamp()
      });
      console.log(`Created Firestore document for user ${user.uid}`);
    } else {
      console.log(`Firestore document already exists for user ${user.uid}`);
    }
  }
}

