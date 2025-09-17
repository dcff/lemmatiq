import { Component, inject, signal, input, output, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Firestore, collection, addDoc, serverTimestamp } from '@angular/fire/firestore';
import { Auth, authState } from '@angular/fire/auth';
import { toSignal } from '@angular/core/rxjs-interop';

interface FieldDefinition {
  name: string;
  displayName: string;
  type: 'text' | 'number' | 'boolean' | 'timestamp' | 'hidden';
  required?: boolean;
  defaultValue?: any;
}

@Component({
  selector: 'app-add-card',
  imports: [CommonModule],
  templateUrl: './add-card.html',
  styleUrls: ['./add-card.css']
})
export class AddCard {
  private firestore = inject(Firestore);
  private auth = inject(Auth);
  private authUser = toSignal(authState(this.auth));

  // Inputs and outputs
  deckName = input.required<string>();
  existingCards = input<any[]>([]);
  cardAdded = output<'close' | 'continue'>();
  modalClosed = output<void>();

  // Component state
  loading = signal(true);
  error = signal<string | null>(null);
  saving = signal(false);
  saveAction = signal<'close' | 'continue'>('close');

  // Field definitions and form data
  allFields = signal<FieldDefinition[]>([]);
  formData = signal<Record<string, any>>({});
  private initialFormData = signal<Record<string, any>>({});


  private lastValidState: boolean | undefined;
  // Computed properties for different field types
  editableFields = computed(() =>
    this.allFields().filter(field =>
      field.type !== 'timestamp' && field.type !== 'hidden'
    )
  );

  timestampFields = computed(() =>
    this.allFields().filter(field => field.type === 'timestamp')
  );

  hiddenFields = computed(() =>
    this.allFields().filter(field => field.type === 'hidden')
  );

  hasFormChanged = computed(() => {
  const current = this.formData();
  const initial = this.initialFormData();

  // Check if any editable field has changed from its initial value
  return this.editableFields().some(field => {
    const currentValue = current[field.name];
    const initialValue = initial[field.name];

    // Handle empty string vs null/undefined as the same
    const normalizedCurrent = currentValue === '' || currentValue == null ? '' : String(currentValue).trim();
    const normalizedInitial = initialValue === '' || initialValue == null ? '' : String(initialValue).trim();

    return normalizedCurrent !== normalizedInitial;
  });
});

  private initialized = signal(false);

constructor() {
  // Initialize fields when component loads - but only once
  effect(() => {
    if (this.deckName() && !this.initialized()) {
      console.log('🚀 First time initialization triggered');
      this.initializeFields();
      this.initialized.set(true);
    }
  });
}


  // Add this method for debugging (call it manually when needed):
debugFormChanges(): void {
  const current = this.formData();
  const initial = this.initialFormData();

  console.log('🔍 hasFormChanged - checking changes...');
  console.log('📋 Current form data:', current);
  console.log('📋 Initial form data:', initial);
  console.log('📝 Editable fields:', this.editableFields().map(f => f.name));

  this.editableFields().forEach(field => {
    const currentValue = current[field.name];
    const initialValue = initial[field.name];

    const normalizedCurrent = currentValue === '' || currentValue == null ? '' : String(currentValue).trim();
    const normalizedInitial = initialValue === '' || initialValue == null ? '' : String(initialValue).trim();

    const fieldChanged = normalizedCurrent !== normalizedInitial;

    console.log(`🔍 Field "${field.name}": current="${normalizedCurrent}" initial="${normalizedInitial}" changed=${fieldChanged}`);
  });

  console.log('🔄 Overall form changed:', this.hasFormChanged());
}
  // Updated initializeFields - no hardcoded field names except automatic ones
  private initializeFields() {
    this.loading.set(true);
    this.error.set(null);

    const cards = this.existingCards();

    try {
      if (!cards || cards.length === 0) {
        // No existing cards - create minimal default fields
        const defaultFields: FieldDefinition[] = [

          // Editable fields for first card
    {
      name: 'lemma',
      displayName: 'Lemma',
      type: 'text',
      required: true
    },
    {
      name: 'definition',
      displayName: 'Definition',
      type: 'text',
      required: true
    },

          {
            name: 'createdAt',
            displayName: 'Created At',
            type: 'timestamp',
            required: false
          },
          {
            name: 'lastUpdatedAt',
            displayName: 'Last Updated At',
            type: 'timestamp',
            required: false
          },
          {
            name: 'reviewCount',
            displayName: 'Review Count',
            type: 'hidden',
            required: false
          },
          {
            name: 'score',
            displayName: 'Score',
            type: 'hidden',
            required: false
          },
          {
            name: 'hiddenFields',
            displayName: 'Hidden Fields',
            type: 'hidden',
            required: false
          }
        ];

        this.allFields.set(defaultFields);
        this.initializeFormData();
      } else {
        // Analyze existing cards to determine field structure
        this.analyzeExistingFields(cards);
      }
    } catch (err) {
      console.error('Error initializing fields:', err);
      this.error.set('Failed to initialize card fields');
    } finally {
      this.loading.set(false);
    }
  }

  // Updated analyzeExistingFields - no hardcoded field names
  private analyzeExistingFields(cards: any[]) {
    const fieldAnalysis = new Map<string, {
      type: 'text' | 'number' | 'boolean' | 'timestamp' | 'hidden';
      hasValues: boolean;
      sampleValues: any[];
    }>();

    // Analyze all fields across all cards
    cards.forEach(card => {
      Object.entries(card).forEach(([fieldName, value]) => {
        if (fieldName === 'id') return;

        if (!fieldAnalysis.has(fieldName)) {
          fieldAnalysis.set(fieldName, {
            type: 'text', // Default to text
            hasValues: false,
            sampleValues: []
          });
        }

        const analysis = fieldAnalysis.get(fieldName)!;

        if (value != null && value !== '') {
          analysis.hasValues = true;
          analysis.sampleValues.push(value);
        }
      });
    });

    // Convert analysis to field definitions
    const fields: FieldDefinition[] = Array.from(fieldAnalysis.entries())
      .map(([name, analysis]) => {
        // Determine field type based on automatic field names
        let fieldType: 'text' | 'number' | 'boolean' | 'timestamp' | 'hidden';

        if (['createdAt', 'lastUpdatedAt', 'lastReviewedAt'].includes(name)) {
          fieldType = 'timestamp';
        } else if (['reviewCount', 'score', 'hiddenFields'].includes(name)) {
          fieldType = 'hidden';
        } else {
          // All other fields are editable text fields
          fieldType = 'text';
        }

        return {
          name,
          displayName: this.formatFieldName(name),
          type: fieldType,
          required: false // No hardcoded required fields
        };
      })
      .sort((a, b) => {
        // Sort order: timestamp fields first, then text fields, then hidden fields
        if (a.type === 'timestamp' && b.type !== 'timestamp') return -1;
        if (a.type !== 'timestamp' && b.type === 'timestamp') return 1;
        if (a.type === 'text' && b.type === 'hidden') return -1;
        if (a.type === 'hidden' && b.type === 'text') return 1;
        return a.displayName.localeCompare(b.displayName);
      });

    console.log('🔍 Analyzed fields:', fields);
    this.allFields.set(fields);
    this.initializeFormData();
  }

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
      const date = new Date(value);
      const dateSeconds = new Date(value * 1000);
      return (date.getFullYear() > 1970 && date.getFullYear() < 3000) ||
             (dateSeconds.getFullYear() > 1970 && dateSeconds.getFullYear() < 3000);
    }
    return false;
  }

  // Updated initializeFormData - all editable fields are text with empty string defaults
  private initializeFormData() {
    console.log('🔄 initializeFormData called');
    console.log('📝 Editable fields:', this.editableFields());

    const data: Record<string, any> = {};

    // Initialize editable fields (all text fields)
    this.editableFields().forEach(field => {
      let defaultValue;
      if (field.defaultValue !== undefined) {
        defaultValue = field.defaultValue;
      } else {
        defaultValue = ''; // All editable fields default to empty string
      }

      data[field.name] = defaultValue;
      console.log(`📝 Setting ${field.name} (${field.type}) =`, defaultValue);
    });

    console.log('📋 New form data:', data);
    this.formData.set(data);

    // Store initial state for change detection
    const initialData = { ...data };
    console.log('📋 New initial form data:', initialData);
    this.initialFormData.set(initialData);

    console.log('✅ Form initialization complete');
    console.log('🔄 Has form changed after init:', this.hasFormChanged());
    console.log('✅ Form is valid after init:', this.isFormValid());
  }

  private formatFieldName(fieldName: string): string {
    return fieldName
      .replace(/([A-Z])/g, ' $1')
      .replace(/[_-]/g, ' ')
      .replace(/\b\w/g, l => l.toUpperCase())
      .trim();
  }

  setSaveAction(action: 'close' | 'continue') {
    console.log('🔧 setSaveAction called with:', action);
    this.saveAction.set(action);
    console.log('Save action set to:', this.saveAction());
  }


  isFormValid(): boolean {
  const requiredFields = this.editableFields().filter(f => f.required);
  const currentData = this.formData();

  const requiredFieldsValid = requiredFields.every(field => {
    const value = currentData[field.name];
    return value != null && String(value).trim() !== '';
  });

  const formChanged = this.hasFormChanged();
  const isValid = requiredFieldsValid && formChanged;

  // Only log when form validity changes
  if (this.lastValidState !== isValid) {
    console.log('✅ Form validity changed:', {
      requiredFieldsValid,
      formChanged,
      isValid
    });
    this.lastValidState = isValid;
  }

  return isValid;
}


async saveCard() {
  console.log('💾 saveCard method started');
  console.log('Current save action:', this.saveAction());

  if (this.saving() || !this.isFormValid()) {
    console.log('❌ saveCard blocked - saving:', this.saving(), 'valid:', this.isFormValid());
    return;
  }

  console.log('🔄 Setting saving to true');
  this.saving.set(true);
  this.error.set(null);

  try {
    const user = this.authUser();
    if (!user) {
      throw new Error('User not authenticated');
    }

    console.log('👤 User authenticated, preparing card data...');

    // Get the current action FIRST, before any async operations
    const currentAction = this.saveAction();
    console.log('🎯 Current action:', currentAction);

    // Prepare card data
    const cardData: Record<string, any> = { ...this.formData() };
    console.log('📋 Form data to save:', cardData);

    // Add timestamp fields
    this.timestampFields().forEach(field => {
      cardData[field.name] = serverTimestamp();
      console.log('⏰ Added timestamp field:', field.name);
    });

    // Add automatic fields
    this.hiddenFields().forEach(field => {
      if (field.name === 'reviewCount') {
        cardData[field.name] = 0;
        console.log('🔢 Auto-set reviewCount = 0');
      } else if (field.name === 'score') {
        cardData[field.name] = 0;
        console.log('🔢 Auto-set score = 0');
      } else if (field.name === 'hiddenFields') {
        // Set hiddenFields to array containing the name of the second editable field
        const editableFieldNames = this.editableFields().map(f => f.name);
        const secondFieldName = editableFieldNames.length > 1 ? editableFieldNames[1] : '';
        cardData[field.name] = [secondFieldName];
        console.log('📋 Auto-set hiddenFields = [' + secondFieldName + ']');
      } else {
        cardData[field.name] = null;
        console.log('🙈 Added hidden field:', field.name, '= null');
      }
    });

    // Convert form values - since all editable fields are text, no conversion needed
    console.log('📝 All editable fields are text type - no conversion needed');

    console.log('📤 Final card data:', cardData);

    // Save to Firestore
    const cardsCollection = collection(
      this.firestore,
      `users/${user.uid}/collections/${this.deckName()}/cards`
    );

    console.log('🔥 Saving to Firestore...');
    await addDoc(cardsCollection, cardData);
    console.log('✅ Successfully saved to Firestore');

    // Emit that a card was added with the current action
    console.log('📡 Emitting cardAdded event with action:', currentAction);
    this.cardAdded.emit(currentAction);

    // Handle post-save action AFTER successful save
    console.log('🎯 Processing post-save action:', currentAction);

    if (currentAction === 'close') {
      console.log('🚪 Action is CLOSE - closing modal');
      this.closeModal();
    } else if (currentAction === 'continue') {
      console.log('➕ Action is CONTINUE - resetting form and keeping modal open');

      // Log current form state before reset
      console.log('📋 Form data before reset:', this.formData());
      console.log('📋 Initial form data before reset:', this.initialFormData());

      // Reset form for adding another card but keep modal open
      this.initializeFormData();

      // Log form state after reset
      console.log('📋 Form data after reset:', this.formData());
      console.log('📋 Initial form data after reset:', this.initialFormData());

      // Reset save action back to default
      console.log('🔧 Resetting save action to close');
      this.saveAction.set('close');
      console.log('🔧 Save action after reset:', this.saveAction());

      console.log('✨ Form reset complete - modal should remain open');
    } else {
      console.warn('⚠️ Unexpected save action:', currentAction);
    }

  } catch (err) {
    console.error('❌ Error saving card:', err);
    this.error.set('Failed to save card. Please try again.');
  } finally {
    console.log('🏁 Setting saving to false');
    this.saving.set(false);
    console.log('💾 saveCard method completed');
  }
}


  updateFormField(fieldName: string, value: any): void {
  console.log('✏️ Updating form field:', fieldName, '=', value);
  const currentData = this.formData();
  const newData = {
    ...currentData,
    [fieldName]: value
  };
  this.formData.set(newData);

  // Debug after update
  this.debugFormChanges();
  console.log('✅ Form is valid:', this.isFormValid());
}

  async onSubmit(action: 'close' | 'continue'): Promise<void> {
    console.log('🚀 onSubmit called with action:', action);
    console.log('Current saving state:', this.saving());
    console.log('Form valid:', this.isFormValid());

    if (this.saving() || !this.isFormValid()) {
      console.log('❌ Submission blocked - saving:', this.saving(), 'valid:', this.isFormValid());
      return;
    }

    console.log('✅ Setting save action to:', action);
    this.setSaveAction(action);
    console.log('Save action after setting:', this.saveAction());

    console.log('📤 Calling saveCard...');
    await this.saveCard();
    console.log('📥 saveCard completed');
  }

  closeModal() {
    console.log('🚪 closeModal called - emitting modalClosed');
    this.modalClosed.emit();
  }

  onOverlayClick(event: MouseEvent) {
    if (event.target === event.currentTarget) {
      this.closeModal();
    }
  }
}
