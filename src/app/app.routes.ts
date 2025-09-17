import { Routes } from '@angular/router';
import { UserProfile } from './components/user-profile/user-profile';
import { CardFilter } from './components/card-filter/card-filter';
import { DeckList } from './components/deck-list/deck-list';
import { FlashcardDisplay } from './components/flashcard-display/flashcard-display';
import { EditDeck } from './components/edit-deck/edit-deck';
import { ColorPicker } from './components/color-picker/color-picker';

export const routes: Routes = [
  { path: 'profile', component: UserProfile  },
  { path: '', redirectTo: '/decks', pathMatch: 'full' },
  { path: 'decks', component: DeckList },
  { path: 'options', component: ColorPicker },
  { path: 'review', component: FlashcardDisplay },
  { path: 'filter/:deckName', component: CardFilter },
  { path: 'edit-deck/:id', component: EditDeck },
  //{ path: '**', redirectTo: '/decks' } // Wildcard route for 404
];
