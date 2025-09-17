import { Component, inject, computed, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  Firestore,
  doc,
  getDoc,
  deleteDoc,
  collection,
  getDocs,
  DocumentReference,
  CollectionReference,
  updateDoc,
  serverTimestamp
} from '@angular/fire/firestore';
import { Auth, onAuthStateChanged, User, deleteUser } from '@angular/fire/auth';
import { Router } from '@angular/router';

interface ProfileField {
  key: string;
  value: any;
  displayName: string;
}

@Component({
  selector: 'app-user-profile',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './user-profile.html',
  styleUrl: './user-profile.css'
})
export class UserProfile {
  private firestore = inject(Firestore);
  private auth = inject(Auth);
  private router = inject(Router);

  // Pure signals for state management
  private currentUser = signal<User | null>(null);
  private profileData = signal<any>(null);
  loading = signal(true);
  error = signal<string | null>(null);
  deleting = signal(false);
  showDeleteConfirmation = signal(false);
  deletionProgress = signal<string>('');
  deletionStats = signal<{collections: number, documents: number}>({collections: 0, documents: 0});

  // Computed signal for profile fields
  //profileFields = computed(() => {
    //const data = this.profileData();
    //if (!data) return [];
    //return this.convertToProfileFields(data);
  //});

  profileFields = computed(() => {
  const data = this.profileData();
  if (!data) return [];

  // Convert to array of fields
  const fields = this.convertToProfileFields(data);

  // Define the desired order
  const order = ['displayName', 'email', 'createdAt', 'deckCount', 'totalCardCount'];

  // Sort the fields array according to the order
  return fields.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
});


  constructor() {
    // Set up auth state listener
    onAuthStateChanged(this.auth, (user) => {
      this.currentUser.set(user);
    });

    // Effect to load profile when user changes
    effect(async () => {
      const user = this.currentUser();
      if (!user) {
        this.loading.set(false);
        this.error.set('User not authenticated');
        return;
      }

      try {
        this.loading.set(true);
        this.error.set(null);

        // Calculate deck and card counts
        const { deckCount, totalCardCount } = await this.calculateUserStats(user.uid);

        const profileRef = doc(this.firestore, `users/${user.uid}`);
        const profileSnap = await getDoc(profileRef);

        let profileData = {};
        if (profileSnap.exists()) {
          profileData = profileSnap.data();
        }

        // Update profile data with calculated counts
        const updatedProfileData = {
          ...profileData,
          deckCount,
          totalCardCount,
        };

        // Update the profile document with the new counts
        await updateDoc(profileRef, {
          deckCount,
          totalCardCount,
        });

        this.profileData.set(updatedProfileData);
        this.loading.set(false);
      } catch (err: any) {
        this.loading.set(false);
        this.error.set('Failed to load profile data: ' + err.message);
        console.error('Error loading profile:', err);
      }
    });
  }

  /**
   * Calculate the user's deck count and total card count across all decks
   */
  private async calculateUserStats(userId: string): Promise<{ deckCount: number, totalCardCount: number }> {
    try {
      let deckCount = 0;
      let totalCardCount = 0;

      // Get all decks under users/{userId}/collections
      const collectionsRef = collection(this.firestore, `users/${userId}/collections`);
      const collectionsSnap = await getDocs(collectionsRef);

      deckCount = collectionsSnap.size;

      // For each deck, count the cards
      for (const deckDoc of collectionsSnap.docs) {
        const deckId = deckDoc.id;
        const cardsRef = collection(this.firestore, `users/${userId}/collections/${deckId}/cards`);
        const cardsSnap = await getDocs(cardsRef);
        totalCardCount += cardsSnap.size;
      }

      return { deckCount, totalCardCount };
    } catch (error) {
      console.error('Error calculating user stats:', error);
      return { deckCount: 0, totalCardCount: 0 };
    }
  }

  private convertToProfileFields(data: any): ProfileField[] {
    return Object.keys(data).map(key => ({
      key,
      value: data[key],
      displayName: this.formatFieldName(key)
    }));
  }

  private formatFieldName(fieldName: string): string {
    // Convert camelCase to readable format
    return fieldName
      .replace(/([A-Z])/g, ' $1') // Add space before capital letters
      .replace(/^./, str => str.toUpperCase()) // Capitalize first letter
      .trim();
  }

  formatValue(value: any): string {
    if (value === null || value === undefined) {
      return 'Not specified';
    }
    if (typeof value === 'boolean') {
      return value ? 'Yes' : 'No';
    }
    if (value instanceof Date || (value && value.toDate)) {
      // Handle Firestore Timestamps
      const date = value.toDate ? value.toDate() : value;
      return date.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
      });
    }

    if (Array.isArray(value)) {
      return value.join(', ');
    }
    if (typeof value === 'object') {
      return JSON.stringify(value, null, 2);
    }
    return String(value);
  }

  // Show delete confirmation dialog
  confirmDeleteProfile(): void {
    this.showDeleteConfirmation.set(true);
  }

  // Cancel delete operation
  cancelDelete(): void {
    this.showDeleteConfirmation.set(false);
    this.deletionProgress.set('');
    this.deletionStats.set({collections: 0, documents: 0});
  }

  /**
   * Get all possible subcollection names by discovering them dynamically
   * This uses the same approach as your deck list - query known parent paths
   */
  private async discoverSubcollections(parentPath: string): Promise<string[]> {
    try {
      // First, get all documents in the parent collection
      const parentCollectionRef = collection(this.firestore, parentPath);
      const parentSnapshot = await getDocs(parentCollectionRef);

      if (parentSnapshot.empty) {
        return [];
      }

      // Get all document IDs - these are our subcollection names
      return parentSnapshot.docs.map(doc => doc.id);

    } catch (error) {
      console.warn(`Could not discover subcollections in ${parentPath}:`, error);
      return [];
    }
  }

  /**
   * Get all possible nested subcollection names within a document
   * We'll try some common patterns, but this could be enhanced with metadata
   */
  private async discoverNestedSubcollections(documentRef: DocumentReference): Promise<string[]> {
    // Since we can't list subcollections directly in client SDK,
    // we'll try common patterns that might exist
    const commonNestedPatterns = ['cards', 'items', 'details', 'history', 'comments'];
    const existingSubcollections: string[] = [];

    for (const pattern of commonNestedPatterns) {
      try {
        const nestedCollectionRef = collection(documentRef, pattern);
        const snapshot = await getDocs(nestedCollectionRef);

        if (!snapshot.empty) {
          existingSubcollections.push(pattern);
        }
      } catch (error) {
        // Subcollection doesn't exist or no permission - continue
      }
    }

    return existingSubcollections;
  }

  /**
   * Delete all documents in a collection recursively
   */
  private async deleteCollectionRecursively(collectionPath: string): Promise<number> {
    try {
      this.deletionProgress.set(`Processing ${collectionPath}...`);

      const collectionRef = collection(this.firestore, collectionPath);
      const snapshot = await getDocs(collectionRef);

      if (snapshot.empty) {
        return 0;
      }

      this.deletionProgress.set(`Found ${snapshot.size} documents in ${collectionPath}`);

      let deletedCount = 0;

      // For each document, first delete its subcollections, then delete the document
      for (const docSnapshot of snapshot.docs) {
        const docRef = docSnapshot.ref;
        const docPath = docRef.path;

        this.deletionProgress.set(`Processing document ${docPath}...`);

        // Discover nested subcollections in this document
        const nestedSubcollections = await this.discoverNestedSubcollections(docRef);

        // Delete each nested subcollection
        for (const nestedSubcollectionName of nestedSubcollections) {
          const nestedCollectionPath = `${docPath}/${nestedSubcollectionName}`;
          const nestedDeletedCount = await this.deleteCollectionRecursively(nestedCollectionPath);
          deletedCount += nestedDeletedCount;
        }

        // Now delete the document itself
        await deleteDoc(docRef);
        deletedCount++;

        this.deletionProgress.set(`Deleted document ${docPath}`);
      }

      return deletedCount;

    } catch (error) {
      console.warn(`Error deleting collection ${collectionPath}:`, error);
      return 0;
    }
  }

  /**
   * Delete all user data by discovering collections dynamically
   */

  private async deleteAllUserData(userId: string): Promise<{ decks: number, cards: number }> {
  let decksDeleted = 0;
  let cardsDeleted = 0;

  this.deletionProgress.set(`Deleting data for user ${userId}...`);

  try {
    // Step 1: Get all deck documents under users/{userId}/collections
    const collectionsRef = collection(this.firestore, `users/${userId}/collections`);
    const collectionsSnap = await getDocs(collectionsRef);

    for (const deckDoc of collectionsSnap.docs) {
      const deckId = deckDoc.id;
      const deckPath = `users/${userId}/collections/${deckId}`;
      this.deletionProgress.set(`Processing deck: ${deckId}`);

      // Step 2: Delete all cards under this deck
      const cardsRef = collection(this.firestore, `${deckPath}/cards`);
      const cardsSnap = await getDocs(cardsRef);

      for (const cardDoc of cardsSnap.docs) {
        await deleteDoc(cardDoc.ref);
        cardsDeleted++;
        this.deletionProgress.set(`Deleted card: ${cardDoc.id}`);
      }

      // Step 3: Delete the deck document itself
      await deleteDoc(deckDoc.ref);
      decksDeleted++;
      this.deletionProgress.set(`Deleted deck: ${deckId}`);
    }

    // Step 4: Delete the main user document
    this.deletionProgress.set('Deleting main user document...');
    const userDocRef = doc(this.firestore, `users/${userId}`);
    await deleteDoc(userDocRef);

  } catch (error) {
    console.warn('Error during user data deletion:', error);
  }

  return { decks: decksDeleted, cards: cardsDeleted };
}


// Delete user profile and account
async deleteProfile(): Promise<void> {
  const user = this.currentUser();
  if (!user) {
    this.error.set('No user is currently authenticated');
    return;
  }

  // Hide confirmation dialog immediately
  this.showDeleteConfirmation.set(false);

  try {
    this.deleting.set(true);
    this.error.set(null);
    this.deletionProgress.set('Starting deletion process...');

    // Delete Firestore user data
    const { decks, cards } = await this.deleteAllUserData(user.uid);

    // Delete auth account
    try {
      this.deletionProgress.set('Deleting authentication account...');
      await deleteUser(user);
    } catch (authErr: any) {
      if (authErr.code === 'auth/requires-recent-login') {
        this.error.set('Please re-login before deleting your account.');
        this.deleting.set(false);
        return;
      } else {
        throw authErr;
      }
    }

    // Success message
    const summary = `Deletion complete! Removed ${decks} decks and ${cards} cards. Redirecting...`;
    this.deletionProgress.set(summary);

    await new Promise(resolve => setTimeout(resolve, 2000));
    await this.router.navigateByUrl('/', { replaceUrl: true });

  } catch (err: any) {
    this.deleting.set(false);
    this.deletionProgress.set('');
    this.error.set('Failed to delete profile: ' + err.message);
  }
}
}

