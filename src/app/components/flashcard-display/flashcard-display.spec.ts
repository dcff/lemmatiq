import { ComponentFixture, TestBed } from '@angular/core/testing';

import { FlashcardDisplay } from './flashcard-display';

describe('FlashcardDisplay', () => {
  let component: FlashcardDisplay;
  let fixture: ComponentFixture<FlashcardDisplay>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FlashcardDisplay]
    })
    .compileComponents();

    fixture = TestBed.createComponent(FlashcardDisplay);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
