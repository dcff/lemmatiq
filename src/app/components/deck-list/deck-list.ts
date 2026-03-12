import { Component, inject, signal, effect, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Firestore, collection, doc, setDoc, updateDoc, deleteDoc, deleteField, serverTimestamp, getDocs, DocumentReference } from '@angular/fire/firestore';
import { Auth, onAuthStateChanged, User } from '@angular/fire/auth';

interface Deck {
  id: string;
  data: any;
  fields: DeckField[];
  isEditing?: boolean;
  editableData?: any; // Temporary editing state
}

interface DeckField {
  key: string;
  value: any;
  displayName: string;
  isFixed?: boolean;
}

@Component({
  selector: 'app-deck-list',
  imports: [CommonModule, FormsModule],
  templateUrl: './deck-list.html',
  styleUrl: './deck-list.css'
})
export class DeckList {
  private firestore = inject(Firestore);
  private auth = inject(Auth);
  private router = inject(Router);

  private currentUser = signal<User | null>(null);
  private deckData = signal<Deck[]>([]);
  loading = signal(true);
  error = signal<string | null>(null);
  savingDecks = signal<Set<string>>(new Set());
  deletingDecks = signal<Set<string>>(new Set());

  deletionProgress = signal<string>('');

  // Add confirmation dialog signals
  showDeleteConfirmation = signal(false);
  deckToDelete = signal<{id: string, name: string} | null>(null);

  fieldOrder = ['name', 'description', 'createdAt', 'updatedAt', 'cardCount'];
  private readonly FIXED_FIELDS = ['id', 'createdAt', 'updatedAt', 'userId', 'createdBy', 'cardCount'];

  decks = computed(() => this.deckData());

  constructor() {
    onAuthStateChanged(this.auth, (user) => {
      this.currentUser.set(user);
    });

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

        const collectionsRef = collection(this.firestore, `users/${user.uid}/collections`);
        const querySnapshot = await getDocs(collectionsRef);

        const decks: Deck[] = [];
        querySnapshot.forEach((doc) => {
          const data = doc.data();
          decks.push({
            id: doc.id,
            data: data,
            fields: this.convertToFields(data),
            isEditing: false,
            editableData: { ...data } // Initialize editable copy
          });
        });

        this.deckData.set(decks);
        this.loading.set(false);
      } catch (err: any) {
        this.loading.set(false);
        this.error.set('Failed to load decks: ' + err.message);
        console.error('Error loading decks:', err);
      }
    });
  }

  getField(deck: Deck, key: string): DeckField | null {
    if (!deck.fields) return null;
    return deck.fields.find(f => f.key === key) || null;
  }

  navigateToDeck(deckId: string) {
    const deck = this.deckData().find(d => d.id === deckId);
    if (deck?.isEditing) return; // Prevent navigation while editing
    this.router.navigate(['/filter', deckId]);
  }

  // Toggle edit mode with flip animation
  editDeck(event: Event, deckId: string) {
    event.stopPropagation();

    const currentDecks = this.deckData();
    const updatedDecks = currentDecks.map(deck => {
      if (deck.id === deckId) {
        return {
          ...deck,
          isEditing: !deck.isEditing,
          editableData: deck.isEditing ? deck.data : { ...deck.data } // Reset or initialize
        };
      }
      return deck;
    });

    this.deckData.set(updatedDecks);
  }

  // Update field in editing mode
  updateEditableField(deckId: string, fieldKey: string, newValue: any) {
    const currentDecks = this.deckData();
    const updatedDecks = currentDecks.map(deck => {
      if (deck.id === deckId && deck.isEditing) {
        const parsedValue = this.parseValue(newValue, deck.data[fieldKey]);
        return {
          ...deck,
          editableData: {
            ...deck.editableData,
            [fieldKey]: parsedValue
          }
        };
      }
      return deck;
    });

    this.deckData.set(updatedDecks);
  }

  // Save changes to Firestore
  async saveDeck(event: Event, deckId: string) {
    event.stopPropagation();

    const user = this.currentUser();
    if (!user) return;

    const deck = this.deckData().find(d => d.id === deckId);
    if (!deck?.isEditing) return;

    try {
      // Add to saving set
      const saving = new Set(this.savingDecks());
      saving.add(deckId);
      this.savingDecks.set(saving);

      const deckPath = `users/${user.uid}/collections/${deckId}`;
      const docRef = doc(this.firestore, deckPath);

      // Only update non-fixed fields
      const updateData: any = {};
      Object.keys(deck.editableData).forEach(key => {
        if (!this.FIXED_FIELDS.includes(key)) {
          updateData[key] = deck.editableData[key];
        }
      });

      // Add timestamp
      updateData.updatedAt = serverTimestamp();

      await updateDoc(docRef, updateData);

      // Update local state with saved data
      const currentDecks = this.deckData();
      const updatedDecks = currentDecks.map(d => {
        if (d.id === deckId) {
          const newData = { ...d.editableData, updatedAt: new Date() };
          return {
            ...d,
            data: newData,
            fields: this.convertToFields(newData),
            isEditing: false, // Exit edit mode
            editableData: newData
          };
        }
        return d;
      });

      this.deckData.set(updatedDecks);

    } catch (err: any) {
      console.error('Error saving deck:', err);
      this.error.set('Failed to save deck: ' + err.message);
    } finally {
      // Remove from saving set
      const saving = new Set(this.savingDecks());
      saving.delete(deckId);
      this.savingDecks.set(saving);
    }
  }

  // Show delete confirmation dialog
  confirmDeleteDeck(event: Event, deckId: string) {
    event.stopPropagation();

    const deck = this.deckData().find(d => d.id === deckId);
    const deckName = deck?.data?.name || 'Untitled Deck';

    this.deckToDelete.set({ id: deckId, name: deckName });
    this.showDeleteConfirmation.set(true);
  }

  // Cancel delete operation
  cancelDelete() {
    this.showDeleteConfirmation.set(false);
    this.deckToDelete.set(null);
  }

  // Delete deck with recursive subcollection deletion
  async deleteDeck() {
    const user = this.currentUser();
    const deckInfo = this.deckToDelete();
    if (!user || !deckInfo) return;

    // Hide confirmation dialog immediately
    this.showDeleteConfirmation.set(false);

    try {
      // Add to deleting set
      const deleting = new Set(this.deletingDecks());
      deleting.add(deckInfo.id);
      this.deletingDecks.set(deleting);

      const deckPath = `users/${user.uid}/collections/${deckInfo.id}`;
      const docRef = doc(this.firestore, deckPath);

      // First, delete the cards collection recursively
      const cardsCollectionPath = `${deckPath}/cards`;
      await this.deleteCollectionRecursively(cardsCollectionPath);

      // Now delete the deck document itself
      await deleteDoc(docRef);

      // Remove the user's custom display order for this deck (if any) to avoid orphaned data
      try {
        const userDocRef = doc(this.firestore, `users/${user.uid}`);
        await updateDoc(userDocRef, { [`deckDisplayOrders.${deckInfo.id}`]: deleteField() });
      } catch {
        // User doc or field may not exist — not critical
      }

      // Remove from local state
      const currentDecks = this.deckData();
      const updatedDecks = currentDecks.filter(d => d.id !== deckInfo.id);
      this.deckData.set(updatedDecks);

    } catch (err: any) {
      console.error('Error deleting deck:', err);
      this.error.set('Failed to delete deck: ' + err.message);
    } finally {
      // Remove from deleting set and reset state
      const deleting = new Set(this.deletingDecks());
      deleting.delete(deckInfo.id);
      this.deletingDecks.set(deleting);
      this.deckToDelete.set(null);
    }
  }

  // Discover nested subcollections in a document
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

  // Recursively delete a collection and all its nested subcollections
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

  isDeckSaving(deckId: string): boolean {
    return this.savingDecks().has(deckId);
  }

  isDeckDeleting(deckId: string): boolean {
    return this.deletingDecks().has(deckId);
  }

  private parseValue(newValue: any, originalValue: any): any {
    if (typeof originalValue === 'number') {
      const parsed = Number(newValue);
      return isNaN(parsed) ? originalValue : parsed;
    }
    if (typeof originalValue === 'boolean') {
      return newValue === 'true' || newValue === true;
    }
    if (Array.isArray(originalValue)) {
      return typeof newValue === 'string'
        ? newValue.split(',').map(s => s.trim())
        : Array.isArray(newValue) ? newValue : [newValue];
    }
    return newValue;
  }

  private convertToFields(data: any): DeckField[] {
    return Object.keys(data).map(key => ({
      key,
      value: data[key],
      displayName: this.formatFieldName(key),
      isFixed: this.FIXED_FIELDS.includes(key)
    }));
  }

  private formatFieldName(fieldName: string): string {
    return fieldName
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, str => str.toUpperCase())
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
      const date = value.toDate ? value.toDate() : value;
      return new Intl.DateTimeFormat('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
      }).format(date);
    }

    if (Array.isArray(value)) {
      return value.join(', ');
    }

    if (typeof value === 'object') {
      return JSON.stringify(value, null, 2);
    }

    return String(value);
  }

  async addDeck() {
    const user = this.currentUser();
    if (!user) {
      this.error.set('User not authenticated');
      return;
    }

    try {
      this.loading.set(true);

      const newDeckRef = doc(collection(this.firestore, `users/${user.uid}/collections`));
      const newDeckId = newDeckRef.id;
      const timestamp = serverTimestamp();
      const currentTime = new Date(); // For local state

      const newDeckData = {
        createdAt: timestamp,
        updatedAt: timestamp,
        cardCount: 0,
        name: '',
        description: ''
      };

      await setDoc(newDeckRef, newDeckData);

      // Create local data with actual Date objects
      const localDeckData = {
        createdAt: currentTime,
        updatedAt: currentTime,
        cardCount: 0,
        name: '',
        description: ''
      };

      // Add to local state with proper dates
      const currentDecks = this.deckData();
      this.deckData.set([
        ...currentDecks,
        {
          id: newDeckId,
          data: localDeckData, // Use local data with actual dates
          fields: this.convertToFields(localDeckData),
          isEditing: true, // Start in edit mode
          editableData: { ...localDeckData }
        } as Deck
      ]);

    } catch (err: any) {
      console.error('Error creating new deck:', err);
      this.error.set('Failed to create new deck: ' + err.message);
    } finally {
      this.loading.set(false);
    }
  }

  getEditableValue(deck: Deck, key: string): any {
    return deck.editableData?.[key] ?? '';
  }
}
