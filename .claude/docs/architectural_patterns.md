# Architectural Patterns

## 1. Angular Signals as Primary State

All local and shared state uses Angular signals, not RxJS subjects or BehaviorSubjects.

- `signal<T>(initial)` for mutable state
- `computed(() => ...)` for derived values — never recalculated unless deps change
- `effect(() => ...)` for side-effects (logging, Firebase subscriptions)

Example: `src/app/services/auth.ts:18-21`
```
private _currentUser = signal<User | null>(null);
public isAuthenticated = computed(() => this._currentUser() !== null);
```

Example: `src/app/components/flashcard-display/flashcard-display.ts:36-63` — the entire
review screen state (currentIndex, answersRevealed, isEditing, session counts, etc.) is
signals + computed.

## 2. `inject()` Function for Dependency Injection

Services are injected via `inject()` in class body, not constructor parameters.
All services use `@Injectable({ providedIn: 'root' })`.

```typescript
// Used in every component and service:
private firestore = inject(Firestore);
private auth = inject(Auth);
private state = inject(FlashcardStateService);
```

Found in: `flashcard-display.ts:25-28`, `auth.ts:15`, `deck-list.ts`, `card-filter.ts`, etc.

## 3. FlashcardStateService as Cross-Route State Bus

`src/app/services/flashcard-state.ts` — only 7 lines. It holds two signals:
- `cards = signal<any[]>([])` — card array set by CardFilter, read by FlashcardDisplay
- `deckName = signal('')` — active deck identifier

**Pattern:** CardFilter populates state → router navigates to `/review` → FlashcardDisplay
reads state. No @Input/@Output across route boundaries; state service is the contract.

## 4. Standalone Components (No NgModules)

Every component uses `@Component({ standalone: true, imports: [...] })`.
Imports are explicit per component — no shared modules.

App bootstrap: `src/main.ts` calls `bootstrapApplication(App, appConfig)`.
Providers configured in `src/app/app.config.ts` (Firebase, router, zone detection).

## 5. FirebaseService — Generic Query Builder Pattern

`src/app/services/firebase.ts` uses a constraint-array pattern for Firestore queries.

```typescript
const constraints: QueryConstraint[] = [];
filters.forEach(f => constraints.push(where(f.field, f.operator, f.value)));
if (sortField) constraints.push(orderBy(sortField, sortDirection));
if (limitCount) constraints.push(limit(limitCount));
const q = query(collectionRef, ...constraints);
```

Used in `queryDocuments()` (line 176) and `paginatedQuery()` (line 256).

**Cursor-based pagination:** `paginatedQuery()` returns `{ docs, lastDoc }` where
`lastDoc` is passed back as the cursor for the next page (`startAfter(lastDoc)`).

## 6. CSV Batch Upload Strategy

`src/app/services/firebase.ts:56-110`

- ≤20 records → individual `addDoc` calls
- >20 records → Firestore `writeBatch` in chunks of 500 (Firestore's max per batch)

Both paths add `createdAt: new Date()` unless `addCreatedAt = false`.

## 7. Field Categorization in FlashcardDisplay

`src/app/components/flashcard-display/flashcard-display.ts:31-33`

Cards have dynamic fields (any CSV headers). Fields are split into groups via constants:

```typescript
private readonly AUXILIARY_DATE_FIELDS = ['createdAt', 'lastReviewedAt'];
private readonly AUXILIARY_NUMERIC_FIELDS = ['score', 'reviewCount'];
private readonly AUXILIARY_ARRAY_FIELDS = ['hiddenFields'];
```

`mainFields` computed = all fields excluding the above three sets.
`hiddenFields[]` stored on each card document controls which main fields are hidden
during review (shown only after user reveals answer).

## 8. User-Scoped Firestore Paths

All user data lives under `users/{uid}/collections/{deckId}/cards/{cardId}`.
Components build the collection path string dynamically using `auth.currentUser.uid`.

Deck deletion requires recursive deletion of the `cards` subcollection before deleting
the parent deck document: `src/app/components/deck-list/deck-list.ts:289-334`.

## 9. Keyboard-Driven Review UX

`src/app/components/flashcard-display/flashcard-display.ts` uses `@HostListener('keydown')`
to handle global keypresses during review:

| Key | Action |
|---|---|
| Space / Enter | Reveal hidden fields or mark correct |
| Backspace | Mark incorrect |
| ArrowLeft/Right | Navigate cards |
| D | Delete card |
| E | Toggle edit mode |
| F | Flip card |
