import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class FlashcardStateService {
  cards = signal<any[]>([]);
  deckName = signal('');
  /** Resolved field display order: user's custom order if set, otherwise CSV column order. */
  fieldOrder = signal<string[]>([]);
}

