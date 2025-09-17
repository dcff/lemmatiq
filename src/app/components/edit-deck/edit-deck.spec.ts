import { ComponentFixture, TestBed } from '@angular/core/testing';

import { EditDeck } from './edit-deck';

describe('EditDeck', () => {
  let component: EditDeck;
  let fixture: ComponentFixture<EditDeck>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EditDeck]
    })
    .compileComponents();

    fixture = TestBed.createComponent(EditDeck);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
