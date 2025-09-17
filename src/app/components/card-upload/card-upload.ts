import { Component, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Firestore, collection, addDoc, doc, updateDoc, serverTimestamp, getDocs } from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';
import Papa from 'papaparse';


@Component({
  selector: 'app-card-upload',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './card-upload.html',
  styleUrls: ['./card-upload.css']
})
export class CardUpload {
  private firestore = inject(Firestore);
  private auth = inject(Auth);

  @Input() deckId!: string;
  @Output() close = new EventEmitter<void>();
  @Output() cardsUploaded = new EventEmitter<void>();

  loading = signal(false);
  error = signal<string | null>(null);
  success = signal(false);

  async handleFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;

  this.loading.set(true);
  this.error.set(null);
  this.success.set(false);

  try {
    const text = await file.text();

    // Parse CSV correctly using PapaParse
    const parsed = Papa.parse(text, {
      header: true,    // first row is header
      skipEmptyLines: true,
    });

    const rows = parsed.data as Record<string, string>[];

    if (!rows.length) {
      this.error.set('CSV must include a header and at least one row.');
      this.loading.set(false);
      return;
    }

    const user = this.auth.currentUser;
    if (!user) {
      this.error.set('You must be logged in.');
      this.loading.set(false);
      return;
    }

    const cardsCollection = collection(
      this.firestore,
      `users/${user.uid}/collections/${this.deckId}/cards`
    );

    console.log('Uploading cards to Firestore path:', `users/${user.uid}/collections/${this.deckId}/cards`);

    const headers = parsed.meta.fields || [];
    const secondFieldName = headers.length > 1 ? headers[1] : null;

    // Upload all cards
    for (const row of rows) {
      const card: Record<string, any> = { ...row };

      card['hiddenFields'] = secondFieldName ? [secondFieldName] : [];
      card['createdAt'] = serverTimestamp();
      card['lastReviewedAt'] = serverTimestamp();

      await addDoc(cardsCollection, card);
    }

    const deckDocRef = doc(this.firestore, `users/${user.uid}/collections/${this.deckId}`);
    const updatedCardsSnapshot = await getDocs(cardsCollection);
    const totalCardCount = updatedCardsSnapshot.size;

    await updateDoc(deckDocRef, {
      updatedAt: serverTimestamp(),
      cardCount: totalCardCount
    });

    this.success.set(true);
    this.cardsUploaded.emit();

  } catch (err) {
    console.error(err);
    this.error.set('Failed to upload CSV.');
  } finally {
    this.loading.set(false);
  }
}

  closeDialog() {
    this.close.emit();
  }
}
