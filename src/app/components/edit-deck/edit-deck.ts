import { Component, inject, signal, effect, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Firestore, doc, getDoc, updateDoc } from '@angular/fire/firestore';
import { Auth, onAuthStateChanged, User } from '@angular/fire/auth';
import { CardUpload } from '../card-upload/card-upload';


interface DeckField {
  key: string;
  value: any;
  displayName: string;
  isFixed: boolean;
}

interface DeckData {
  id: string;
  data: any;
  fields: DeckField[];
}

@Component({
  selector: 'app-edit-deck',
  imports: [CommonModule, FormsModule, CardUpload],
  templateUrl: './edit-deck.html',
  styleUrl: './edit-deck.css'
})
export class EditDeck {
  private firestore = inject(Firestore);
  private auth = inject(Auth);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  private currentUser = signal<User | null>(null);
  private deckData = signal<DeckData | null>(null);
  private originalData = signal<any | null>(null); // NEW: track original Firestore data

  loading = signal(true);
  error = signal<string | null>(null);
  deckId = signal<string | null>(null);
  saving = signal(false);
  showUploadDialog = signal(false);


  deck = computed(() => this.deckData());
  editableFields = computed(() => this.deckData()?.fields.filter(f => !f.isFixed) ?? []);
  fixedFields = computed(() => this.deckData()?.fields.filter(f => f.isFixed) ?? []);

  hasUnsavedChanges = computed(() => {
    const deck = this.deckData();
    const original = this.originalData();
    if (!deck || !original) return false;

    return deck.fields.some(field => {
      if (field.isFixed) return false;
      const originalValue = original[field.key];
      return JSON.stringify(field.value) !== JSON.stringify(originalValue);
    });
  });

  private readonly FIXED_FIELDS = ['id', 'createdAt', 'updatedAt', 'userId', 'createdBy', 'cardCount'];

  constructor() {
    const routeDeckId = this.route.snapshot.paramMap.get('id');
    this.deckId.set(routeDeckId);

    onAuthStateChanged(this.auth, (user) => {
      this.currentUser.set(user);
    });

    effect(async () => {
      const user = this.currentUser();
      const deckId = this.deckId();
      if (user && deckId) {
        await this.loadDeck(user.uid, deckId);
      } else {
        this.loading.set(false);
        this.error.set(user ? 'No deck ID provided' : 'User not authenticated');
      }
    });
  }

  private async loadDeck(userId: string, deckId: string) {
    try {
      this.loading.set(true);
      this.error.set(null);

      const deckPath = `users/${userId}/collections/${deckId}`;
      const docRef = doc(this.firestore, deckPath);
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        const data = docSnap.data();
        const deckData: DeckData = {
          id: docSnap.id,
          data,
          fields: this.convertToFields(data)
        };
        this.deckData.set(deckData);
        this.originalData.set(structuredClone(data)); // deep copy of original
      } else {
        this.error.set('Deck not found');
      }
    } catch (err: any) {
      this.error.set('Failed to load deck: ' + err.message);
    } finally {
      this.loading.set(false);
    }
  }

  private convertToFields(data: any): DeckField[] {
    return Object.keys(data).map(key => ({
      key,
      value: data[key],
      displayName: this.formatFieldName(key),
      isFixed: this.FIXED_FIELDS.includes(key)
    }));
  }

  private formatFieldName(name: string): string {
    return name.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).trim();
  }

  formatValue(value: any): string {
    if (value === null || value === undefined) return 'Not specified';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (value instanceof Date || (value?.toDate)) {
      const date = value.toDate ? value.toDate() : value;
      return date.toLocaleDateString();
    }
    if (Array.isArray(value)) return value.join(', ');
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  updateField(fieldKey: string, newValue: any) {
    const currentDeck = this.deckData();
    if (!currentDeck) return;

    const updatedFields = currentDeck.fields.map(field =>
      field.key === fieldKey ? { ...field, value: this.parseValue(newValue, field.value) } : field
    );

    this.deckData.set({
      ...currentDeck,
      fields: updatedFields,
      data: {
        ...currentDeck.data,
        [fieldKey]: this.parseValue(newValue, currentDeck.data[fieldKey])
      }
    });
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

  async saveChanges() {
    const user = this.currentUser();
    const deckId = this.deckId();
    const deck = this.deckData();
    if (!user || !deckId || !deck) return;

    try {
      this.saving.set(true);
      const deckPath = `users/${user.uid}/collections/${deckId}`;
      const docRef = doc(this.firestore, deckPath);

      const updateData: any = {};
      deck.fields.forEach(f => { if (!f.isFixed) updateData[f.key] = f.value; });
      await updateDoc(docRef, updateData);

      this.originalData.set(structuredClone(deck.data)); // reset baseline
      alert('Deck updated successfully!');
      //this.goBack();
    } catch (err: any) {
      this.error.set('Failed to save changes: ' + err.message);
    } finally {
      this.saving.set(false);
    }
  }

  goBack() {
    this.router.navigate(['/decks']);
  }

  openUploadDialog() {
    this.showUploadDialog.set(true);
  }

  isArray(v: any) { return Array.isArray(v); }
  getInputValue(e: Event) { return (e.target as HTMLInputElement).value; }
  getSelectValue(e: Event) { return (e.target as HTMLSelectElement).value; }
}

