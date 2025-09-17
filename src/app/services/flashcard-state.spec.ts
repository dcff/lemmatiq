import { TestBed } from '@angular/core/testing';

import { FlashcardState } from './flashcard-state';

describe('FlashcardState', () => {
  let service: FlashcardState;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(FlashcardState);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
