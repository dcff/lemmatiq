import { Component, inject, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import { Firestore, collection, getDocs } from '@angular/fire/firestore';
import { Auth, authState } from '@angular/fire/auth';
import { FlashcardStateService } from '../../services/flashcard-state';
import { CardUpload } from '../card-upload/card-upload';
import { toSignal } from '@angular/core/rxjs-interop';
import { AddCard } from '../add-card/add-card';

interface NumericField {
  name: string;
  displayName: string;
  type: 'numeric';
  min: number;
  max: number;
  currentMin: number;
  currentMax: number;
}

interface TextualField {
  name: string;
  displayName: string;
  type: 'textual';
  searchText: string;
}

interface BooleanField {
  name: string;
  displayName: string;
  type: 'boolean';
  selectedValue: 'all' | 'true' | 'false';
}

interface DateField {
  name: string;
  displayName: string;
  type: 'date';
  minDate: Date;
  maxDate: Date;
  currentMinDate: Date | null;
  currentMaxDate: Date | null;
}

type FilterField = NumericField | TextualField | BooleanField | DateField;

interface FilterCriteria {
  [fieldName: string]: {
    type: 'numeric' | 'textual' | 'boolean' | 'date';
    min?: number;
    max?: number;
    searchText?: string;
    booleanValue?: 'all' | 'true' | 'false';
    minDate?: Date;
    maxDate?: Date;
  };
}

@Component({
  selector: 'app-card-filter',
  imports: [CommonModule, CardUpload, AddCard],
  templateUrl: './card-filter.html',
  styleUrl: './card-filter.css'
})
export class CardFilter {
  private firestore = inject(Firestore);
  private auth = inject(Auth);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private readonly state = inject(FlashcardStateService);
  showUploadSection = signal(false);
  showAddCardSection = signal(false);
  showFilterSection = signal(false);
  deckId = signal<string | null>(null);
  // Add shuffle state
isShuffled = signal(false);
  private authUser = toSignal(authState(this.auth));

  loading = signal(true);
  error = signal<string | null>(null);
  deckName = signal('');

  filterFields = signal<FilterField[]>([]);
  totalCards = signal(0);
  filteredCount = signal(0);

  allCards = signal<any[]>([]);
  filteredCards = signal<any[]>([]);

  hasFilterFields = computed(() => this.filterFields().length > 0);
  canApplyFilter = computed(() =>
    this.filterFields().some(field => {
      switch (field.type) {
        case 'numeric':
          return (
            field.currentMin !== field.min || field.currentMax !== field.max
          );
        case 'textual':
          return field.searchText.trim() !== '';
        case 'boolean':
          return field.selectedValue !== 'all';
        case 'date':
          return field.currentMinDate !== null || field.currentMaxDate !== null;
        default:
          return false;
      }
    })
  );

  constructor() {
    // Get deckName from route params and set it in state
    effect(() => {
      const params = this.route.snapshot.params;
      const deckName = params['deckName'] || params['id'] || 'default';
      this.deckName.set(deckName);
      this.state.deckName.set(deckName);
      this.deckId.set(deckName);
    });

    // Load cards when user is authenticated and deckName is set
    effect(() => {
      const user = this.authUser();
      const deckName = this.deckName();
      if (user && deckName) {
        this.analyzeCards();
      }
    });
  }

   // Fisher-Yates shuffle algorithm
  private shuffleArray<T>(array: T[]): T[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  // Shuffle cards method
  shuffleCards() {
    const currentCards = this.filteredCards();
    const shuffledCards = this.shuffleArray(currentCards);
    this.filteredCards.set(shuffledCards);
    this.state.cards.set(shuffledCards);
    this.isShuffled.set(true);
  }

  // Reset to original order
  resetCardOrder() {
    this.applyFilters(); // This will restore the original filtered order
    this.isShuffled.set(false);
  }

  // Header button methods
  toggleUpload() {
    this.showUploadSection.set(!this.showUploadSection());
    // Close other sections when upload is opened
    if (this.showUploadSection()) {
      this.showAddCardSection.set(false);
      this.showFilterSection.set(false);
    }
  }

  toggleAddCard() {
    this.showAddCardSection.set(!this.showAddCardSection());
    // Close other sections when add card is opened
    if (this.showAddCardSection()) {
      this.showUploadSection.set(false);
      this.showFilterSection.set(false);
    }
  }

  toggleFilter() {
    this.showFilterSection.set(!this.showFilterSection());
    // Close other sections when filter is opened
    if (this.showFilterSection()) {
      this.showUploadSection.set(false);
      this.showAddCardSection.set(false);
    }
  }

  // Check if a value is a timestamp (Firebase Timestamp or Date or number)
  private isTimestamp(value: any): boolean {
    // Firebase Timestamp object
    if (value && typeof value === 'object' && value.toDate && typeof value.toDate === 'function') {
      return true;
    }
    // Date object
    if (value instanceof Date) {
      return true;
    }
    // Unix timestamp (number in milliseconds or seconds)
    if (typeof value === 'number' && value > 0) {
      // Check if it's a reasonable timestamp (after 1970 and before year 3000)
      const date = new Date(value);
      const dateSeconds = new Date(value * 1000); // In case it's in seconds
      return (date.getFullYear() > 1970 && date.getFullYear() < 3000) ||
             (dateSeconds.getFullYear() > 1970 && dateSeconds.getFullYear() < 3000);
    }
    return false;
  }

  // Convert any timestamp format to Date object
  private toDate(value: any): Date | null {
  try {
    // Firebase Timestamp (has .toDate method)
    if (value && typeof value === 'object' && typeof value.toDate === 'function') {
      return value.toDate();
    }

    // Firestore plain object {seconds, nanoseconds}
    if (value && typeof value === 'object' && 'seconds' in value && 'nanoseconds' in value) {
      return new Date(
        value.seconds * 1000 + Math.floor(value.nanoseconds / 1e6)
      );
    }

    // Native Date
    if (value instanceof Date) {
      return value;
    }

    // Numeric timestamps
    if (typeof value === 'number' && value > 0) {
      if (value > 1e12) {
        return new Date(value); // ms
      } else {
        return new Date(value * 1000); // s
      }
    }

    return null;
  } catch {
    return null;
  }
}


  private determineFieldType(value: any): {
    type: 'numeric' | 'textual' | 'boolean' | 'date';
    numericValues?: number[];
    hasTextValues?: boolean;
    booleanValues?: Set<boolean>;
    dateValues?: Date[];
  } {
    if (typeof value === 'boolean') {
      return { type: 'boolean', booleanValues: new Set<boolean>() };
    }
    if (this.isTimestamp(value)) {
      return { type: 'date', dateValues: [] };
    }
    if (this.isNumeric(value)) {
      return { type: 'numeric', numericValues: [] };
    }
    return { type: 'textual', hasTextValues: true };
  }

  private addValueToAnalysis(analysis: any, value: any) {
    switch (analysis.type) {
      case 'numeric':
        const n = Number(value);
        if (!isNaN(n)) analysis.numericValues.push(n);
        break;
      case 'textual':
        analysis.hasTextValues = true;
        break;
      case 'boolean':
        if (typeof value === 'boolean') analysis.booleanValues.add(value);
        break;
      case 'date':
        const date = this.toDate(value);
        if (date) analysis.dateValues.push(date);
        break;
    }
  }

async analyzeCards() {
  try {
    this.loading.set(true);
    this.error.set(null);

    const user = this.authUser();
    const deckName = this.deckName();

    if (!user) {
      this.error.set('User not authenticated');
      this.loading.set(false);
      return;
    }

    if (!deckName) {
      this.error.set('No deck specified');
      this.loading.set(false);
      return;
    }

    const cardsCollection = collection(
      this.firestore,
      `users/${user.uid}/collections/${deckName}/cards`
    );
    const querySnapshot = await getDocs(cardsCollection);

    const cards: any[] = [];
    querySnapshot.forEach(doc => cards.push({ id: doc.id, ...doc.data() }));

    this.allCards.set(cards);
    this.filteredCards.set(cards);
    this.totalCards.set(cards.length);
    this.filteredCount.set(cards.length);

    // Reset shuffle state when cards are reloaded
    this.isShuffled.set(false);

    this.state.cards.set(cards);

    // Field analysis
    const fieldAnalysis = new Map<
      string,
      {
        type: 'numeric' | 'textual' | 'boolean' | 'date';
        numericValues?: number[];
        hasTextValues?: boolean;
        booleanValues?: Set<boolean>;
        dateValues?: Date[];
      }
    >();

    cards.forEach(card => {
      Object.entries(card).forEach(([key, value]) => {
        if (key === 'id') return;

        if (!fieldAnalysis.has(key)) {
          fieldAnalysis.set(key, this.determineFieldType(value));
        }
        this.addValueToAnalysis(fieldAnalysis.get(key)!, value);
      });
    });

    // Create fields and group them by type
    const fields: FilterField[] = Array.from(fieldAnalysis.entries())
      .map(([name, analysis]) => this.createFilterFieldIncludeAll(name, analysis))
      .filter((f): f is FilterField => f !== null)
      .sort((a, b) => {
        // Define the desired type order
        const typeOrder: Record<string, number> = {
          'textual': 1,
          'numeric': 2,
          'boolean': 3,
          'date': 4
        };

        // First sort by type
        const typeComparison = typeOrder[a.type] - typeOrder[b.type];
        if (typeComparison !== 0) {
          return typeComparison;
        }

        // Then sort alphabetically by display name within the same type
        return a.displayName.localeCompare(b.displayName);
      });

    this.filterFields.set(fields);

  } catch (err) {
    console.error('Error analyzing cards:', err);
    this.error.set('Failed to analyze cards. Please try again.');
  } finally {
    this.loading.set(false);
  }
}


  private createFilterFieldIncludeAll(name: string, analysis: any): FilterField | null {
    const displayName = this.formatFieldName(name);

    switch (analysis.type) {
      case 'numeric': {
        const min = analysis.numericValues.length > 0 ? Math.min(...analysis.numericValues) : 0;
        const max = analysis.numericValues.length > 0 ? Math.max(...analysis.numericValues) : 0;
        return {
          name,
          displayName,
          type: 'numeric',
          min,
          max,
          currentMin: min,
          currentMax: max
        };
      }
      case 'textual': {
        return {
          name,
          displayName,
          type: 'textual',
          searchText: ''
        };
      }
      case 'boolean': {
        return { name, displayName, type: 'boolean', selectedValue: 'all' };
      }
      case 'date': {
        const dates = analysis.dateValues || [];
        if (dates.length === 0) return null;

        const minDate = new Date(Math.min(...dates.map((d: Date) => d.getTime())));
        const maxDate = new Date(Math.max(...dates.map((d: Date) => d.getTime())));

        return {
          name,
          displayName,
          type: 'date',
          minDate,
          maxDate,
          currentMinDate: null,
          currentMaxDate: null
        };
      }
      default:
        return null;
    }
  }

  private isNumeric(value: any): boolean {
    if (value == null || value === '') return false;
    if (typeof value === 'number') return !isNaN(value) && !this.isTimestamp(value);
    if (typeof value === 'string') {
      const n = Number(value);
      return !isNaN(n) && isFinite(n) && !this.isTimestamp(n);
    }
    return false;
  }

  private matchesGrepPattern(text: string, pattern: string): boolean {
    if (!pattern.trim()) return true;

    try {
      const hasRegexChars = /[.*+?^${}()|[\]\\]/.test(pattern);
      if (!hasRegexChars) {
        return text.toLowerCase().includes(pattern.toLowerCase());
      }

      let regexPattern = pattern
        .replace(/\\\./g, '\\.')
        .replace(/\\\*/g, '\\*')
        .replace(/\\\+/g, '\\+')
        .replace(/\\\?/g, '\\?');

      const regex = new RegExp(regexPattern, 'i');
      return regex.test(text);
    } catch (e) {
      return text.toLowerCase().includes(pattern.toLowerCase());
    }
  }

  reviewAllCards() {
    const resetFields: FilterField[] = this.filterFields().map(field => {
      if (field.type === 'numeric') {
        return {
          ...field,
          currentMin: field.min,
          currentMax: field.max,
        } as NumericField;
      }
      if (field.type === 'textual') {
        return {
          ...field,
          searchText: '',
        } as TextualField;
      }
      if (field.type === 'boolean') {
        return {
          ...field,
          selectedValue: 'all' as 'all',
        } as BooleanField;
      }
      if (field.type === 'date') {
        return {
          ...field,
          currentMinDate: null,
          currentMaxDate: null,
        } as DateField;
      }
      return field;
    });

    this.filterFields.set(resetFields);
    this.applyFilters();
  }

  private applyFilterCriteria(cards: any[], filters: FilterCriteria): any[] {
    return cards.filter(card =>
      Object.entries(filters).every(([fieldName, criteria]) => {
        const value = card[fieldName];
        switch (criteria.type) {
          case 'numeric':
            return (
              typeof value === 'number' &&
              value >= (criteria.min ?? Number.MIN_SAFE_INTEGER) &&
              value <= (criteria.max ?? Number.MAX_SAFE_INTEGER)
            );
          case 'textual':
            if (!criteria.searchText || criteria.searchText.trim() === '') return true;
            const textValue = String(value || '');
            return this.matchesGrepPattern(textValue, criteria.searchText);
          case 'boolean':
            return (
              criteria.booleanValue === 'all' ||
              value === (criteria.booleanValue === 'true')
            );
          case 'date':
            const cardDate = this.toDate(value);
              console.log('Filtering:', { fieldName, value, parsed: cardDate, min: criteria.minDate, max: criteria.maxDate });

            if (!cardDate) return false;
            const min = criteria.minDate ? new Date(criteria.minDate) : null;
  const max = criteria.maxDate ? new Date(criteria.maxDate) : null;

  if (min) {
    min.setHours(0, 0, 0, 0); // start of day
  }
  if (max) {
    max.setHours(23, 59, 59, 999); // end of day
  }

  const minDateCheck = !min || cardDate >= min;
  const maxDateCheck = !max || cardDate <= max;

  return minDateCheck && maxDateCheck;

          default:
            return true;
        }
      })
    );
  }

  applyFilters() {
    const filters: FilterCriteria = {};
    this.filterFields().forEach(field => {
      switch (field.type) {
        case 'numeric':
          if (
            field.currentMin !== field.min ||
            field.currentMax !== field.max
          )
            filters[field.name] = {
              type: 'numeric',
              min: field.currentMin,
              max: field.currentMax
            };
          break;
        case 'textual':
          if (field.searchText.trim() !== '') {
            filters[field.name] = {
              type: 'textual',
              searchText: field.searchText
            };
          }
          break;
        case 'boolean':
          if (field.selectedValue !== 'all')
            filters[field.name] = {
              type: 'boolean',
              booleanValue: field.selectedValue
            };
          break;
        case 'date':
          if (field.currentMinDate || field.currentMaxDate) {
            filters[field.name] = {
              type: 'date',
              minDate: field.currentMinDate || undefined,
              maxDate: field.currentMaxDate || undefined
            };
          }
          break;
      }
    });

    const filtered = this.applyFilterCriteria(this.allCards(), filters);
    this.filteredCards.set(filtered);
    this.filteredCount.set(filtered.length);
    this.state.cards.set(filtered);

    // Reset shuffle state when filters are applied
    this.isShuffled.set(false);
  }

  // UI update helpers
  updateNumericField(field: NumericField, prop: 'currentMin' | 'currentMax', value: number) {
    const fields = this.filterFields().map(f =>
      f.name === field.name && f.type === 'numeric'
        ? { ...f, [prop]: +value }
        : f
    );
    this.filterFields.set(fields);
    this.applyFilters();
  }

  updateBooleanField(field: BooleanField, value: 'all' | 'true' | 'false') {
    const fields = this.filterFields().map(f =>
      f.name === field.name && f.type === 'boolean'
        ? { ...f, selectedValue: value }
        : f
    );
    this.filterFields.set(fields);
    this.applyFilters();
  }

  updateTextualField(field: TextualField, searchText: string) {
    const updatedFields: FilterField[] = this.filterFields().map(f =>
      f.name === field.name && f.type === 'textual'
        ? { ...f, searchText } as TextualField
        : f
    );

    this.filterFields.set(updatedFields);
    this.applyFilters();
  }

  // New method for updating date fields
  updateDateField(field: DateField, prop: 'currentMinDate' | 'currentMaxDate', value: string | null) {
    const dateValue = value ? new Date(value) : null;

    const fields = this.filterFields().map(f =>
      f.name === field.name && f.type === 'date'
        ? { ...f, [prop]: dateValue }
        : f
    );

    this.filterFields.set(fields);
    this.applyFilters();
  }

  // Helper to format date for input field
  formatDateForInput(date: Date | null): string {
    if (!date) return '';
    return date.toISOString().split('T')[0];
  }

  // Helper to get min/max date strings for HTML input constraints
  getDateInputMin(field: DateField): string {
    return this.formatDateForInput(field.minDate);
  }

  getDateInputMax(field: DateField): string {
    return this.formatDateForInput(field.maxDate);
  }

  // Navigation methods
  goToFlashcards() {
    this.router.navigate(['/review']);
  }

  // Updated Add Card methods for inline component
  onCardAdded(action: 'close' | 'continue') {
    this.analyzeCards(); // Always refresh data

    if (action === 'close') {
      this.showAddCardSection.set(false); // Close the inline component
    }
  }

  onCardsUploaded() {
    this.showUploadSection.set(false);
    this.analyzeCards();
  }

  formatFieldName(fieldName: string) {
    return fieldName
      .replace(/([A-Z])/g, ' $1')
      .replace(/[_-]/g, ' ')
      .replace(/\b\w/g, l => l.toUpperCase())
      .trim();
  }

  getFieldsByType(fieldType: string) {
  return this.filterFields().filter(field => field.type === fieldType);
}
}
