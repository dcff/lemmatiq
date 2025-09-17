import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class FlashcardStateService {
  cards = signal<any[]>([]);
  deckName = signal('');
}

