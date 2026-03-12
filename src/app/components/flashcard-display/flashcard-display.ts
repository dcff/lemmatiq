import { Component, inject, signal, computed, effect, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Firestore, doc, updateDoc, deleteDoc } from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';
import { FlashcardStateService } from '../../services/flashcard-state';

interface Card {
  id: string;
  [key: string]: any;
}

interface FieldGroup {
  key: string;
  value: string;
}

@Component({
  selector: 'app-flashcard-display',
  imports: [CommonModule],
  templateUrl: './flashcard-display.html',
  styleUrl: './flashcard-display.css'
})
export class FlashcardDisplay {
  private firestore = inject(Firestore);
  private auth = inject(Auth);
  private router = inject(Router);
  private state = inject(FlashcardStateService);

  // Field categorization constants
  private readonly AUXILIARY_DATE_FIELDS = ['createdAt', 'lastReviewedAt'];
  private readonly AUXILIARY_NUMERIC_FIELDS = ['score', 'reviewCount'];
  private readonly AUXILIARY_ARRAY_FIELDS = ['hiddenFields'];

  // Signals
  cards = this.state.cards;
  deckName = this.state.deckName;
  currentIndex = signal(0);
  answersRevealed = signal(false); // Controls whether hidden fields are temporarily revealed
  processingRating = signal(false);
  processingDelete = signal(false);
  processingEdit = signal(false);
  error = signal<string | null>(null);
  deleteMessage = signal<string | null>(null);
  skipScoreUpdate = signal(false);
  showDeleteConfirmation = signal(false);
  isEditing = signal(false);
  editedCard = signal<{[key: string]: any}>({});
  pendingHiddenFields = signal<string[]>([]); // What will be saved as hiddenFields when rating
  isCardFlipped = signal(false);

  // Session tracking signals
  correctCount = signal(0);
  incorrectCount = signal(0);
  reviewCompleted = signal(false);

  // Computed signals
  hasCards = computed(() => this.cards().length > 0);

  currentCard = computed(() => {
    const idx = this.currentIndex();
    const cards = this.cards();
    return idx < cards.length ? cards[idx] : null;
  });

  // All card fields, sorted by the resolved field order (CSV column order or user customisation)
  cardFields = computed(() => {
    const card = this.currentCard();
    if (!card) return [];
    const fieldOrder = this.state.fieldOrder();
    return Object.entries(card)
      .filter(([k]) => k !== 'id')
      .map(([k, v]) => ({ key: k, value: this.formatFieldValue(v) }))
      .sort((a, b) => {
        const ai = fieldOrder.indexOf(a.key);
        const bi = fieldOrder.indexOf(b.key);
        return (ai === -1 ? Infinity : ai) - (bi === -1 ? Infinity : bi);
      });
  });

  // Main fields (text fields that are not auxiliary)
  mainFields = computed(() => {
    return this.cardFields().filter(f =>
      !this.AUXILIARY_DATE_FIELDS.includes(f.key) &&
      !this.AUXILIARY_NUMERIC_FIELDS.includes(f.key) &&
      !this.AUXILIARY_ARRAY_FIELDS.includes(f.key)
    );
  });

  backMetadataFields = computed(() => {
  const card = this.currentCard();
  if (!card) return [];

  return [
    { key: 'createdAt', displayName: 'Created At', value: card['createdAt'] },
    { key: 'lastReviewedAt', displayName: 'Last Reviewed At', value: card['lastReviewedAt'] },
    { key: 'score', displayName: 'Score', value: card['score'] || '0' },
    { key: 'reviewCount', displayName: 'Review Count', value: card['reviewCount'] || '0' },
    { key: 'id', displayName: 'Card ID', value: card.id }
  ];
});
  // Auxiliary date fields
  auxiliaryDateFields = computed(() => {
    return this.cardFields().filter(f => this.AUXILIARY_DATE_FIELDS.includes(f.key));
  });

  // Auxiliary numeric fields
  auxiliaryNumericFields = computed(() => {
    return this.cardFields().filter(f => this.AUXILIARY_NUMERIC_FIELDS.includes(f.key));
  });

  // Auxiliary array fields
  auxiliaryArrayFields = computed(() => {
    return this.cardFields().filter(f => this.AUXILIARY_ARRAY_FIELDS.includes(f.key));
  });

  // Current hidden fields from the card data (for display)
  currentHiddenFields = computed(() => {
    const card = this.currentCard();
    return (card?.['hiddenFields'] as string[]) || [];
  });

  // Fields that should be displayed (not in hiddenFields array, unless revealed)
  visibleMainFields = computed(() => {
    const hiddenFieldKeys = this.currentHiddenFields();
    return this.mainFields().filter(f => !hiddenFieldKeys.includes(f.key));
  });

  visibleAuxiliaryDateFields = computed(() => {
    const hiddenFieldKeys = this.currentHiddenFields();
    return this.auxiliaryDateFields().filter(f => !hiddenFieldKeys.includes(f.key));
  });

  visibleAuxiliaryNumericFields = computed(() => {
    const hiddenFieldKeys = this.currentHiddenFields();
    return this.auxiliaryNumericFields().filter(f => !hiddenFieldKeys.includes(f.key));
  });

  visibleAuxiliaryArrayFields = computed(() => {
    const hiddenFieldKeys = this.currentHiddenFields();
    return this.auxiliaryArrayFields().filter(f => !hiddenFieldKeys.includes(f.key));
  });

  // Fields that are currently hidden (in hiddenFields array)
  hiddenMainFields = computed(() => {
    const hiddenFieldKeys = this.currentHiddenFields();
    return this.mainFields().filter(f => hiddenFieldKeys.includes(f.key));
  });

  hiddenAuxiliaryDateFields = computed(() => {
    const hiddenFieldKeys = this.currentHiddenFields();
    return this.auxiliaryDateFields().filter(f => hiddenFieldKeys.includes(f.key));
  });

  hiddenAuxiliaryNumericFields = computed(() => {
    const hiddenFieldKeys = this.currentHiddenFields();
    return this.auxiliaryNumericFields().filter(f => hiddenFieldKeys.includes(f.key));
  });

  hiddenAuxiliaryArrayFields = computed(() => {
    const hiddenFieldKeys = this.currentHiddenFields();
    return this.auxiliaryArrayFields().filter(f => hiddenFieldKeys.includes(f.key));
  });

  hasHiddenFields = computed(() => {
    return this.hiddenMainFields().length > 0 ||
           this.hiddenAuxiliaryDateFields().length > 0 ||
           this.hiddenAuxiliaryNumericFields().length > 0 ||
           this.hiddenAuxiliaryArrayFields().length > 0;
  });

  isFirstCard = computed(() => this.currentIndex() === 0);
  isLastCard = computed(() => this.currentIndex() >= this.cards().length - 1);

  progress = computed(() => {
    const total = this.cards().length;
    if (total === 0) return 0;
    return Math.round(((this.currentIndex() + 1) / total) * 100);
  });

  // Review session computed values
  totalReviewed = computed(() => this.correctCount() + this.incorrectCount());

  accuracyPercentage = computed(() => {
    const total = this.totalReviewed();
    if (total === 0) return 0;
    return Math.round((this.correctCount() / total) * 100);
  });

  constructor() {
    effect(() => {
      // Reset reveal state when index changes
      this.currentIndex();
      this.answersRevealed.set(false);
      this.showDeleteConfirmation.set(false);
      this.isEditing.set(false);
    });

    // Initialize pendingHiddenFields and editedCard whenever the current card changes
    effect(() => {
      const card = this.currentCard();
      if (card) {
        // Initialize pendingHiddenFields with current hiddenFields
        this.pendingHiddenFields.set([...(card.hiddenFields || [])]);

        // Initialize editedCard with current card values
        const { id, ...cardWithoutId } = card;
        this.editedCard.set({ ...cardWithoutId });
      }
    });

    // Navigate back to filter if no cards are available
    effect(() => {
      const cards = this.cards();
      if (cards.length === 0) {
        console.warn('No cards available for review');
        // Optionally navigate back to filter
        // this.navigateBackToFilter();
      }
    });
  }

  nextCard() {
    if (this.currentIndex() < this.cards().length - 1) {
      this.currentIndex.update(i => i + 1);
    }
  }

  previousCard() {
    if (this.currentIndex() > 0) {
      this.currentIndex.update(i => i - 1);
    }
  }

  revealAnswers() {
    this.answersRevealed.set(true);
  }

  // Show delete confirmation
  showDeleteDialog() {
    this.showDeleteConfirmation.set(true);
  }

  // Cancel delete operation
  cancelDelete() {
    this.showDeleteConfirmation.set(false);
  }

  // Enter edit mode
  enterEditMode() {
    const card = this.currentCard();
    if (card) {
      const { id, ...cardWithoutId } = card;
      this.editedCard.set({ ...cardWithoutId });
      this.isEditing.set(true);
    }
  }

  // Cancel edit operation
  cancelEdit() {
    this.isEditing.set(false);
    // Reset editedCard to original values
    const card = this.currentCard();
    if (card) {
      const { id, ...cardWithoutId } = card;
      this.editedCard.set({ ...cardWithoutId });
    }
  }

  // Update a field value in edit mode
  updateEditedField(fieldKey: string, value: any) {
    this.editedCard.update(card => ({
      ...card,
      [fieldKey]: value
    }));
  }

  // Save edited card
  async saveEditedCard() {
    const card = this.currentCard();
    const user = this.auth.currentUser;
    if (!card || !user) return;

    try {
      this.processingEdit.set(true);
      this.error.set(null);

      const deckName = this.deckName();
      const cardRef = doc(this.firestore, `users/${user.uid}/collections/${deckName}/cards`, card.id);

      const editedData = this.editedCard();

      // Update in Firestore
      await updateDoc(cardRef, editedData);

      // Update local state
      this.state.cards.update(cards =>
        cards.map(c => (c.id === card.id ? { ...c, ...editedData } : c))
      );

      this.isEditing.set(false);

    } catch (err) {
      console.error('Error updating card:', err);
      this.error.set('Failed to save card. Please try again.');
    } finally {
      this.processingEdit.set(false);
    }
  }


  flipCard() {
  this.isCardFlipped.set(!this.isCardFlipped());
}

handleCardClick(event: Event) {
  // Only flip if clicking on the card itself, not on interactive elements
  const target = event.target as HTMLElement;
  if (target.classList.contains('clickable-area') ||
      (target.closest('.card') &&
       !target.closest('.unified-field-item') &&
       !target.closest('.btn') &&
       !target.closest('.skip-score-update') &&
       !target.closest('input') &&
       !target.closest('label'))) {
    this.flipCard();
  }
}

allMainFields() {
  return this.mainFields();
}
  // Delete current card
  async deleteCurrentCard() {
    const card = this.currentCard();
    const user = this.auth.currentUser;
    if (!card || !user) return;

    try {
      this.processingDelete.set(true);
      this.error.set(null);

      const deckName = this.deckName();
      const cardRef = doc(this.firestore, `users/${user.uid}/collections/${deckName}/cards`, card.id);

      // Delete from Firestore
      await deleteDoc(cardRef);

      // Update local state - remove the card
      this.state.cards.update(cards => cards.filter(c => c.id !== card.id));

      // Handle navigation after deletion
      const remainingCards = this.cards();
      const currentIdx = this.currentIndex();

      if (remainingCards.length === 0) {
        // No more cards, navigate back to decks
        this.navigateToDecks();
      } else {
        if (currentIdx >= remainingCards.length) {
          // Deleted the last card in the list — step back to new last
          this.currentIndex.set(remainingCards.length - 1);
        }
        // Reset reveal state for the card now being shown
        this.answersRevealed.set(false);
        // Show brief confirmation then auto-clear after 2 s
        this.deleteMessage.set('Card deleted');
        setTimeout(() => this.deleteMessage.set(null), 2000);
      }

      this.showDeleteConfirmation.set(false);

    } catch (err) {
      console.error('Error deleting card:', err);
      this.error.set('Failed to delete card. Please try again.');
    } finally {
      this.processingDelete.set(false);
    }
  }

  // Modified rateCard - now saves pendingHiddenFields
  async rateCard(isCorrect: boolean) {
    const card = this.currentCard();
    const user = this.auth.currentUser;
    if (!card || !user) return;

    try {
      this.processingRating.set(true);
      this.error.set(null);

      const deckName = this.deckName();
      const cardRef = doc(this.firestore, `users/${user.uid}/collections/${deckName}/cards`, card.id);

      const currentReviewCount = card['reviewCount'] || 0;
      const currentScore = card['score'] || 0;

      const updateData: any = {
        reviewCount: currentReviewCount + 1,
        lastReviewedAt: new Date(),
        hiddenFields: this.pendingHiddenFields() // Save the pending hidden fields
      };

      if (isCorrect && !this.skipScoreUpdate()) {
        updateData.score = currentScore + 1;
      }

      await updateDoc(cardRef, updateData);

      // Update local state
      this.state.cards.update(cards =>
        cards.map(c => (c.id === card.id ? { ...c, ...updateData } : c))
      );

      // Update session tracking
      if (isCorrect) {
        this.correctCount.update(count => count + 1);
      } else {
        this.incorrectCount.update(count => count + 1);
      }

      if (!this.isLastCard()) {
        this.nextCard();
      } else {
        // Mark review as completed
        this.reviewCompleted.set(true);
        console.log('Deck completed!');
      }

    } catch (err) {
      console.error('Error rating card:', err);
      this.error.set('Failed to save rating. Please try again.');
    } finally {
      this.processingRating.set(false);
    }
  }

  // Toggle field in pendingHiddenFields (for future save)
  toggleHiddenField(fieldKey: string) {
    const current = this.pendingHiddenFields();
    if (current.includes(fieldKey)) {
      this.pendingHiddenFields.set(current.filter(f => f !== fieldKey));
    } else {
      this.pendingHiddenFields.set([...current, fieldKey]);
    }
  }

  // Check if field will be hidden in next save
  isFieldPendingHidden(fieldKey: string): boolean {
    return this.pendingHiddenFields().includes(fieldKey);
  }

  // Check if field is currently hidden (for display purposes)
  isFieldCurrentlyHidden(fieldKey: string): boolean {
    return this.currentHiddenFields().includes(fieldKey);
  }

  navigateToDecks() {
    this.router.navigate(['/decks']);
  }

  // Start a new review session
  startNewReview() {
    this.restartDeck();
  }

  formatFieldName(fieldName: string): string {
    return fieldName
      .replace(/([A-Z])/g, ' $1')
      .replace(/[_-]/g, ' ')
      .replace(/\b\w/g, l => l.toUpperCase())
      .trim();
  }

  @HostListener('window:keydown', ['$event'])
  handleKeyboard(event: KeyboardEvent) {
    // Don't handle keyboard events if delete confirmation is showing, in edit mode, or review is completed
    if (this.showDeleteConfirmation() || this.isEditing() || this.reviewCompleted()) return;

    // Prevent default behavior for our handled keys
    switch (event.key) {
      case ' ':
      case 'Space':
        event.preventDefault();
        if (this.hasHiddenFields() && !this.answersRevealed()) {
          this.revealAnswers();
        }
        break;
      case 'ArrowLeft':
        event.preventDefault();
        this.previousCard();
        break;
      case 'ArrowRight':
        event.preventDefault();
        this.nextCard();
        break;
      case 'Enter':
        event.preventDefault();
        if (this.answersRevealed() || !this.hasHiddenFields()) {
          this.rateCard(true);
        }
        break;
      case 'Backspace':
        event.preventDefault();
        if (this.answersRevealed() || !this.hasHiddenFields()) {
          this.rateCard(false);
        }
        break;
      case 'Delete':
        // Forward delete (fn + delete on Mac)
        event.preventDefault();
        this.showDeleteDialog();
        break;
      case 'd':
      case 'D':
        // CMD/Ctrl + D for delete (works on all platforms)
        if (event.metaKey || event.ctrlKey) {
          event.preventDefault();
          this.showDeleteDialog();
        }
        break;
      case 'e':
      case 'E':
        event.preventDefault();
        this.enterEditMode();
        break;
      case 'f':
      case 'F':
        event.preventDefault();
        this.flipCard();
        break;
    }
  }

  restartDeck() {
    this.currentIndex.set(0);
    this.answersRevealed.set(false);
    this.error.set(null);
    this.showDeleteConfirmation.set(false);
    this.isEditing.set(false);
    // Reset session tracking
    this.correctCount.set(0);
    this.incorrectCount.set(0);
    this.reviewCompleted.set(false);
  }

  formatFieldValue(value: any): string {
    if (value == null) return '';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (value instanceof Date) {
      return value.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
      });
    }
    if (value?.toDate && typeof value.toDate === 'function') {
      return value.toDate().toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
      });
    }
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value, null, 2);
      } catch {
        return String(value);
      }
    }
    return String(value);
  }
}
